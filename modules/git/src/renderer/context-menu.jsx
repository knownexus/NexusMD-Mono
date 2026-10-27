import React from 'react'

/**
 * A right-click menu at the pointer. `menu` is { x, y, label, items: [{ label, onSelect }] } or null.
 * Closes on a click elsewhere, Esc, losing focus, or after a choice; ↑/↓ move between items.
 */
export function ContextMenu({ menu, onClose }) {
  const root = React.useRef(null)
  // Read through a ref so a parent's fresh onClose each render doesn't re-run the effect (and re-focus).
  const close = React.useRef(onClose)
  close.current = onClose
  React.useEffect(() => {
    if (!menu) return undefined
    const away = e => { if (!root.current?.contains(e.target)) close.current() }
    const esc = e => { if (e.key === 'Escape') close.current() }
    const blur = () => close.current()
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', blur)
    root.current?.querySelector('.nx-gw-menu-item')?.focus()
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', blur)
    }
  }, [menu])
  if (!menu) return null
  const onKeyDown = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = [...root.current.querySelectorAll('.nx-gw-menu-item')]
    const i = list.indexOf(document.activeElement)
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
  }
  return (
    <div ref={root} role="menu" aria-label={menu.label} className="nx-gw-menu nx-gw-ctx" onKeyDown={onKeyDown}
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 50 }}>
      {menu.items.map(it => (
        <button key={it.label} type="button" role="menuitem" className="nx-gw-menu-item" onClick={() => { onClose(); it.onSelect() }}>{it.label}</button>
      ))}
    </div>
  )
}

/** Where a context menu opens for this event: at the pointer, or beside the row for the Menu key. */
export function menuPoint(e) {
  const box = e.currentTarget.getBoundingClientRect()
  return { x: e.clientX || box.left + 24, y: e.clientY || box.bottom }
}
