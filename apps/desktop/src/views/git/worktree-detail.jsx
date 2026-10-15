import React from 'react'
import { statusCode } from '@nexusmd/core'

const AREA_COLOUR = { staged: 'var(--success)', unstaged: 'var(--warning)', untracked: 'var(--warning)', conflict: 'var(--danger)' }

function Field({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span><span style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/** Where a worktree is and how it tracks its upstream; shown above its changes. */
export function WorktreeHeader({ tree }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Field label="Path" value={tree.path} />
      <Field label="Upstream" value={tree.upstream ? `${tree.upstream}${tree.upstreamGone ? ' (missing)' : ''}` : 'None'} />
      <Field label="Last fetch" value={tree.fetchedAt ? new Date(tree.fetchedAt).toLocaleString() : 'Unknown'} />
      <Field label="In progress" value={tree.operation} />
      <Field label="Locked" value={tree.locked} />
      <Field label="Stale" value={tree.prunable} />
      {tree.error && <div role="alert" style={{ color: 'var(--danger)' }}>{tree.error}</div>}
    </div>
  )
}

export function WorktreeDetail({ tree, branch }) {
  if (branch) {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <Field label="Branch" value={branch.name} />
        <Field label="Last commit" value={`${branch.head.slice(0, 7)} ${branch.subject}`} />
        <Field label="Upstream" value={branch.upstream || 'None'} />
        <div style={{ color: 'var(--text-muted)' }}>Not checked out in any worktree.</div>
      </div>
    )
  }
  if (!tree) return <div style={{ color: 'var(--text-muted)' }}>Select a worktree to see its details.</div>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <WorktreeHeader tree={tree} />
      {!tree.error && (
        tree.changes.length === 0
          ? <div style={{ color: 'var(--text-muted)' }}>No changes.</div>
          : (
            <ul aria-label="Changed files" style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--font-mono, monospace)' }}>
              {tree.changes.map(c => (
                <li key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: AREA_COLOUR[c.area], whiteSpace: 'pre' }}>{statusCode(c)}</span>
                  <span>{c.path}</span>
                  {c.originalPath && <span style={{ color: 'var(--text-muted)' }}>{`← ${c.originalPath}`}</span>}
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  )
}
