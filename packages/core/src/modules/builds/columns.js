// Builds table columns: pure layout logic shared by the mobile and desktop Builds views. Each view passes its own
// column list ({ id | key, label, width, locked? }[]); locked columns (the status dot, the actions) never hide.

const idOf = (c) => c.id ?? c.key
const asList = (v) => (Array.isArray(v) ? v : [])

// The columns still shown. Hidden ids that are not in the list (a column that was removed) are ignored.
export function visibleColumns(columns, hidden) {
  const h = asList(hidden)
  return asList(columns).filter(c => c.locked || !h.includes(idOf(c)))
}

// CSS grid-template-columns for the shown columns. When no stretchy (fr) column is left, the last column takes the
// spare width instead, so the rows still fill the table.
export function gridTemplate(columns, hidden) {
  const widths = visibleColumns(columns, hidden).map(c => String(c.width))
  const last = widths.length - 1
  if (last >= 0 && !widths.some(w => /fr\b/.test(w)) && /^\d+px$/.test(widths[last])) {
    widths[last] = `minmax(${widths[last]}, 1fr)`
  }
  return widths.join(' ')
}

// The narrowest the table can be: each shown column's minimum width (px, or a minmax() minimum), the gaps between
// them, and the row's side padding.
export function minTableWidth(columns, hidden, { gap = 8, padding = 28 } = {}) {
  const w = visibleColumns(columns, hidden).map(c => {
    const m = String(c.width).match(/^(?:minmax\(\s*)?(\d+)px/)
    return m ? parseInt(m[1], 10) : 0
  })
  if (!w.length) return padding
  return w.reduce((a, b) => a + b, 0) + (w.length - 1) * gap + padding
}

// The columns in the user's saved order (unknown and repeated ids dropped); columns not in the saved order (new
// ones) follow, in list order.
export function orderColumns(order, columns) {
  const cols = asList(columns)
  const seen = new Set()
  const out = []
  for (const id of asList(order)) {
    const c = cols.find(x => idOf(x) === id)
    if (!c || seen.has(id)) continue
    seen.add(id)
    out.push(c)
  }
  for (const c of cols) if (!seen.has(idOf(c))) out.push(c)
  return out
}
