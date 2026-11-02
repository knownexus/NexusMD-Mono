import React from 'react'
import { orderedNav, mergeNavOrder, placedNav, NAV_PLACES } from './layout.js'

// Drag-to-reorder list of nav items, editing the persisted navOrder from
// Settings. Mirrors the dashboard widget DnD pattern (view-dashboard.jsx):
// HTML5 draggable rows, reorder on drop, report the new id array upward.
// Each row's checkbox shows or hides that entry in the sidebar: `hidden` is the ids
// currently hidden and onHiddenChange(ids) reports the new list. A hidden row stays
// in the list, dimmed, so it can be shown again.
// With onPlacementChange the rows are split into the sidebar's groups (main list, More, footer):
// each row's "Move to" picker, or dropping it on a row in another group, moves it there and reports
// the new `placement` ({ [id]: 'main' | 'more' | 'footer' }). Dragging within a group reorders it.
export function NavOrderEditor({ nav, order, onChange, hidden = [], onHiddenChange = null, placement = {}, onPlacementChange = null }) {
  const [dragId, setDragId] = React.useState(null)
  const isHidden = id => hidden.includes(id)
  const setShown = (id, shown) => onHiddenChange?.(shown ? hidden.filter(h => h !== id) : [...hidden, id])
  const place = (id, where) => onPlacementChange?.({ ...(placement || {}), [id]: where })

  const groups = onPlacementChange
    ? (g => NAV_PLACES.map(p => ({ ...p, items: g[p.id] })))(placedNav(order, placement, nav))
    : [{ id: 'main', label: 'Sidebar', items: orderedNav(order, nav) }]
  const groupOf = id => groups.find(g => g.items.some(item => item.id === id))

  const onDragStart = id => e => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = e => { e.preventDefault() }
  const onDrop = id => e => {
    e.preventDefault()
    if (!dragId || dragId === id) { setDragId(null); return }
    const from = groupOf(dragId)
    const to = groupOf(id)
    if (from !== to) { place(dragId, to.id); setDragId(null); return }
    const next = to.items.map(item => item.id)
    const at = next.indexOf(id)
    next.splice(next.indexOf(dragId), 1)
    next.splice(at, 0, dragId)
    onChange(mergeNavOrder(order, next))
    setDragId(null)
  }

  const row = (item, group) => (
    <div
      key={item.id}
      data-testid="nav-order-row"
      draggable
      onDragStart={onDragStart(item.id)}
      onDragOver={onDragOver}
      onDrop={onDrop(item.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderRadius: 6, cursor: 'grab',
        border: '1px solid var(--border)', background: 'var(--surface-2)',
        fontSize: 13, opacity: dragId === item.id ? 0.5 : isHidden(item.id) ? 0.55 : 1,
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--text-subtle)', cursor: 'grab' }}>⋮⋮</span>
      {onHiddenChange && (
        <input type="checkbox" aria-label={`Show ${item.label} in the sidebar`} checked={!isHidden(item.id)}
          onChange={e => setShown(item.id, e.target.checked)} />
      )}
      <span data-testid="nav-order-item">{item.label}</span>
      {isHidden(item.id) && <span style={{ marginLeft: onPlacementChange ? 0 : 'auto', fontSize: 11, color: 'var(--text-subtle)' }}>Hidden</span>}
      {onPlacementChange && (
        <select aria-label={`Move ${item.label} to`} value="" onChange={e => { if (e.target.value) place(item.id, e.target.value) }}
          style={{ marginLeft: 'auto', fontSize: 12, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
          <option value="">Move to…</option>
          {NAV_PLACES.filter(p => p.id !== group.id).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      )}
    </div>
  )

  if (!onPlacementChange) {
    return (
      <div className="nav-order-editor" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {groups[0].items.map(item => row(item, groups[0]))}
      </div>
    )
  }

  return (
    <div className="nav-order-editor" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map(group => {
        const headingId = `nav-order-group-${group.id}`
        return (
          <div key={group.id} role="group" aria-labelledby={headingId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div id={headingId} style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-subtle)' }}>{group.label}</div>
            {group.items.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '2px 8px' }}>Nothing here. Move a screen in.</div>
            )}
            {group.items.map(item => row(item, group))}
          </div>
        )
      })}
    </div>
  )
}
