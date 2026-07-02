import React from 'react'
import { orderedNav } from './layout.js'

// Drag-to-reorder list of nav items, editing the persisted navOrder from
// Settings. Mirrors the dashboard widget DnD pattern (view-dashboard.jsx):
// HTML5 draggable rows, reorder on drop, report the new id array upward.
export function NavOrderEditor({ nav, order, onChange }) {
  const items = orderedNav(order, nav)
  const ids = items.map(item => item.id)
  const [dragId, setDragId] = React.useState(null)

  const onDragStart = id => e => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = () => e => { e.preventDefault() }
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
          draggable
          onDragStart={onDragStart(item.id)}
          onDragOver={onDragOver()}
          onDrop={onDrop(item.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 6, cursor: 'grab',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            fontSize: 13, opacity: dragId === item.id ? 0.5 : 1,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--text-subtle)', cursor: 'grab' }}>⋮⋮</span>
          <span data-testid="nav-order-item">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
