import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { commitReview } from '@nexusmd/core'

const repoOf = tree => ({ name: tree.repo, path: tree.repoRoot })
const message = e => e?.message || String(e)

/**
 * Commits the staged changes of each ticked worktree, one after another. Stamps are taken when the
 * dialog opens, so a worktree whose index changed afterwards is refused rather than committed.
 */
export function CommitDialog({ targets, adapter, registered, initialMessages = {}, onClose, onDone, onRetry }) {
  const [ticked, setTicked] = React.useState(() => Object.fromEntries(targets.map(t => [t.id, t.ticked])))
  const [perTarget, setPerTarget] = React.useState(false)
  const [shared, setShared] = React.useState(initialMessages.shared ?? '')
  const [messages, setMessages] = React.useState(initialMessages.perTarget ?? {})
  const [stamps, setStamps] = React.useState({})
  const [phase, setPhase] = React.useState('edit')
  const [results, setResults] = React.useState([])
  const started = React.useRef(false)

  React.useEffect(() => {
    let live = true
    for (const t of targets) {
      if (t.unavailable) continue
      adapter.stamp(repoOf(t.tree), t.tree.path, registered, { kind: 'commit' }).then(
        stamp => { if (live) setStamps(m => ({ ...m, [t.id]: { stamp } })) },
        e => { if (live) setStamps(m => ({ ...m, [t.id]: { error: message(e) } })) },
      )
    }
    return () => { live = false }
  }, [])

  const view = targets.map(t => ({ ...t, ticked: !!ticked[t.id] && !t.unavailable }))
  const review = commitReview(view, perTarget ? { perTarget: messages } : { message: shared })
  const stampError = review.blocks.map(b => stamps[b.id]?.error).find(Boolean)
  const waiting = review.blocks.some(b => !stamps[b.id])
  const canRun = phase === 'edit' && !review.error && !waiting && !stampError

  const run = async () => {
    if (!canRun || started.current) return
    started.current = true
    setPhase('running')
    const out = []
    for (const b of review.blocks) {
      const t = targets.find(x => x.id === b.id)
      try {
        const r = await adapter.commit(repoOf(t.tree), t.tree.path, registered, b.message, stamps[b.id].stamp)
        out.push({ id: b.id, title: b.title, ok: !!r.ok, detail: r.detail })
      } catch (e) {
        out.push({ id: b.id, title: b.title, ok: false, detail: message(e) })
      }
    }
    setResults(out)
    setPhase('results')
    onDone()
  }
  const failed = results.filter(r => !r.ok).map(r => r.id)

  const footer = phase === 'results'
    ? (
      <>
        {failed.length > 0 && <button className="btn sm" onClick={() => onRetry(failed, { shared, perTarget: messages })}>Retry failed</button>}
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </>
    )
    : (
      <>
        <button className="btn sm ghost" onClick={onClose} disabled={phase === 'running'}>Cancel</button>
        <button className="btn sm" disabled={!canRun} onClick={run}>{phase === 'running' ? 'Committing…' : 'Commit'}</button>
      </>
    )

  return (
    <PlModal open wide onClose={onClose} title="Commit" icon="git-branch" footer={footer} closeOnBackdrop={phase !== 'running'}>
      {phase === 'results'
        ? (
          <ul aria-label="Commit results" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {results.map(r => (
              <li key={r.id} style={{ color: r.ok ? undefined : 'var(--danger)' }}>
                <strong>{`${r.ok ? '✓' : '✗'} ${r.title}`}</strong>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.detail}</pre>
              </li>
            ))}
          </ul>
        )
        : (
          <div style={{ display: 'grid', gap: 10 }} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}>
            <fieldset aria-label="Worktrees" style={{ display: 'grid', gap: 4, border: 0, padding: 0, margin: 0 }}>
              {targets.map(t => (
                <label key={t.id} style={{ display: 'flex', gap: 6, color: t.unavailable ? 'var(--text-muted)' : undefined }}>
                  <input type="checkbox" aria-label={t.title} checked={!!ticked[t.id] && !t.unavailable} disabled={!!t.unavailable || phase !== 'edit'}
                    onChange={() => setTicked(m => ({ ...m, [t.id]: !m[t.id] }))} />
                  <span>{`${t.title} · ${t.staged.length} staged`}</span>
                  {t.unavailable && <span>{`— ${t.unavailable}`}</span>}
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'flex', gap: 6 }}>
              <input type="checkbox" aria-label="Message per worktree" checked={perTarget} onChange={e => setPerTarget(e.target.checked)} />
              Message per worktree
            </label>
            {!perTarget && (
              <textarea aria-label="Commit message" rows={4} value={shared} onChange={e => setShared(e.target.value)} autoFocus />
            )}
            {review.blocks.map(b => (
              <div key={b.id} role="group" aria-label={`Staged files in ${b.title}`} className="card" style={{ padding: 8 }}>
                <strong>{b.title}</strong>
                <ul style={{ margin: '4px 0', padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono, monospace)' }}>
                  {b.files.map(f => <li key={f} style={{ whiteSpace: 'pre' }}>{f}</li>)}
                </ul>
                {perTarget && (
                  <textarea aria-label={`Message for ${b.title}`} rows={3} value={messages[b.id] ?? ''}
                    onChange={e => setMessages(m => ({ ...m, [b.id]: e.target.value }))} />
                )}
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)' }}>{review.note}</div>
            {stampError
              ? <div role="alert" style={{ color: 'var(--danger)' }}>{stampError}</div>
              : review.error && <div style={{ color: 'var(--text-muted)' }}>{review.error}</div>}
          </div>
        )}
    </PlModal>
  )
}
