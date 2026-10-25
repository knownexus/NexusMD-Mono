import React from 'react'
import { GroupDraft } from '@nexusmd/core'
import { PlModal } from '@nexusmd/ui'

// Members are the registered repositories (Settings → Desktop → Git Workspace) and their worktrees
// and branches; a group never registers anything. onDelete (edit mode only) offers Delete group in
// the footer, behind a confirmation.
export function GroupEditor({ open, config, snapshot, existing, onClose, onSaved, onDelete = null }) {
  const [draft, setDraft] = React.useState(null)
  const [name, setName] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [folded, setFolded] = React.useState(() => new Set())
  const [status, setStatus] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [, redraw] = React.useReducer(n => n + 1, 0)

  React.useEffect(() => {
    if (!open) { setDraft(null); return }
    setDraft(new GroupDraft(config, snapshot || { worktrees: [], branches: [] }, existing))
    setName(existing?.name ?? 'New group')
    setFilter('')
    setFolded(new Set())
    setStatus('')
    setConfirmDelete(false)
    // A new draft only when the dialog opens.
  }, [open])

  if (!open || !draft) return null

  const act = fn => { try { fn(); setStatus('') } catch (e) { setStatus(e.message) } redraw() }
  const toggleFold = repo => setFolded(prev => { const next = new Set(prev); if (!next.delete(repo)) next.add(repo); return next })
  const save = () => {
    try {
      const { config: next, group } = draft.commit(config, name, existing)
      onSaved(next, group)
    } catch (e) {
      setStatus(e.message)
    }
  }

  const rows = draft.rows(filter, folded)
  const repoRows = rows.filter(m => m.kind === 'repo')
  const whole = repoRows.filter(m => draft.state(m.repo) === 'whole').length
  const entries = draft.checked?.size ?? 0
  const summary = [whole && `${whole} whole repo${whole > 1 ? 's' : ''}`, entries && `${entries} worktree${entries > 1 ? 's' : ''} or branch${entries > 1 ? 'es' : ''}`].filter(Boolean)
  const boxState = m => {
    if (m.kind === 'repo') return draft.state(m.repo)
    if (draft.inherited(m)) return 'inherited'
    return draft.checked.has(m.id) ? 'whole' : 'none'
  }
  const MARK = { whole: '✓', some: '–', inherited: '✓', none: '' }

  const footerLeft = onDelete && existing ? (
    confirmDelete
      ? <span className="row"><span style={{ color: 'var(--danger)', fontSize: 12.5 }}>Delete this group? Repositories stay in place.</span>
          <button className="btn sm danger" onClick={onDelete}>Delete</button>
          <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>Keep</button></span>
      : <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>Delete group…</button>
  ) : null
  const footer = (
    <>
      <span className="nx-muted" style={{ fontSize: 12.5, marginRight: 'auto' }}>
        {summary.length ? `Includes ${summary.join(' and ')}.` : 'Nothing selected yet.'}
      </span>
      <button className="btn sm ghost" onClick={onClose}>Cancel</button>
      <button className="btn sm accent" onClick={save}>Save</button>
    </>
  )

  return (
    <PlModal open={open} onClose={onClose} wide icon="git-branch" closeOnBackdrop={false}
      title={existing ? `Edit ${existing.name}` : 'New project group'}
      sub="Whole repos include their future worktrees." footer={footer} footerLeft={footerLeft}>
      <div style={{ display: 'grid', gap: 14 }}>
        <label>
          <span className="nx-field-label">Group name</span>
          <input className="nx-input" aria-label="Group name" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="nx-field-label" style={{ margin: 0 }}>Members</span>
          <input className="nx-input" aria-label="Filter" placeholder="Filter repositories, worktrees and branches" value={filter}
            onChange={e => setFilter(e.target.value)} />
          <span className="nx-muted" style={{ fontSize: 12 }}>Only repositories registered in Settings → Desktop → Git Workspace are listed.</span>
        </div>
        {status && <div role="alert" className="nx-alert bad">{status}</div>}
        <ul role="tree" aria-label="Group members" className="nx-tree-box">
          {!rows.length && <li className="nx-muted">Nothing matches that filter.</li>}
          {rows.map(m => {
            const isRepo = m.kind === 'repo'
            const st = boxState(m)
            return (
              <li key={m.id} className={isRepo ? '' : 'child'}>
                {m.kind === 'repo' && (
                  <button className="nx-fold" aria-label={`${folded.has(m.repo) ? 'Unfold' : 'Fold'} ${m.repo}`} onClick={() => toggleFold(m.repo)}>
                    {folded.has(m.repo) ? '▸' : '▾'}
                  </button>
                )}
                <button role="checkbox" aria-label={m.label} className={`nx-box${isRepo ? '' : ' sm'}`} data-state={st}
                  aria-checked={isRepo ? draft.state(m.repo) === 'whole' : draft.inherited(m) || draft.checked.has(m.id)}
                  onClick={() => act(() => draft.toggle(m))}>{MARK[st]}</button>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={isRepo ? 'nx-strong' : 'nx-mono'} style={{ fontSize: isRepo ? 13 : 12.5, color: draft.inherited(m) ? 'var(--text-muted)' : undefined }}>{m.label}</span>
                  {m.kind === 'repo' && draft.state(m.repo) === 'whole' && <div className="nx-muted" style={{ fontSize: 12 }}>Whole repo, including future worktrees</div>}
                </span>
                {m.kind === 'repo' && (
                  <>
                    <button className="nx-link" style={{ color: 'var(--text-muted)' }} onClick={() => act(() => { if (!draft.branchesShown.delete(m.repo)) draft.branchesShown.add(m.repo) })}>
                      {draft.branchesShown.has(m.repo) ? 'Hide branches' : 'Show branches'}
                    </button>
                    <button className="btn sm ghost" onClick={() => act(() => draft.toggleWhole(m.repo))}>
                      {draft.state(m.repo) === 'whole' ? 'Choose entries' : 'Whole repo'}
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </PlModal>
  )
}
