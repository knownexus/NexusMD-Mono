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
  React.useEffect(() => () => { live.current = false }, [])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await adapter.query(config, ['status', '--json'])
      const result = (r?.results || []).find(m => m.kind === 'status')
      if (!live.current) return
      if (result) { setStatus(normaliseStatus(result)); setError(null) }
      else setError(`devenv status returned nothing (exit ${r?.code}). ${r?.stderr || ''}`.trim())
    } catch (e) {
      if (live.current) setError(e?.message || 'devenv status failed')
    } finally {
      if (live.current) setLoading(false)
    }
  }, [adapter, config])

  React.useEffect(() => {
    refresh()
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  const prev = React.useRef(runStatus)
  React.useEffect(() => {
    if (ACTIVE.includes(prev.current) && !ACTIVE.includes(runStatus)) refresh()
    prev.current = runStatus
  }, [runStatus, refresh])

  return { status, error, loading, refresh }
}
