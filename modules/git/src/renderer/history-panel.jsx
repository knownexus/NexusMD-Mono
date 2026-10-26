import React from 'react'
import { useHistory } from './use-history.js'
import { useCommit } from './use-commit.js'
import { HistoryPane } from './history-pane.jsx'
import { CommitDetail } from './commit-detail.jsx'
import { RebaseDialog } from './rebase-dialog.jsx'
import { buildEditItems, useCommitEdit } from './commit-edit-items.js'

const clamp = v => Math.min(0.8, Math.max(0.2, v))
const PREFETCH = 5

/**
 * History for one target (a worktree's HEAD, or a branch that isn't checked out): the commit list
 * left of the shared divider, the focused commit right of it. `upstream` names the branch's
 * upstream for the list's divider; `rebasing` says the worktree is mid-rebase. `own` (oids in
 * source..HEAD) and `source` (its short name) say where "Squash into previous" must stop.
 * A new `request` ({ oid?, sinceBase?, nonce }) filters since a base and/or focuses a commit.
 */
export function HistoryPanel({ adapter, repo, cwd, registered, target, split, onSplit, onAction = null, upstream = null, rebasing = false, own = null, source = null, request = null }) {
  const history = useHistory({ adapter, repo, cwd, registered, target })
  const [focusOid, setFocusOid] = React.useState(null)
  const [parentIndex, setParentIndex] = React.useState(0)
  const [focusedPath, setFocusedPath] = React.useState(null)
  // A parent jumped to may be older than the loaded page; it is shown on its own until focus moves.
  const [pinned, setPinned] = React.useState(false)
  const filesRef = React.useRef(null)
  const [rebase, setRebase] = React.useState(null)
  // Ctrl/Shift-click selection; empty means just the focused commit.
  const [selection, setSelection] = React.useState(() => new Set())
  const edit = useCommitEdit({ adapter, repo, cwd, registered, onAction })
  const box = React.useRef(null)
  const [dragging, setDragging] = React.useState(null)

  const commits = history.rows.filter(r => r.commit).map(r => r.commit)
  // Focus stays on the same commit across page reloads; with nothing focused, the top one is.
  const current = focusOid && (pinned || commits.some(c => c.oid === focusOid)) ? focusOid : (commits[0]?.oid ?? null)
  const at = commits.findIndex(c => c.oid === current)
  const nextOids = at >= 0 ? commits.slice(at + 1, at + 1 + PREFETCH).map(c => c.oid) : []
  const commit = useCommit({ adapter, repo, cwd, registered, oid: current, parentIndex, focusedPath, nextOids })
  const focus = (oid, pin = false, keepSelection = false) => {
    setFocusOid(oid); setPinned(pin); setParentIndex(0); setFocusedPath(null)
    if (!keepSelection) setSelection(new Set())
  }
  const selected = selection.size ? selection : new Set(current ? [current] : [])
  const select = (oid, { additive, range }) => {
    if (range) {
      const to = commits.findIndex(c => c.oid === oid)
      if (at < 0 || to < 0) return
      setSelection(new Set(commits.slice(Math.min(at, to), Math.max(at, to) + 1).map(c => c.oid)))
    } else if (additive) {
      const next = new Set(selected)
      if (next.delete(oid)) { setSelection(next); return }
      next.add(oid)
      setSelection(next)
      focus(oid, false, true)
    }
  }
  // A request from elsewhere (a commits strip) filters since a base and/or focuses a commit, once per nonce.
  const handled = React.useRef(null)
  React.useEffect(() => {
    if (!request || handled.current === request.nonce) return
    handled.current = request.nonce
    if (request.sinceBase) { history.setFilter('sinceBase'); history.setBase(request.sinceBase) }
    if (request.oid) focus(request.oid, true)
  }, [request]) // eslint-disable-line react-hooks/exhaustive-deps
  const jump = oid => focus(oid, !commits.some(c => c.oid === oid))

  // Commit actions only where history is a worktree's own HEAD: they act on that worktree.
  const unpushed = history.unpushed
  const canRebaseFrom = index => target.ref === 'HEAD' && !!unpushed && index >= 0 && commits[index].parents.length > 0 &&
    commits.slice(0, index + 1).every(c => unpushed.has(c.oid) && c.parents.length === 1)
  const revert = c => onAction('revert', { oid: c.oid, parents: c.parents.length, ...(c.parents.length > 1 ? { parent: 1 } : {}) })
  const focused = at >= 0 ? commits[at] : null
  // The detail panel's actions on the focused commit, after Copy hash.
  const detailActions = onAction && target.ref === 'HEAD' && focused ? [
    { label: 'Cherry-pick…', onSelect: () => onAction('cherryPick', { oid: focused.oid, parents: focused.parents.length, ...(focused.parents.length > 1 ? { parent: 1 } : {}) }) },
    { label: 'Revert…', onSelect: () => revert(focused) },
    {
      label: 'Reset to here…', danger: true, disabled: at === 0,
      title: at === 0 ? 'The branch is already at this commit' : 'Move this branch back to this commit',
      onSelect: () => onAction('reset', { oid: focused.oid, mode: 'mixed' }),
    },
  ] : []
  const commitMenu = onAction ? (c, index) => [
    { label: 'New branch here…', onSelect: () => onAction('branch', { start: c.oid, startLabel: `${c.oid.slice(0, 7)} ${c.subject}`, checkout: false }) },
    { label: 'Check out (detached)…', onSelect: () => onAction('checkout', { oid: c.oid }) },
    { label: 'Revert…', onSelect: () => revert(c) },
    ...(canRebaseFrom(index) ? [{
      label: 'Rebase from here…',
      onSelect: () => setRebase({ base: c.parents[0], commits: commits.slice(0, index + 1).reverse().map(x => ({ oid: x.oid, subject: x.subject })) }),
    }] : []),
    ...(target.ref === 'HEAD' ? buildEditItems({
      commits, index, unpushed, own, source, searching: !!history.search,
      selected: selected.has(c.oid) ? selected : new Set([c.oid]),
      onEdit: e => edit.start(e, commits),
    }) : []),
  ] : null

  const shownSplit = dragging ?? split
  const drag = e => {
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    let last = null
    const move = ev => { last = clamp((ev.clientX - rect.left) / rect.width); setDragging(last) }
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
    if (e.key === 'ArrowLeft') onSplit(clamp(split - 0.05))
    if (e.key === 'ArrowRight') onSplit(clamp(split + 0.05))
  }

  return (
    <div ref={box} className="nx-gw-history" style={{ gridTemplateColumns: `minmax(0, ${shownSplit}fr) 6px minmax(0, ${1 - shownSplit}fr)` }}>
      <HistoryPane history={history} focusOid={current} onFocus={oid => focus(oid)} onOpenFiles={() => filesRef.current?.focus()} commitMenu={commitMenu} selected={selected} onSelect={select}
        upstream={upstream} rebasing={rebasing} />
      <div role="separator" aria-orientation="vertical" aria-label="Resize history and commit" aria-valuenow={Math.round(shownSplit * 100)}
        tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'col-resize', background: 'linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat' }} />
      <CommitDetail commit={commit} oid={current} parentIndex={parentIndex} onParent={setParentIndex}
        focusedPath={focusedPath} onFile={setFocusedPath} onJump={jump} filesRef={filesRef} actions={detailActions} />
      {edit.dialog}
      {rebase && (
        <RebaseDialog commits={rebase.commits} base={rebase.base} onClose={() => setRebase(null)}
          onRun={options => { setRebase(null); onAction('rebaseInteractive', options) }} />
      )}
    </div>
  )
}
