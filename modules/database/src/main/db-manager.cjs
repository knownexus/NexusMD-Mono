// electron/ipc/db-manager.cjs
//
// Node-side IPC handler for the Database Manager module.
// All real DB work happens here — never in the renderer process.
//
// Follows the withLogging pattern used by oauth.cjs and api-client-script.cjs
// so failures appear in the desktop Logs view.
//
// Supports: SQL Server (mssql package) and SQLite (better-sqlite3 package).
// SQL Server signs in with a SQL login, or interactively with Microsoft Entra
// ID (Azure AD) through @azure/identity.
// Both are optional peer dependencies — a clear error is thrown if one is
// used without being installed.
//
// The driver loaders are injectable via `register(ipcMain, { drivers })`
// (default: the real `require('mssql')` / `require('better-sqlite3')`) —
// vi.mock() cannot intercept a CJS require() inside this file, so tests
// inject fakes this way instead (same pattern as oauth.cjs's `deps` param).

'use strict'

const { withLogging } = require('@nexusmd/main-kit/with-logging')

// ─── Connection/db caches (process-lifetime) ──────────────────────────────────

/** @type {Map<string, import('mssql').ConnectionPool>} */
const sqlPools = new Map()

/** @type {Map<string, import('better-sqlite3').Database>} */
const sqliteDbs = new Map()

// ─── Default driver loaders ────────────────────────────────────────────────────

function requireMssql() {
  try { return require('mssql') }
  catch { throw new Error('mssql is not installed. Run: npm -w apps/desktop install mssql') }
}

function requireSqlite() {
  try { return require('better-sqlite3') }
  catch { throw new Error('better-sqlite3 is not installed. Run: npm -w apps/desktop install better-sqlite3') }
}

// Microsoft Entra ID (Azure AD) interactive sign-in: opens the system browser,
// then hands the token to tedious through its `token-credential` auth type.
function createInteractiveCredential({ loginHint }) {
  const { InteractiveBrowserCredential } = require('@azure/identity')
  return new InteractiveBrowserCredential({ loginHint })
}

const DEFAULT_DRIVERS = { requireMssql, requireSqlite, createInteractiveCredential }

const AZURE_AD_INTERACTIVE = 'azure-ad-interactive'
const AZURE_SQL_SCOPE = 'https://database.windows.net/.default'

const SAFE_ID = /^[a-zA-Z_][a-zA-Z0-9_ ]*$/
function validateIdentifier(name) {
  if (!SAFE_ID.test(name)) throw new Error(`Invalid identifier: "${name}"`)
}

// A table as connect lists it. SQL Server names one outside dbo by its schema (maintenance.Member) and
// a dbo table bare, so a bare name there is always dbo. Both are sent qualified: a bare [Member] would
// resolve to the login's default schema first and could read or write a namesake there.
// SQLite names have no schema part (schema is null).
function tableName(type, table) {
  if (type !== 'sqlserver' || typeof table !== 'string') {
    validateIdentifier(table)
    return { schema: null, name: table, sql: `[${table}]` }
  }
  if (!table.includes('.')) {
    validateIdentifier(table)
    return { schema: 'dbo', name: table, sql: `[dbo].[${table}]` }
  }
  const [schema, name, ...rest] = table.split('.')
  if (rest.length) throw new Error(`Invalid identifier: "${table}"`)
  validateIdentifier(schema)
  validateIdentifier(name)
  return { schema, name, sql: `[${schema}].[${name}]` }
}

// How connect lists a table: dbo tables keep their bare name (and so their saved stars and groups);
// others carry their schema.
const listName = (schema, name) => (!schema || schema === 'dbo' ? name : `${schema}.${name}`)

// ─── SQL Server pool factory ──────────────────────────────────────────────────

/** @type {Map<string, import('@azure/identity').TokenCredential>} */
const interactiveCredentials = new Map()

// One credential per account, so its token cache lives for the whole session:
// the browser opens once, then new pool connections (and reconnects to other
// databases as the same account) get their tokens silently.
async function getInteractiveCredential(cfg, drivers) {
  const loginHint = cfg.user || undefined
  const key = loginHint ?? ''
  let credential = interactiveCredentials.get(key)
  if (!credential) {
    credential = drivers.createInteractiveCredential({ loginHint })
    interactiveCredentials.set(key, credential)
  }
  // Sign in before connecting — a browser sign-in can take longer than
  // tedious's connect timeout, which would otherwise cut it short.
  await credential.getToken(AZURE_SQL_SCOPE)
  return credential
}

