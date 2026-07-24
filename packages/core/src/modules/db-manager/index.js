// packages/core/src/modules/db-manager/index.js
//
// Database Manager — core module.
// Pure logic only — no DOM, no React, no Node built-ins.
// All I/O goes through the `dbManager` adapter injected by each platform.

import { registerModule } from '../../features/module-registry.js'

// ─── Module-level adapter ref (set by init, cleared by dispose) ───────────────

let _adapter = null

export function getDbManagerAdapter() {
  return _adapter
}

// ─── Connection string parsing (pure, platform-agnostic) ─────────────────────

// Applies `;key=value` pairs (ADO.NET and JDBC both use this shape after
// their respective prefixes) onto a SQL Server config object being built up.
function applyKeyValuePairs(cfg, str) {
  str.split(';').forEach(pair => {
    const eq = pair.indexOf('=')
    if (eq === -1) return
    const key = pair.slice(0, eq).trim().toLowerCase().replace(/\s+/g, '')
    const val = pair.slice(eq + 1).trim()
    if (key === 'server' || key === 'datasource' || key === 'servername') {
      const [host, port] = val.split(',')
      cfg.server = host.trim()
      if (port) cfg.port = parseInt(port.trim(), 10)
    }
    if (key === 'database' || key === 'initialcatalog' || key === 'databasename') cfg.database = val
    if (key === 'userid' || key === 'uid' || key === 'username' || key === 'user') cfg.user = val
    if (key === 'password' || key === 'pwd') cfg.password = val
    if (key === 'encrypt') cfg.encrypt = val.toLowerCase() !== 'false'
    if (key === 'trustservercertificate') cfg.trustServerCertificate = val.toLowerCase() === 'true'
  })
}

/**
 * Parse a connection string into a structured config object.
 * Handles three SQL Server formats (URL, JDBC, ADO.NET) and a SQLite path/URL format.
 *
 * @param {'sqlserver'|'sqlite'} type
 * @param {string} connectionString
 * @returns {object}
 */
