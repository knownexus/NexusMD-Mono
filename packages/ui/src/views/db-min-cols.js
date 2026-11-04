// Columns a person has minimised in the Browse grid, remembered per connection and table.
// Profile-scoped: keyOf turns `minCols.<conn>.<table>` into the host's full storage key (`<ns>.dbManager.minCols...`).
const defaultKeyOf = name => `nexusmd.dbManager.${name}`
const key = (connKey, table, keyOf = defaultKeyOf) => keyOf(`minCols.${connKey}.${table}`)

export function readMinCols(connKey, table, keyOf) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key(connKey, table, keyOf)))
    return Array.isArray(v) ? v.filter(n => typeof n === 'string') : []
  } catch { return [] }
}

export function writeMinCols(connKey, table, names, keyOf) {
  try {
    if (names.length) window.localStorage.setItem(key(connKey, table, keyOf), JSON.stringify(names))
    else window.localStorage.removeItem(key(connKey, table, keyOf))
  } catch { /* storage unavailable */ }
}
