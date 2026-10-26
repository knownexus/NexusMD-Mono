// packages/ui/src/views/db-menu.jsx
//
// The Database page's menu: opened from a "⋯" button or a right-click, at a point on screen.
// Items come as a list —
//   { label, icon?, hint?, onSelect, disabled?, danger?, checked? }   an action
//   { label, icon?, submenu: [...] }                                  a flyout to the side
//   { input: { label, placeholder, initial?, submitLabel, onSubmit } } a name typed in place
//   { heading: 'Text' } · { separator: true }
// Arrow keys move, → / ← open and close a flyout, Enter picks, Esc or a click elsewhere closes.

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Icon } from '../icons.jsx'

const actionable = item => (item.onSelect || item.submenu) && !item.disabled

// Keeps a menu inside the window: flips left / up when it would run off the edge.
function useFit(ref, x, y, { alignRight = false } = {}) {
  const [pos, setPos] = useState({ left: x, top: y, ready: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    let left = alignRight ? x - width : x
    if (left + width > vw - 8) left = Math.max(8, vw - width - 8)
    if (left < 8) left = 8
    let top = y
    if (top + height > vh - 8) top = Math.max(8, vh - height - 8)
    setPos({ left, top, ready: true })
  }, [ref, x, y, alignRight])
  return pos
}

function MenuInput({ input, onDone }) {
  const [value, setValue] = useState(input.initial ?? '')
  return (
    <form
      className="nx-db-menu-form"
      onSubmit={e => { e.preventDefault(); if (!value.trim()) return; input.onSubmit(value.trim()); onDone() }}
      onKeyDown={e => e.stopPropagation()}
    >
      <input className="db-input" aria-label={input.label} placeholder={input.placeholder} value={value}
        autoFocus={input.autoFocus} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone() } }} />
      <button type="submit" className="btn sm" disabled={!value.trim()}>{input.submitLabel}</button>
    </form>
  )
}

function MenuPanel({ items, x, y, alignRight, label, onClose, onBack, depth = 0 }) {
  const ref = useRef(null)
  const pos = useFit(ref, x, y, { alignRight })
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(null) // index of the item whose flyout is showing
  const itemRefs = useRef([])

  // The first action takes focus when the menu opens, so the keyboard works straight away.
  // (Only then: the items are rebuilt on every render of the page behind.)
  useEffect(() => {
    const first = items.findIndex(actionable)
    if (first >= 0) { setActive(first); itemRefs.current[first]?.focus() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const move = (by) => {
    const idx = items.map((it, i) => (actionable(it) ? i : -1)).filter(i => i >= 0)
    if (!idx.length) return
    const at = idx.indexOf(active)
    const next = idx[(at + by + idx.length) % idx.length]
    setActive(next)
    itemRefs.current[next]?.focus()
  }

  const pick = (item, i) => {
    if (item.disabled) return
    if (item.submenu) { setOpen(i); return }
    onClose()
    item.onSelect?.()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'ArrowRight' && items[active]?.submenu) { e.preventDefault(); setOpen(active) }
    else if (e.key === 'ArrowLeft' && onBack) { e.preventDefault(); e.stopPropagation(); onBack() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack ? onBack() : onClose() }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1) }
    else return
    e.stopPropagation()
  }

  const flyoutAt = (i) => {
    const r = itemRefs.current[i]?.getBoundingClientRect()
    if (!r) return { x: pos.left, y: pos.top }
    // To the right, unless that would leave the window; then to the left.
    const right = r.right + 2
    return right + 230 > window.innerWidth ? { x: r.left - 2, y: r.top - 6, alignRight: true } : { x: right, y: r.top - 6 }
  }

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className="nx-db-cmenu"
        data-depth={depth}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onKeyDown={onKeyDown}
        onContextMenu={e => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.separator) return <div key={i} className="nx-db-menu-sep" role="separator" />
          if (item.heading) return <div key={i} className="nx-db-cmenu-head" title={item.heading}>{item.heading}</div>
          if (item.input) return <MenuInput key={i} input={item.input} onDone={onClose} />
          return (
            <button
              key={i}
              ref={el => { itemRefs.current[i] = el }}
              type="button"
              role={item.checked != null ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.checked != null ? !!item.checked : undefined}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? open === i : undefined}
              className="nx-db-cmenu-item"
              data-danger={item.danger || undefined}
              data-active={active === i || undefined}
              disabled={item.disabled}
              title={item.title}
              onMouseEnter={() => { setActive(i); if (item.submenu) setOpen(i); else if (open != null) setOpen(null) }}
              onClick={() => pick(item, i)}
            >
              <span className="ic">{item.checked ? <Icon name="check" size={12} /> : item.icon ? <Icon name={item.icon} size={12} /> : null}</span>
              <span className="lbl">{item.label}</span>
              {item.hint && <span className="hint">{item.hint}</span>}
              {item.submenu && <Icon name="chevron-right" size={11} className="sub" />}
            </button>
          )
        })}
      </div>
      {open != null && items[open]?.submenu && (
        <MenuPanel
          {...flyoutAt(open)}
          items={items[open].submenu}
          label={items[open].label}
          depth={depth + 1}
          onClose={onClose}
          onBack={() => { setOpen(null); itemRefs.current[open]?.focus() }}
        />
      )}
    </>
  )
}

/**
 * A menu at (x, y) — a right-click's point, or under a "⋯" button (alignRight lines its right
 * edge up with the button's). Closes on Esc, a click outside, scrolling or resizing.
 */
export function DbMenu({ items, x, y, alignRight = false, label, onClose }) {
  const root = useRef(null)
  useEffect(() => {
    const onDown = e => { if (!root.current?.contains(e.target)) onClose() }
    const onAway = () => onClose()
    // Scrolling inside the menu itself (a long group list) mustn't close it.
    const onScroll = e => { if (!root.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onAway)
    window.addEventListener('resize', onAway)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onAway)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])
  return (
    <div ref={root} className="nx-db-cmenu-root">
      <MenuPanel items={items} x={x} y={y} alignRight={alignRight} label={label} onClose={onClose} />
    </div>
  )
}

/** Where a menu opened from a button goes: under it, right edges lined up. */
export const menuPointFor = el => {
  const r = el.getBoundingClientRect()
  return { x: r.right, y: r.bottom + 4, alignRight: true }
}
