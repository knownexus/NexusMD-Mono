import React from 'react'
import { useHistory } from './use-history.js'
import { useCommit } from './use-commit.js'
import { HistoryPane } from './history-pane.jsx'
import { CommitDetail } from './commit-detail.jsx'

const clamp = v => Math.min(0.8, Math.max(0.2, v))
const PREFETCH = 5

/**
 * History for one target (a worktree's HEAD, or a branch that isn't checked out): the commit list
 * above the shared divider, the focused commit below it.
 */
export function HistoryPanel({ adapter, repo, cwd, registered, target, split, onSplit }) {
  const history = useHistory({ adapter, repo, cwd, registered, target })
  const [focusOid, setFocusOid] = React.useState(null)
  const [parentIndex, setParentIndex] = React.useState(0)
  const [focusedPath, setFocusedPath] = React.useState(null)
  // A parent jumped to may be older than the loaded page; it is shown on its own until focus moves.
  const [pinned, setPinned] = React.useState(false)
  const filesRef = React.useRef(null)
  const box = React.useRef(null)
  const [dragging, setDragging] = React.useState(null)

  const commits = history.rows.filter(r => r.commit).map(r => r.commit)
  // Focus stays on the same commit across page reloads; with nothing focused, the top one is.
  const current = focusOid && (pinned || commits.some(c => c.oid === focusOid)) ? focusOid : (commits[0]?.oid ?? null)
  const at = commits.findIndex(c => c.oid === current)
  const nextOids = at >= 0 ? commits.slice(at + 1, at + 1 + PREFETCH).map(c => c.oid) : []
  const commit = useCommit({ adapter, repo, cwd, registered, oid: current, parentIndex, focusedPath, nextOids })
  const focus = (oid, pin = false) => { setFocusOid(oid); setPinned(pin); setParentIndex(0); setFocusedPath(null) }
  const jump = oid => focus(oid, !commits.some(c => c.oid === oid))

  const shownSplit = dragging ?? split
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
    <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${shownSplit}fr) 6px minmax(0, ${1 - shownSplit}fr)`, height: '70vh', minHeight: 320 }}>
      <HistoryPane history={history} focusOid={current} onFocus={oid => focus(oid)} onOpenFiles={() => filesRef.current?.focus()} />
      <div role="separator" aria-orientation="horizontal" aria-label="Resize history and commit" aria-valuenow={Math.round(shownSplit * 100)}
        tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)' }} />
      <CommitDetail commit={commit} oid={current} parentIndex={parentIndex} onParent={setParentIndex}
        focusedPath={focusedPath} onFile={setFocusedPath} onJump={jump} filesRef={filesRef} />
    </div>
  )
}
