import React from 'react'

/** A rebase, merge, revert or cherry-pick stopped part-way: say so, and offer Continue or Abort. */
export function OperationBanner({ tree, onAction }) {
  if (!tree?.operation) return null
  const conflicts = tree.changes.some(c => c.area === 'conflict')
  return (
    <div role="status" className="card" style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--warning)' }}>
      <strong style={{ flex: 1 }}>{tree.operation}</strong>
      {conflicts && <span style={{ fontSize: 12 }}>Resolve the conflicts, stage the files, then continue.</span>}
      <button className="btn sm" disabled={conflicts} title={conflicts ? 'Resolve and stage the conflicted files first' : undefined} onClick={() => onAction('continue', {})}>Continue</button>
      <button className="btn sm danger" onClick={() => onAction('abort', {})}>Abort</button>
    </div>
  )
}
