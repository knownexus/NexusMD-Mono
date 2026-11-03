// The desktop Dashboard's layout, one per screen (pure; dashboard-grid.jsx draws it).
//
// Every part of the Dashboard (the greeting, its buttons, the stat cards, the built-in cards and the
// added widgets) is an item { i, x, y, w, h } in a grid of `cols` columns and ROW_HEIGHT-px rows. The
// `dashLayouts` tweak keeps one layout per screen resolution: { "3840x1600": { cols, rowHeight, items } }. A screen that has none starts from the
// nearest resolution that has one, scaled to its own columns, and failing that from the old
// order/width/height settings; it is saved only when something is moved or resized there.

export const ROW_HEIGHT = 20
// Layouts saved before rows were 20px say nothing about it; theirs were 40px.
const OLD_ROW_HEIGHT = 40
export const MARGIN = 16
export const COL_PX = 320
export const MIN_COLS = 4
export const MAX_COLS = 16
const CARD_ROWS = 12
const WIDGET_ROWS = 9
export const MIN_H = 1
// Each column is split into SUB grid columns, so widgets move and resize in quarter-column steps.
// A saved layout records the grid columns it was made with, so ones saved before (one grid column per
// column) scale up exactly.
export const SUB = 4
// The narrowest a widget can be: half a column.
export const MIN_W = SUB / 2

/** The key a screen's layout is saved under: its real resolution, e.g. "3840x2160". */
export function screenKey(display) {
  const w = display?.physicalWidth || display?.width || 0
  const h = display?.physicalHeight || display?.height || 0
  return `${w}x${h}`
}

/** Columns for a screen: one per ~320 laid-out px (Windows scaling applied), 4 to 16. */
export function colsFor(display) {
  const w = display?.width || 0
  return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(w / COL_PX)))
}

/** Grid columns for a screen: SUB per column. */
export function gridColsFor(display) {
  return colsFor(display) * SUB
}

const rowsForPx = px => Math.max(MIN_H, Math.ceil((px + MARGIN) / (ROW_HEIGHT + MARGIN)))
const half = cols => Math.max(1, Math.floor(cols / 2))

// What a widget is, for its default size: `frac` of the columns (else `wide`: all, or half), `rows` high.
// entries: { key, wide, frac?, rows, top? }   top: a part of the page's head, placed above the rest
function sizeOf(entry, cols) {
  const w = entry.frac ? Math.min(cols, Math.max(1, Math.round(cols * entry.frac))) : entry.wide ? cols : half(cols)
  return { w, h: entry.rows || CARD_ROWS }
}

/** Lays entries out left to right, wrapping into rows, from the top (or from row `startY`). */
export function flow(entries, cols, startY = 0) {
  const items = []
  let x = 0, y = startY, rowH = 0
  for (const e of entries) {
    const { w, h } = sizeOf(e, cols)
    if (x + w > cols) { x = 0; y += rowH; rowH = 0 }
    items.push({ i: e.key, x, y, w, h })
    x += w
    rowH = Math.max(rowH, h)
  }
  return items
}

/**
 * The entries the grid shows, in their default order: the built-in cards (in widgetOrder, which
 * `cards` already follows) then the added widgets. Card sizes come from the old settings where set.
 *   cards    [{ id, span }]          widgetWidths { id: wide }   widgetHeights { id: px }
 *   widgets  [{ id, half }]          (half: the type's own default)
 */
export function entriesFor({ cards = [], widgets = [], widgetWidths = {}, widgetHeights = {} }) {
  return [
    ...cards.map(c => (c.bare
      ? { key: `card:${c.id}`, wide: false, frac: c.frac, rows: c.rows || MIN_H, top: !!c.top }
      : {
          key: `card:${c.id}`,
          wide: widgetWidths[c.id] !== undefined ? !!widgetWidths[c.id] : c.span === 2,
          rows: widgetHeights[c.id] ? rowsForPx(widgetHeights[c.id]) : CARD_ROWS,
        })),
    ...widgets.map(w => ({ key: `w:${w.id}`, wide: !w.half, rows: WIDGET_ROWS })),
  ]
}

const widthOfKey = key => Number(String(key).split('x')[0]) || 0

// A saved layout fitted to `cols` and today's rows: positions and widths scaled from the columns it was
// made with, heights and rows from the row height it was made with (so it keeps its size on screen).
function scaled(layout, cols) {
  const from = layout.cols || cols
  const k = cols / from
  const rowFrom = layout.rowHeight || OLD_ROW_HEIGHT
  const v = (rowFrom + MARGIN) / (ROW_HEIGHT + MARGIN)
  return layout.items.map(it => {
    const w = Math.min(cols, Math.max(1, Math.round(it.w * k)))
    const x = Math.min(cols - w, Math.max(0, Math.round(it.x * k)))
    return v === 1 ? { ...it, x, w } : { ...it, x, w, y: Math.round(it.y * v), h: Math.round(it.h * v) }
  })
}

/** The saved layout this screen starts from: its own, else the nearest resolution's (by width), else none. */
export function sourceFor(saved, key) {
  const all = saved && typeof saved === 'object' ? saved : {}
  if (valid(all[key])) return { key, layout: all[key], own: true }
  const target = widthOfKey(key)
  const others = Object.keys(all).filter(k => valid(all[k]))
  if (!others.length) return null
  others.sort((a, b) => Math.abs(widthOfKey(a) - target) - Math.abs(widthOfKey(b) - target) || widthOfKey(b) - widthOfKey(a))
  return { key: others[0], layout: all[others[0]], own: false }
}
const valid = l => !!l && Array.isArray(l.items)

/**
 * The layout to show on this screen. Items for widgets that are gone are dropped, widgets with no
 * place yet are flowed in below the rest, and every width fits `cols`.
 * Returns { items, own } — own: the screen has a saved layout of its own.
 */
export function layoutFor(saved, key, cols, entries) {
  const src = sourceFor(saved, key)
  const keys = new Set(entries.map(e => e.key))
  if (!src) return { items: flow(entries, cols), own: false }
  const kept = scaled(src.layout, cols)
    .filter(it => it && keys.has(it.i))
    .map(it => {
      const w = Math.min(cols, Math.max(1, Math.round(it.w) || 1))
      return { i: it.i, w, x: Math.min(cols - w, Math.max(0, Math.round(it.x) || 0)), y: Math.max(0, Math.round(it.y) || 0), h: Math.max(MIN_H, Math.round(it.h) || MIN_H) }
    })
  const placed = new Set(kept.map(it => it.i))
  const missing = entries.filter(e => !placed.has(e.key))
  // Parts of the page's head that the layout doesn't have yet go above everything, which moves down.
  const top = flow(missing.filter(e => e.top), cols)
  const drop = top.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  const moved = kept.map(it => (drop ? { ...it, y: it.y + drop } : it))
  const bottom = moved.reduce((m, it) => Math.max(m, it.y + it.h), drop)
  const added = flow(missing.filter(e => !e.top), cols, bottom)
  return { items: [...top, ...moved, ...added], own: src.own }
}

/** dashLayouts with this screen's layout set to `items` (only the fields the grid needs). */
export function withLayout(saved, key, cols, items) {
  const clean = items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
  return { ...(saved && typeof saved === 'object' ? saved : {}), [key]: { cols, rowHeight: ROW_HEIGHT, items: clean } }
}

/** dashLayouts without this screen's layout (Reset layout). */
export function withoutLayout(saved, key) {
  const next = { ...(saved && typeof saved === 'object' ? saved : {}) }
  delete next[key]
  return next
}
