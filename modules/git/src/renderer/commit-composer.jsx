import React from 'react'

const NOUN = { rebase: 'rebase', merge: 'merge', revert: 'revert', 'cherry-pick': 'cherry-pick' }

/**
 * The inline commit box at the bottom of the Changes column (sticky). Only the summary shows until it's
 * focused or has text. A hint line always says why the buttons are disabled or what will happen.
 * During an operation the whole form is replaced by one line.
 *
 * onCommit({ message, amend, push }) may return a promise; the form clears when it resolves truthy.
 * Wire it to use-commit.js (same path the Commit dialog uses), then push / publish when push is true.
 */
export function CommitComposer({ tree, busy = false, onCommit }) {
  const [summary, setSummary] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [amend, setAmend] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const id = tree?.path
  React.useEffect(() => { setSummary(''); setDescription(''); setAmend(false); setOpen(false) }, [id])
  if (!tree) return null

  if (tree.operation) {
    const noun = NOUN[tree.operationInfo?.kind] ?? 'operation'
    return (
      <div className="nx-gw-composer">
        <div className="nx-gw-paused" role="note">{`Committing is paused during the ${noun} — resolved files go into the replayed commit.`}</div>
      </div>
    )
  }

  const staged = tree.changes.filter(c => c.area === 'staged').length
  const len = summary.length
  const disabled = busy || (!staged && !amend) || !summary.trim()
  const hint = busy ? 'Working…'
    : !staged && !amend ? (tree.changes.length ? 'Stage files first — use Stage or Stage all above' : 'Nothing to commit')
      : !summary.trim() ? 'Write a summary to commit'
        : `${amend ? 'Amends your last commit' : `${staged} staged file${staged === 1 ? '' : 's'} → ${tree.branch}`} · Ctrl+Enter`
  const label = amend ? 'Amend commit' : staged ? `Commit ${staged} file${staged === 1 ? '' : 's'}` : 'Commit'
  const pushLabel = amend ? 'Amend & push' : tree.upstream ? 'Commit & push' : 'Commit & publish'
  const submit = async push => {
    if (disabled) return
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    const ok = await onCommit({ message, amend, push })
    if (ok !== false) { setSummary(''); setDescription(''); setAmend(false); setOpen(false) }
  }
  const onKeyDown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(false) } }

  return (
    <div className="nx-gw-composer" onKeyDown={onKeyDown}>
      <div className="nx-gw-summary">
        <input aria-label="Commit summary" placeholder="Commit summary" value={summary} onChange={e => setSummary(e.target.value)} onFocus={() => setOpen(true)} />
        <span className="count" data-tone={len > 72 ? 'bad' : len > 50 ? 'warn' : undefined}>{`${len}/72`}</span>
      </div>
      {(open || description) && (
        <textarea aria-label="Commit description" placeholder="Description" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
      )}
      <label><input type="checkbox" checked={amend} onChange={e => setAmend(e.target.checked)} />Amend last commit</label>
      <div className="nx-gw-commit-btns">
        <button className="btn sm" disabled={disabled} title={tree.upstream ? `Commit, then push to ${tree.upstream}` : 'Commit, then publish this branch'} onClick={() => submit(true)}>{pushLabel}</button>
        <button className="btn sm accent" disabled={disabled} title="Ctrl+Enter" onClick={() => submit(false)}>{label}</button>
      </div>
      <div className="nx-gw-hint" aria-live="polite" data-tone={disabled && !busy ? 'warn' : undefined}>{hint}</div>
    </div>
  )
}
