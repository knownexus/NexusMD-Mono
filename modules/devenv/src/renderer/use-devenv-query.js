import React from 'react'

const ACTIVE = ['starting', 'running']

// A read-only devenv query (devenv:query never takes the exclusive slot), reloaded when the
// provider's run finishes and, with intervalMs, polled while the document is visible.
export function useDevenvQuery({ adapter, config, argv, kind, normalise, runStatus, intervalMs = null }) {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  const argvKey = argv.join('\u0000')
  const normaliseRef = React.useRef(normalise)
  normaliseRef.current = normalise
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const name = `devenv ${argv.filter(a => a !== '--json').join(' ')}`
  // Overlapping refreshes can resolve out of order; only the newest request may write state.
  const load = React.useCallback(async (quiet, skipIfBusy = false) => {
    // docker ps can hang for the whole timeout; stacking polls behind it would only pile up processes.
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const r = await adapter.query(config, argvKey.split('\u0000'))
      const result = (r?.results || []).find(m => m.kind === kind)
      if (!current()) return
      if (result) { setData(normaliseRef.current(result)); setError(null) }
      else setError(`${name} returned nothing (exit ${r?.code}). ${r?.stderr || ''}`.trim())
    } catch (e) {
      if (current()) setError(e?.message || `${name} failed`)
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
    }
  }, [adapter, config, argvKey, kind, name])

  const refresh = React.useCallback(() => load(false), [load])

  React.useEffect(() => {
    load(false)
    if (!intervalMs) return undefined
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

  return { data, error, loading, refresh }
}
