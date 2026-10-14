import React from 'react'
import { loadSnapshot } from '@nexusmd/core'

// The last snapshot outlives the screen, so coming back shows it at once while a quiet refresh
// runs. Nothing polls while the screen is closed. Keyed by the repo list, so a change starts fresh.
let cached = null

export function clearGitSnapshotCache() {
  cached = null
}

// Polls git status for every registered repo while the window is visible (devenv's query-hook
// pattern): a poll is skipped while one is still running, and only the newest result is kept.
export function useGitSnapshot({ adapter, repos, enabled = true, intervalMs = 10000 }) {
  const reposKey = JSON.stringify(repos || [])
  const [snapshot, setSnapshot] = React.useState(() => (cached?.key === reposKey ? cached.snapshot : null))
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  // A reload asked for while a load runs: { promise, resolve } for the one load queued after it.
  const queued = React.useRef(null)
  const hasSnapshot = React.useRef(snapshot != null)
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const load = React.useCallback(async (quiet, skipIfBusy = false) => {
    if (!enabled) return
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const next = await loadSnapshot(adapter, JSON.parse(reposKey))
      cached = { key: reposKey, snapshot: next }
      if (current()) { setSnapshot(next); setError(null); hasSnapshot.current = true }
    } catch (e) {
      if (current()) setError(e?.message || 'Could not read the repositories')
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
      if (!inFlight.current && queued.current) {
        const q = queued.current
        queued.current = null
        load(true).then(q.resolve, q.resolve)
      }
    }
  }, [adapter, reposKey, enabled])

  // A manual refresh while a load is running would only queue a duplicate poll.
  const refresh = React.useCallback(() => load(false, true), [load])

  // After a write: a running load may have read status before the write, so one quiet load is
  // queued after it (never more than one), or starts at once when nothing is running.
  const reload = React.useCallback(() => {
    if (!inFlight.current) return load(true)
    if (!queued.current) {
      let resolve
      const promise = new Promise(r => { resolve = r })
      queued.current = { promise, resolve }
    }
    return queued.current.promise
  }, [load])

  React.useEffect(() => {
    // With a cached snapshot on screen, the first refresh is quiet rather than a loading state.
    load(hasSnapshot.current)
    if (!enabled || !intervalMs) return undefined
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const poll = () => { if (visible()) load(true, true) }
    const id = setInterval(poll, intervalMs)
    document.addEventListener('visibilitychange', poll)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
      window.removeEventListener('focus', poll)
    }
  }, [load, enabled, intervalMs])

  return { snapshot, error, loading, refresh, reload }
}
