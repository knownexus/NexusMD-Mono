import React from 'react'
import { ansiToSpans, stripAnsi, classifyLogLevel, filterLogLines } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning, #b8860b)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}
const LEVEL_BORDER = { error: 'var(--danger)', warn: 'var(--warning, #b8860b)' }

// A run's output as a log: filtered, level-highlighted, optionally pinned to the newest line.
export function LogPanel({ state, filter, onStop }) {
  const outRef = React.useRef(null)
  const [pinned, setPinned] = React.useState(true)
  const running = state.status === 'starting' || state.status === 'running'
  const shown = filterLogLines(state.lines, filter)

  React.useEffect(() => {
    const el = outRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [state.lines.length, pinned])

  const copy = () => navigator.clipboard?.writeText(shown.map(r => stripAnsi(r.line.text)).join('\n')).catch(() => {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{state.command}</strong>
        <span style={{ color: 'var(--text-muted)' }}>{`${shown.length} of ${state.lines.length} lines`}</span>
        {state.status === 'failed' && <span className="chip failed">{state.exitCode == null ? 'Failed' : `Failed (exit ${state.exitCode})`}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} aria-label="Scroll to newest" />
            <span>Scroll to newest</span>
          </label>
          <button className="btn sm ghost" onClick={copy} disabled={!shown.length}>Copy</button>
          {running && <button className="btn sm danger" onClick={onStop} disabled={state.cancelling}>Stop</button>}
        </span>
      </div>
      {state.error && <div style={{ color: 'var(--danger)' }}>{state.error}</div>}
      <pre ref={outRef} style={{ flex: 1, minHeight: 200, overflow: 'auto', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {shown.map(({ line, index }) => {
          const level = classifyLogLevel(line.text)
          return (
            <div key={index} data-level={level || undefined}
              style={{ borderLeft: level ? `3px solid ${LEVEL_BORDER[level]}` : '3px solid transparent', paddingLeft: 6, color: line.stream === 'stderr' ? 'var(--danger)' : undefined }}>
              {ansiToSpans(line.text).map((s, j) => (
                <span key={j} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
              ))}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
