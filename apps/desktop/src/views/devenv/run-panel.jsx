import React from 'react'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning, #b8860b)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}

function badge(state) {
  if (state.status === 'starting') return 'Starting…'
  if (state.status === 'running') return state.cancelling ? 'Cancelling…' : 'Running'
  if (state.status === 'done') return 'Done'
  if (state.status === 'cancelled') return 'Cancelled'
  if (state.status === 'failed') return state.exitCode == null ? 'Failed' : `Failed (exit ${state.exitCode})`
  return ''
}

export function RunPanel({ state, onCancel }) {
  const outRef = React.useRef(null)
  const running = state.status === 'starting' || state.status === 'running'

  React.useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.lines.length])

  const copy = () => navigator.clipboard?.writeText(state.lines.map(l => stripAnsi(l.text)).join('\n')).catch(() => {})

  return (
    <div className="devenv-run" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{state.command}</strong>
        <span className={`chip ${state.status}`}>{badge(state)}</span>
        {state.step && running && <span style={{ color: 'var(--text-muted)' }}>{`${state.step.n}/${state.step.total} ${state.step.text}`}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={copy} disabled={!state.lines.length}>Copy output</button>
          {running && <button className="btn sm danger" onClick={onCancel} disabled={state.cancelling}>Cancel</button>}
        </span>
      </div>
      {state.step && running && (
        <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--accent)', width: `${Math.min(100, (state.step.n / Math.max(1, state.step.total)) * 100)}%` }} />
        </div>
      )}
      {state.error && <div style={{ color: 'var(--danger)' }}>{state.error}</div>}
      <pre ref={outRef} style={{ flex: 1, minHeight: 200, overflow: 'auto', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {state.lines.map((l, i) => (
          <div key={i} style={l.stream === 'stderr' ? { color: 'var(--danger)' } : undefined}>
            {ansiToSpans(l.text).map((s, j) => (
              <span key={j} data-color={s.color || undefined} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
            ))}
          </div>
        ))}
      </pre>
    </div>
  )
}
