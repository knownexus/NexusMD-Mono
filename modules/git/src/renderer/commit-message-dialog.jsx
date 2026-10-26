import React from 'react'
import { PlModal } from '@nexusmd/ui'

/**
 * Edit a commit message (reword, or the combined message of a squash). Save needs a non-blank
 * subject and a change from `initial`. `error` (a message that couldn't be loaded) disables Save.
 */
export function CommitMessageDialog({ title, initial, onSave, onClose, error = null }) {
  const [text, setText] = React.useState(initial)
  const subject = text.split('\n')[0].trim()
  const canSave = !error && subject !== '' && text !== initial
  const save = () => { if (canSave) onSave(text) }
  const footer = (
    <>
      <button className="btn sm ghost" onClick={onClose}>Cancel</button>
      <button className="btn sm" disabled={!canSave} onClick={save}>Save</button>
    </>
  )
  return (
    <PlModal open wide onClose={onClose} title={title} icon="git-branch" footer={footer}>
      <div style={{ display: 'grid', gap: 8 }} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save() } }}>
        <textarea aria-label="Commit message" rows={8} value={text} onChange={e => setText(e.target.value)} autoFocus
          style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
        {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>
    </PlModal>
  )
}
