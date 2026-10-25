import React from 'react'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { HistoryPanel } from './history-panel.jsx'
import { FilesPane } from './files-pane.jsx'
import { OperationBanner } from './operation-banner.jsx'
import { StashList } from './stash-list.jsx'
import { FileEditor } from './file-editor.jsx'
import { ResolvePane } from './resolve-pane.jsx'
import { GoToFile } from './go-to-file.jsx'
import { BranchHeader } from './branch-header.jsx'
import { discardWorktreeDraft, discardConflictDraft, worktreeDraftPaths, worktreeDraftsByEditor, useWorktreeDraftsVersion } from './use-worktree-file.js'

/**
 * The selected worktree: header with sync actions, then Changes or History (the file column with the
 * commit composer beside the focused file's diff, editor or resolve screen). The git command line is
 * ViewGit's, docked below this panel.
 * `onAction(action, ids?)` reviews a file action for the selection, or for `ids`. The ref exposes
 * `confirmDiscard()`, which asks before unsaved edits would be lost, and `openFile(path, line)`.
 */
export const WorktreePanel = React.forwardRef(function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onWrite, onCommit, onResolve = null, onHunk,
  busy, status, split, onSplit, panel = 'changes', onPanel = () => {}, onSync = null, onSaved,
  onOverview = () => {}, onSwitch = () => {},
}, ref) {
  const [stashes, setStashes] = React.useState(false)
  // How many stashes the worktree has, for the More menu; read again with each snapshot.
  const [stashCount, setStashCount] = React.useState(null)
  const canStash = !!onSync && !!adapter.stashes
  React.useEffect(() => {
    if (!canStash) return undefined
    let live = true
    setStashCount(null)
    adapter.stashes(repo, tree.path, registered).then(raw => { if (live) setStashCount(String(raw ?? '').split('\n').filter(Boolean).length) }, () => {})
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- repo is a fresh object each render; its path is what matters
  }, [adapter, canStash, repo.path, tree.path, registered, version])
  const history = panel === 'history'
  const filesTab = panel === 'files'
  // The changes pane's diff isn't on screen in History or Files, so it isn't loaded either.
  const change = history || filesTab ? null : tree.changes.find(c => c.id === focusId) ?? null
  // The file in the editor, for the worktree it was opened in. `line` is a fresh { line } per request
  // so the editor jumps again even to the same line, and stays put while typing. Kept (hidden) in Diff.
  const [opened, setOpened] = React.useState(null)
  const [mode, setMode] = React.useState('diff')
  // A file just marked resolved keeps its resolve screen (for Undo resolution) after the snapshot reload
  // drops its conflict entry, until another file is focused or the operation ends.
  const [justResolved, setJustResolved] = React.useState(null)
  // Closing the editor always goes back to Diff, so the pills never claim Diff while a click would open Edit.
  const close = () => { setOpened(null); setMode('diff'); setJustResolved(null) }
  // Another worktree starts in Diff with nothing open (ViewGit asked about the edits before switching).
  const [shownTree, setShownTree] = React.useState(tree.path)
  if (shownTree !== tree.path) { setShownTree(tree.path); close() }
  const editor = !history && !filesTab && opened?.tree === tree.path ? opened : null
  const editing = mode === 'edit' && !!editor
  const dirty = React.useRef(false)
  // The conflicted file being resolved (focused, or just resolved), when no editor is open.
  const resolvePath = history || filesTab || editor ? null
    : change?.area === 'conflict' ? change.path
    : !change && tree.operation && justResolved?.tree === tree.path ? justResolved.path : null
  const resolveDirty = React.useRef(false)
  // The worktree's conflicted files in list order, and where the one on screen sits among them. A file
  // just resolved has left the list: "next" is then the first one still conflicted. Both ends wrap.
  const conflicted = [...new Set(tree.changes.filter(c => c.area === 'conflict').map(c => c.path))]
  const at = conflicted.indexOf(resolvePath)
  const others = conflicted.filter(p => p !== resolvePath)
  const conflictFiles = {
    index: at, total: conflicted.length,
    next: at < 0 ? others[0] ?? null : others.length ? conflicted[(at + 1) % conflicted.length] : null,
    prev: at < 0 ? others[others.length - 1] ?? null : others.length ? conflicted[(at - 1 + conflicted.length) % conflicted.length] : null,
  }
  // A just-resolved file that conflicts again (the next step of the operation, or outside the app) is a new
  // conflict: once a snapshot has shown it gone, its return remounts the pane, which loads it afresh.
  const [resolveGen, setResolveGen] = React.useState(0)
  if (justResolved?.tree === tree.path) {
    const back = tree.changes.some(c => c.area === 'conflict' && c.path === justResolved.path)
    if (!back && !justResolved.gone) setJustResolved({ ...justResolved, gone: true })
    else if (back && justResolved.gone) { setJustResolved(null); setResolveGen(g => g + 1) }
  }
  // Discarding also forgets the kept draft, so the edits don't come back the next time the file opens.
  const confirmDiscard = () => {
    if (resolvePath && resolveDirty.current) {
      if (!window.confirm(`Discard unsaved changes to ${resolvePath}?`)) return false
      discardWorktreeDraft(repo.path, tree.path, resolvePath)
      return true
    }
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
    if (history || filesTab) onPanel('changes')
    if (openFile(path)) setGoTo(false)
  }
  // Edits kept from an editor that went away (another app view, a refresh that briefly lost this
  // worktree) are pointed at here and in the changes list until saved or reverted.
  useWorktreeDraftsVersion()
  const drafts = worktreeDraftPaths(repo.path, tree.path)
  const byEditor = worktreeDraftsByEditor(repo.path, tree.path)
  const elsewhere = byEditor.plain.filter(p => p !== editor?.path)
  // Resolve-screen drafts not on screen: a still-conflicted file reopens its resolve screen; one that
  // isn't conflicted any more can only be discarded (asked first), never silently.
  const keptResolves = byEditor.conflict.filter(p => p !== resolvePath)
    .map(p => ({ path: p, change: tree.changes.find(c => c.area === 'conflict' && c.path === p) ?? null }))
  // Focusing another file keeps the mode: in Edit it opens that file, in Diff the hidden editor closes.
  // Conflicted files open their resolve screen, so focusing one goes back to Diff.
  const focus = id => {
    const next = tree.changes.find(c => c.id === id) ?? null
    if (next?.path !== (editor?.path ?? resolvePath)) {
      if (!confirmDiscard()) return
      if (mode === 'edit' && next && next.area !== 'conflict') open(next.path)
      else close()
    }
    setJustResolved(null)
    onFocus(id)
  }
  const openResolve = c => {
    if (history || filesTab || c.path !== resolvePath) {
      if (!confirmDiscard()) return
      close()
      if (history || filesTab) onPanel('changes')
    }
    setJustResolved(null)
    onFocus(c.id)
  }
  const discardKeptResolve = p => {
    if (window.confirm(`Discard unsaved resolve edits to ${p}? It isn't conflicted any more, so they can't be used.`)) discardConflictDraft(repo.path, tree.path, p)
  }
  // Skip and Abort change the conflicted files under the resolve screen, so unsaved edits are asked about first.
  const operation = (kind, options) => {
    if ((kind === 'skip' || kind === 'abort') && !confirmDiscard()) return
    onSync(kind, options)
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
  const diffChange = resolvePath ? null : !editor || change?.path === editor.path ? change
    : tree.changes.find(c => c.path === editor.path && c.area !== 'staged') ?? tree.changes.find(c => c.path === editor.path) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change: diffChange, version })
  const canEdit = !!editor || (!!change && change.area !== 'conflict')
  return (
    <div className="nx-gw-detail">
      <BranchHeader tree={tree} stashCount={stashCount} onSync={onSync ?? (() => {})} onStashes={() => setStashes(true)}
        onOverview={onOverview} onSwitch={onSwitch} onEditor={() => setGoTo(true)}
        onTerminal={adapter.openTerminal ? () => adapter.openTerminal(repo, tree.path, registered) : null} />
      {goTo && <GoToFile adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} onOpen={goToFile} onClose={() => setGoTo(false)} />}
      {tree.error && <div role="alert" className="nx-alert bad" style={{ margin: '10px 16px 0' }}>{tree.error}</div>}
      <div className="nx-gw-tabs">
        <PanelSwitch panel={panel} onPanel={switchPanel} count={tree.changes.length} />
        <span className="nx-gw-tabs-end">
          <button className="nx-gw-goto" title="Ctrl+P" onClick={() => setGoTo(true)}>Go to file<span className="kbd">Ctrl P</span></button>
        </span>
      </div>
      {elsewhere.length + keptResolves.length > 0 && (
        <div role="note" aria-label="Unsaved edits" className="nx-panel-section" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="nx-badge warn">● Unsaved edits kept</span>
          {elsewhere.map(p => <button key={p} className="btn sm ghost" title={`Open ${p}`} onClick={() => goToFile(p)}>{p}</button>)}
          {keptResolves.map(({ path: p, change: c }) => (c
            ? <button key={`r:${p}`} className="btn sm ghost" title={`Resolve ${p}`} onClick={() => openResolve(c)}>{p}</button>
            : (
              <span key={`r:${p}`} className="row" style={{ gap: 4 }}>
                <span className="nx-muted" title="Resolve edits to a file that isn't conflicted any more">{p}</span>
                <button className="btn sm ghost danger" aria-label={`Discard unsaved resolve edits to ${p}`} onClick={() => discardKeptResolve(p)}>Discard</button>
              </span>
            )))}
        </div>
      )}
      {onSync && <div className="nx-gw-banner-slot"><OperationBanner tree={tree} onAction={operation} /></div>}
      {stashes && <StashList adapter={adapter} repo={repo} tree={tree} registered={registered} onAction={onSync} onClose={() => setStashes(false)} />}
      {filesTab
        ? (
          <div className="nx-gw-files-body">
            <FilesPane adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} version={version} onImported={onSaved} onOpenFile={goToFile} />
          </div>
        )
        : history
        ? (
          <div className="nx-panel-body">
            <HistoryPanel adapter={adapter} repo={repo} cwd={tree.path} registered={registered} target={{ ref: 'HEAD', head: tree.head || null }} split={split} onSplit={onSplit} onAction={onSync}
              upstream={tree.upstream && !tree.upstreamGone ? tree.upstream : null} rebasing={/^Rebase/.test(tree.operation ?? '')} />
          </div>
        )
        : (
            <div className="nx-gw-changes">
              <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={focus} drafts={drafts}
                onAction={onAction} onWrite={onWrite} onCommit={onCommit} onResolve={onResolve && resolve} busy={busy} status={status} />
              <div className="nx-gw-changes-main" data-mode={canEdit ? 'edit' : 'plain'}>
                {canEdit && <ModeSwitch editing={editing} onDiff={() => setMode('diff')} onEdit={edit} />}
                {editor && (
                  <div style={{ display: editing ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                    <FileEditor adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} path={editor.path} line={editor.line}
                      onSaved={onSaved} onDirtyChange={d => { dirty.current = d }} />
                  </div>
                )}
                {!editing && (resolvePath
                  ? <ResolvePane key={`${tree.path}|${resolvePath}|${resolveGen}`} adapter={adapter} repo={repo} tree={tree} registered={registered} change={change ?? { path: resolvePath }}
                      onDirtyChange={d => { resolveDirty.current = d }} files={conflictFiles}
                      onOpenFile={p => { const next = tree.changes.find(c => c.area === 'conflict' && c.path === p); if (next) openResolve(next) }}
                      onResolved={() => { setJustResolved({ tree: tree.path, path: resolvePath }); onSaved?.() }} />
                  : editor && !diffChange
                  ? <div role="note" style={{ color: 'var(--text-muted)' }}>No changes yet.</div>
                  : <DiffPane change={diffChange} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(diffChange, index, stamp, diff.reload)}
                      onFile={diffChange && (action => (action === 'stage' || action === 'unstage' ? onWrite(action, [diffChange.id]) : onAction(action, [diffChange.id])))}
                      onLine={diffChange && diffChange.area !== 'conflict' ? n => openFile(diffChange.path, n) : null} />)}
              </div>
            </div>
          )}
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
    <div role="tablist" aria-label="Panel" style={{ display: 'contents' }}>
      {[['changes', 'Changes', count], ['history', 'History', 0], ['files', 'Files', 0]].map(([id, label, n]) => (
        <button key={id} role="tab" className="nx-gw-tab" aria-selected={panel === id} onClick={() => onPanel(id)}>
          {label}{n > 0 && <>{' '}<span className="n">{n}</span></>}
        </button>
      ))}
    </div>
  )
}
