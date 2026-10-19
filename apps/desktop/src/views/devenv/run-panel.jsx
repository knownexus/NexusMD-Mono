import React from 'react'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning, #b8860b)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}
const TONE = { starting: 'info', running: 'info', done: 'ok', failed: 'bad' }

function badge(state) {
  if (state.status === 'starting') return 'Starting…'
  if (state.status === 'running') return state.cancelling ? 'Cancelling…' : 'Running'
  if (state.status === 'done') return 'Done'
  if (state.status === 'cancelled') return 'Cancelled'
  if (state.status === 'failed') return state.exitCode == null ? 'Failed' : `Failed (exit ${state.exitCode})`
  return ''
}

// A run's output inside a dialog, styled like the run drawer.
export function RunPanel({ state, onCancel }) {
  const outRef = React.useRef(null)
  const running = state.status === 'starting' || state.status === 'running'

  React.useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.lines.length])

  const copy = () => navigator.clipboard?.writeText(state.lines.map(l => stripAnsi(l.text)).join('\n')).catch(() => {})

  return (
    <section className="nx-run devenv-run" aria-label="Output">
      <div className="nx-drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nx-drawer-title nx-trunc nx-mono" style={{ fontSize: 12.5, marginTop: 0 }}>{state.command}</div>
          {state.step && running && <div className="nx-muted" style={{ fontSize: 12, marginTop: 2 }}>{`${state.step.n}/${state.step.total} ${state.step.text}`}</div>}
        </div>
        <span className={`nx-badge ${TONE[state.status] || ''}`}>{badge(state)}</span>
        <button className="btn sm ghost" onClick={copy} disabled={!state.lines.length}>Copy output</button>
        {running && <button className="btn sm danger" onClick={onCancel} disabled={state.cancelling}>Cancel</button>}
      </div>
      {state.step && running && (
        <div className="nx-drawer-progress"><div style={{ width: `${Math.min(100, (state.step.n / Math.max(1, state.step.total)) * 100)}%` }} /></div>
      )}
      {state.error && <div className="nx-alert bad" style={{ borderRadius: 0 }}>{state.error}</div>}
      <pre ref={outRef} className="nx-drawer-out">
        {state.lines.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 't-bad' : undefined}>
            {ansiToSpans(l.text).map((s, j) => (
              <span key={j} data-color={s.color || undefined} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
            ))}
          </div>
        ))}
      </pre>
    </section>
  )
}
