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

const { withLogging } = require('./withLogging.cjs')

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
  if (!recordset?.length) return { columns: [], rows: [] }
  const columns = Object.keys(recordset[0])
  const rows = recordset.map(r => columns.map(c => r[c] ?? null))
  return { columns, rows }
}

// better-sqlite3 binds numbers, strings, bigints, buffers and null only; a bit arrives as a boolean.
const sqliteValue = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)

// ─── Handlers (factory so each carries its own `drivers`) ────────────────────

function makeHandlers(drivers) {
  async function handleConnect(_e, { type, config }) {
    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request().query(`
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME
      `)
      return { ok: true, tables: result.recordset.map(r => r.TABLE_NAME) }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map(r => r.name)
      return { ok: true, tables }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleGetRows(_e, { type, config, table, limit = 500, offset = 0 }) {
    validateIdentifier(table)
    const safeLimit  = Math.min(Math.max(parseInt(limit,  10) || 500,  1), 10_000)
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request().query(`
        SELECT * FROM [${table}]
        ORDER BY (SELECT NULL)
        OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY
      `)
      return recordsetToRows(result.recordset)
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      const rawRows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(safeLimit, safeOffset)
      if (!rawRows.length) return { columns: [], rows: [] }
      const columns = Object.keys(rawRows[0])
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
    validateIdentifier(table)
    const keys = keyColumns(primaryKey)
    if (!Array.isArray(values) || values.length === 0) throw new Error('values must be a non-empty array')
    const rows = values.map(v => keyValues(keys, v))
    if (rows.some(r => !Array.isArray(r) || r.length !== keys.length)) throw new Error('each value must give every key column')

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      const where   = rows.map((r, i) => `(${keys.map((k, j) => { request.input(`v${i}_${j}`, r[j]); return `[${k}] = @v${i}_${j}` }).join(' AND ')})`)
      const result  = await request.query(`DELETE FROM [${table}] WHERE ${where.join(' OR ')}`)
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
    validateIdentifier(table)
    validateIdentifier(column)
    const keys = keyColumns(primaryKey)
    const key  = keyValues(keys, primaryValue)
    if (!Array.isArray(key) || key.length !== keys.length) throw new Error('primaryValue must give every key column')

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request().input('val', value ?? null)
      const where   = keys.map((k, j) => { request.input(`pk${j}`, key[j]); return `[${k}] = @pk${j}` }).join(' AND ')
      const result  = await request.query(`UPDATE [${table}] SET [${column}] = @val WHERE ${where}`)
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
    validateIdentifier(table)
    const cols = Object.keys(values)
    cols.forEach(validateIdentifier)

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      cols.forEach((c, i) => request.input(`v${i}`, values[c] ?? null))
      const sql = cols.length
        ? `INSERT INTO [${table}] (${cols.map(c => `[${c}]`).join(', ')}) VALUES (${cols.map((_, i) => `@v${i}`).join(', ')})`
        : `INSERT INTO [${table}] DEFAULT VALUES`
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
    validateIdentifier(table)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request()
        .input('table', table)
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
            SELECT ku.COLUMN_NAME, ku.TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
              ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
             AND tc.TABLE_NAME = ku.TABLE_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME AND pk.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_NAME = @table
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

  return { handleConnect, handleGetRows, handleDeleteRows, handleUpdateCell, handleInsertRow, handleGetColumns, handleRunQuery }
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
  handle('db-manager:get-columns', handlers.handleGetColumns)
  handle('db-manager:run-query',  handlers.handleRunQuery)

  // Hook into Electron's quit lifecycle so connections are cleanly closed.
  // electron/main.cjs already calls app.on('before-quit', ...) for other teardown —
  // add this alongside it rather than relying on module-level process.on.
}

module.exports = { register, closeAll }
