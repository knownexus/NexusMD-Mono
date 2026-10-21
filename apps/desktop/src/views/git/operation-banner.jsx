import React from 'react'
import { operationText, checkoutName } from '@nexusmd/core'

const VERB = { rebase: 'Rebasing', merge: 'Merging', revert: 'Reverting', 'cherry-pick': 'Cherry-picking' }
const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }
const shortRef = r => String(r ?? '').replace(/^refs\/(heads|remotes|tags)\//, '')

/**
 * Drop-in replacement for OperationBar (same props, same accessible button names: Continue, Skip, Abort).
 * Says what's paused and why, shows step progress and conflicts left, and explains a disabled Continue.
 * Abort should open a confirmation (onAction('abort') → the existing ActionDialog 'abort' preview).
 */
export function OperationBanner({ tree, onAction }) {
  if (!tree?.operation) return null
  const info = tree.operationInfo
  const kind = info?.kind
  const conflicts = tree.changes.filter(c => c.area === 'conflict').length
  const onto = shortRef(info?.onto?.name)
  const title = `${VERB[kind] ?? 'Paused'}${onto ? ` onto ${onto}` : ''} — ${conflicts ? 'paused on conflicts' : 'ready to continue'}`
  // operationText keeps the existing wording ("Rebasing feat onto main · commit 2 of 5 · abc1234 "subject"").
  const detail = operationText(info, checkoutName(tree)) || tree.operation
  const steps = info?.total ? Array.from({ length: info.total }, (_, i) => (i < info.step - 1 ? 'done' : i === info.step - 1 ? 'now' : 'todo')) : []
  return (
    <div role="status" className="nx-gw-op">
      <div className="nx-gw-op-main">
        <div className="nx-gw-op-title">{info ? title : tree.operation}</div>
        <div className="nx-gw-op-sub" title={detail}>{detail}</div>
        <div className="nx-gw-op-progress">
          {steps.length > 0 && <div className="nx-gw-steps" aria-label={`Step ${info.step} of ${info.total}`}>{steps.map((s, i) => <span key={i} data-s={s} />)}</div>}
          <span className="nx-gw-op-count" style={{ color: conflicts ? 'var(--danger)' : 'var(--success)' }}>
            {conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} left` : 'All conflicts resolved'}
          </span>
        </div>
      </div>
      <div className="nx-gw-op-actions">
        <button className="btn sm accent" aria-label="Continue" disabled={conflicts > 0} title={conflicts ? 'Resolve every conflicted file first' : `Continue the ${NOUN[kind] ?? 'operation'}`}
          onClick={() => onAction('continue', {})}>{`Continue ${NOUN[kind] ?? ''}`.trim()}</button>
        {kind !== 'merge' && <button className="btn sm" aria-label="Skip" onClick={() => onAction('skip', {})}>Skip this commit</button>}
        <button className="btn sm ghost danger" aria-label="Abort" onClick={() => onAction('abort', {})}>Abort</button>
      </div>
    </div>
  )
}
