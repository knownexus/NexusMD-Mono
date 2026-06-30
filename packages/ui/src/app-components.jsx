// app-components.jsx — shared components that need app data/storage, sourced via
// useNexusData() context rather than a platform's data singleton. These were the
// pieces blocking view promotion (Avatar/TypeIcon read team data; usePersisted
// reads profile-scoped storage). They now run unchanged on web and desktop.

import React from 'react'
import { Icon } from './icons.jsx'
import { useNexusData } from './data-context.jsx'

const { useState, useEffect, useRef } = React

/**
 * useState backed by the host's storage. Handles Sets automatically. With
 * { sync: true } it also calls the host's pushPref (server/remote sync; no-op
 * by default). Keys pass through getProfileKey, so the host decides scoping —
 * web supplies identity (already-namespaced keys), desktop can profile-scope.
 */
export function usePersisted(key, initial, { sync = false } = {}) {
  const { storage, getProfileKey, pushPref } = useNexusData()
  const k = getProfileKey(key)
  const seed = typeof initial === 'function' ? initial() : initial
  const isSet = seed instanceof Set

  const [value, setValue] = useState(() => {
    try {
      const raw = storage.getItem(k)
      if (raw === null || raw === undefined) return seed
      const parsed = JSON.parse(raw)
      return isSet ? new Set(parsed) : parsed
    } catch {
      return seed
    }
  })

  useEffect(() => {
    try {
      storage.setItem(k, JSON.stringify(value instanceof Set ? [...value] : value))
    } catch { /* quota / private mode */ }
  }, [k, value])

  useEffect(() => {
    if (!sync) return
    const serialised = storage.getItem(k)
    if (serialised === null || serialised === undefined) return
    pushPref(key, serialised)
  }, [k, value, sync])

  return [value, setValue]
}

/** Coloured initials avatar. Resolves team/me from context. */
export function Avatar({ who, size = 'sm', title }) {
  const { data } = useNexusData()
  const team = data.TEAM || []
  const me = data.ME || {}
  const member = who === 'me' ? me : team.find((t) => t.id === who)
  const initials = member ? member.initials : (who || '?').slice(0, 2).toUpperCase()
  const hueSeed = (member?.id || who || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const hue = (hueSeed * 47) % 360
  const bg = member?.id === 'me' ? 'var(--accent)' : `oklch(0.75 0.1 ${hue})`
  const fg = member?.id === 'me' ? 'var(--accent-fg)' : 'oklch(0.25 0.08 ' + hue + ')'
  return (
    <div className={`avatar ${size}`} style={{ background: bg, color: fg }} title={title || member?.name || who}>
      {initials}
    </div>
  )
}

/**
 * Sliding detail drawer with drag-to-resize and a per-profile width.
 * Width persists under `${namespace}.ui.drawerWidth` via the host's storage +
 * getProfileKey (web: bare nexusmd key; app: profile-scoped helm key). On
 * viewports ≤600px the drawer goes full-width (the width style is dropped).
 */
export function Drawer({ open, onClose, title, badges, children, actions }) {
  const { storage, getProfileKey, namespace } = useNexusData()
  const widthKey = getProfileKey(`${namespace}.ui.drawerWidth`)
  const DRAWER_MIN = 280
  const DRAWER_MAX = 2000
  const drawerRef = useRef(null)
  const draggedW = useRef(null)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const stored = parseInt(storage.getItem(widthKey) || '560', 10)
    return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, stored))
  })

  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width:600px)').matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width:600px)')
    const handler = (e) => setIsPhone(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function onResizeStart(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = drawerRef.current ? drawerRef.current.offsetWidth : drawerWidth
    draggedW.current = startW
    document.body.classList.add('resizing-drawer')

    function onMove(ev) {
      const newW = Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, startW + (startX - ev.clientX)))
      draggedW.current = newW
      setDrawerWidth(newW)
    }
    function cleanup() {
      document.body.classList.remove('resizing-drawer')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', cleanup)
      window.removeEventListener('blur', cleanup)
      if (draggedW.current) storage.setItem(widthKey, String(draggedW.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', cleanup)
    window.addEventListener('blur', cleanup)
  }

  return (
    <React.Fragment>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose}/>
      <div className={`drawer ${open ? 'open' : ''}`} ref={drawerRef} style={isPhone ? undefined : { width: drawerWidth }}>
        <div className="drawer-resize-handle" onMouseDown={onResizeStart}/>
        <div className="drawer-head">
          <h2 className="truncate">{title}</h2>
          {badges}
          <div className="spacer"/>
          {actions}
          <button className="btn icon ghost sm" onClick={onClose} title="Close (Esc)"><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </React.Fragment>
  )
}

