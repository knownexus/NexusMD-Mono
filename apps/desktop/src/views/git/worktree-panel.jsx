import React from 'react'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { HistoryPanel } from './history-panel.jsx'
import { OperationBanner } from './operation-banner.jsx'
import { StashList } from './stash-list.jsx'
import { GitCommandLine } from './git-command-line.jsx'

const clamp = v => Math.min(0.8, Math.max(0.2, v))

function trackText(tree) {
  if (!tree.upstream) return `no upstream · ${tree.ahead} local commit${tree.ahead === 1 ? '' : 's'}`
  return `${tree.upstream}${tree.upstreamGone ? ' (missing)' : ''} · ${tree.ahead} ahead, ${tree.behind} behind`
}

/** The selected worktree: header with sync actions, git command line, then Changes or History (the focused file's diff below a divider). */
export function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onHunk,
  busy, status, split, onSplit, panel = 'changes', onPanel = () => {}, onSync = null, onExec = null,
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
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div className="nx-panel-head">
        {/* Grows to fill the row, and pushes the sync buttons onto their own line before getting too narrow to read. */}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="nx-panel-branch">{tree.branch}</div>
          <div className="nx-panel-sub">{`${tree.path} · ${trackText(tree)}`}</div>
          <div className="nx-panel-sub">{`Last fetch ${tree.fetchedAt ? new Date(tree.fetchedAt).toLocaleString() : 'unknown'}`}</div>
          {(tree.operation || tree.locked || tree.prunable) && (
            <div className="nx-pills" style={{ marginTop: 6 }}>
              {tree.operation && <span className="nx-badge warn">{tree.operation}</span>}
              {/* Both hold git's reason, or a plain default when it gave none. */}
              {tree.locked && <span className="nx-badge">{tree.locked === 'Locked' ? 'Locked' : `Locked: ${tree.locked}`}</span>}
              {tree.prunable && <span className="nx-badge bad">{tree.prunable === 'Stale registration' ? 'Stale registration' : `Stale: ${tree.prunable}`}</span>}
            </div>
          )}
        </div>
        {onSync && <SyncBar tree={tree} onSync={onSync} onStashes={() => setStashes(true)} />}
      </div>
      {tree.error && <div role="alert" className="nx-alert bad" style={{ margin: '10px 16px 0' }}>{tree.error}</div>}
      {onExec && (
        <div className="nx-panel-section" style={{ background: 'var(--surface-2)' }}>
          <GitCommandLine path={tree.path} disabled={busy} onRun={argv => onExec(tree, argv)} />
        </div>
      )}
      <div className="nx-panel-section" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <PanelSwitch panel={panel} onPanel={onPanel} count={tree.changes.length} />
      </div>
      <div className="nx-panel-body">
        {onSync && <OperationBanner tree={tree} onAction={onSync} />}
        {stashes && <StashList adapter={adapter} repo={repo} tree={tree} registered={registered} onAction={onSync} onClose={() => setStashes(false)} />}
        {history
          ? <HistoryPanel adapter={adapter} repo={repo} cwd={tree.path} registered={registered} target={{ ref: 'HEAD', head: tree.head || null }} split={split} onSplit={onSplit} onAction={onSync} />
          : (
            <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${shown}fr) 6px minmax(0, ${1 - shown}fr)`, height: '64vh', minHeight: 320 }}>
              <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
                onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
              <div role="separator" aria-orientation="horizontal" aria-label="Resize changes and diff" aria-valuenow={Math.round(shown * 100)}
                tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)', borderRadius: 3 }} />
              <DiffPane change={change} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(change, index, stamp, diff.reload)} />
            </div>
          )}
      </div>
    </div>
  )
}

export function PanelSwitch({ panel, onPanel, count = 0 }) {
  return (
    <div role="group" aria-label="Panel" className="nx-pills">
      {[['changes', count ? `Changes (${count})` : 'Changes'], ['history', 'History']].map(([id, label]) => (
        <button key={id} className="nx-pill" aria-pressed={panel === id} onClick={() => onPanel(id)}>{label}</button>
      ))}
    </div>
  )
}

// Sync and branch actions for the selected worktree; each opens the preview dialog.
function SyncBar({ tree, onSync, onStashes }) {
  const [branchMenu, setBranchMenu] = React.useState(false)
  const go = (kind, options = {}) => { setBranchMenu(false); onSync(kind, options) }
  const detached = tree.branch === '(detached)'
  return (
    <div role="group" aria-label="Sync" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
      <button className="btn sm ghost" title="git fetch" onClick={() => go('fetch')}>Fetch</button>
      <button className="btn sm" disabled={!tree.upstream} title={tree.upstream ? 'git pull --ff-only' : 'No upstream'} onClick={() => go('pull', { mode: 'ff' })}>
        {tree.behind ? `Pull ${tree.behind}…` : 'Pull…'}
      </button>
      <button className={`btn sm ${tree.ahead || !tree.upstream ? 'accent' : ''}`} disabled={detached} title={tree.upstream ? 'git push' : `git push -u origin ${tree.branch}`} onClick={() => go('push', {})}>
        {!tree.upstream ? 'Publish…' : tree.ahead ? `Push ${tree.ahead}…` : 'Push…'}
      </button>
      <button className="btn sm ghost" aria-haspopup="menu" aria-expanded={branchMenu} onClick={() => setBranchMenu(m => !m)}>Branch ▾</button>
      {branchMenu && (
        <div role="menu" aria-label="Branch" className="card" onKeyDown={e => { if (e.key === 'Escape') setBranchMenu(false) }}
          style={{ position: 'absolute', top: '100%', right: 0, zIndex: 5, display: 'grid', gap: 2, padding: 4, marginTop: 4, boxShadow: 'var(--shadow-lg)' }}>
          <button role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => go('branch', { start: 'HEAD', checkout: true })}>New branch…</button>
          <button role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => go('checkout', {})}>Check out…</button>
          <button role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => go('worktreeAdd', {})}>New worktree…</button>
          <button role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => go('worktreeRemove', { path: tree.path })}>Remove this worktree…</button>
          <button role="menuitem" className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setBranchMenu(false); onStashes() }}>Stash…</button>
        </div>
      )}
    </div>
  )
}
