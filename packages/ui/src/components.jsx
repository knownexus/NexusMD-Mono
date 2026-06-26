// components.jsx — pure, prop-driven presentational primitives shared across apps.
//
// Only stateless, platform-agnostic components live here. App-coupled pieces
// (Avatar/TypeIcon read team data; usePersisted writes localStorage/sync) stay in
// the apps until they're refactored to take data via props.

import React from 'react'
import { stateCategory } from '@nexusmd/core'

/** Coloured state dot (optionally labelled). */
export function StateDot({ state, withLabel }) {
  const cat = stateCategory(state)
  const dotColor = {
    done:    'var(--success)',
    active:  'var(--info)',
    review:  'var(--violet)',
    blocked: 'var(--danger)',
    todo:    'var(--text-muted)',
  }[cat] ?? 'var(--text-muted)'
  return (
    <span className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }}/>
      {withLabel && <span>{state || '—'}</span>}
    </span>
  )
}

/** Priority pill. */
export function Prio({ p }) {
  if (!p) return <span className="muted mono" style={{ fontSize: 10.5 }}>—</span>
  return <span className={`prio p${p}`}>P{p}</span>
}

/** Toggleable filter chip with optional count. */
export function FilterChip({ active, count, onClick, children, icon }) {
  return (
    <div className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {count != null && <span className="count">{count}</span>}
    </div>
  )
}

/** Card frame with header (title/subtitle/actions/badge) and body. */
export function CardFrame({ title, subtitle, actions, children, className = '', icon, padded = true, badge }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        {icon && <span style={{ color: 'var(--text-subtle)' }}>{icon}</span>}
        <h3>{title}</h3>
        {badge && <span className="pill" style={{ fontSize: 10 }}>{badge}</span>}
        {subtitle && <span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{subtitle}</span>}
        {actions && <div className="actions">{actions}</div>}
      </div>
      <div className={padded ? 'card-body' : 'card-body flush'}>{children}</div>
    </div>
  )
}

/** Minimal inline sparkline. */
export function Sparkline({ data, width = 64, height = 22, color = 'currentColor' }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/** Labelled stat tile with optional trend + sparkline. */
export function Stat({ label, value, meta, trend, spark, sparkColor, accent, icon }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value" style={accent ? { color: accent } : null}>{value}</div>
      {meta && (
        <div className="stat-meta">
          {trend && <span className={`stat-trend ${trend.dir}`}>{trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '·'} {trend.value}</span>}
          <span>{meta}</span>
        </div>
      )}
      {spark && <Sparkline data={spark} color={sparkColor || 'var(--text-subtle)'}/>}
    </div>
  )
}