export function parseConnectionString(type, connectionString) {
  const cs = connectionString.trim()

  if (type === 'sqlite') {
    const path = cs.startsWith('sqlite:///')
      ? cs.slice('sqlite:///'.length)
      : cs
    return { type: 'sqlite', filePath: path }
  }

  if (type === 'sqlserver') {
    // URL style: mssql://user:pass@host:1433/database
    if (/^(mssql|sqlserver):\/\//i.test(cs)) {
      const url = new URL(cs.replace(/^sqlserver/i, 'mssql'))
      return {
        type: 'sqlserver',
        server:   url.hostname,
        port:     url.port ? parseInt(url.port, 10) : 1433,
        database: url.pathname.replace(/^\//, ''),
        user:     url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        encrypt:  true,
        trustServerCertificate: false,
      }
    }

    // JDBC style: jdbc:sqlserver://host[:port];database=db;user=...;password=...
    const jdbcMatch = cs.match(/^jdbc:sqlserver:\/\/([^;]+)(;.*)?$/i)
    if (jdbcMatch) {
      const [, hostPort, rest] = jdbcMatch
      const [host, port] = hostPort.split(':')
      const cfg = {
        type: 'sqlserver', server: host.trim(),
        port: port ? parseInt(port, 10) : 1433,
        encrypt: true, trustServerCertificate: false,
      }
      applyKeyValuePairs(cfg, rest || '')
      return cfg
    }

    // ADO.NET key=value; style
    const cfg = { type: 'sqlserver', port: 1433, encrypt: true, trustServerCertificate: false }
    applyKeyValuePairs(cfg, cs)
    return cfg
  }

  throw new Error(`Unknown database type: ${type}`)
}

/**
 * Build a config object from manual fields (used when no connection string is provided).
 */
export function buildConfig(type, fields) {
  if (type === 'sqlite') return { type: 'sqlite', filePath: fields.filePath ?? '' }
  // fields.port comes from a form text input, so it arrives as a string (or
  // ''/undefined) — the mssql driver requires options.port to be a number.
  const parsedPort = parseInt(fields.port, 10)
  return {
    type:                  'sqlserver',
    server:                fields.host ?? '',
    port:                  Number.isFinite(parsedPort) ? parsedPort : 1433,
    database:              fields.database ?? '',
    user:                  fields.user ?? undefined,
    password:              fields.password ?? undefined,
    encrypt:               fields.encrypt !== false,
    trustServerCertificate: fields.trustServerCertificate ?? false,
  }
}

/**
 * Resolve a connection params object from either a connection string or manual fields.
 * Returns the config object ready to pass to adapter calls.
 */
export function resolveConnectionParams(type, { connectionString, ...fields }) {
  if (connectionString?.trim()) return parseConnectionString(type, connectionString)
  return buildConfig(type, fields)
}

/**
 * Render manual fields as an equivalent connection string, so a UI can keep a
 * "connection string" tab in sync as the "fields" tab is edited. Uses the
 * ADO.NET `Key=Value;` dialect (see parseConnectionString) because — unlike
 * the mssql://user:pass@host/db URL form — it round-trips every field this
 * module supports, including encrypt/trustServerCertificate.
 * @param {'sqlserver'|'sqlite'} type
 * @param {object} fields  Same shape buildConfig() accepts.
 * @returns {string}
 */
export function buildConnectionString(type, fields) {
  if (type === 'sqlite') return fields.filePath || ''

  const port = fields.port || '1433'
  const parts = [`Server=${fields.host || ''},${port}`]
  if (fields.database) parts.push(`Database=${fields.database}`)
  if (fields.user)     parts.push(`User Id=${fields.user}`)
  if (fields.password) parts.push(`Password=${fields.password}`)
  parts.push(`Encrypt=${fields.encrypt === false ? 'false' : 'true'}`)
  parts.push(`TrustServerCertificate=${fields.trustServerCertificate ? 'true' : 'false'}`)
  return parts.join(';') + ';'
}

// ─── Saved-connection list helpers (pure — no storage I/O) ───────────────────
// A platform persists an array of connection *metadata* (never secrets — the
// password / connection string is stored separately, keyed by id, through
// whatever secret store the platform has). These helpers manage that array.

/** id for a new saved connection. */
export function generateConnectionId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * Insert or update a connection's metadata in a list, by id.
 * Pure — returns a new array; `list` is never mutated.
 * @param {object[]} list
 * @param {{id?: string}} meta  Assigned a fresh id via generateConnectionId() if absent.
 * @returns {object[]}
 */
export function upsertConnection(list, meta) {
  const entry = { ...meta, id: meta.id || generateConnectionId() }
  const idx = list.findIndex(c => c.id === entry.id)
  if (idx === -1) return [...list, entry]
  const next = [...list]
  next[idx] = entry
  return next
}

/**
 * Remove a connection by id. Pure — returns a new array.
 * @param {object[]} list
 * @param {string} id
 * @returns {object[]}
 */
export function removeConnection(list, id) {
  return list.filter(c => c.id !== id)
}

// ─── State helpers ────────────────────────────────────────────────────────────

/**
 * Initial UI state for the module — returned by load(), used by the view.
 */
export function createInitialState() {
  return {
    session:       null,   // { type, config, tables: string[] } | null
    selectedTable: null,
    tableData:     null,   // { columns: string[], rows: any[][] } | null
    loading:       false,
    tableLoading:  false,
    error:         null,
  }
}

/**
 * Return a new state with a session connected.
 * Pure — takes old state, returns new state. Any extra fields (e.g.
 * `connectionId`/`name`, used to track which saved connection is active)
 * are carried onto `session` unchanged, alongside the required type/config/tables.
 */
export function applyConnected(state, { type, config, tables, ...rest }) {
  return {
    ...state,
    session:       { type, config, tables, ...rest },
    selectedTable: null,
    tableData:     null,
    error:         null,
    loading:       false,
  }
}

export function applyDisconnected(state) {
  return { ...createInitialState() }
}

export function applyTableSelected(state, tableName) {
  return { ...state, selectedTable: tableName, tableData: null, tableLoading: true, error: null }
}

export function applyTableLoaded(state, { columns, rows }) {
  return { ...state, tableData: { columns, rows }, tableLoading: false }
}

export function applyRowsDeleted(state, deletedRowIndices) {
  if (!state.tableData) return state
  const indexSet = new Set(deletedRowIndices)
  const rows = state.tableData.rows.filter((_, i) => !indexSet.has(i))
  return { ...state, tableData: { ...state.tableData, rows } }
}

export function applyCellUpdated(state, { rowIndex, colIndex, value }) {
  if (!state.tableData) return state
  const rows = state.tableData.rows.map((row, i) => {
    if (i !== rowIndex) return row
    const updated = [...row]
    updated[colIndex] = value
    return updated
  })
  return { ...state, tableData: { ...state.tableData, rows } }
}

export function applyError(state, message) {
  return { ...state, error: message, loading: false, tableLoading: false }
}

// ─── Module registration ──────────────────────────────────────────────────────

registerModule({
  id:   'db-manager',
  name: 'Database Manager',

  // `dbManager` is a desktop-only adapter — its absence from createNoOpAdapters()
  // means this module won't activate on web or Capacitor unless they supply it.
  requiredAdapters: ['dbManager'],

  defaultEnabled: true,

  init(adapters) {
    _adapter = adapters.dbManager
  },

  async load() {
    // Action-oriented module — no polling. load() is a no-op that exists only
    // so the module participates in the adapter-gating cycle.
    return {}
  },

  dispose() {
    _adapter = null
  },
})
