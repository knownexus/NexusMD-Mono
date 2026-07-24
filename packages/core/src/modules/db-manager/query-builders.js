// packages/core/src/modules/db-manager/query-builders.js
//
// Pure SQL-string generators for the Query tab's guided command builders
// (Search, Insert, Update, Delete, Join, Aggregate). No DOM, no I/O — table
// and column names passed in are expected to come from session.tables /
// getColumns() (schema-derived), never freeform user text.

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
  if (operator === 'IS NULL') return `${column} IS NULL`
  return `${column} ${operator} ${formatSqlValue(value)}`
}

function whereClause(conditions, combinator) {
  if (!conditions.length) return ''
  return `\nWHERE ${conditions.map(formatCondition).join(` ${combinator} `)}`
}

export function buildSearchQuery(table, conditions = [], combinator = 'AND') {
  return `SELECT * FROM ${table}${whereClause(conditions, combinator)}`
}

export function buildInsertQuery(table, columns) {
  const names  = columns.map(c => c.name).join(', ')
  const values = columns.map(c => formatSqlValue(c.value)).join(', ')
  return `INSERT INTO ${table} (${names}) VALUES (${values})`
}

export function buildUpdateQuery(table, setColumns, conditions = [], combinator = 'AND') {
  const setClause = setColumns.map(c => `${c.name} = ${formatSqlValue(c.value)}`).join(', ')
  return `UPDATE ${table} SET ${setClause}${whereClause(conditions, combinator)}`
}

export function buildDeleteQuery(table, conditions = [], combinator = 'AND') {
  return `DELETE FROM ${table}${whereClause(conditions, combinator)}`
}

export function buildJoinQuery(leftTable, rightTable, joinType, leftColumn, rightColumn) {
  return `SELECT * FROM ${leftTable}\n${joinType} JOIN ${rightTable} ON `
    + `${leftTable}.${leftColumn} = ${rightTable}.${rightColumn}`
}

export function buildAggregateQuery(table, aggregates, groupByColumns = []) {
  const selectCols = [
    ...aggregates.map(a => `${a.fn}(${a.column})`),
    ...groupByColumns,
  ].join(', ')
  const base = `SELECT ${selectCols} FROM ${table}`
  return groupByColumns.length ? `${base}\nGROUP BY ${groupByColumns.join(', ')}` : base
}
