// packages/core/src/modules/db-manager/export-sql.js
//
// Whole-database exports as SQL scripts: every table's schema (CREATE TABLE, keys, indexes) and
// every table's rows (INSERTs). Pure — the caller fetches structures and rows and passes them in.

import { quoteIdent, quoteTable, sqlLiteral } from './query-builders.js'

const WITH_LENGTH = /^(n?var)?char$|^n?char$|^(var)?binary$/i
const EXACT = /^(decimal|numeric)$/i
// Values the script can't carry as text, and columns the database fills in itself.
const NOT_SCRIPTED = /^(timestamp|rowversion|binary|varbinary|image|blob|geography|geometry|hierarchyid|sql_variant)$/i

const baseType = c => String(c?.dataType ?? '').toLowerCase().replace(/\(.*$/, '').trim()

/** A column's type with its size, the way CREATE TABLE writes it. */
function typeSql(dialect, c) {
  const type = String(c.dataType ?? '').trim()
  if (dialect === 'sqlite') return type
  if (WITH_LENGTH.test(type) && c.maxLength != null) return `${type}(${c.maxLength < 0 ? 'max' : c.maxLength})`
  if (EXACT.test(type) && c.precision != null) return `${type}(${c.precision},${c.scale ?? 0})`
  return type
}

/**
 * Tables ordered so each comes after the tables its foreign keys point at (a cycle, or a key to a
 * table outside the list, is left in its listed place).
 * @param {string[]} names
 * @param {Record<string, { foreignKeys?: { refTable: string }[] }>} structures
 */
export function orderByDependencies(names, structures) {
  const listed = new Set(names)
  const done = new Set()
  const out = []
  const visit = (name, path) => {
    if (done.has(name) || path.has(name)) return
    path.add(name)
    for (const fk of structures[name]?.foreignKeys ?? []) {
      if (fk.refTable !== name && listed.has(fk.refTable)) visit(fk.refTable, path)
    }
    path.delete(name)
    if (!done.has(name)) { done.add(name); out.push(name) }
  }
  names.forEach(n => visit(n, new Set()))
  return out
}

const fkClause = fk => {
  const cols = fk.columns.map(quoteIdent).join(', ')
  const refs = fk.refColumns.map(quoteIdent).join(', ')
  const rule = (word, v) => (v && !/^no.?action$/i.test(v) ? ` ${word} ${String(v).replace(/_/g, ' ').toUpperCase()}` : '')
  return `FOREIGN KEY (${cols}) REFERENCES ${quoteTable(fk.refTable)} (${refs})${rule('ON DELETE', fk.onDelete)}${rule('ON UPDATE', fk.onUpdate)}`
}

/**
 * One script that creates every table: columns, primary keys, foreign keys and indexes.
 * SQL Server keys are added after all tables exist; SQLite has to write them inside CREATE TABLE.
 * @param {'sqlserver'|'sqlite'} dialect
 * @param {{ name: string, columns: object[], foreignKeys?: object[], indexes?: object[] }[]} tables  In the order to create them
 * @param {{ database?: string }} [opts]
 */
export function buildSchemaScript(dialect, tables, { database = '' } = {}) {
  const lite = dialect === 'sqlite'
  const blocks = [`-- Schema${database ? ` of ${database}` : ''} · ${tables.length} table${tables.length === 1 ? '' : 's'}`]
  const later = []

  for (const t of tables) {
    const cols = t.columns ?? []
    const keys = cols.filter(c => c.isPrimaryKey)
    const inlineKey = lite && keys.length === 1 && keys[0].isIdentity
    const lines = cols.map(c => {
      if (c.isComputed) return `${quoteIdent(c.name)} AS (/* computed column: add its expression */ NULL)`
      if (inlineKey && c === keys[0]) return `${quoteIdent(c.name)} ${typeSql(dialect, c) || 'INTEGER'} PRIMARY KEY AUTOINCREMENT`
      const parts = [quoteIdent(c.name), typeSql(dialect, c) || (lite ? '' : 'nvarchar(max)')].filter(Boolean)
      if (c.isIdentity && !lite) parts.push('IDENTITY(1,1)')
      parts.push(c.isPrimaryKey || !c.nullable ? 'NOT NULL' : 'NULL')
      return parts.join(' ')
    })
    if (keys.length && !inlineKey) {
      const list = keys.map(c => quoteIdent(c.name)).join(', ')
      lines.push(lite ? `PRIMARY KEY (${list})` : `CONSTRAINT ${quoteIdent(`PK_${t.name.replace(/\./g, '_')}`)} PRIMARY KEY (${list})`)
    }
    const fks = t.foreignKeys ?? []
    if (lite) fks.forEach(fk => lines.push(fkClause(fk)))
    else fks.forEach(fk => later.push(`ALTER TABLE ${quoteTable(t.name)} ADD CONSTRAINT ${quoteIdent(fk.name)} ${fkClause(fk)};`))

    blocks.push(`CREATE TABLE ${quoteTable(t.name)} (\n${lines.map(l => `  ${l}`).join(',\n')}\n);`)

    for (const ix of t.indexes ?? []) {
      if (ix.primaryKey || !ix.columns?.length) continue
      const list = ix.columns.map(c => `${quoteIdent(c.name)}${c.desc ? ' DESC' : ''}`).join(', ')
      const where = ix.filter ? ` WHERE ${ix.filter.replace(/^\(\((.*)\)\)$/, '($1)')}` : ''
      later.push(`CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(ix.name)} ON ${quoteTable(t.name)} (${list})${where};`)
    }
  }
  if (later.length) blocks.push(later.join('\n'))
  return `${blocks.join('\n\n')}\n`
}

/**
 * INSERTs for one table's rows. Unlike a copied selection this keeps identity values (SQL Server
 * wraps them in IDENTITY_INSERT); computed, row-version and binary columns are left out.
 * @param {'sqlserver'|'sqlite'} dialect
 * @param {string} table
 * @param {string[]} columns  Column names, in row order
 * @param {any[][]} rows
 * @param {object[]} columnInfo  Each column's metadata, from getColumns()
 */
export function buildTableData(dialect, table, columns, rows, columnInfo = []) {
  const info = new Map(columnInfo.map(c => [c.name, c]))
  const kept = columns.map((name, i) => ({ name, i, col: info.get(name) }))
    .filter(c => !c.col?.isComputed && !NOT_SCRIPTED.test(baseType(c.col)))
  const skipped = columns.length - kept.length
  const header = `-- ${table} · ${rows.length} row${rows.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} column${skipped === 1 ? '' : 's'} not scripted (computed, row version or binary)` : ''}`
  if (!rows.length || !kept.length) return header
  const names = kept.map(c => quoteIdent(c.name)).join(', ')
  const inserts = rows.map(row =>
    `INSERT INTO ${quoteTable(table)} (${names}) VALUES (${kept.map(c => sqlLiteral(c.col && { ...c.col, isIdentity: false }, row[c.i], dialect)).join(', ')});`)
  const identity = dialect === 'sqlserver' && kept.some(c => c.col?.isIdentity)
  return [header, identity && `SET IDENTITY_INSERT ${quoteTable(table)} ON;`, ...inserts, identity && `SET IDENTITY_INSERT ${quoteTable(table)} OFF;`]
    .filter(Boolean).join('\n')
}

/** The pieces of a data export joined into one script. */
export function joinDataScript(parts, { database = '' } = {}) {
  return `-- Data${database ? ` of ${database}` : ''} · ${parts.length} table${parts.length === 1 ? '' : 's'}\n\n${parts.join('\n\n')}\n`
}
