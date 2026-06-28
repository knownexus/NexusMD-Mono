// toast.jsx — lightweight global toast notifications (shared across platforms).
//
// Usage from anywhere:
//   const id = toast('Saved', 'success');           // success | error | info | loading
//   toast('Working…', 'loading', { duration: 0 });  // 0 = stays until dismissed
//   toast.dismiss(id);
//
// <ToastHost/> is mounted once per app root.

import React from 'react'
import { Icon } from './icons.jsx'

export const NexusMDToastBus = (() => {
  const listeners = new Set()
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    emit(evt) { listeners.forEach((fn) => fn(evt)) },
  }
})()

export const toast = (message, type = 'info', opts = {}) => {
  const id = (typeof window !== 'undefined')
    ? (window.__nexusMDToastId = (window.__nexusMDToastId || 0) + 1)
    : Math.floor(performance.now())
  NexusMDToastBus.emit({ id, message, type, duration: opts.duration ?? 4500 })
  return id
}
toast.dismiss = (id) => NexusMDToastBus.emit({ __dismiss: id })

export function ToastHost() {
  const [toasts, setToasts] = React.useState([])

  // one-time keyframe injection (inline styles can't define @keyframes)
  React.useEffect(() => {
    if (!document.getElementById('nexusmd-toast-kf')) {
      const s = document.createElement('style')
      s.id = 'nexusmd-toast-kf'
      s.textContent = '@keyframes nexusMDToastIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'
      document.head.appendChild(s)
    }
  }, [])

  React.useEffect(() => NexusMDToastBus.subscribe((evt) => {
    if (evt.__dismiss != null) {
      setToasts((list) => list.filter((x) => x.id !== evt.__dismiss))
      return
    }
    setToasts((list) => [...list, evt])
    if (evt.duration > 0) {
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== evt.id)), evt.duration)
    }
  }), [])

  const remove = (id) => setToasts((list) => list.filter((x) => x.id !== id))

  const palette = {
    success: { icon: 'check', accent: 'var(--success, #16a34a)' },
    error: { icon: 'alert', accent: 'var(--danger, #dc2626)' },
    info: { icon: 'info', accent: 'var(--accent, #2563eb)' },
    loading: { icon: 'refresh', accent: 'var(--text-muted, #888)' },
  }

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380, pointerEvents: 'none',
    }}>
      {toasts.map((t) => {
        const p = palette[t.type] || palette.info
        return (
          <div key={t.id} role="status" style={{
            pointerEvents: 'auto',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: 'var(--surface, #fff)', color: 'var(--text, #111)',
            border: '1px solid var(--border, #e5e7eb)', borderLeft: `3px solid ${p.accent}`,
            borderRadius: 10, padding: '10px 12px',
            boxShadow: 'var(--shadow-pop, 0 8px 24px rgba(0,0,0,.12))',
            fontSize: 13, fontFamily: 'var(--sans, system-ui)',
            animation: 'nexusMDToastIn .18s ease',
          }}>
            <span style={{ color: p.accent, flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
              <Icon name={p.icon} size={15} />
            </span>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
            <button onClick={() => remove(t.id)} title="Dismiss" style={{
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-subtle, #999)', padding: 0, flexShrink: 0, display: 'inline-flex',
            }}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
