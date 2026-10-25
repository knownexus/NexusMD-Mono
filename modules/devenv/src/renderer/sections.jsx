import React from 'react'

// Building blocks shared by the Dev Environment dialogs, in the dashboard tiles' style.

export function Section({ title, meta = null, actions = null, children }) {
  return (
    <section className="nx-section" aria-label={title}>
      <div className="nx-tile-head">
        <span>{title}</span>
        {(meta != null || actions) && (
          <span className="row" style={{ gap: 8 }}>
            {meta != null && <span className="nx-tile-meta">{meta}</span>}
            {actions}
          </span>
        )}
      </div>
      <div className="nx-section-body">{children}</div>
    </section>
  )
}

export function StatusLine({ state, meta, children }) {
  return (
    <div className="nx-row">
      <span className="nx-dot" data-state={state} aria-label={state} />
      <span className="nx-trunc">{children}</span>
      {meta && <span className="nx-row-meta nx-mono">{meta}</span>}
    </div>
  )
}

export function Field({ label, aria, value, onChange, hint, mono = false, ...rest }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      <input className={`nx-input${mono ? ' mono' : ''}`} aria-label={aria} value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />
      {hint && <span className="nx-field-hint">{hint}</span>}
    </label>
  )
}

export function Check({ label, aria, checked, onChange }) {
  return (
    <label>
      <input type="checkbox" aria-label={aria} checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
