import React from 'react'
import { Icon, TypeIcon, Avatar } from '@nexusmd/ui'
import { isTerminalState } from '@nexusmd/core'

export function PersonSummary({ dev, workItems, prs }) {
  const myWIs = workItems.filter(w => w.assignee === dev.id && !isTerminalState(w.state))
  const myPRs = prs.filter(p => p.author === dev.id)

  return (
    <div>
      <div className="drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{dev.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{dev.role}{dev.tz ? ` · ${dev.tz}` : ''}</div>
          {dev.focus && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{dev.focus}</div>}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Active work ({myWIs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {myWIs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No active work items.</div>}
          {myWIs.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <TypeIcon type={w.type}/><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{w.id}</span>
              <span>{w.title}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Open PRs ({myPRs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {myPRs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No open pull requests.</div>}
          {myPRs.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{p.id}</span>
              <span>{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
