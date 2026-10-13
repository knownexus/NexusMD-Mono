import React from 'react'
import { GroupDraft } from '@nexusmd/core'
import { PlModal } from '@nexusmd/ui'
import { effectiveRoots } from '../../git-config.js'

const BOX = { whole: '☑', some: '◩', none: '☐' }

export function GroupEditor({ open, config, snapshot, existing, adapter, onClose, onSaved }) {
  const [draft, setDraft] = React.useState(null)
  const [name, setName] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [folded, setFolded] = React.useState(() => new Set())
  const [status, setStatus] = React.useState('')
  const [failing, setFailing] = React.useState(null)
  const [searching, setSearching] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [, redraw] = React.useReducer(n => n + 1, 0)
  const roots = effectiveRoots(config)

  // Every async result is checked against the session (dialog open) and scan sequence it started in.
  const session = React.useRef(0)
  const scanSeq = React.useRef(0)

  const scan = React.useCallback(async d => {
    const mine = session.current
    const seq = ++scanSeq.current
    const live = () => mine === session.current && seq === scanSeq.current
    setSearching(true)
    try {
      const found = await adapter.discover(roots, config.repos)
      if (!live()) return
      d.addDiscovered(found)
      redraw()
    } catch (e) {
      if (live()) setStatus(`Repository search failed: ${e?.message || e}`)
    } finally {
      if (live()) setSearching(false)
    }
    // roots/config.repos are read at the moment of the scan on purpose.
  }, [adapter, JSON.stringify(roots), JSON.stringify(config.repos)])

  React.useEffect(() => {
    if (!open) { setDraft(null); return }
    session.current++
    const d = new GroupDraft(config, snapshot || { worktrees: [], branches: [] }, existing)
    setDraft(d)
    setName(existing?.name ?? 'New group')
    setFilter('')
    setFolded(new Set())
    setStatus('')
    setFailing(null)
    setSaving(false)
    setSearching(false)
    scan(d)
    return () => { session.current++ }
    // A new draft only when the dialog opens.
  }, [open])

  React.useEffect(() => {
    if (failing) document.querySelector('[data-failing="true"] [role="checkbox"]')?.focus()
  }, [failing])

  if (!open || !draft) return null

  const act = fn => { try { fn(); setStatus('') } catch (e) { setStatus(e.message) } redraw() }
  const toggleFold = repo => setFolded(prev => { const next = new Set(prev); if (!next.delete(repo)) next.add(repo); return next })
  const save = async () => {
    const mine = session.current
    // Cleared first so a repeat failure on the same member changes `failing` and refocuses it.
    setFailing(null)
    setSaving(true)
    try {
      const { config: next, group } = await draft.commit(config, name, existing, dir => adapter.resolve(dir))
      if (mine === session.current) onSaved(next, group)
    } catch (e) {
      if (mine !== session.current) return
      setStatus(e.message)
      setFailing(e.memberId ?? null)
    } finally {
      if (mine === session.current) setSaving(false)
    }
  }

  const rows = draft.rows(filter, folded)
  const footer = (
    <>
      <button className="btn sm ghost" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn sm" onClick={save} disabled={saving}>Save</button>
    </>
  )

  return (
    <PlModal open={open} onClose={onClose} wide icon="git-branch" closeOnBackdrop={false}
      title={existing ? `Edit ${existing.name}` : 'New project group'}
      sub="Whole repos include their future worktrees." footer={footer}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Name</span>
          <input aria-label="Group name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Filter" placeholder="Filter repositories, worktrees and branches" value={filter}
            onChange={e => setFilter(e.target.value)} style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {searching ? 'Searching for repositories…' : `Search folders: ${roots.join('; ') || 'none'}`}
          </span>
          <button className="btn sm ghost" onClick={() => scan(draft)} disabled={searching}>Rescan</button>
        </div>
        {status && <div role="alert" style={{ color: 'var(--danger)' }}>{status}</div>}
        <ul role="tree" aria-label="Group members" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflowY: 'auto' }}>
          {rows.map(m => (
            <li key={m.id} data-failing={m.id === failing ? 'true' : undefined}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 6px', paddingLeft: m.kind === 'worktree' || m.kind === 'branch' ? 34 : 6,
                outline: m.id === failing ? '1px solid var(--danger)' : undefined, borderRadius: 'var(--radius-sm)' }}>
              {m.kind === 'repo' && (
                <button className="btn sm ghost" aria-label={`${folded.has(m.repo) ? 'Unfold' : 'Fold'} ${m.repo}`} onClick={() => toggleFold(m.repo)}>
                  {folded.has(m.repo) ? '▸' : '▾'}
                </button>
              )}
              <button role="checkbox" aria-label={m.label} className="btn sm ghost"
                aria-checked={m.kind === 'repo' || m.kind === 'new-repo' ? draft.state(m.repo) === 'whole' : draft.inherited(m) || draft.checked.has(m.id)}
                onClick={() => act(() => draft.toggle(m))}>
                {m.kind === 'repo' || m.kind === 'new-repo' ? BOX[draft.state(m.repo)] : (draft.inherited(m) || draft.checked.has(m.id) ? '☑' : '☐')}
              </button>
              <span style={{ flex: 1, color: draft.inherited(m) ? 'var(--text-muted)' : undefined }}>{m.label}</span>
              {m.kind === 'new-repo' && <span style={{ color: 'var(--warning)', fontSize: 12 }}>★ not registered · {m.value}</span>}
              {m.kind === 'repo' && (
                <>
                  <button className="btn sm ghost" onClick={() => act(() => draft.toggleWhole(m.repo))}>
                    {draft.state(m.repo) === 'whole' ? 'Choose entries' : 'Whole repo'}
                  </button>
                  <button className="btn sm ghost" onClick={() => act(() => { if (!draft.branchesShown.delete(m.repo)) draft.branchesShown.add(m.repo) })}>
                    {draft.branchesShown.has(m.repo) ? 'Hide branches' : 'Show branches'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </PlModal>
  )
}
