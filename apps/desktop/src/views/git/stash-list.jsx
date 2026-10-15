import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { ipcMessage } from './use-git-actions.js'

/** The worktree's stashes, each with Apply / Pop / Drop, and a way to stash the current changes. */
export function StashList({ adapter, repo, tree, registered, onAction, onClose }) {
  const [list, setList] = React.useState(null)
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    let live = true
    adapter.stashes(repo, tree.path, registered).then(
      raw => { if (live) setList(String(raw).split('\n').filter(Boolean).map(l => { const [oid, name, time, subject] = l.split('\0'); return { oid, name, time: Number(time) * 1000, subject } })) },
      e => { if (live) setError(ipcMessage(e)) },
    )
    return () => { live = false }
  }, [adapter, repo, tree.path, registered])
  const go = (kind, options) => { onClose(); onAction(kind, options) }
  return (
    <PlModal open onClose={onClose} title="Stashes" icon="git-branch" footer={<button className="btn sm ghost" onClick={onClose}>Close</button>}>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => go('stashPush', { includeUntracked: false })}>Stash changes…</button>
        {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
        {list && !list.length && <div style={{ color: 'var(--text-muted)' }}>No stashes.</div>}
        <ul aria-label="Stash entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {(list ?? []).map(s => (
            <li key={s.oid} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{`${s.name} · ${s.subject}`}</span>
              <button className="btn sm ghost" onClick={() => go('stashApply', { oid: s.oid })}>Apply</button>
              <button className="btn sm ghost" onClick={() => go('stashPop', { oid: s.oid })}>Pop</button>
              <button className="btn sm ghost danger" onClick={() => go('stashDrop', { oid: s.oid })}>Drop…</button>
            </li>
          ))}
        </ul>
      </div>
    </PlModal>
  )
}
