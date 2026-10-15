import React from 'react'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}
const BADGE = {
  starting: ['info', 'Starting…'], running: ['info', 'Running'], done: ['ok', 'Finished'],
  cancelled: ['', 'Cancelled'], failed: ['bad', 'Failed'],
}

/**
 * Slide-over output panel. Mount inside a `position: relative` container (.nx-page).
 * lines: [{ text, stream?: 'stderr', tone?: 'muted'|'ok'|'warn'|'bad'|'cmd' }] — ANSI in text is rendered.
 */
export function RunDrawer({ title, eyebrow = 'Output', status, lines = [], step = null, error = null, cancelling = false, exitCode = null, onClose, onCancel, onRetry }) {
  const out = React.useRef(null)
  const running = status === 'starting' || status === 'running'
  React.useEffect(() => { const el = out.current; if (el) el.scrollTop = el.scrollHeight }, [lines.length])
  const [tone, label] = BADGE[status] || ['', status || '']
  const badge = status === 'running' && cancelling ? 'Cancelling…' : status === 'failed' && exitCode != null ? `Failed (exit ${exitCode})` : label
  const copy = () => navigator.clipboard?.writeText(lines.map(l => stripAnsi(l.text)).join('\n')).catch(() => {})

  return (
    <aside className="nx-drawer" role="dialog" aria-label={title}>
      <div className="nx-drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nx-eyebrow">{eyebrow}</div>
          <div className="nx-drawer-title nx-trunc">{title}</div>
        </div>
        <span className={`nx-badge ${tone}`}>{badge}</span>
        <button className="btn sm ghost" onClick={copy} disabled={!lines.length}>Copy</button>
        {running && onCancel && <button className="btn sm danger" onClick={onCancel} disabled={cancelling}>Cancel</button>}
        <button className="btn sm" onClick={onClose}>Close</button>
      </div>
      {step && running && (
        <div className="nx-drawer-progress"><div style={{ width: `${Math.min(100, (step.n / Math.max(1, step.total)) * 100)}%` }} /></div>
      )}
      <pre ref={out} className="nx-drawer-out">
        {step && running && <div className="t-muted">{`Step ${step.n} of ${step.total}: ${step.text}`}</div>}
        {lines.map((l, i) => (
          <div key={i} className={l.tone ? `t-${l.tone}` : l.stream === 'stderr' ? 't-bad' : undefined}>
            {ansiToSpans(l.text).map((s, j) => (
              <span key={j} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
            ))}
          </div>
        ))}
        {error && <div className="t-bad">{error}</div>}
        {running && <div className="t-muted">Working…</div>}
      </pre>
      {status === 'failed' && onRetry && (
        <div className="nx-drawer-foot"><button className="btn sm" onClick={onRetry}>Run again</button></div>
      )}
    </aside>
  )
}
