import React from 'react'
import { normaliseSummary } from '@nexusmd/core'

export function SummaryCard({ result }) {
  const s = normaliseSummary(result)
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>{s.title}</strong>
      {s.sections.map((sec, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sec.heading && <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{sec.heading}</div>}
          {sec.rows.map((r, j) => (
            <div key={`${j}:${r.key}`} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>{r.key}</span>
              <span style={r.failed ? { color: 'var(--danger)' } : undefined}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
      {s.notes.map((n, i) => <div key={`${i}:${n}`} style={{ color: 'var(--text-muted)', fontSize: 12 }}>{n}</div>)}
    </div>
  )
}