/** Coloured project pill. Resolves the project (id → name/color) from context. */
export function ProjectChip({ id }) {
  const { data } = useNexusData()
  const p = (data.PROJECTS || []).find((x) => x.id === id)
  if (!p) return null
  return (
    <span className="pill" style={{ background: 'transparent', borderColor: 'var(--border)' }}>
      <span className="dot" style={{ background: p.color }}/>
      {p.name}
    </span>
  )
}

/** Work-item type glyph (or labelled pill when window.nexusMDTypeLabels is set). */
export function TypeIcon({ type }) {
  const labelsOn = typeof window !== 'undefined' && window.nexusMDTypeLabels
  if (labelsOn) {
    const labels = { bug: 'Bug', task: 'Task', story: 'Story', feature: 'Feature', epic: 'Epic', spike: 'Spike' }
    return <span className={`type-pill ${type}`} title={type}>{labels[type] || type}</span>
  }
  const map = { bug: 'B', task: 'T', story: 'S', feature: 'F', epic: 'E', spike: 'K' }
  return <span className={`type-icon ${type}`} title={type}>{map[type] || '·'}</span>
}

/** Inline "N new since last visit" banner with dismiss + optional View action. */
export function NotificationBanner({ label, onDismiss, onView }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '0 0 12px 0', padding: '9px 14px',
      borderRadius: 8, fontSize: 13,
      background: 'var(--accent-soft)',
      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
      color: 'var(--accent)',
    }}>
      <Icon name="bell" size={13} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {onView && (
        <button className="btn sm ghost" onClick={onView}
          style={{ color: 'var(--accent)', padding: '2px 10px', flexShrink: 0 }}>
          View
        </button>
      )}
      <button className="btn icon ghost sm" onClick={onDismiss} style={{ flexShrink: 0 }}>
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

/** Small "⋯" popup menu. items: [{ label, icon?, kbd?, danger?, onClick? }]. */
export function MenuButton({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn icon ghost sm" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} title="More">
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%',
          minWidth: 160, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: 4, zIndex: 50, fontSize: 13,
        }}>
          {items.map((it, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick && it.onClick() }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 5,
              width: '100%', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer',
              color: it.danger ? 'var(--danger)' : 'var(--text)', fontSize: 13,
            }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              {it.icon}
              <span>{it.label}</span>
              {it.kbd && <span className="kbd" style={{ marginLeft: 'auto' }}>{it.kbd}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sheet — mobile bottom sheet ─────────────────────────────────────────────
export function Sheet({ open, onClose, icon, title, sub, children, footer, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const labelId = title ? 'm-sheet-title' : undefined;
  return (
    <div className="m-sheet-veil"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m-sheet" style={size === 'tall' ? { maxHeight: '92%' } : null}
        role="dialog" aria-modal="true" aria-labelledby={labelId}
        onClick={e => e.stopPropagation()}>
        {(title || icon) && (
          <div className="m-sheet-h">
            {icon && (
              <span className="ic">
                <Icon name={icon} size={16}/>
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={labelId}>{title}</h2>
              {sub && <div className="sub">{sub}</div>}
            </div>
            <button className="m-iconbtn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={17}/>
            </button>
          </div>
        )}
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
