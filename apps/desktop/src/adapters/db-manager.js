// apps/desktop/src/adapters/db-manager.js
//
// Renderer-side adapter for the Database Manager module.
// Implements the `dbManager` adapter contract defined in
// packages/core/src/adapters/index.js and calls through to the
// contextBridge methods exposed by electron/preload.cjs.
//
// Spread this into the `adapters` object in apps/desktop/src/main.jsx:
//
//   import { dbManagerAdapter } from './adapters/db-manager.js'
//   const adapters = {
//     ...createNoOpAdapters(),
//     ...
//     dbManager: dbManagerAdapter,
//   }

const api = () => window.electronAPI?.dbManager

export const dbManagerAdapter = {
  /** @returns {boolean} True when running inside the Electron shell with preload wired up. */
  isAvailable() {
    return !!(window.electronAPI?.dbManager)
  },

  /**
   * Connect to a database and return the list of tables.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config  Parsed config from core's resolveConnectionParams()
   * @returns {Promise<{ ok: boolean, tables: string[] }>}
   */
  connect(type, config) {
    return api().connect(type, config)
  },

  /**
   * Fetch rows from a table.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} table
   * @param {number} [limit=500]
   * @param {number} [offset=0]
   * @returns {Promise<{ columns: string[], rows: any[][] }>}
   */
  getRows(type, config, table, limit = 500, offset = 0) {
    return api().getRows(type, config, table, limit, offset)
  },

  /**
   * Delete rows by primary key values.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} table
   * @param {string} primaryKey   Column name used as the PK
   * @param {any[]}  values       PK values to delete
   * @returns {Promise<{ ok: boolean, affected: number }>}
   */
  deleteRows(type, config, table, primaryKey, values) {
    return api().deleteRows(type, config, table, primaryKey, values)
  },

  /**
   * Update a single cell.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} table
   * @param {string} primaryKey
   * @param {any}    primaryValue  The PK value identifying the row
   * @param {string} column        Column to update
   * @param {any}    value         New value
   * @returns {Promise<{ ok: boolean, affected: number }>}
   */
  updateCell(type, config, table, primaryKey, primaryValue, column, value) {
    return api().updateCell(type, config, table, primaryKey, primaryValue, column, value)
  },

  /**
   * Run a raw SQL query (SELECT / DELETE / WITH only).
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} sql
   * @returns {Promise<{ columns: string[], rows: any[][], affected: number|null }>}
   */
  runQuery(type, config, sql) {
    return api().runQuery(type, config, sql)
  },

  /**
   * Fetch column metadata for a table.
   * @param {'sqlserver'|'sqlite'} type
   * @param {object} config
   * @param {string} table
   * @returns {Promise<{ ok: boolean, columns: { name: string, dataType: string, isPrimaryKey: boolean }[] }>}
   */
  getColumns(type, config, table) {
    return api().getColumns(type, config, table)
  },
}
