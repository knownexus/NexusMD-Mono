import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { PopoverMenu } from './popover-menu.jsx'

/** The ⋯ menu beside the active custom group's tab; each item opens its own small dialog. */
export function GroupMenuButton({ name, editBusy = null, onEdit, onOpen }) {
  return (
    <PopoverMenu label="⋯" align="left" buttonClassName="nx-gw-icon-btn" menuLabel={`Group options for ${name}`}
      buttonProps={{ 'aria-label': `Group options for ${name}`, title: 'Group options' }}
      items={[
        { label: 'Edit members…', onSelect: onEdit, disabled: !!editBusy, reason: editBusy ?? undefined },
        { label: 'Rename…', onSelect: () => onOpen('rename') },
        { label: 'Duplicate…', onSelect: () => onOpen('duplicate') },
        { label: 'Delete…', onSelect: () => onOpen('delete'), danger: true },
      ]} />
  )
}

// Rename / duplicate / delete for one group. onRename/onDuplicate return an error message or null.
export function GroupMenu({ name, mode, onClose, onRename, onDuplicate, onDelete }) {
  const [value, setValue] = React.useState(mode === 'duplicate' ? `${name} copy` : name)
  const [error, setError] = React.useState(null)
  const submit = fn => { const e = fn(value); if (e) setError(e); else onClose() }
  const footer = mode === 'delete'
    ? <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm danger" onClick={() => { onDelete(); onClose() }}>Delete group</button></>
    : <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm" onClick={() => submit(mode === 'rename' ? onRename : onDuplicate)}>Save</button></>
  const title = { rename: `Rename ${name}`, duplicate: `Duplicate ${name}`, delete: `Delete ${name}` }[mode]
  return (
    <PlModal open onClose={onClose} title={title} icon="git-branch" footer={footer}>
      {mode !== 'delete' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input aria-label="New group name" autoFocus value={value} onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(mode === 'rename' ? onRename : onDuplicate) }} />
          {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
      {mode === 'delete' && <p>{`Delete the saved membership of ${name}? Repository files, branches and worktrees stay in place.`}</p>}
    </PlModal>
  )
}
