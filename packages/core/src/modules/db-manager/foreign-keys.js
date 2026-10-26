// packages/core/src/modules/db-manager/foreign-keys.js
//
// Where a row's foreign keys lead, and which rows point back at it, as table + WHERE pairs the
// grid can open. Pure. `structure` is what the Structure tab reads: { foreignKeys, referencedBy },
// each key { key, columns, refTable, refColumns } or { key, table, columns, refColumns }.

// Values pass through untouched (big numbers stay text, dates stay Dates) for the database to match.
const valuesOf = (columns, row, names) => names.map(n => row[columns.indexOf(n)])

/** One target per foreign key whose columns are all set in `row`: the parent row it names. */
export function followTargets(structure, columns, row) {
  return (structure?.foreignKeys ?? []).flatMap(fk => {
    const values = valuesOf(columns, row, fk.columns)
    if (values.some(v => v === null || v === undefined)) return []
    return [{
      key: fk.key,
      table: fk.refTable,
      where: fk.refColumns.map((column, i) => ({ column, value: values[i] })),
      label: `${fk.columns.join(', ')} → ${fk.refTable}`,
    }]
  })
}

/** One target per key that points at this table, for the rows that reference `row`. */
export function referencingTargets(structure, columns, row) {
  return (structure?.referencedBy ?? []).flatMap(k => {
    const values = valuesOf(columns, row, k.refColumns)
    if (values.some(v => v === null || v === undefined)) return []
    return [{
      key: k.key,
      table: k.table,
      where: k.columns.map((column, i) => ({ column, value: values[i] })),
      label: `${k.table} by ${k.columns.join(', ')}`,
    }]
  })
}

/** A WHERE as text, e.g. "A = 1 · B IS NULL". */
export function whereLabel(where) {
  return where
    .map(({ column, value }) => {
      if (value === null || value === undefined) return `${column} IS NULL`
      return `${column} = ${value instanceof Date ? value.toISOString().slice(0, 19) : value}`
    })
    .join(' · ')
}
