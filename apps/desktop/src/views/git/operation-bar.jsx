import React from 'react'
import { operationText, checkoutName } from '@nexusmd/core'

/** A rebase, merge, revert or cherry-pick stopped part-way: say where it is, and offer Continue, Skip (not for a merge) or Abort. */
export function OperationBar({ tree, onAction }) {
  if (!tree?.operation) return null
  const conflicts = tree.changes.some(c => c.area === 'conflict')
  const kind = tree.operationInfo?.kind
  const text = operationText(tree.operationInfo, checkoutName(tree)) || tree.operation
  return (
    <div role="status" className="card" style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--warning)' }}>
      <strong style={{ flex: 1 }}>{text}</strong>
      <button className="btn sm" disabled={conflicts} title={conflicts ? 'Resolve every conflicted file first' : undefined} onClick={() => onAction('continue', {})}>Continue</button>
      {kind !== 'merge' && <button className="btn sm" onClick={() => onAction('skip', {})}>Skip</button>}
      <button className="btn sm danger" onClick={() => onAction('abort', {})}>Abort</button>
    </div>
  )
}
