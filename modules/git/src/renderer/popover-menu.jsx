import React from 'react'

/**
 * A button that opens a small menu (replaces modal menus such as GroupMenu's first screen).
 * items: [{ heading }] or [{ label, onSelect, hint?, danger?, disabled?, reason? }]. A disabled item's
 * `reason` becomes its tooltip. Closes on outside click, Esc, or after a choice; ↑/↓ move between items.
 */
export function PopoverMenu({ label, items, align = 'right', buttonClassName = 'btn sm', buttonProps = {}, menuLabel = label }) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef(null)
  const btn = React.useRef(null)
  React.useEffect(() => {
    if (!open) return undefined
    const away = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', away)
    root.current?.querySelector('.nx-gw-menu-item:not([disabled])')?.focus()
    return () => window.removeEventListener('mousedown', away)
  }, [open])
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = [...root.current.querySelectorAll('.nx-gw-menu-item:not([disabled])')]
    const i = list.indexOf(document.activeElement)
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
  }
  return (
    <span className="nx-gw-pop" ref={root} onKeyDown={onKeyDown}>
      <button ref={btn} type="button" className={buttonClassName} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} {...buttonProps}>{label}</button>
      {open && (
        <div role="menu" aria-label={typeof menuLabel === 'string' ? menuLabel : undefined} className="nx-gw-menu" data-align={align}>
          {items.map((it, i) => (it.heading
            ? <div key={`h${i}`} className="nx-gw-menu-head">{it.heading}</div>
            : (
              <button key={it.label} type="button" role="menuitem" className="nx-gw-menu-item" data-danger={it.danger || undefined}
                disabled={!!it.disabled} title={it.disabled ? it.reason : undefined}
                onClick={() => { setOpen(false); it.onSelect() }}>
                {it.label}{it.hint != null && it.hint !== '' && <span className="hint">{it.hint}</span>}
              </button>
            )))}
        </div>
      )}
    </span>
  )
}
