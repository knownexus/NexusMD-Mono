import React from 'react'
import { WorktreeHeader } from './worktree-detail.jsx'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'

const clamp = v => Math.min(0.8, Math.max(0.2, v))

/** The selected worktree: where it is, its changes, and the focused file's diff below a divider. */
export function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onHunk,
  busy, status, split, onSplit,
}) {
  const change = tree.changes.find(c => c.id === focusId) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change, version })
  const box = React.useRef(null)
  const drag = e => {
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    const move = ev => onSplit(clamp((ev.clientY - rect.top) / rect.height))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
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
      <WorktreeHeader tree={tree} />
      <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${split}fr) 6px minmax(0, ${1 - split}fr)`, height: '70vh', minHeight: 320 }}>
        <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
          onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
        <div role="separator" aria-orientation="horizontal" aria-label="Resize changes and diff" aria-valuenow={Math.round(split * 100)}
          tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)' }} />
        <DiffPane change={change} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(change, index, stamp)} />
      </div>
    </div>
  )
}
