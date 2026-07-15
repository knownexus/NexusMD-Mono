import React from 'react'

const toggleStyle = { border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px 0 0', color: 'var(--text-muted)', fontSize: 10 }

function JsonValue({ value }) {
  const [collapsed, setCollapsed] = React.useState(false)

  if (Array.isArray(value)) {
    if (!value.length) return <span>[]</span>
    return (
      <span>
        <button type="button" onClick={() => setCollapsed(c => !c)} style={toggleStyle}>{collapsed ? '▶' : '▼'}</button>
        [{collapsed ? '…' : (
          <div style={{ paddingLeft: 16 }}>
            {value.map((v, i) => (
              <div key={i}>
                <JsonValue value={v} />
                {i < value.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
        )}]
      </span>
    )
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return <span>{'{}'}</span>
    return (
      <span>
        <button type="button" onClick={() => setCollapsed(c => !c)} style={toggleStyle}>{collapsed ? '▶' : '▼'}</button>
        {'{'}{collapsed ? '…' : (
          <div style={{ paddingLeft: 16 }}>
            {entries.map(([k, v], i) => (
              <div key={k}>
                <span style={{ color: 'var(--accent, #1d6fcc)' }}>"{k}"</span>: <JsonValue value={v} />
                {i < entries.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
        )}{'}'}
      </span>
    )
  }

  if (typeof value === 'string') return <span style={{ color: 'var(--success, #2a2)' }}>"{value}"</span>
  if (typeof value === 'number' || typeof value === 'boolean') return <span style={{ color: 'var(--warning, #b58900)' }}>{String(value)}</span>
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>null</span>
  return <span>{String(value)}</span>
}

/**
 * Renders `text` as a collapsible JSON tree when it parses as JSON;
 * otherwise falls back to a plain monospace block (XML/HTML/text bodies).
 */
export function JsonPretty({ text }) {
  const parsed = React.useMemo(() => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false }
    try { return { ok: true, value: JSON.parse(text) } } catch { return { ok: false } }
  }, [text])

  if (!parsed.ok) {
    return (
      <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300, margin: 0 }}>
        {text}
      </pre>
    )
  }

  return (
    <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300, fontFamily: 'monospace' }}>
      <JsonValue value={parsed.value} />
    </div>
  )
}
