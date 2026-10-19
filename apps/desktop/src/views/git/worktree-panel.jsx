import React from 'react'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { HistoryPanel } from './history-panel.jsx'
import { OperationBar } from './operation-bar.jsx'
import { StashList } from './stash-list.jsx'
import { GitCommandLine } from './git-command-line.jsx'
import { FileEditor } from './file-editor.jsx'
import { GoToFile } from './go-to-file.jsx'
import { discardWorktreeDraft, worktreeDraftPaths, useWorktreeDraftsVersion } from './use-worktree-file.js'

const clamp = v => Math.min(0.8, Math.max(0.2, v))

function trackText(tree) {
  if (!tree.upstream) return `no upstream · ${tree.ahead} local commit${tree.ahead === 1 ? '' : 's'}`
  return `${tree.upstream}${tree.upstreamGone ? ' (missing)' : ''} · ${tree.ahead} ahead, ${tree.behind} behind`
}

/**
 * The selected worktree: header with sync actions, git command line, then Changes or History (the
 * focused file's diff, or that file in an editor, below a divider). The ref exposes
 * `confirmDiscard()`, which asks before unsaved edits would be lost, and `openFile(path, line)`.
 */
export const WorktreePanel = React.forwardRef(function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onResolve = null, onHunk,
  busy, status, split, onSplit, panel = 'changes', onPanel = () => {}, onSync = null, onExec = null, onSaved,
}, ref) {
  const [stashes, setStashes] = React.useState(false)
  const history = panel === 'history'
  // The changes pane's diff isn't on screen in History, so it isn't loaded either.
  const change = history ? null : tree.changes.find(c => c.id === focusId) ?? null
  // The file in the editor, for the worktree it was opened in. `line` is a fresh { line } per request
  // so the editor jumps again even to the same line, and stays put while typing. Kept (hidden) in Diff.
  const [opened, setOpened] = React.useState(null)
  const [mode, setMode] = React.useState('diff')
  // Closing the editor always goes back to Diff, so the pills never claim Diff while a click would open Edit.
  const close = () => { setOpened(null); setMode('diff') }
  // Another worktree starts in Diff with nothing open (ViewGit asked about the edits before switching).
  const [shownTree, setShownTree] = React.useState(tree.path)
  if (shownTree !== tree.path) { setShownTree(tree.path); close() }
  const editor = !history && opened?.tree === tree.path ? opened : null
  const editing = mode === 'edit' && !!editor
  const dirty = React.useRef(false)
  // Discarding also forgets the kept draft, so the edits don't come back the next time the file opens.
  const confirmDiscard = () => {
    if (!editor || !dirty.current) return true
    if (!window.confirm(`Discard unsaved changes to ${editor.path}?`)) return false
    discardWorktreeDraft(repo.path, editor.tree, editor.path)
    return true
  }
  const open = (path, line = null) => setOpened({ tree: tree.path, path, line: line == null ? null : { line } })
  const openFile = (path, line = null) => {
    if (path !== editor?.path && !confirmDiscard()) return false
    open(path, line)
    setMode('edit')
    return true
  }
  React.useImperativeHandle(ref, () => ({ confirmDiscard, openFile }))
  // Ctrl+P (Go to file) while this panel is shown; not over another dialog. preventDefault keeps the print dialog away.
  const [goTo, setGoTo] = React.useState(false)
  React.useEffect(() => {
    const key = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'p') return
      e.preventDefault()
      if (!document.querySelector('[aria-modal="true"]')) setGoTo(true)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const goToFile = path => {
    if (history) onPanel('changes')
    if (openFile(path)) setGoTo(false)
  }
  // Edits kept from an editor that went away (another app view, a refresh that briefly lost this
  // worktree) are pointed at here and in the changes list until saved or reverted.
  useWorktreeDraftsVersion()
  const drafts = worktreeDraftPaths(repo.path, tree.path)
  const elsewhere = drafts.filter(p => p !== editor?.path)
  // Closing or reloading the window with unsaved edits asks first (main shows the question).
  React.useEffect(() => {
    const warn = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  // Focusing another file keeps the mode: in Edit it opens that file, in Diff the hidden editor closes.
  // Conflicted files only show their diff, so focusing one goes back to Diff.
  const focus = id => {
    const next = tree.changes.find(c => c.id === id) ?? null
    if (next?.path !== editor?.path) {
      if (!confirmDiscard()) return
      if (mode === 'edit' && next && next.area !== 'conflict') open(next.path)
      else close()
    }
    onFocus(id)
  }
  const switchPanel = id => {
    if (id === panel) return
    if (!confirmDiscard()) return
    close()
    onPanel(id)
  }
  // Taking a side rewrites the file on disk, so edits to it (open here or kept) are asked about first and dropped once it succeeds.
  const resolve = (change, take) => {
    if (editor?.path === change.path) { if (!confirmDiscard()) return }
    else if (drafts.includes(change.path) && !window.confirm(`Discard unsaved changes to ${change.path}?`)) return
    onResolve(change, take, () => discardWorktreeDraft(repo.path, tree.path, change.path))
  }
  const edit = () => { if (!editor && change) open(change.path); setMode('edit') }
  // An opened file's diff, whichever of its changes is focused (unstaged first); none if it is unchanged.
  const diffChange = !editor || change?.path === editor.path ? change
    : tree.changes.find(c => c.path === editor.path && c.area !== 'staged') ?? tree.changes.find(c => c.path === editor.path) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change: diffChange, version })
  const canEdit = !!editor || (!!change && change.area !== 'conflict')
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
        <button className="btn sm ghost" title="Ctrl+P" style={{ alignSelf: 'flex-start' }} onClick={() => setGoTo(true)}>Go to file</button>
        {onSync && <SyncBar tree={tree} onSync={onSync} onStashes={() => setStashes(true)} />}
      </div>
      {goTo && <GoToFile adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} onOpen={goToFile} onClose={() => setGoTo(false)} />}
      {tree.error && <div role="alert" className="nx-alert bad" style={{ margin: '10px 16px 0' }}>{tree.error}</div>}
      {onExec && (
        <div className="nx-panel-section" style={{ background: 'var(--surface-2)' }}>
          <GitCommandLine path={tree.path} disabled={busy} onRun={argv => onExec(tree, argv)} />
        </div>
      )}
      <div className="nx-panel-section" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <PanelSwitch panel={panel} onPanel={switchPanel} count={tree.changes.length} />
      </div>
      {elsewhere.length > 0 && (
        <div role="note" aria-label="Unsaved edits" className="nx-panel-section" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="nx-badge warn">● Unsaved edits kept</span>
          {elsewhere.map(p => <button key={p} className="btn sm ghost" title={`Open ${p}`} onClick={() => goToFile(p)}>{p}</button>)}
        </div>
      )}
      <div className="nx-panel-body">
        {onSync && <OperationBar tree={tree} onAction={onSync} />}
        {stashes && <StashList adapter={adapter} repo={repo} tree={tree} registered={registered} onAction={onSync} onClose={() => setStashes(false)} />}
        {history
          ? <HistoryPanel adapter={adapter} repo={repo} cwd={tree.path} registered={registered} target={{ ref: 'HEAD', head: tree.head || null }} split={split} onSplit={onSplit} onAction={onSync} />
          : (
            <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${shown}fr) 6px minmax(0, ${1 - shown}fr)`, height: '64vh', minHeight: 320 }}>
              <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={focus} drafts={drafts}
                onAction={onAction} onCommit={onCommit} onResolve={onResolve && resolve} busy={busy} status={status} />
              <div role="separator" aria-orientation="horizontal" aria-label="Resize changes and diff" aria-valuenow={Math.round(shown * 100)}
                tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)', borderRadius: 3 }} />
              <div style={{ display: 'grid', gridTemplateRows: canEdit ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 6, minHeight: 0 }}>
                {canEdit && <ModeSwitch editing={editing} onDiff={() => setMode('diff')} onEdit={edit} />}
                {editor && (
                  <div style={{ display: editing ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                    <FileEditor adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} path={editor.path} line={editor.line}
                      onSaved={onSaved} onDirtyChange={d => { dirty.current = d }} />
                  </div>
                )}
                {!editing && (editor && !diffChange
                  ? <div role="note" style={{ color: 'var(--text-muted)' }}>No changes yet.</div>
                  : <DiffPane change={diffChange} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(diffChange, index, stamp, diff.reload)}
                      onLine={diffChange && diffChange.area !== 'conflict' ? n => openFile(diffChange.path, n) : null} />)}
              </div>
            </div>
          )}
      </div>
    </div>
  )
})

function ModeSwitch({ editing, onDiff, onEdit }) {
  return (
    <div role="group" aria-label="Diff or edit" className="nx-pills">
      <button className="nx-pill" aria-pressed={!editing} onClick={onDiff} style={{ height: 26 }}>Diff</button>
      <button className="nx-pill" aria-pressed={editing} onClick={onEdit} style={{ height: 26 }}>Edit</button>
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
