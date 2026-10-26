// packages/core/src/modules/db-manager/ddl.js
//
// Creating and dropping tables and views: the column types each dialect offers, checks on a
// new table's design, and the CREATE / DROP statements (shown to the person before they run).
// Pure — names are bracketed with quoteIdent, which SQL Server and SQLite both read.

import { quoteIdent } from './query-builders.js'

// size: what the type takes in brackets — a length ("max" allowed where marked), or precision/scale.
const SQLSERVER_TYPES = [
  { name: 'int', integer: true }, { name: 'bigint', integer: true }, { name: 'smallint', integer: true }, { name: 'tinyint', integer: true },
  { name: 'bit' },
  { name: 'decimal', size: 'precision' }, { name: 'numeric', size: 'precision' }, { name: 'money' }, { name: 'float' },
  { name: 'nvarchar', size: 'length', max: 4000, allowMax: true }, { name: 'varchar', size: 'length', max: 8000, allowMax: true },
  { name: 'nchar', size: 'length', max: 4000 }, { name: 'char', size: 'length', max: 8000 },
  { name: 'date' }, { name: 'datetime2' }, { name: 'datetime' }, { name: 'time' }, { name: 'datetimeoffset' },
  { name: 'uniqueidentifier' }, { name: 'varbinary', size: 'length', max: 8000, allowMax: true },
]
const SQLITE_TYPES = [{ name: 'INTEGER', integer: true }, { name: 'REAL' }, { name: 'TEXT' }, { name: 'NUMERIC' }, { name: 'BLOB' }]

/** The column types a new table can use. */
export function columnTypes(dialect) {
  return dialect === 'sqlite' ? SQLITE_TYPES : SQLSERVER_TYPES
}
const typeOf = (dialect, name) => columnTypes(dialect).find(t => t.name === name)

// Defaults a person may name rather than type a value for.
const DEFAULT_FUNCTIONS = ['GETDATE()', 'GETUTCDATE()', 'SYSDATETIME()', 'SYSUTCDATETIME()', 'NEWID()', 'NEWSEQUENTIALID()', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME']

/** A default as SQL: a number, NULL or a known function as it is; anything else as quoted text. */
export function formatDefault(dialect, raw) {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^null$/i.test(v)) return 'NULL'
  const fn = DEFAULT_FUNCTIONS.find(f => f.toLowerCase() === v.toLowerCase())
  if (fn) return fn
  const quoted = `'${v.replace(/'/g, "''")}'`
  return dialect === 'sqlserver' ? `N${quoted}` : quoted
}

const sizeSuffix = (t, c) => {
  if (t?.size === 'length') return `(${String(c.length).toLowerCase() === 'max' ? 'max' : Number(c.length)})`
  if (t?.size === 'precision') return `(${Number(c.precision)},${Number(c.scale || 0)})`
  return ''
}

/**
 * What's wrong with a new table's design, as sentences (empty when it can be created).
 * @param {'sqlserver'|'sqlite'} dialect
 * @param {string} table
 * @param {{ name, type, length?, precision?, scale?, nullable, primaryKey, identity, default }[]} columns
 */
export function validateTableSpec(dialect, table, columns) {
  const errors = []
  if (!String(table ?? '').trim()) errors.push('Give the table a name.')
  if (!columns.length) errors.push('Add at least one column.')
  if (columns.some(c => !String(c.name ?? '').trim())) errors.push('Every column needs a name.')
  const seen = new Map()
  for (const c of columns) {
    const k = String(c.name ?? '').trim().toLowerCase()
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
  if (dupes.length) errors.push(`Column names must be different: ${dupes.join(', ')}.`)
  if (columns.filter(c => c.identity).length > 1) errors.push('Only one column can be an identity.')
  for (const c of columns) {
    const t = typeOf(dialect, c.type)
    const label = String(c.name ?? '').trim() || 'A column'
    if (!t) { errors.push(`${label}: choose a type.`); continue }
    if (c.identity && !t.integer) errors.push(`${label}: only a whole-number column can be an identity.`)
    if (c.identity && dialect === 'sqlite' && !(c.primaryKey && columns.filter(x => x.primaryKey).length === 1)) {
      errors.push(`${label}: in SQLite only the single INTEGER primary key can number itself.`)
    }
    if (t.size === 'length') {
      const max = String(c.length ?? '').toLowerCase() === 'max'
      const n = Number(c.length)
      if (max ? !t.allowMax : !(Number.isInteger(n) && n >= 1 && n <= t.max)) {
        errors.push(`${label}: length must be 1 to ${t.max}${t.allowMax ? ', or max' : ''}.`)
      }
    }
    if (t.size === 'precision') {
      const p = Number(c.precision), s = Number(c.scale || 0)
      if (!(Number.isInteger(p) && p >= 1 && p <= 38)) errors.push(`${label}: precision must be 1 to 38.`)
      else if (!(Number.isInteger(s) && s >= 0)) errors.push(`${label}: scale must be 0 or more.`)
      else if (s > p) errors.push(`${label}: scale can’t be more than precision.`)
    }
  }
  return errors
}

/** The CREATE TABLE statement for a design that passes validateTableSpec. */
export function buildCreateTable(dialect, table, columns) {
  const keys = columns.filter(c => c.primaryKey)
  // SQLite numbers its single INTEGER PRIMARY KEY itself, written on the column.
  const inlineKey = dialect === 'sqlite' && keys.length === 1 && keys[0].identity
  const lines = columns.map(c => {
    const t = typeOf(dialect, c.type)
    const name = String(c.name).trim()
    if (inlineKey && c === keys[0]) return `${quoteIdent(name)} ${c.type} PRIMARY KEY AUTOINCREMENT`
    const parts = [quoteIdent(name), `${c.type}${sizeSuffix(t, c)}`]
    if (c.identity && dialect === 'sqlserver') parts.push('IDENTITY(1,1)')
    parts.push(c.primaryKey || !c.nullable ? 'NOT NULL' : 'NULL')
    const def = c.identity ? null : formatDefault(dialect, c.default)
    if (def) parts.push(`DEFAULT ${def}`)
    return parts.join(' ')
  })
  if (keys.length && !inlineKey) {
    const cols = keys.map(c => quoteIdent(String(c.name).trim())).join(', ')
    lines.push(dialect === 'sqlserver'
      ? `CONSTRAINT ${quoteIdent(`PK_${String(table).trim()}`)} PRIMARY KEY (${cols})`
      : `PRIMARY KEY (${cols})`)
  }
  return `CREATE TABLE ${quoteIdent(String(table).trim())} (\n${lines.map(l => `  ${l}`).join(',\n')}\n)`
}

/**
 * Whether `sql` is one statement: semicolons inside strings, [names], "names" and comments don't
 * count, nor does one at the very end.
 */
export function isSingleStatement(sql) {
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

/** CREATE VIEW for a SELECT (or a WITH … SELECT). */
export function buildCreateView(name, select) {
  const n = String(name ?? '').trim()
  const body = String(select ?? '').trim().replace(/;\s*$/, '')
  if (!n) throw new Error('Give the view a name.')
  if (!/^(select|with)\b/i.test(body)) throw new Error('A view is a SELECT (or WITH … SELECT) query.')
  if (!isSingleStatement(body)) throw new Error('A view is one statement: take out the extra ones after the semicolon.')
  return `CREATE VIEW ${quoteIdent(n)} AS\n${body}`
}

/** DROP TABLE, or DROP VIEW. */
export function buildDropStatement(name, { view = false } = {}) {
  return `DROP ${view ? 'VIEW' : 'TABLE'} ${quoteIdent(name)}`
}
