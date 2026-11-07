import React from 'react'

const fileCount = n => `${n} file${n === 1 ? '' : 's'}`

/**
 * The commit form in the Changes tab's right-hand panel: summary with its 72 count, a description that is
 * always there, a card saying what will be committed and where it pushes, the amend option, a hint when
 * Commit is disabled, then Commit and Commit & push / publish / Amend & push.
 *
 * onCommit({ message, amend, push }) may return a promise; the form clears unless it resolves false.
 * Ctrl+Enter commits from anywhere in the Changes tab (the .nx-gw-changes box around the rail).
 */
export function CommitRail({ tree, busy = false, onCommit }) {
  const [summary, setSummary] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [amend, setAmend] = React.useState(false)
  const root = React.useRef(null)
  const id = tree?.path
  React.useEffect(() => { setSummary(''); setDescription(''); setAmend(false) }, [id])

  const staged = tree.changes.filter(c => c.area === 'staged').length
  const disabled = busy || (!staged && !amend) || !summary.trim()
  const submit = async push => {
    if (disabled) return
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    const ok = await onCommit({ message, amend, push })
    if (ok !== false) { setSummary(''); setDescription(''); setAmend(false) }
  }
  // The key handler is on the whole Changes tab, so it always sees the latest form.
  const latest = React.useRef(submit)
  latest.current = submit
  React.useEffect(() => {
    const el = root.current
    const box = el?.closest('.nx-gw-changes') ?? el
    if (!box) return undefined
    const onKey = e => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.closest?.('[aria-modal="true"]')) return
      e.preventDefault()
      latest.current(false)
    }
    box.addEventListener('keydown', onKey)
    return () => box.removeEventListener('keydown', onKey)
  }, [])

  const len = summary.length
  const hint = busy ? 'Working…'
    : !staged && !amend ? (tree.changes.length ? 'Stage files first' : 'Nothing to commit')
      : !summary.trim() ? 'Write a summary to commit' : null
  const label = amend ? 'Amend commit' : staged ? `Commit ${fileCount(staged)}` : 'Commit'
  const pushLabel = amend ? 'Amend & push' : tree.upstream ? 'Commit & push' : 'Commit & publish'
  return (
    <div ref={root} className="nx-gw-crail">
      <div className="nx-gw-eyebrow">{`Commit to ${tree.branch}`}</div>
      <div className="nx-gw-summary">
        <input aria-label="Commit summary" placeholder="Commit summary" value={summary} onChange={e => setSummary(e.target.value)} />
        <span className="count" data-tone={len > 72 ? 'bad' : len > 50 ? 'warn' : undefined}>{`${len}/72`}</span>
      </div>
      <textarea aria-label="Commit description" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <div className="nx-gw-card">
        <div>{fileCount(staged)}</div>
        <div>{tree.upstream && !tree.upstreamGone ? `Pushes to ${tree.upstream}` : 'Not published yet'}</div>
      </div>
      <label><input type="checkbox" checked={amend} onChange={e => setAmend(e.target.checked)} />Amend last commit</label>
      <div className="nx-gw-spacer-y" />
      {hint && <div className="nx-gw-hint" aria-live="polite" data-tone={busy ? undefined : 'warn'}>{hint}</div>}
      <button className="btn accent nx-gw-crail-primary" disabled={disabled} aria-label={label} title="Ctrl+Enter" onClick={() => submit(false)}>
        {label}<span className="kbd">Ctrl ⏎</span>
      </button>
      <button className="btn nx-gw-crail-secondary" disabled={disabled}
        title={tree.upstream ? `Commit, then push to ${tree.upstream}` : 'Commit, then publish this branch'} onClick={() => submit(true)}>{pushLabel}</button>
    </div>
  )
}
