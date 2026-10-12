// planner-chips.jsx — shared Planner v2 presentational primitives.
//
// The pure date/status logic (PL_STATUSES, PL_PRIOS, plParseYmd, plIsOverdueYmd…)
// lives in @nexusmd/core; these are the React chips/modal that render it. No
// platform (electron/capacitor/DOM-storage) dependencies — only React + core.

import React from 'react'
import { PL_STATUSES, PL_PRIOS, plParseYmd, plIsOverdueYmd, plIsTodayYmd } from '@nexusmd/core'
import { Icon } from './icons.jsx'

const { useEffect } = React

/** Status select rendered as a coloured chip. */
export function StatusChip({ value, onChange, stopClick, readOnly }) {
  return (
    <span className="stchip" data-s={value || ''} onClick={stopClick ? (e) => e.stopPropagation() : undefined}>
      <span className="face"><span className="cdot"></span>{value || '—'}</span>
      {!readOnly && (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label="Status">
          {PL_STATUSES.map((s) => <option key={s} value={s}>{s || '—'}</option>)}
        </select>
      )}
    </span>
  )
}

/** Priority select rendered as a coloured chip. */
export function PrioChip({ value, onChange, stopClick, readOnly }) {
  const n = value ? value[0] : ''
  return (
    <span className="stchip" onClick={stopClick ? (e) => e.stopPropagation() : undefined}>
      <span className={`priochip p${n || 4}`} style={!value ? { opacity: 0.45 } : null}>{value ? 'P' + n : '—'}</span>
      {!readOnly && (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label="Priority">
          {PL_PRIOS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}
        </select>
      )}
    </span>
  )
}

/** Unified modal shell used by every planner dialog. */
// closeOnBackdrop=false is for dialogs where closing has consequences (e.g. it aborts a
// running command); Esc and the close button still call onClose.
export function PlModal({ open, onClose, icon, title, sub, wide, className, children, footer, footerLeft, closeOnBackdrop = true }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="plm-veil" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}>
      <div className={`plm ${wide ? 'wide' : ''} ${className || ''}`} role="dialog" aria-modal="true">
        <div className="plm-head">
          {icon && <span className="plm-ic"><Icon name={icon} size={16}/></span>}
          <div className="plm-ttl">
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="btn icon ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14}/></button>
        </div>
        <div className="plm-body">{children}</div>
        {(footer || footerLeft) && (
          <div className="plm-foot">
            {footerLeft && <span className="left">{footerLeft}</span>}
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Labeled form field used in drawers/modals. */
export function PlFld({ label, children, span }) {
  return (
    <div className="fld" style={span ? { gridColumn: `span ${span}` } : null}>
      <label>{label}</label>
      {children}
    </div>
  )
}

/** Compact date label with overdue/today colouring. */
export function DueLabel({ value, status }) {
  if (!value) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const d = plParseYmd(value)
  if (!d) return <span style={{ color: 'var(--text-subtle)' }}>{value}</span>
  const overdue = plIsOverdueYmd(value, status)
  const today = plIsTodayYmd(value)
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 11.5, whiteSpace: 'nowrap',
      color: overdue ? 'var(--danger)' : today ? 'var(--accent)' : 'var(--text-muted)',
      fontWeight: overdue || today ? 600 : 400,
    }}>
      {today ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      {overdue && ' !'}
    </span>
  )
}
