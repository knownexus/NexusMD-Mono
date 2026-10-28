import React from 'react'
import { applyStatus } from '@nexusmd/core'

// One worktree's status, for a pop-out window: a single `git status`, where the full snapshot reads
// every worktree of the repo and its branches (a second or more for a repo with several worktrees).
// Polls while the window is visible, skipping a poll while a read runs; only the newest read is kept.
// `reload()` after a write queues one read after a running one, so it never shows status from before
// the write. `reads` counts the reads shown so far.
export function useWorktreeStatus({ adapter, repo, worktree, registered, enabled = true, intervalMs = 5000 }) {
  const [state, setState] = React.useState({ tree: null, error: null, takenAt: null, reads: 0 })
  const live = React.useRef(true)
  const seq = React.useRef(0)
  const inFlight = React.useRef(0)
  const queued = React.useRef(null)
  const latest = React.useRef(null)
  const key = JSON.stringify({ repo: { name: repo.name, path: repo.path }, worktree, registered })
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const load = React.useCallback(async (skipIfBusy = false) => {
    if (!enabled) return
    if (skipIfBusy && inFlight.current > 0) return
    const id = ++seq.current
    inFlight.current++
    const current = () => live.current && id === seq.current
    try {
      const r = JSON.parse(key)
      const s = await adapter.status(r.repo, r.worktree, r.registered, { untracked: 'all' })
      const tree = applyStatus({ repo: r.repo.name, path: r.worktree, changes: [] }, s)
      if (current()) setState(p => ({ tree, error: null, takenAt: new Date().toISOString(), reads: p.reads + 1 }))
    } catch (e) {
      if (current()) setState(p => ({ ...p, error: e?.message || 'Could not read the worktree' }))
    } finally {
      inFlight.current--
      if (!inFlight.current && queued.current) {
        const q = queued.current
        queued.current = null
        latest.current().then(q.resolve, q.resolve)
      }
    }
  }, [adapter, key, enabled])
  latest.current = load

  const reload = React.useCallback(() => {
    if (!inFlight.current) return load()
    if (!queued.current) {
      let resolve
      const promise = new Promise(r => { resolve = r })
      queued.current = { promise, resolve }
    }
    return queued.current.promise
  }, [load])

  React.useEffect(() => {
    load()
    if (!enabled || !intervalMs) return undefined
    const poll = () => { if (document.visibilityState === 'visible') load(true) }
    const id = setInterval(poll, intervalMs)
    document.addEventListener('visibilitychange', poll)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
      window.removeEventListener('focus', poll)
    }
  }, [load, enabled, intervalMs])

  return { ...state, reload }
}
