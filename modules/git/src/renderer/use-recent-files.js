import React from 'react'

// The files opened in each worktree this session (newest first, three of them), kept while the app runs.
const store = new Map()
const SHOWN = 3

/** Forgets every worktree's recent files. */
export function forgetRecentFiles() { store.clear() }

/** The worktree's recent files ([{ path, openedAt }]) and touch(path), which records a file as opened now. */
export function useRecentFiles(key) {
  const [, redraw] = React.useReducer(n => n + 1, 0)
  const touch = React.useCallback(path => {
    const rest = (store.get(key) ?? []).filter(r => r.path !== path)
    store.set(key, [{ path, openedAt: Date.now() }, ...rest].slice(0, SHOWN))
    redraw()
  }, [key])
  return { recent: store.get(key) ?? [], touch }
}
