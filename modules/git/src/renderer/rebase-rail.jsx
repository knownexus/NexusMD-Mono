import React from 'react'
import { checkoutName } from '@nexusmd/core'
import { operationHeading, useConflictCount } from './operation-banner.jsx'

const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`

/** The collapsed strip's label: "Rebase 3 of 7", or just the operation when its position isn't known. */
export function rebaseLabel(tree) {
  const info = tree.operationInfo
  if (!info?.kind) return tree.operation || 'Operation'
  if (info.kind === 'rebase' && info.step != null && info.total != null) return `Rebase ${info.step} of ${info.total}`
  return cap(NOUN[info.kind] ?? 'operation')
}

/**
 * A rebase, merge, revert or cherry-pick stopped part-way, in the Changes tab's right-hand panel in place of
 * the commit form: what is paused and where, the conflicts resolved so far, and Continue, Skip (not for a
 * merge) and Abort. `onAction(kind, options)` is the page's (Abort opens its confirmation). Accessible names
 * stay Continue / Skip / Abort.
 */
export function RebaseRail({ tree, onAction }) {
  const { left, total } = useConflictCount(tree)
  const info = tree.operationInfo
  const kind = info?.kind
  const noun = NOUN[kind] ?? 'operation'
  const position = kind === 'rebase' && info.step != null && info.total != null
  const steps = position ? Array.from({ length: info.total }, (_, i) => (i < info.step - 1 ? 'done' : i === info.step - 1 ? 'now' : 'todo')) : []
  return (
    <div className="nx-gw-crail" role="status">
      <div className="nx-gw-eyebrow" data-tone="warn">{kind ? `${cap(noun)} in progress` : tree.operation}</div>
      {info && <div className="nx-gw-rail-title">{operationHeading(info)}</div>}
      {position && (
        <div className="nx-gw-card">
          <div><span>{`Commit ${info.step} of ${info.total}`}</span></div>
          {info.replaying && <div className="nx-gw-rail-replay"><span className="nx-hash">{info.replaying.oid.slice(0, 7)}</span>{` ${info.replaying.subject ?? ''}`}</div>}
          <div className="nx-gw-steps" aria-label={`Step ${info.step} of ${info.total}`}>{steps.map((s, i) => <span key={i} data-s={s} />)}</div>
        </div>
      )}
      <div className="nx-gw-rail-count" data-tone={left ? 'bad' : 'ok'}>
        {left ? `${total - left} of ${total} ${plural(total, 'conflict')} resolved` : 'All conflicts resolved'}
      </div>
      <div className="nx-gw-rail-note">{left ? `Paused on conflicts. Resolve each file, then continue the ${noun}.` : `Ready to continue the ${noun}.`}</div>
      <div className="nx-gw-spacer-y" />
      <button className="btn accent nx-gw-crail-primary" aria-label="Continue" disabled={left > 0}
        title={left ? `Resolve ${left} remaining ${plural(left, 'conflict')} first` : `Continue the ${noun}`}
        onClick={() => onAction('continue', {})}>{`Continue ${kind ? noun : ''}`.trim()}</button>
      {kind !== 'merge' && <button className="btn nx-gw-crail-secondary" aria-label="Skip" onClick={() => onAction('skip', {})}>Skip this commit</button>}
      <button className="btn ghost danger nx-gw-crail-secondary" aria-label="Abort" onClick={() => onAction('abort', { branchLabel: checkoutName(tree), operationName: noun })}>{`Abort ${kind ? noun : 'operation'}...`}</button>
    </div>
  )
}