async function getSqlPool(cfg, drivers) {
  const interactive = cfg.authentication === AZURE_AD_INTERACTIVE
  const key = `${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user ?? ''}/${interactive ? AZURE_AD_INTERACTIVE : 'sql'}`
  if (sqlPools.has(key)) return sqlPools.get(key)

  const sql = drivers.requireMssql()
  const auth = interactive
    ? { authentication: { type: 'token-credential', options: { credential: await getInteractiveCredential(cfg, drivers) } } }
    : { user: cfg.user, password: cfg.password }
  const pool = await sql.connect({
    server:   cfg.server,
    port:     cfg.port ?? 1433,
    database: cfg.database,
    ...auth,
    options: {
      encrypt:               cfg.encrypt !== false,
      trustServerCertificate: cfg.trustServerCertificate ?? false,
      connectTimeout:         15_000,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  })
  sqlPools.set(key, pool)
  return pool
}

// ─── SQLite connection factory ────────────────────────────────────────────────

function getSqliteDb(filePath, drivers) {
  if (sqliteDbs.has(filePath)) return sqliteDbs.get(filePath)
  const Database = drivers.requireSqlite()
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  sqliteDbs.set(filePath, db)
  return db
}

// ─── Shared row reader ────────────────────────────────────────────────────────

function recordsetToRows(recordset) {
  // The driver names the columns even when no row comes back, so an empty table keeps its
  // columns (and the grid can still find its key).
  const meta = recordset?.columns ? Object.values(recordset.columns).sort((a, b) => a.index - b.index).map(c => c.name) : []
  if (!recordset?.length) return { columns: meta, rows: [] }
  const columns = meta.length ? meta : Object.keys(recordset[0])
  const rows = recordset.map(r => columns.map(c => r[c] ?? null))
  return { columns, rows }
}

// One statement only: semicolons inside strings, [names], "names" and comments don't count, nor
// does a trailing one. (The same rule as isSingleStatement in @nexusmd/core's ddl.js, which this
// CommonJS file can't import.)
function isSingleStatement(sql) {
  const bare = String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\[(?:[^\]]|\]\])*\]/g, '[]')
    .replace(/"(?:[^"]|"")*"/g, '""')
    .trim()
    .replace(/;\s*$/, '')
  return !bare.includes(';')
}

// better-sqlite3 binds numbers, strings, bigints, buffers and null only; a bit arrives as a boolean.
const sqliteValue = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)

// ─── Handlers (factory so each carries its own `drivers`) ────────────────────

