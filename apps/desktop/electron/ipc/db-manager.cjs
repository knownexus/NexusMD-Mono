// electron/ipc/db-manager.cjs
//
// Node-side IPC handler for the Database Manager module.
// All real DB work happens here — never in the renderer process.
//
// Follows the withLogging pattern used by oauth.cjs and api-client-script.cjs
// so failures appear in the desktop Logs view.
//
// Supports: SQL Server (mssql package) and SQLite (better-sqlite3 package).
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

const DEFAULT_DRIVERS = { requireMssql, requireSqlite }

const SAFE_ID = /^[a-zA-Z_][a-zA-Z0-9_ ]*$/
function validateIdentifier(name) {
  if (!SAFE_ID.test(name)) throw new Error(`Invalid identifier: "${name}"`)
}

// ─── SQL Server pool factory ──────────────────────────────────────────────────

async function getSqlPool(cfg, drivers) {
  const key = `${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user ?? ''}`
  if (sqlPools.has(key)) return sqlPools.get(key)

  const sql = drivers.requireMssql()
  const pool = await sql.connect({
    server:   cfg.server,
    port:     cfg.port ?? 1433,
    database: cfg.database,
    user:     cfg.user,
    password: cfg.password,
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

  async function handleDeleteRows(_e, { type, config, table, primaryKey, values }) {
    validateIdentifier(table)
    validateIdentifier(primaryKey)
    if (!Array.isArray(values) || values.length === 0) throw new Error('values must be a non-empty array')

    if (type === 'sqlserver') {
      const pool    = await getSqlPool(config, drivers)
      const request = pool.request()
      const params  = values.map((v, i) => { request.input(`v${i}`, v); return `@v${i}` })
      const result  = await request.query(
        `DELETE FROM [${table}] WHERE [${primaryKey}] IN (${params.join(',')})`,
      )
      return { ok: true, affected: result.rowsAffected[0] }
    }

    if (type === 'sqlite') {
      const db          = getSqliteDb(config.filePath, drivers)
      const placeholders = values.map(() => '?').join(',')
      const info         = db.prepare(`DELETE FROM "${table}" WHERE "${primaryKey}" IN (${placeholders})`).run(...values)
      return { ok: true, affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleUpdateCell(_e, { type, config, table, primaryKey, primaryValue, column, value }) {
    validateIdentifier(table)
    validateIdentifier(primaryKey)
    validateIdentifier(column)

    if (type === 'sqlserver') {
      const pool = await getSqlPool(config, drivers)
      const result = await pool.request()
        .input('val', value ?? null)
        .input('pk',  primaryValue)
        .query(`UPDATE [${table}] SET [${column}] = @val WHERE [${primaryKey}] = @pk`)
      return { ok: true, affected: result.rowsAffected[0] }
    }

    if (type === 'sqlite') {
      const db   = getSqliteDb(config.filePath, drivers)
      const info = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${primaryKey}" = ?`)
                     .run(value ?? null, primaryValue)
      return { ok: true, affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  async function handleRunQuery(_e, { type, config, sql }) {
    const trimmed = sql.trimStart().toUpperCase()
    const ALLOWED = ['SELECT', 'WITH', 'DELETE']
    if (!ALLOWED.some(p => trimmed.startsWith(p))) {
      throw new Error('Only SELECT, WITH (CTE), and DELETE statements are permitted.')
    }

    if (type === 'sqlserver') {
      const pool   = await getSqlPool(config, drivers)
      const result = await pool.request().query(sql)
      if (result.recordset) return { ...recordsetToRows(result.recordset), affected: null }
      return { columns: [], rows: [], affected: result.rowsAffected?.[0] ?? 0 }
    }

    if (type === 'sqlite') {
      const db = getSqliteDb(config.filePath, drivers)
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
        const rawRows = db.prepare(sql).all()
        if (!rawRows.length) return { columns: [], rows: [], affected: null }
        const columns = Object.keys(rawRows[0])
        const rows    = rawRows.map(r => columns.map(c => r[c] ?? null))
        return { columns, rows, affected: null }
      }
      const info = db.prepare(sql).run()
      return { columns: [], rows: [], affected: info.changes }
    }

    throw new Error(`Unknown database type: ${type}`)
  }

  return { handleConnect, handleGetRows, handleDeleteRows, handleUpdateCell, handleRunQuery }
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
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all db-manager IPC channels.
 * Call this from electron/main.cjs inside the app.whenReady() block.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{ logger?: object, drivers?: { requireMssql?: Function, requireSqlite?: Function } }} [opts]
 */
function register(ipcMain, opts = {}) {
  const handle   = withLogging(ipcMain, opts.logger)
  const drivers  = { ...DEFAULT_DRIVERS, ...opts.drivers }
  const handlers = makeHandlers(drivers)

  handle('db-manager:connect',    handlers.handleConnect)
  handle('db-manager:get-rows',   handlers.handleGetRows)
  handle('db-manager:delete-rows', handlers.handleDeleteRows)
  handle('db-manager:update-cell', handlers.handleUpdateCell)
  handle('db-manager:run-query',  handlers.handleRunQuery)

  // Hook into Electron's quit lifecycle so connections are cleanly closed.
  // electron/main.cjs already calls app.on('before-quit', ...) for other teardown —
  // add this alongside it rather than relying on module-level process.on.
}

module.exports = { register, closeAll }
