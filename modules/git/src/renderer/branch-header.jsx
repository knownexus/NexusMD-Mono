import React from 'react'
import { primaryAction, worktreeName, checkoutName, sourceName } from '@nexusmd/core'
import { PopoverMenu } from './popover-menu.jsx'
import { fetchedAgo } from './fetched-ago.js'
import { ipcMessage } from './use-git-actions.js'
import { Icon } from '@nexusmd/ui'

// The header's contextual primary takes only these of primaryAction's kinds; the rest are elsewhere on the page.
const PRIMARY = {
  pull: ['pull', { mode: 'ff' }],
  push: ['push', {}],
  publish: ['push', { setUpstream: true }],
}
const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// The repository's primary checkout: its .git directory is the common dir. Linked worktrees (and every
// worktree of a bare repository) have theirs elsewhere. Without a common dir, the registered root stands in.
export function isMainWorktree(tree) {
  if (tree.commonDir) return norm(tree.commonDir) === `${norm(tree.path)}/.git`
  return norm(tree.path) === norm(tree.repoRoot)
}

// The upstream and where the branch stands against it: an operation first, then what is left to push or pull.
function tracking(tree) {
  if (tree.upstreamGone) return [{ text: 'Upstream was deleted on origin', tone: 'warn' }]
  if (!tree.upstream) return [{ text: 'Not published yet' }]
  const info = tree.operationInfo
  if (tree.operation) {
    // onto is { oid, name } (a full ref name), not a string.
    const onto = typeof info?.onto === 'string' ? info.onto : String(info?.onto?.name ?? '').replace(/^refs\/(heads|remotes|tags)\//, '')
    const state = info?.kind === 'rebase' && onto ? `Rebasing onto ${onto}` : tree.operation
    return [{ text: tree.upstream }, { text: state, tone: 'bad' }]
  }
  const arrows = [tree.ahead ? `↑${tree.ahead}` : null, tree.behind ? `↓${tree.behind}` : null].filter(Boolean)
  const words = [tree.ahead ? `${tree.ahead} to push` : null, tree.behind ? `${tree.behind} to pull` : null].filter(Boolean)
  return [{ text: tree.upstream }, { text: arrows.length ? arrows.join(' ') : 'In sync', tone: arrows.length ? 'info' : 'ok', title: words.length ? words.join(' · ') : undefined }]
}

/** The Changes / History / Files tabs; `count` is the number of changed files. */
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

/**
 * The selected worktree's header in two short rows. Row 1: a back-to-overview button, the branch with a
 * Switch chip (Ctrl+K), its upstream and sync state, the path (with a copy button) and its actions
 * (contextual primary, Fetch, Pull…, Rebase…, More ▾, Terminal, Editor). Row 2 (when `onPanel` is given):
 * the Changes / History / Files tabs and Go to file. Each git action goes through `onSync(kind, options)`,
 * which opens its preview dialog. The breadcrumb shows only in the focus layout (`focusLayout`).
 */
export function BranchHeader({
  tree, stashCount = null, onSync, onStashes, onOverview, onSwitch, onEditor, onSource = () => {}, onTerminal = null,
  panel = 'changes', onPanel = null, changeCount = 0, onGoTo = () => {}, focusLayout = false,
}) {
  const [copied, setCopied] = React.useState(false)
  const [terminalError, setTerminalError] = React.useState(null)
  React.useEffect(() => { setTerminalError(null); setCopied(false) }, [tree.path])
  React.useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => {
    const done = navigator.clipboard?.writeText(tree.path)
    if (done) done.then(() => setCopied(true), () => {})
  }
  const terminal = () => { setTerminalError(null); onTerminal().catch(e => setTerminalError(ipcMessage(e))) }

  const name = worktreeName(tree)
  const branch = checkoutName(tree) ?? tree.branch
  // A linked worktree's folder is named when it differs from the branch; the main checkout isn't.
  const folder = name !== 'checkout' && name !== branch ? name : null
  const isMain = isMainWorktree(tree)
  const detached = tree.branch === '(detached)'
  const busy = !!tree.operation
  const primary = busy ? null : primaryAction(tree)
  const go = PRIMARY[primary?.kind]
  const published = !!tree.upstream && !tree.upstreamGone
  const ago = fetchedAgo(tree.fetchedAt)
  const busyReason = `Finish or abort the ${tree.operation} first`

  const more = [
    { heading: 'Branch' },
    { label: 'New branch…', hint: 'b', onSelect: () => onSync('branch', { start: 'HEAD', checkout: true }) },
    { label: 'Check out another branch…', onSelect: () => onSync('checkout', {}) },
    { heading: 'Remote' },
    { label: 'Push…', disabled: detached, reason: 'Check out a branch first', onSelect: () => onSync('push', published ? {} : { setUpstream: true }) },
    { heading: 'Stash' },
    { label: 'Stash changes…', onSelect: () => onSync('stashPush', {}) },
    { label: 'Stashes…', hint: stashCount || null, onSelect: onStashes },
    { heading: 'Worktree' },
    { label: 'Add worktree…', onSelect: () => onSync('worktreeAdd', {}) },
    { label: 'Remove this worktree…', danger: true, disabled: isMain, reason: "The main worktree can't be removed", onSelect: () => onSync('worktreeRemove', { path: tree.path }) },
  ]

  return (
    <div className="nx-gw-dhead">
      {focusLayout && (
        <nav aria-label="Breadcrumb" className="nx-gw-crumb">
          <button type="button" className="nx-gw-crumb-link" onClick={onOverview}>Overview</button>
          <span aria-hidden="true">›</span>
          <span>{tree.repo}</span>
          {folder && <><span aria-hidden="true">›</span><span>{folder}</span></>}
        </nav>
      )}
      <div className="nx-gw-dhead-row">
        <div className="nx-gw-dhead-branch">
          {!focusLayout && (
            <button type="button" className="nx-gw-icon-btn nx-gw-back" aria-label="Overview" title="Back to the overview" onClick={onOverview}>
              <Icon name="chevron-left" size={14} />
            </button>
          )}
          <h3 className="nx-gw-branch-name" title={branch}>{branch}</h3>
          <button type="button" className="nx-gw-switch" title="Jump to another branch (Ctrl+K)" onClick={onSwitch}>Switch ▾</button>
        </div>
        <div className="nx-gw-dhead-meta">
          {tracking(tree).map(t => <span key={t.text} className="nx-gw-t" data-tone={t.tone} title={t.title}>{t.text}</span>)}
          <span className="nx-gw-pathbox">
            <span className="nx-gw-path" title={tree.path}>{tree.path}</span>
            <button type="button" className="nx-gw-copy" aria-label={copied ? 'Copied' : 'Copy path'} title={copied ? 'Copied' : 'Copy path'} onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size={12} />
            </button>
          </span>
          {tree.source && !detached && (
            <button type="button" className="nx-gw-crumb-link" title="The branch this one was cut from" onClick={onSource}>from {sourceName(tree.source.ref)} ▾</button>
          )}
          <span>{ago ? `Fetched ${ago}` : 'Never fetched'}</span>
          {tree.operation && <span className="nx-badge warn">{tree.operation}</span>}
          {/* Both hold git's reason, or a plain default when it gave none. */}
          {tree.locked && <span className="nx-badge">{tree.locked === 'Locked' ? 'Locked' : `Locked: ${tree.locked}`}</span>}
          {tree.prunable && <span className="nx-badge bad">{tree.prunable === 'Stale registration' ? 'Stale registration' : `Stale: ${tree.prunable}`}</span>}
        </div>
        <div role="group" aria-label="Branch actions" className="nx-gw-dhead-actions">
          {go && <button type="button" className="btn sm accent" onClick={() => onSync(...go)}>{primary.label}</button>}
          <button type="button" className="btn sm" title="git fetch" onClick={() => onSync('fetch', {})}>Fetch</button>
          <button type="button" className="btn sm" disabled={busy || !tree.upstream} title={busy ? busyReason : tree.upstream ? 'git pull --ff-only' : 'No upstream'}
            onClick={() => onSync('pull', { mode: 'ff' })}>Pull…</button>
          <button type="button" className="btn sm" disabled={busy || detached}
            title={busy ? busyReason : detached ? 'Check out a branch first' : 'git rebase onto a branch, tag or commit you choose'}
            onClick={() => onSync('rebase', {})}>Rebase…</button>
          <PopoverMenu label="More ▾" menuLabel="More" items={more} />
          <span className="nx-gw-divider" />
          {onTerminal && (
            <button type="button" className="nx-gw-icon-btn nx-gw-sq" aria-label="Terminal" title={`Open a terminal in ${tree.path}`} onClick={terminal}>
              <Icon name="terminal" size={14} />
            </button>
          )}
          <button type="button" className="nx-gw-icon-btn nx-gw-sq" aria-label="Editor" title="Open a file in the editor (Ctrl+P)" onClick={onEditor}>
            <Icon name="edit" size={14} />
          </button>
          {terminalError && <span role="alert" className="nx-gw-dhead-error">{terminalError}</span>}
        </div>
      </div>
      {onPanel && (
        <div className="nx-gw-tabs">
          <PanelSwitch panel={panel} onPanel={onPanel} count={changeCount} />
          <span className="nx-gw-tabs-end">
            <button type="button" className="nx-gw-goto" title="Ctrl+P" onClick={onGoTo}>Go to file<span className="kbd">Ctrl P</span></button>
          </span>
        </div>
      )}
    </div>
  )
}