function makeHandlers(drivers) {
  // Tables and views together (both can be browsed and queried); `views` says which are views.
  async function handleConnect(_e, { type, config }) {
    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request().query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW') AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
        ORDER BY TABLE_NAME
      `)
      const named = r => listName(r.TABLE_SCHEMA, r.TABLE_NAME)
      return {
        ok: true,
        tables: result.recordset.map(named),
        views: result.recordset.filter(r => r.TABLE_TYPE === 'VIEW').map(named),
      }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const rows = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
      return { ok: true, tables: rows.map(r => r.name), views: rows.filter(r => r.type === 'view').map(r => r.name) }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  // Creates or drops a table or view. Only those four statements, one at a time: the renderer
  // builds them (and shows them first), so anything else is a mistake, not a feature.
  const DDL = /^\s*(CREATE\s+TABLE|CREATE\s+VIEW|DROP\s+TABLE|DROP\s+VIEW)\s/i
  async function handleRunDdl(_e, { type, config, sql }) {
    if (typeof sql !== 'string' || !DDL.test(sql)) throw new Error('Only CREATE TABLE, CREATE VIEW, DROP TABLE and DROP VIEW can be run this way.')
    if (!isSingleStatement(sql)) throw new Error('Run one statement at a time.')

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      await pool.request().query(sql)
      return { ok: true }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      db.prepare(sql).run()
      return { ok: true }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  // `where` is a list of { column, value } ANDed together; a null or undefined value matches IS NULL.
  async function handleGetRows(_e, { type, config, table, limit = 500, offset = 0, where }) {
    const t = tableName(type, table)
    const filters = (where ?? []).map(({ column, value }) => { validateIdentifier(column); return { column, value: value ?? null } })
    const safeLimit  = Math.min(Math.max(parseInt(limit,  10) || 500,  1), 10_000)
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const request = pool.request()
      const clause  = filters.map(({ column, value }, i) => {
        if (value === null) return `[${column}] IS NULL`
        request.input(`w${i}`, value)
        return `[${column}] = @w${i}`
      })
      const result = await request.query(`
        SELECT * FROM ${t.sql}
        ${clause.length ? `WHERE ${clause.join(' AND ')}` : ''}
        ORDER BY (SELECT NULL)
        OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY
      `)
      return recordsetToRows(result.recordset)
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const clause  = filters.map(({ column, value }) => value === null ? `"${column}" IS NULL` : `"${column}" = ?`)
      const whereSql  = clause.length ? ` WHERE ${clause.join(' AND ')}` : ''
      const stmt    = db.prepare(`SELECT * FROM "${table}"${whereSql} LIMIT ? OFFSET ?`)
      const rawRows = stmt.all(...filters.filter(f => f.value !== null).map(f => f.value), safeLimit, safeOffset)
      // better-sqlite3 knows the columns before any row is read, so an empty table keeps them.
      const named   = typeof stmt.columns === 'function' ? stmt.columns().map(c => c.name) : []
      if (!rawRows.length) return { columns: named, rows: [] }
      const columns = named.length ? named : Object.keys(rawRows[0])
      const rows    = rawRows.map(r => columns.map(c => r[c] ?? null))
      return { columns, rows }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  // A row is found by its primary key: one column (`primaryKey: 'id'`, value `5`) or several
  // (`primaryKey: ['a', 'b']`, value `[1, 2]`), so a composite key never matches extra rows.
  function keyColumns(primaryKey) {
    const keys = Array.isArray(primaryKey) ? primaryKey : [primaryKey]
    if (!keys.length) throw new Error('primaryKey must name at least one column')
    keys.forEach(validateIdentifier)
    return keys
  }
  const keyValues = (keys, v) => (keys.length === 1 && !Array.isArray(v) ? [v] : v)

  async function handleDeleteRows(_e, { type, config, table, primaryKey, values }) {
    const t = tableName(type, table)
    const keys = keyColumns(primaryKey)
    if (!Array.isArray(values) || values.length === 0) throw new Error('values must be a non-empty array')
    const rows = values.map(v => keyValues(keys, v))
    if (rows.some(r => !Array.isArray(r) || r.length !== keys.length)) throw new Error('each value must give every key column')

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      const where   = rows.map((r, i) => `(${keys.map((k, j) => { request.input(`v${i}_${j}`, r[j]); return `[${k}] = @v${i}_${j}` }).join(' AND ')})`)
      const result  = await request.query(`DELETE FROM ${t.sql} WHERE ${where.join(' OR ')}`)
      return { ok: true, affected: result.rowsAffected[0] }
    }

    if (type === 'sqlite') {
      const db    = getSqliteDb(config.filePath, drivers)
      const where = rows.map(() => `(${keys.map(k => `"${k}" = ?`).join(' AND ')})`).join(' OR ')
      const info  = db.prepare(`DELETE FROM "${table}" WHERE ${where}`).run(...rows.flat())
      return { ok: true, affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleUpdateCell(_e, { type, config, table, primaryKey, primaryValue, column, value }) {
    const t = tableName(type, table)
    validateIdentifier(column)
    const keys = keyColumns(primaryKey)
    const key  = keyValues(keys, primaryValue)
    if (!Array.isArray(key) || key.length !== keys.length) throw new Error('primaryValue must give every key column')

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request().input('val', value ?? null)
      const where   = keys.map((k, j) => { request.input(`pk${j}`, key[j]); return `[${k}] = @pk${j}` }).join(' AND ')
      const result  = await request.query(`UPDATE ${t.sql} SET [${column}] = @val WHERE ${where}`)
      return { ok: true, affected: result.rowsAffected[0] }
    }

    if (type === 'sqlite') {
      const db   = getSqliteDb(config.filePath, drivers)
      const info = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE ${keys.map(k => `"${k}" = ?`).join(' AND ')}`)
                     .run(sqliteValue(value), ...key)
      return { ok: true, affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  // Adds a row. `values` maps column names to values; columns left out get their default
  // (identity and computed columns are always left out by the caller).
  async function handleInsertRow(_e, { type, config, table, values = {} }) {
    const t = tableName(type, table)
    const cols = Object.keys(values)
    cols.forEach(validateIdentifier)

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      cols.forEach((c, i) => request.input(`v${i}`, values[c] ?? null))
      const sql = cols.length
        ? `INSERT INTO ${t.sql} (${cols.map(c => `[${c}]`).join(', ')}) VALUES (${cols.map((_, i) => `@v${i}`).join(', ')})`
        : `INSERT INTO ${t.sql} DEFAULT VALUES`
      const result = await request.query(sql)
      return { ok: true, affected: result.rowsAffected[0] }
    }

    if (type === 'sqlite') {
      const db  = getSqliteDb(config.filePath, drivers)
      const sql = cols.length
        ? `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
        : `INSERT INTO "${table}" DEFAULT VALUES`
      const info = db.prepare(sql).run(...cols.map(c => sqliteValue(values[c])))
      return { ok: true, affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleGetColumns(_e, { type, config, table }) {
    const t = tableName(type, table)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request()
        .input('object', t.sql)
        .input('table', t.name)
        .query(`
          SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType,
                 CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isPrimaryKey,
                 CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
                 c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
                 c.NUMERIC_PRECISION AS numericPrecision, c.NUMERIC_SCALE AS numericScale,
                 CASE WHEN c.COLUMN_DEFAULT IS NOT NULL THEN 1 ELSE 0 END AS hasDefault,
                 COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS isIdentity,
                 COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed') AS isComputed
          FROM INFORMATION_SCHEMA.COLUMNS c
          LEFT JOIN (
            SELECT ku.COLUMN_NAME, ku.TABLE_NAME, ku.TABLE_SCHEMA
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
              ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
             AND tc.CONSTRAINT_SCHEMA = ku.CONSTRAINT_SCHEMA
             AND tc.TABLE_NAME = ku.TABLE_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME AND pk.TABLE_NAME = c.TABLE_NAME AND pk.TABLE_SCHEMA = c.TABLE_SCHEMA
          WHERE c.TABLE_NAME = @table
            AND OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)) = OBJECT_ID(@object)
          ORDER BY c.ORDINAL_POSITION
        `)
      // Precision and scale only mean something for decimal / numeric (float reports them too).
      const exact = t => /^(decimal|numeric)$/i.test(t)
      return {
        ok: true,
        columns: result.recordset.map(r => ({
          name: r.name, dataType: r.dataType, isPrimaryKey: !!r.isPrimaryKey,
          nullable: !!r.nullable, maxLength: r.maxLength ?? null,
          precision: exact(r.dataType) ? r.numericPrecision : null, scale: exact(r.dataType) ? r.numericScale : null,
          hasDefault: !!r.hasDefault, isIdentity: !!r.isIdentity, isComputed: !!r.isComputed,
        })),
      }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const rows = db.prepare(`PRAGMA table_info("${table}")`).all()
      // A lone INTEGER PRIMARY KEY is the rowid: SQLite fills it in, like an identity column.
      const rowid = rows.filter(r => r.pk > 0).length === 1 ? rows.find(r => r.pk > 0 && /^integer$/i.test(r.type)) : null
      return {
        ok: true,
        columns: rows.map(r => ({
          name: r.name, dataType: r.type, isPrimaryKey: r.pk > 0,
          nullable: !r.notnull && r.pk === 0, maxLength: null, precision: null, scale: null,
          hasDefault: r.dflt_value != null || r === rowid, isIdentity: r === rowid, isComputed: false,
        })),
      }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  // Foreign keys both ways and indexes, for the Structure tab. Each SQL Server query is one request;
  // its rows (one per key column) are grouped here.
  async function handleGetStructure(e, { type, config, table }) {
    const t = tableName(type, table)
    const { columns } = await handleGetColumns(e, { type, config, table })

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const run = sql => pool.request().input('object', t.sql).query(sql).then(r => r.recordset)
      const keyRows = where => run(`
        SELECT fk.name AS name,
               OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ownerSchema, OBJECT_NAME(fk.parent_object_id) AS ownerTable,
               COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS col,
               OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS refSchema, OBJECT_NAME(fk.referenced_object_id) AS refTable,
               COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS refCol,
               REPLACE(fk.delete_referential_action_desc, '_', ' ') AS onDelete,
               REPLACE(fk.update_referential_action_desc, '_', ' ') AS onUpdate
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        WHERE ${where}
        ORDER BY fk.name, fkc.constraint_column_id
      `)
      const group = (rows, target) => {
        const keys = new Map()
        for (const r of rows) {
          const id = `${r.ownerSchema}.${r.name}`
          let k = keys.get(id)
          if (!k) keys.set(id, k = { name: r.name, ...target(r), columns: [], refColumns: [], onDelete: r.onDelete, onUpdate: r.onUpdate })
          k.columns.push(r.col)
          k.refColumns.push(r.refCol)
        }
        return [...keys.values()]
      }
      const outgoing = await keyRows('fk.parent_object_id = OBJECT_ID(@object)')
      const incoming = await keyRows('fk.referenced_object_id = OBJECT_ID(@object)')
      const indexRows = await run(`
        SELECT i.name AS name, i.is_unique AS isUnique, i.is_primary_key AS isPrimaryKey, i.filter_definition AS filter,
               COL_NAME(ic.object_id, ic.column_id) AS col, ic.is_descending_key AS isDesc
        FROM sys.indexes i
        JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        WHERE i.object_id = OBJECT_ID(@object) AND i.type > 0 AND ic.key_ordinal > 0
        ORDER BY i.name, ic.key_ordinal
      `)
      const indexes = new Map()
      for (const r of indexRows) {
        let ix = indexes.get(r.name)
        if (!ix) indexes.set(r.name, ix = { name: r.name, columns: [], unique: !!r.isUnique, primaryKey: !!r.isPrimaryKey, filter: r.filter ?? null })
        ix.columns.push({ name: r.col, desc: !!r.isDesc })
      }
      return {
        ok: true,
        columns,
        foreignKeys: group(outgoing, r => ({ refTable: listName(r.refSchema, r.refTable) })),
        // Constraint names are unique per schema only, so a key from another schema carries it.
        referencedBy: group(incoming, r => ({
          table: listName(r.ownerSchema, r.ownerTable),
          name: r.ownerSchema === t.schema ? r.name : `${r.ownerSchema}.${r.name}`,
        })),
        indexes: [...indexes.values()],
      }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const q = name => `"${name.replace(/"/g, '""')}"`
      const keysOf = name => {
        const keys = new Map()
        for (const r of db.prepare(`PRAGMA foreign_key_list(${q(name)})`).all()) {
          let k = keys.get(r.id)
          if (!k) keys.set(r.id, k = { table: r.table, parts: [], onDelete: r.on_delete, onUpdate: r.on_update })
          k.parts.push({ seq: r.seq, from: r.from, to: r.to })
        }
        return [...keys.values()].map(k => {
          const parts = k.parts.sort((a, b) => a.seq - b.seq)
          return { table: k.table, columns: parts.map(p => p.from), to: parts.map(p => p.to), onDelete: k.onDelete, onUpdate: k.onUpdate }
        })
      }
      // `to` is null when the key points at the target's primary key.
      const primaryKeyOf = name => db.prepare(`PRAGMA table_info(${q(name)})`).all()
        .filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name)
      const targetColumns = k => (k.to.every(c => c != null) ? k.to : primaryKeyOf(k.table))
      // SQLite names no constraint, so the key id is its owner, columns and target.
      const keyName = (owner, columns, target) => `${owner}(${columns.join(', ')}) → ${target}`

      const foreignKeys = keysOf(t.name).map(k => ({
        name: keyName(t.name, k.columns, k.table), columns: k.columns, refTable: k.table, refColumns: targetColumns(k), onDelete: k.onDelete, onUpdate: k.onUpdate,
      }))

      const referencedBy = []
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      for (const { name } of tables) {
        for (const k of keysOf(name)) {
          if (k.table.toLowerCase() !== t.name.toLowerCase()) continue
          referencedBy.push({
            name: keyName(name, k.columns, k.table), table: name, columns: k.columns, refColumns: targetColumns(k), onDelete: k.onDelete, onUpdate: k.onUpdate,
          })
        }
      }

      const indexes = db.prepare(`PRAGMA index_list(${q(t.name)})`).all().map(ix => ({
        name: ix.name,
        columns: db.prepare(`PRAGMA index_xinfo(${q(ix.name)})`).all()
          .filter(c => c.key === 1).sort((a, b) => a.seqno - b.seqno).map(c => ({ name: c.name, desc: !!c.desc })),
        unique: !!ix.unique, primaryKey: ix.origin === 'pk', filter: null,
      }))
      return { ok: true, columns, foreignKeys, referencedBy, indexes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleRunQuery(_e, { type, config, sql }) {
    const trimmed = sql.trimStart().toUpperCase()
    const ALLOWED = ['SELECT', 'WITH', 'DELETE', 'INSERT', 'UPDATE']
    if (!ALLOWED.some(p => trimmed.startsWith(p))) {
      throw new Error('Only SELECT, WITH (CTE), DELETE, INSERT, and UPDATE statements are permitted.')
    }

    // Every result set the statement returns, each with its column names even when it has no rows,
    // so an empty SELECT still shows its headers. `columns`/`rows` are the first set's.
    const withSets = (sets, affected) => ({
      columns: sets[0]?.columns ?? [], rows: sets[0]?.rows ?? [], sets, affected: sets.length ? null : affected,
    })

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      // Rows as arrays, so two columns with the same name (a.id, b.id) both survive.
      request.arrayRowMode = true
      const result  = await request.query(sql)
      const metas   = result.columns ?? []
      const sets    = (result.recordsets ?? []).map((rs, i) => {
        // One result set gives a flat list of column metadata; several give one list each.
        const meta = Array.isArray(metas[0]) ? (metas[i] ?? []) : (i === 0 ? metas : [])
        const columns = [...meta].sort((a, b) => a.index - b.index).map(c => c.name)
        const rows = rs.map(r => (Array.isArray(r) ? r : columns.map(c => r[c])).map(v => v ?? null))
        return { columns: columns.length ? columns : recordsetToRows(rs).columns, rows }
      })
      const affected = (result.rowsAffected ?? []).reduce((n, x) => n + x, 0)
      return withSets(sets, affected)
    }

    if (type === 'sqlite') {
      const db   = getSqliteDb(config.filePath, drivers)
      const stmt = db.prepare(sql)
      const reads = typeof stmt.reader === 'boolean' ? stmt.reader : (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH'))
      if (reads) {
        // better-sqlite3 knows the columns before any row is read.
        if (typeof stmt.columns === 'function' && typeof stmt.raw === 'function') {
          const columns = stmt.columns().map(c => c.name)
          return withSets([{ columns, rows: stmt.raw(true).all().map(r => r.map(v => v ?? null)) }], null)
        }
        const rawRows = stmt.all()
        const columns = rawRows.length ? Object.keys(rawRows[0]) : []
        return withSets([{ columns, rows: rawRows.map(r => columns.map(c => r[c] ?? null)) }], null)
      }
      const info = stmt.run()
      return withSets([], info.changes)
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  return { handleConnect, handleRunDdl, handleGetRows, handleDeleteRows, handleUpdateCell, handleInsertRow, handleGetColumns, handleGetStructure, handleRunQuery }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function closeAll() {
  for (const [, pool] of sqlPools) {
    try { await pool.close() } catch {}
  }
  for (const [, db] of sqliteDbs) {
    try { db.close() } catch {}
  }
  sqlPools.clear()
  sqliteDbs.clear()
  interactiveCredentials.clear()
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all db-manager IPC channels.
 * Call this from electron/main.cjs inside the app.whenReady() block.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{ logger?: object, drivers?: { requireMssql?: Function, requireSqlite?: Function, createInteractiveCredential?: Function } }} [opts]
 */
function register(ipcMain, opts = {}) {
  const handle   = withLogging(ipcMain, opts.logger)
  const drivers  = { ...DEFAULT_DRIVERS, ...opts.drivers }
  const handlers = makeHandlers(drivers)

  handle('db-manager:connect',    handlers.handleConnect)
  handle('db-manager:get-rows',   handlers.handleGetRows)
  handle('db-manager:delete-rows', handlers.handleDeleteRows)
  handle('db-manager:update-cell', handlers.handleUpdateCell)
  handle('db-manager:insert-row',  handlers.handleInsertRow)
  handle('db-manager:run-ddl',     handlers.handleRunDdl)
  handle('db-manager:get-columns', handlers.handleGetColumns)
  handle('db-manager:get-structure', handlers.handleGetStructure)
  handle('db-manager:run-query',  handlers.handleRunQuery)

  // Hook into Electron's quit lifecycle so connections are cleanly closed.
  // electron/main.cjs already calls app.on('before-quit', ...) for other teardown —
  // add this alongside it rather than relying on module-level process.on.
}

module.exports = { register, closeAll }
