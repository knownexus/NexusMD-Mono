import React from 'react'
import { PlModal } from '@nexusmd/ui'

// Edit / rename / duplicate / delete for one group. onRename/onDuplicate return an error message or null.
export function GroupMenu({ name, onClose, onEdit, onRename, onDuplicate, onDelete, editBusy = null }) {
  const [mode, setMode] = React.useState('menu')
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState(null)
  const submit = fn => { const e = fn(value); if (e) setError(e); else onClose() }
  const footer = mode === 'menu' ? null
    : mode === 'delete'
      ? <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm danger" onClick={() => { onDelete(); onClose() }}>Delete group</button></>
      : <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm" onClick={() => submit(mode === 'rename' ? onRename : onDuplicate)}>Save</button></>
  return (
    <PlModal open onClose={onClose} title={name} icon="git-branch" footer={footer}>
      {mode === 'menu' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <button className="btn sm ghost" title={editBusy ?? undefined} disabled={!!editBusy} onClick={() => { onEdit(); onClose() }}>Edit members…</button>
          <button className="btn sm ghost" onClick={() => { setValue(name); setMode('rename') }}>Rename…</button>
          <button className="btn sm ghost" onClick={() => { setValue(`${name} copy`); setMode('duplicate') }}>Duplicate…</button>
          <button className="btn sm ghost" onClick={() => setMode('delete')}>Delete…</button>
        </div>
      )}
      {(mode === 'rename' || mode === 'duplicate') && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input aria-label="New group name" value={value} onChange={e => setValue(e.target.value)} />
          {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
      {mode === 'delete' && <p>{`Delete the saved membership of ${name}? Repository files, branches and worktrees stay in place.`}</p>}
    </PlModal>
  )
}
