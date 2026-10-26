// packages/core/src/modules/db-manager/query-builders.js
//
// Pure SQL-string generators for the Query tab's guided command builders
// (Search, Insert, Update, Delete, Join, Aggregate). No DOM, no I/O — table
// and column names passed in are expected to come from session.tables /
// getColumns() (schema-derived), never freeform user text.

import { columnKind, cellToInput } from './cell-types.js'

/**
 * A table or column name in square brackets, so reserved words (Key, User,
 * Order…), spaces and other odd characters can't break the statement. SQL
 * Server and SQLite both read [name]; a ] inside the name is doubled.
 */
export function quoteIdent(name) {
  if (name === '*') return name
  return `[${String(name).replace(/]/g, ']]')}]`
}

/**
 * A table as the session lists it: `Member` in the default schema, `maintenance.Member` in
 * another, bracketed part by part ([maintenance].[Member]) so it names the right table.
 */
export function quoteTable(name) {
  const s = String(name)
  const dot = s.indexOf('.')
  return dot < 0 ? quoteIdent(s) : `${quoteIdent(s.slice(0, dot))}.${quoteIdent(s.slice(dot + 1))}`
}

/**
 * Format a raw form value as a SQL literal. Blank/nullish input becomes
 * NULL (a guided form field left empty means "no value", not the string
 * "undefined"); integer/decimal-looking strings are left unquoted so
 * numeric columns don't get quoted numbers.
 */
export function formatSqlValue(raw) {
  if (raw === null || raw === undefined || raw === '') return 'NULL'
  const trimmed = String(raw).trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  return `'${trimmed.replace(/'/g, "''")}'`
}

/** Format one WHERE-clause condition row. */
export function formatCondition({ column, operator, value }) {
  if (operator === 'IS NULL') return `${quoteIdent(column)} IS NULL`
  return `${quoteIdent(column)} ${operator} ${formatSqlValue(value)}`
}

function whereClause(conditions, combinator) {
  if (!conditions.length) return ''
  return `\nWHERE ${conditions.map(formatCondition).join(` ${combinator} `)}`
}

export function buildSearchQuery(table, conditions = [], combinator = 'AND') {
  return `SELECT * FROM ${quoteTable(table)}${whereClause(conditions, combinator)}`
}

export function buildInsertQuery(table, columns) {
  const names  = columns.map(c => quoteIdent(c.name)).join(', ')
  const values = columns.map(c => formatSqlValue(c.value)).join(', ')
  return `INSERT INTO ${quoteTable(table)} (${names}) VALUES (${values})`
}

export function buildUpdateQuery(table, setColumns, conditions = [], combinator = 'AND') {
  const setClause = setColumns.map(c => `${quoteIdent(c.name)} = ${formatSqlValue(c.value)}`).join(', ')
  return `UPDATE ${quoteTable(table)} SET ${setClause}${whereClause(conditions, combinator)}`
}

export function buildDeleteQuery(table, conditions = [], combinator = 'AND') {
  return `DELETE FROM ${quoteTable(table)}${whereClause(conditions, combinator)}`
}

export function buildJoinQuery(leftTable, rightTable, joinType, leftColumn, rightColumn) {
  const [l, r] = [quoteTable(leftTable), quoteTable(rightTable)]
  return `SELECT * FROM ${l}\n${joinType} JOIN ${r} ON `
    + `${l}.${quoteIdent(leftColumn)} = ${r}.${quoteIdent(rightColumn)}`
}

export function buildAggregateQuery(table, aggregates, groupByColumns = []) {
  const groupBy = groupByColumns.map(quoteIdent)
  const selectCols = [
    ...aggregates.map(a => `${a.fn}(${quoteIdent(a.column)})`),
    ...groupBy,
  ].join(', ')
  const base = `SELECT ${selectCols} FROM ${quoteTable(table)}`
  return groupBy.length ? `${base}\nGROUP BY ${groupBy.join(', ')}` : base
}

/**
 * A stored value as a SQL literal for its column. Unlike formatSqlValue this goes by the column's
 * type, so a text column keeps '007' quoted. SQL Server needs N before national-character text.
 * @param {'sqlserver'|'sqlite'} dialect
 */
export function sqlLiteral(col, value, dialect) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  const kind = columnKind(col)
  if (kind === 'integer' || kind === 'decimal') return String(value)
  const text = value instanceof Date ? cellToInput(col, value) : String(value)
  const national = dialect === 'sqlserver' && /^n/i.test(String(col?.dataType ?? ''))
  return `${national ? 'N' : ''}'${text.replace(/'/g, "''")}'`
}

/** One INSERT per row, for pasting elsewhere; columns the database writes itself are left out. */
export function buildInsertStatements(table, columns, rows, columnInfo, dialect) {
  const info = new Map(columnInfo.map(c => [c.name, c]))
  const keep = columns.map((name, i) => ({ name, i, col: info.get(name) })).filter(c => columnKind(c.col) !== 'readonly')
  const names = keep.map(c => quoteIdent(c.name)).join(', ')
  return rows
    .map(row => `INSERT INTO ${quoteTable(table)} (${names}) VALUES (${keep.map(c => sqlLiteral(c.col, row[c.i], dialect)).join(', ')});`)
    .join('\n')
}
