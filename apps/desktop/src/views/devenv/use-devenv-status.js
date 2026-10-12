import React from 'react'
import { normaliseStatus } from '@nexusmd/core'

const ACTIVE = ['starting', 'running']

// Status comes from devenv:query, which never waits for the exclusive slot, so it keeps
// refreshing while start/stop run; it refreshes again the moment a run finishes.
export function useDevenvStatus({ adapter, config, runStatus, intervalMs = 10000 }) {
  const [status, setStatus] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  // Overlapping refreshes can resolve out of order; only the newest request may write state.
  const load = React.useCallback(async (quiet, skipIfBusy = false) => {
    // docker ps can hang for the whole timeout; stacking polls behind it would only pile up processes.
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const r = await adapter.query(config, ['status', '--json'])
      const result = (r?.results || []).find(m => m.kind === 'status')
      if (!current()) return
      if (result) { setStatus(normaliseStatus(result)); setError(null) }
      else setError(`devenv status returned nothing (exit ${r?.code}). ${r?.stderr || ''}`.trim())
    } catch (e) {
      if (current()) setError(e?.message || 'devenv status failed')
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
    }
  }, [adapter, config])

  const refresh = React.useCallback(() => load(false), [load])

  React.useEffect(() => {
    load(false)
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const id = setInterval(() => { if (visible()) load(true, true) }, intervalMs)
    // Timers are throttled while hidden, so the view can be stale the moment it comes back.
    const onVisible = () => { if (visible()) load(true, true) }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, intervalMs])

  const prev = React.useRef(runStatus)
  React.useEffect(() => {
    if (ACTIVE.includes(prev.current) && !ACTIVE.includes(runStatus)) load(true)
    prev.current = runStatus
  }, [runStatus, load])

  return { status, error, loading, refresh }
}
