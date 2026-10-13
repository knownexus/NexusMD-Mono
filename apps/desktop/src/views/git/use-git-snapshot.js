import React from 'react'
import { loadSnapshot } from '@nexusmd/core'

// Polls git status for every registered repo while the window is visible (devenv's query-hook
// pattern): a poll is skipped while one is still running, and only the newest result is kept.
export function useGitSnapshot({ adapter, repos, enabled = true, intervalMs = 10000 }) {
  const [snapshot, setSnapshot] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  const reposKey = JSON.stringify(repos || [])
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
      if (current()) { setSnapshot(next); setError(null) }
    } catch (e) {
      if (current()) setError(e?.message || 'Could not read the repositories')
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
    }
  }, [adapter, reposKey, enabled])

  const refresh = React.useCallback(() => load(false), [load])

  React.useEffect(() => {
    load(false)
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

  return { snapshot, error, loading, refresh }
}
