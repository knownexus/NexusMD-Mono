import React from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { CardFrame, Icon, WidgetBody } from '@nexusmd/ui'
import {
  ROW_HEIGHT, MARGIN, MIN_H, screenKey, colsFor, entriesFor, layoutFor, withLayout, withoutLayout,
} from './dashboard-layout.js'

// The desktop Dashboard's widgets — the built-in cards and the added (Home) widgets — in one grid where
// each can be dragged (by its grip) and resized (right edge, bottom edge, corner). The layout is kept per
// screen (dashboard-layout.js): moving the window to another monitor switches to that monitor's layout.
//
// Below STACK_BELOW px the grid is one column in layout order, never saved, so a window snapped narrow
// stays usable without overwriting the screen's arrangement.

const STACK_BELOW = 900
const NO_DISPLAY = { id: 'none', width: 1920, height: 1080, scaleFactor: 1, physicalWidth: 1920, physicalHeight: 1080 }

/** The screen the window is on, from the shell (host.display), kept current as the window moves. */
export function useDisplay(host) {
  const [display, setDisplay] = React.useState(null)
  React.useEffect(() => {
    let live = true
    const d = host?.display
    if (!d) { setDisplay(NO_DISPLAY); return undefined }
    Promise.resolve().then(() => d.get()).then(x => live && setDisplay(x || NO_DISPLAY)).catch(() => live && setDisplay(NO_DISPLAY))
    const off = d.onChange?.(x => { if (live && x) setDisplay(x) })
    return () => { live = false; if (typeof off === 'function') off() }
  }, [host])
  return display
}

// The width the grid has to fill, followed as the window or sidebar changes.
function useWidth(ref, fixed) {
  const [width, setWidth] = React.useState(fixed || 0)
  React.useLayoutEffect(() => {
    if (fixed) { setWidth(fixed); return undefined }
    const el = ref.current
    if (!el) return undefined
    // jsdom (tests) lays nothing out, so 0 there; the window's width stands in.
    const read = () => setWidth(el.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 0)
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fixed])
  return width
}

function Cell({ item, ctx, onEdit }) {
  if (item.card) {
    const c = item.card
    return (
      <>
        {c.onHide && (
          <button type="button" className="widget-hide" title="Hide widget" aria-label={`Hide ${c.title}`}
            onMouseDown={e => e.stopPropagation()} onClick={() => c.onHide(c.id)}>
            <Icon name="x" size={12}/>
          </button>
        )}
        <CardFrame title={c.title} padded={false}>{c.render()}</CardFrame>
      </>
    )
  }
  return <div className="dash-cell-body"><WidgetBody widget={item.widget} ctx={ctx} onEdit={onEdit}/></div>
}

/**
 *   cards        the built-in cards from DashboardView ([{ id, title, render, span, onHide }])
 *   widgets      the added widgets to show ([{ id, type, config }], already filtered to what's on)
 *   widgetTypes  WIDGET_TYPES (for each added widget's default width)
 *   ctx, onEdit  what the added widgets read, and their ⋯ (settings)
 *   display      the screen (useDisplay)
 *   layouts, onLayoutsChange   the dashLayouts tweak
 *   widgetWidths, widgetHeights   the old per-card settings, which the first layout starts from
 *   width        fixed width (tests); otherwise measured
 */
export function DashboardGrid({
  cards = [], widgets = [], widgetTypes = {}, ctx = {}, onEdit, display, layouts = {}, onLayoutsChange,
  widgetWidths = {}, widgetHeights = {}, width: fixedWidth, footer,
}) {
  const ref = React.useRef(null)
  const width = useWidth(ref, fixedWidth)
  const screen = display || NO_DISPLAY
  const key = screenKey(screen)
  const cols = colsFor(screen)

  const entries = entriesFor({
    cards: cards.map(c => ({ id: c.id, span: c.span })),
    widgets: widgets.map(w => ({ id: w.id, half: !!widgetTypes[w.type]?.half })),
    widgetWidths, widgetHeights,
  })
  const { items, own } = layoutFor(layouts, key, cols, entries)
  const byKey = new Map([
    ...cards.map(c => [`card:${c.id}`, { card: c }]),
    ...widgets.map(w => [`w:${w.id}`, { widget: w }]),
  ])

  const save = next => onLayoutsChange?.(withLayout(layouts, key, cols, next))
  const reset = () => onLayoutsChange?.(withoutLayout(layouts, key))
  const label = `${screen.physicalWidth || screen.width}×${screen.physicalHeight || screen.height}`

  const stacked = width > 0 && width < STACK_BELOW
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x)

  return (
    <div ref={ref} className="dash-grid" data-screen={key} data-cols={cols}>
      {width > 0 && (stacked ? (
        <div className="dash-stack">
          {ordered.map(it => (
            <div key={it.i} className="widget dash-cell" data-testid="dash-cell" data-key={it.i}>
              <Cell item={byKey.get(it.i)} ctx={ctx} onEdit={onEdit}/>
            </div>
          ))}
        </div>
      ) : (
        // key: a new screen is a new grid, laid out from that screen's own layout.
        <GridLayout key={key} className="dash-rgl" width={width} cols={cols} rowHeight={ROW_HEIGHT} margin={[MARGIN, MARGIN]}
          containerPadding={[0, 0]} layout={items.map(it => ({ ...it, minH: MIN_H, minW: 1 }))} compactType="vertical"
          draggableHandle=".widget-grab" draggableCancel=".widget-hide, .m-iconbtn" resizeHandles={['se', 'e', 's']}
          onDragStop={save} onResizeStop={save}>
          {items.map(it => (
            <div key={it.i} className="widget dash-cell" data-testid="dash-cell" data-key={it.i}>
              <div className="widget-grab" title="Drag to move" aria-label="Drag to move"><Icon name="grip" size={14}/></div>
              <Cell item={byKey.get(it.i)} ctx={ctx} onEdit={onEdit}/>
            </div>
          ))}
        </GridLayout>
      ))}
      <div className="dash-grid-foot">
        {footer}
        <span className="dash-grid-screen" title="Each screen resolution keeps its own Dashboard layout">
          Layout for this {label} screen{own ? '' : ' (not arranged yet)'}
        </span>
        {own && <button type="button" className="btn sm ghost" onClick={reset}>Reset layout</button>}
      </div>
    </div>
  )
}
