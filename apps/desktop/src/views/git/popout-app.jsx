import React from 'react'
import { worktreeId } from '@nexusmd/core'
import { FileEditor } from './file-editor.jsx'
import { ResolvePane } from './resolve-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'
import { useGitSnapshot } from './use-git-snapshot.js'
import '../devenv-git.css'
import './git-workspace.css'

const HEADINGS = { editor: 'Edit', conflict: 'Resolve', diff: 'Diff' }
const NOOP = () => {}

// The same palette the main window uses (its tweaks are kept in localStorage).
function usePalette() {
  React.useEffect(() => {
    let palette = 'parchment'
    try {
      const t = JSON.parse(localStorage.getItem('nexusmd.tweaks') || '{}')
      palette = t.theme === 'dark' ? (t.darkTheme || 'cobalt') : (t.lightTheme || 'parchment')
    } catch { /* the default palette */ }
    document.body.dataset.theme = palette
  }, [])
}

/**
 * The page of a Git Workspace pop-out window (see popout-spec.js): one screen, for one file, with
 * nothing else around it. After it writes, the other windows are told so they read the repository again.
 * The conflict and diff screens read their worktree themselves, and again when the main window
 * (or another pop-out) writes; the diff is read-only, so staging stays in the main window.
 */
export function PopoutApp({ spec, adapter }) {
  usePalette()
  const { kind, repo, worktree, registered, path } = spec
  React.useEffect(() => { document.title = `${HEADINGS[kind]} ${path.split('/').pop()} · ${repo.name}` }, [kind, path, repo.name])
  const needsTree = kind !== 'editor'
  const repos = React.useMemo(() => [repo], [repo.name, repo.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const snap = useGitSnapshot({ adapter, repos, enabled: needsTree, intervalMs: 5000, full: worktreeId({ path: worktree }), persist: false })
  const { reload } = snap
  React.useEffect(() => (needsTree ? adapter.onChanged(() => reload([repo.name])) : undefined), [adapter, needsTree, reload, repo.name])
  const tree = snap.snapshot?.worktrees.find(t => worktreeId(t) === worktreeId({ path: worktree })) ?? null

  const written = () => { adapter.notifyChanged(repo.path); if (needsTree) reload([repo.name]) }

  let body
  if (kind === 'editor') {
    body = <FileEditor adapter={adapter} repo={repo} worktreePath={worktree} registered={registered} path={path} onSaved={written} />
  } else if (!tree) {
    body = snap.error
      ? <div role="alert" className="nx-alert bad">{snap.error}</div>
      : <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
  } else if (tree.error) {
    body = <div role="alert" className="nx-alert bad">{tree.error}</div>
  } else if (kind === 'conflict') {
    const change = tree.changes.find(c => c.area === 'conflict' && c.path === path) ?? { path }
    body = <ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={written} />
  } else {
    body = <DiffBody adapter={adapter} repo={repo} tree={tree} registered={registered} changeId={spec.changeId} path={path} version={snap.snapshot?.takenAt} />
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

function DiffBody({ adapter, repo, tree, registered, changeId, path, version }) {
  const change = tree.changes.find(c => c.id === changeId) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change, version })
  if (!change) return <div role="note" style={{ color: 'var(--text-muted)' }}>{`${path} has no changes any more.`}</div>
  const images = adapter.readImage ? { load: (side, rel) => adapter.readImage(repo, tree.path, registered, rel, side), key: `${tree.path}|${diff.result?.stamp ?? ''}` } : null
  return <DiffPane change={change} diff={diff} onHunk={NOOP} readOnly images={images} />
}
