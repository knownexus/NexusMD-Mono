import React from 'react'
import { paletteFor as uiPaletteFor } from '@nexusmd/ui'
import { FileEditor } from './file-editor.jsx'
import { ResolvePane } from './resolve-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { useWorktreeStatus } from './use-worktree-status.js'
import '@nexusmd/editor-kit/devenv-git.css'
import './git-workspace.css'

const HEADINGS = { editor: 'Edit', conflict: 'Resolve', diff: 'Diff' }
const NOOP = () => {}

// The app can be updated on its own (app-updater.cjs), so it may run in a shell from before
// @nexusmd/ui had paletteFor (NexusMD 1.2.7 and older), whose tweaks know only light and dark. The
// split build reads @nexusmd/ui's names off the shell's module, so a missing one is undefined there.
// Read when called, not at load: tests that load every app mock @nexusmd/ui without it.
const paletteFor = t => (uiPaletteFor ? uiPaletteFor(t) : t?.theme === 'dark' ? (t.darkTheme || 'cobalt') : (t?.lightTheme || 'parchment'))

// The same palette the main window uses (its tweaks are kept in localStorage).
function usePalette() {
  React.useEffect(() => {
    let palette = paletteFor()
    try {
      palette = paletteFor(JSON.parse(localStorage.getItem('nexusmd.tweaks') || '{}'))
    } catch { /* the default palette */ }
    document.body.dataset.theme = palette
  }, [])
}

/**
 * The page of a Git Workspace pop-out window (see popout-spec.js): one screen, for one file, with
 * nothing else around it. After it writes, the other windows are told so they read the repository again.
 * The conflict and diff screens read their worktree's status themselves (that worktree only), and
 * again when the main window (or another pop-out) writes; the diff is read-only, so staging stays in
 * the main window. A diff that came with its change shows it at once, without waiting for the status.
 */
export function PopoutApp({ spec, adapter }) {
  usePalette()
  const { kind, repo, worktree, registered, path } = spec
  React.useEffect(() => { document.title = `${HEADINGS[kind]} ${path.split('/').pop()} · ${repo.name}` }, [kind, path, repo.name])
  const needsTree = kind !== 'editor'
  const status = useWorktreeStatus({ adapter, repo, worktree, registered, enabled: needsTree, intervalMs: 5000 })
  const { reload } = status
  React.useEffect(() => (needsTree ? adapter.onChanged(() => reload()) : undefined), [adapter, needsTree, reload])
  const tree = status.tree

  const written = () => { adapter.notifyChanged(repo.path); if (needsTree) reload() }

  let body
  if (kind === 'editor') {
    body = <FileEditor adapter={adapter} repo={repo} worktreePath={worktree} registered={registered} path={path} onSaved={written} />
  } else if (kind === 'diff' && spec.change && !tree?.error) {
    // Until the first status read lands, the change it came with; the diff it asked for is as new as
    // that read, so only later reads ask for it again.
    const change = tree ? tree.changes.find(c => c.id === spec.changeId) ?? null : spec.change
    body = <DiffBody adapter={adapter} repo={repo} worktreePath={worktree} registered={registered} change={change} path={path} version={status.reads > 1 ? status.takenAt : null} />
  } else if (!tree) {
    body = status.error
      ? <div role="alert" className="nx-alert bad">{status.error}</div>
      : <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  } else if (tree.error) {
    body = <div role="alert" className="nx-alert bad">{tree.error}</div>
  } else if (kind === 'conflict') {
    const change = tree.changes.find(c => c.area === 'conflict' && c.path === path) ?? { path }
    body = <ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={written} />
  } else {
    const change = tree.changes.find(c => c.id === spec.changeId) ?? null
    body = <DiffBody adapter={adapter} repo={repo} worktreePath={tree.path} registered={registered} change={change} path={path} version={status.takenAt} />
  }

  return (
    <div className="nx-popout">
      <div className="nx-popout-head">
        <span className="nx-popout-title nx-trunc" title={path}>{path}</span>
        <span className="nx-popout-where nx-trunc" title={worktree}>{`${repo.name} · ${worktree}`}</span>
      </div>
      <div className="nx-popout-body">{body}</div>
    </div>
  )
}

function DiffBody({ adapter, repo, worktreePath, registered, change, path, version }) {
  const diff = useDiff({ adapter, repo, worktreePath, registered, change, version })
  if (!change) return <div role="note" style={{ color: 'var(--text-muted)' }}>{`${path} has no changes any more.`}</div>
  const images = adapter.readImage ? { load: (side, rel) => adapter.readImage(repo, worktreePath, registered, rel, side), key: `${worktreePath}|${diff.result?.stamp ?? ''}` } : null
  return <DiffPane change={change} diff={diff} onHunk={NOOP} readOnly images={images} />
}
