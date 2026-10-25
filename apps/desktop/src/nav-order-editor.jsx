import React from 'react'
import { orderedNav } from './layout.js'

// Drag-to-reorder list of nav items, editing the persisted navOrder from
// Settings. Mirrors the dashboard widget DnD pattern (view-dashboard.jsx):
// HTML5 draggable rows, reorder on drop, report the new id array upward.
// Each row's checkbox shows or hides that entry in the sidebar: `hidden` is the ids
// currently hidden and onHiddenChange(ids) reports the new list. A hidden row stays
// in the list, dimmed, so it can be shown again.
export function NavOrderEditor({ nav, order, onChange, hidden = [], onHiddenChange = null }) {
  const items = orderedNav(order, nav)
  const ids = items.map(item => item.id)
  const [dragId, setDragId] = React.useState(null)
  const isHidden = id => hidden.includes(id)
  const setShown = (id, shown) => onHiddenChange?.(shown ? hidden.filter(h => h !== id) : [...hidden, id])

  const onDragStart = id => e => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = e => { e.preventDefault() }
  const onDrop = id => e => {
    e.preventDefault()
    if (!dragId || dragId === id) { setDragId(null); return }
    const next = ids.slice()
    const from = next.indexOf(dragId)
    const to = next.indexOf(id)
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    onChange(next)
    setDragId(null)
  }

  return (
    <div className="nav-order-editor" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map(item => (
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
          {isHidden(item.id) && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-subtle)' }}>Hidden</span>}
        </div>
      ))}
    </div>
  )
}
