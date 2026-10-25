import React from 'react'
import { operationText, checkoutName } from '@nexusmd/core'

const VERB = { rebase: 'Rebasing', merge: 'Merging', revert: 'Reverting', 'cherry-pick': 'Cherry-picking' }
const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }
const shortRef = r => String(r ?? '').replace(/^refs\/(heads|remotes|tags)\//, '')
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`

// "Rebasing onto origin/master", "Merging topic", "Cherry-picking"…
function heading(info) {
  const verb = VERB[info?.kind] ?? 'Paused'
  if (info?.kind === 'rebase') { const onto = shortRef(info.onto?.name); return onto ? `${verb} onto ${onto}` : verb }
  if (info?.kind === 'merge') { const from = shortRef(info.merging?.name); return from ? `${verb} ${from}` : verb }
  return verb
}

// The conflicted files seen since this step stopped: the ones gone from the list since were resolved.
// A new step (or another worktree, or another operation) starts the count again.
function useConflictCount(tree) {
  const info = tree?.operationInfo
  const key = `${tree?.path}|${tree?.operation}|${info?.step ?? ''}|${info?.replaying?.oid ?? info?.picked?.oid ?? ''}`
  const current = [...new Set((tree?.changes ?? []).filter(c => c.area === 'conflict').map(c => c.path))]
  const [seen, setSeen] = React.useState({ key, paths: current })
  let paths = seen.paths
  if (seen.key !== key) { paths = current; setSeen({ key, paths }) }
  else if (current.some(p => !paths.includes(p))) { paths = [...new Set([...paths, ...current])]; setSeen({ key, paths }) }
  return { left: current.length, total: Math.max(paths.length, current.length) }
}

/**
 * A rebase, merge, revert or cherry-pick stopped part-way: says what's paused and why, shows step
 * progress and the conflicts resolved so far, and offers Continue, Skip (not for a merge) or Abort.
 * Accessible names stay Continue / Skip / Abort. Abort goes through onAction('abort'), which opens the
 * ActionDialog 'abort' preview as the confirmation; branchLabel and operationName are only for its copy.
 */
export function OperationBanner({ tree, onAction }) {
  const { left, total } = useConflictCount(tree)
  if (!tree?.operation) return null
  const info = tree.operationInfo
  const kind = info?.kind
  const noun = NOUN[kind] ?? 'operation'
  const title = info ? `${heading(info)} — ${left ? 'paused on conflicts' : 'ready to continue'}` : tree.operation
  const detail = operationText(info, checkoutName(tree)) || tree.operation
  const commit = kind === 'rebase' && info.step != null && info.total != null
  const steps = info?.total ? Array.from({ length: info.total }, (_, i) => (i < info.step - 1 ? 'done' : i === info.step - 1 ? 'now' : 'todo')) : []
  return (
    <div role="status" className="nx-gw-op">
      <div className="nx-gw-op-main">
        <div className="nx-gw-op-title">{title}</div>
        {info && (commit
          ? (
            <div className="nx-gw-op-sub" title={detail}>
              {`Commit ${info.step} of ${info.total}`}
              {info.replaying && <>{' · '}<span className="nx-hash" style={{ color: 'var(--accent)' }}>{info.replaying.oid.slice(0, 7)}</span>{` ${info.replaying.subject ?? ''}`}</>}
            </div>
          )
          : <div className="nx-gw-op-sub" title={detail}>{detail}</div>)}
        <div className="nx-gw-op-progress">
          {steps.length > 0 && <div className="nx-gw-steps" aria-label={`Step ${info.step} of ${info.total}`}>{steps.map((s, i) => <span key={i} data-s={s} />)}</div>}
          <span className="nx-gw-op-count" style={{ color: left ? 'var(--danger)' : 'var(--success)' }}>
            {left ? `${total - left} of ${total} ${plural(total, 'conflict')} resolved` : 'All conflicts resolved'}
          </span>
        </div>
      </div>
      <div className="nx-gw-op-actions">
        <button className="btn sm accent" aria-label="Continue" disabled={left > 0}
          title={left ? `Resolve ${left} remaining ${plural(left, 'conflict')} first` : `Continue the ${noun}`}
          onClick={() => onAction('continue', {})}>{`Continue ${NOUN[kind] ?? ''}`.trim()}</button>
        {kind !== 'merge' && <button className="btn sm" aria-label="Skip" onClick={() => onAction('skip', {})}>Skip this commit</button>}
        <button className="btn sm ghost danger" aria-label="Abort" onClick={() => onAction('abort', { branchLabel: checkoutName(tree), operationName: noun })}>Abort</button>
      </div>
    </div>
  )
}
