import React from 'react'

const ACTIVE = ['starting', 'running']

// The profile folder's file list, reloaded when the config changes and when a run of the
// provider ends (devenv setup profile creates the files).
export function useProfileFiles({ adapter, config, runStatus }) {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  // Overlapping loads can resolve out of order; only the newest may write state.
  const load = React.useCallback(async () => {
    const seq = ++reqId.current
    const current = () => live.current && seq === reqId.current
    setLoading(true)
    try {
      const r = await adapter.listProfileFiles(config)
      if (current()) { setData(r); setError(null) }
    } catch (e) {
      if (current()) setError(e?.message || "Couldn't list the profile files")
    } finally {
      if (current()) setLoading(false)
    }
  }, [adapter, config])

  React.useEffect(() => { load() }, [load])

  const prev = React.useRef(runStatus)
  React.useEffect(() => {
    const was = prev.current
    prev.current = runStatus
    if (ACTIVE.includes(was) && !ACTIVE.includes(runStatus)) load()
  }, [runStatus, load])

  return {
    dir: data?.dir ?? null,
    exists: data?.exists === true,
    files: data?.files ?? [],
    truncated: data?.truncated === true,
    loaded: !!data,
    error,
    loading,
    refresh: load,
  }
}
