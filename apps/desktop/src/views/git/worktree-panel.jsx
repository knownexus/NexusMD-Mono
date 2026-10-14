import React from 'react'
import { WorktreeHeader } from './worktree-detail.jsx'
import { ChangesPane } from './changes-pane.jsx'

/** The selected worktree: where it is, then its changes. Task 9 adds the diff pane below. */
export function WorktreePanel({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy, status }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WorktreeHeader tree={tree} />
      <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
        onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
    </div>
  )
}
