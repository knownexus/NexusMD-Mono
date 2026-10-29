// github-ui.jsx — the pieces every GitHub view is drawn with, in the look of Git Workspace's
// local overview: a card with a tinted head, and one way to say loading, failure and empty.
import React from 'react'

export function GithubCard({ title, hint, tone = 'muted', label, head, children }) {
  return (
    <section className="nx-gw-card" aria-label={label ?? title}>
      <div className="nx-gw-card-head">
        <span className="nx-gw-dot" data-tone={tone} />
        <span className="nx-gw-card-title">{title}</span>
        {hint && <span className="hint">{hint}</span>}
        {head}
      </div>
      {children}
    </section>
  )
}

export function Notice({ kind = 'loading', children }) {
  if (kind === 'error') return <div className="nx-alert" role="alert">{children}</div>
  if (kind === 'empty') return <div className="nx-gw-empty-good">{children}</div>
  return <div className="nx-gw-empty">{children}</div>
}
