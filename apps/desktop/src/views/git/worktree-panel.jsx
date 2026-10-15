import React from 'react'
import { WorktreeHeader } from './worktree-detail.jsx'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { HistoryPanel } from './history-panel.jsx'
import { OperationBanner } from './operation-banner.jsx'
import { StashList } from './stash-list.jsx'

const clamp = v => Math.min(0.8, Math.max(0.2, v))

/** The selected worktree: where it is, its changes, and the focused file's diff below a divider. */
export function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onHunk,
  busy, status, split, onSplit, panel = 'changes', onPanel = () => {}, onSync = null,
}) {
  const [stashes, setStashes] = React.useState(false)
  const history = panel === 'history'
  // The changes pane's diff isn't on screen in History, so it isn't loaded either.
  const change = history ? null : tree.changes.find(c => c.id === focusId) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change, version })
  const box = React.useRef(null)
  // While dragging, the ratio lives here; config (localStorage) is written once on release.
  const [dragging, setDragging] = React.useState(null)
  const shown = dragging ?? split
  const drag = e => {
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    let last = null
    const move = ev => { last = clamp((ev.clientY - rect.top) / rect.height); setDragging(last) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      if (last != null) onSplit(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = e => {
    if (e.key === 'ArrowUp') onSplit(clamp(split - 0.05))
    if (e.key === 'ArrowDown') onSplit(clamp(split + 0.05))
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PanelSwitch panel={panel} onPanel={onPanel} />
        {onSync && <SyncBar tree={tree} onSync={onSync} onStashes={() => setStashes(true)} />}
      </div>
      {onSync && <OperationBanner tree={tree} onAction={onSync} />}
      <WorktreeHeader tree={tree} />
      {stashes && <StashList adapter={adapter} repo={repo} tree={tree} registered={registered} onAction={onSync} onClose={() => setStashes(false)} />}
      {history
        ? <HistoryPanel adapter={adapter} repo={repo} cwd={tree.path} registered={registered} target={{ ref: 'HEAD', head: tree.head || null }} split={split} onSplit={onSplit} onAction={onSync} />
        : <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${shown}fr) 6px minmax(0, ${1 - shown}fr)`, height: '70vh', minHeight: 320 }}>
        <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
          onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
        <div role="separator" aria-orientation="horizontal" aria-label="Resize changes and diff" aria-valuenow={Math.round(shown * 100)}
          tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)' }} />
        <DiffPane change={change} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(change, index, stamp, diff.reload)} />
      </div>}
    </div>
  )
}

export function PanelSwitch({ panel, onPanel }) {
  return (
    <div role="group" aria-label="Panel" style={{ display: 'flex', gap: 4 }}>
      {[['changes', 'Changes'], ['history', 'History']].map(([id, label]) => (
        <button key={id} className={`btn sm ${panel === id ? '' : 'ghost'}`} aria-pressed={panel === id} onClick={() => onPanel(id)}>{label}</button>
      ))}
    </div>
  )
}

// Sync and branch actions for the selected worktree; each opens the preview dialog.
function SyncBar({ tree, onSync, onStashes }) {
  const [branchMenu, setBranchMenu] = React.useState(false)
  const go = (kind, options = {}) => { setBranchMenu(false); onSync(kind, options) }
  return (
    <div role="group" aria-label="Sync" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
      <button className="btn sm ghost" onClick={() => go('fetch')}>Fetch</button>
      <button className="btn sm ghost" disabled={!tree.upstream} title={tree.upstream ? undefined : 'No upstream'} onClick={() => go('pull', { mode: 'ff' })}>Pull…</button>
      <button className="btn sm ghost" disabled={tree.branch === '(detached)'} onClick={() => go('push', {})}>Push…</button>
      <button className="btn sm ghost" aria-haspopup="menu" aria-expanded={branchMenu} onClick={() => setBranchMenu(m => !m)}>Branch ▾</button>
      {branchMenu && (
        <div role="menu" aria-label="Branch" className="card" onKeyDown={e => { if (e.key === 'Escape') setBranchMenu(false) }}
          style={{ position: 'absolute', top: '100%', right: 0, zIndex: 5, display: 'grid', gap: 2, padding: 4 }}>
          <button role="menuitem" className="btn sm ghost" onClick={() => go('branch', { start: 'HEAD', checkout: true })}>New branch…</button>
          <button role="menuitem" className="btn sm ghost" onClick={() => go('checkout', {})}>Check out…</button>
          <button role="menuitem" className="btn sm ghost" onClick={() => go('worktreeAdd', {})}>New worktree…</button>
          <button role="menuitem" className="btn sm ghost" onClick={() => go('worktreeRemove', { path: tree.path })}>Remove this worktree…</button>
          <button role="menuitem" className="btn sm ghost" onClick={() => { setBranchMenu(false); onStashes() }}>Stash…</button>
        </div>
      )}
    </div>
  )
}
