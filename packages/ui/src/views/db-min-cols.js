// Columns a person has minimised in the Browse grid, remembered per connection and table.
const key = (connKey, table) => `nx-db:min-cols:${connKey}:${table}`

export function readMinCols(connKey, table) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key(connKey, table)))
    return Array.isArray(v) ? v.filter(n => typeof n === 'string') : []
  } catch { return [] }
}

export function writeMinCols(connKey, table, names) {
  try {
    if (names.length) window.localStorage.setItem(key(connKey, table), JSON.stringify(names))
    else window.localStorage.removeItem(key(connKey, table))
  } catch { /* storage unavailable */ }
}
