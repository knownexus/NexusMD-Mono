import React from 'react'
import { LIST_WIDTH, clampListWidth } from './git-config.js'

// The divider between the branch list and the details beside it. Dragging it (or the arrow keys when
// it has focus) sets the list's width; a double-click puts back the default. While dragging, `onDrag`
// gets each width so the page can follow; `onDone` gets the one to keep.
export function ListResizer({ width, bodyRef, onDrag, onDone }) {
  const drag = e => {
    if (e.button > 0) return   // right or middle button
    e.preventDefault()
    const left = bodyRef.current?.getBoundingClientRect().left ?? 0
    let last = null
    const move = ev => { last = clampListWidth(ev.clientX - left); onDrag(last) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onDrag(null)
      if (last != null) onDone(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onDone(clampListWidth(width - 20)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); onDone(clampListWidth(width + 20)) }
  }
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize branch list" aria-valuenow={width}
      aria-valuemin={220} aria-valuemax={720} tabIndex={0} className="nx-gw-list-resizer" title="Drag to resize · double-click to reset"
      onPointerDown={drag} onKeyDown={nudge} onDoubleClick={() => onDone(LIST_WIDTH)} />
  )
}
