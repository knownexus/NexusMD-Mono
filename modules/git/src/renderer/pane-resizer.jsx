import React from 'react'
import { LIST_WIDTH, clampListWidth, getGitConfig, setGitConfig } from './git-config.js'
import { useGitConfig } from './use-git-config.js'

export const FILES_WIDTH = 320
export const EXPLORER_WIDTH = 300

/**
 * A pane's saved width in pixels (a key of the view state: filesWidth, explorerWidth…) and the one
 * being dragged now, so the page can follow the pointer and keep only the width it is let go at.
 */
export function usePaneWidth(key, fallback) {
  const config = useGitConfig()
  const [dragged, setDragged] = React.useState(null)
  const save = width => setGitConfig({ view: { ...getGitConfig().view, [key]: width } })
  return { width: dragged ?? config.view[key] ?? fallback, onDrag: setDragged, onDone: save }
}

// The divider between a pane and the one beside it, as the branch list's (list-resizer.jsx): dragging
// it or the arrow keys set the pane's width, a double-click puts back `fallback`. `boxRef` is the
// grid holding both; widths are measured from its left edge.
export function PaneResizer({ label, width, fallback = LIST_WIDTH, boxRef, onDrag, onDone, className = 'nx-gw-list-resizer' }) {
  const drag = e => {
    if (e.button > 0) return   // right or middle button
    e.preventDefault()
    const left = boxRef.current?.getBoundingClientRect().left ?? 0
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
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={width} aria-valuemin={220} aria-valuemax={720}
      tabIndex={0} className={className} title="Drag to resize · double-click to reset"
      onPointerDown={drag} onKeyDown={nudge} onDoubleClick={() => onDone(fallback)} />
  )
}
