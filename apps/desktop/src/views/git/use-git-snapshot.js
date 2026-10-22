import React from 'react'
import { loadSnapshot, refreshRepos, worktreeId } from '@nexusmd/core'
import { getProfileKey } from '../../profile-keys.js'

// The last snapshot outlives the screen and the app: coming back, or starting NexusMD, shows it at
// once while a quiet refresh runs (each git process costs about half a second on Windows, so a full
// read takes seconds). Nothing polls while the screen is closed. Keyed by the repo list, so a change
// starts fresh. Kept in this profile's storage, unless it's too big to be worth it.
let cached = null
const STORE = () => getProfileKey('git.snapshot')
const STORE_MAX = 2 * 1024 * 1024

function stored(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE()) || 'null')
    return saved?.key === key && saved.snapshot?.takenAt ? saved.snapshot : null
  } catch {
    return null
  }
}

function remember(key, snapshot) {
  cached = { key, snapshot }
  try {
    const text = JSON.stringify(cached)
    if (text.length <= STORE_MAX) localStorage.setItem(STORE(), text)
    else localStorage.removeItem(STORE())
  } catch { /* storage full or unavailable: the in-memory copy still serves this session */ }
}

export function clearGitSnapshotCache() {
  cached = null
  try { localStorage.removeItem(STORE()) } catch { /* nothing kept */ }
}

// Polls git status for every registered repo while the window is visible (devenv's query-hook
// pattern): a poll is skipped while one is still running, and only the newest result is kept.
// `full`: the id of the worktree on screen. Its untracked files are listed one by one; every other
// worktree reads them collapsed, which keeps a poll fast when a repo has tens of thousands.
export function useGitSnapshot({ adapter, repos, enabled = true, intervalMs = 10000, full = null }) {
  const fullRef = React.useRef(full)
  fullRef.current = full
  const reposKey = JSON.stringify(repos || [])
  const [snapshot, setSnapshot] = React.useState(() => (cached?.key === reposKey ? cached.snapshot : stored(reposKey)))
  // True while the snapshot on screen is one kept from an earlier visit or run, not read just now.
  const [stale, setStale] = React.useState(() => snapshot != null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  // A reload asked for while a load runs: { promise, resolve } for the one load queued after it.
  const queued = React.useRef(null)
  const hasSnapshot = React.useRef(snapshot != null)
  // The newest loader: a load queued during an older one must read the current repo list.
  const latestLoad = React.useRef(null)
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  // `only`: names of the repos to read again, keeping the rest of the snapshot on screen as it is.
  const load = React.useCallback(async (quiet, skipIfBusy = false, only = null) => {
    if (!enabled) return
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const repos = JSON.parse(reposKey)
      const base = only?.length && cached?.key === reposKey ? cached.snapshot : null
      const fullFor = fullRef.current ? [fullRef.current] : []
      const next = base ? await refreshRepos(adapter, repos, base, only, { fullFor }) : await loadSnapshot(adapter, repos, { fullFor })
      remember(reposKey, next)
      // Only a full read makes a kept snapshot current again.
      if (current()) { setSnapshot(next); if (!base) setStale(false); setError(null); hasSnapshot.current = true }
    } catch (e) {
      if (current()) setError(e?.message || 'Could not read the repositories')
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
      if (!inFlight.current && queued.current) {
        const q = queued.current
        queued.current = null
        latestLoad.current(true).then(q.resolve, q.resolve)
      }
    }
  }, [adapter, reposKey, enabled])
  latestLoad.current = load

  // A manual refresh while a load is running would only queue a duplicate poll.
  const refresh = React.useCallback(() => load(false, true), [load])

  // After a write: a running load may have read status before the write, so one quiet load is
  // queued after it (never more than one), or starts at once when nothing is running. Given the
  // names of the repos written to, only those are read again (a queued load reads them all).
  const reload = React.useCallback((only = null) => {
    if (!inFlight.current) return load(true, false, Array.isArray(only) ? only : null)
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

  // Opening a worktree that was read collapsed reads it in full, quietly, without waiting for the next poll.
  const shown = full && snapshot?.worktrees.find(t => worktreeId(t) === full)
  const needsFull = !!shown && !shown.untrackedFull && !shown.error
  React.useEffect(() => { if (needsFull) latestLoad.current(true, false, [shown.repo]) }, [needsFull, full]) // eslint-disable-line react-hooks/exhaustive-deps

  return { snapshot, stale, error, loading, refresh, reload }
}
