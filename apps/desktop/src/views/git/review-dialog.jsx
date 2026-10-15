import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { worktreeName } from '@nexusmd/core'

const VERB = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard', delete: 'Delete' }

/** Shows exactly what a file action will touch; destructive actions need their word typed. */
export function ReviewDialog({ state, onClose, onConfirm }) {
  const [typed, setTyped] = React.useState('')
  const [sent, setSent] = React.useState(false)
  if (!state) return null
  const { review, stamp, error } = state
  const ready = !!stamp && !sent && (!review.needsTyping || typed === review.needsTyping)
  const submit = () => {
    if (!ready) return
    setSent(true)
    onConfirm()
  }
  return (
    <PlModal open onClose={onClose} title={review.title} sub={`${state.tree.repo} › ${worktreeName(state.tree)}`} icon="git-branch"
      footer={(
        <>
          <button className="btn sm ghost" onClick={onClose}>Cancel</button>
          <button className={`btn sm${review.needsTyping ? ' danger' : ''}`} disabled={!ready} autoFocus={!review.needsTyping} onClick={submit}>
            {VERB[review.action]}
          </button>
        </>
      )}>
      <form onSubmit={e => { e.preventDefault(); submit() }} style={{ display: 'grid', gap: 8 }}>
        {review.warning && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{review.warning}</div>}
        <ul aria-label="Files" style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono, monospace)', maxHeight: 280, overflow: 'auto' }}>
          {review.files.map(f => (
            <li key={f.id}><span style={{ whiteSpace: 'pre' }}>{f.code}</span>{` ${f.path}${f.originalPath ? ` ← ${f.originalPath}` : ''}`}</li>
          ))}
        </ul>
        {review.skipped.length > 0 && (
          <div style={{ color: 'var(--text-muted)' }}>{`Skipped: ${review.skipped.map(s => `${s.path} (${s.reason})`).join('; ')}`}</div>
        )}
        {review.needsTyping && (
          <label style={{ display: 'grid', gap: 4 }}>
            {`Type ${review.needsTyping} to confirm`}
            <input aria-label={`Type ${review.needsTyping} to confirm`} value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
          </label>
        )}
        {!stamp && !error && <div style={{ color: 'var(--text-muted)' }}>Checking the current state…</div>}
        {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      </form>
    </PlModal>
  )
}
