import React from 'react'
import { parseDiff, changePaths } from '@nexusmd/core'

const EMPTY = { key: null, result: null, files: [], error: null, loading: false }

// Loads the focused change's diff on demand. A new snapshot (`version`) reloads it, because porcelain
// status can't tell whether an unstaged edit changed; the last diff stays on screen meanwhile.
// Only the newest response is kept.
export function useDiff({ adapter, repo, worktreePath, registered, change, version }) {
  const [state, setState] = React.useState(EMPTY)
  const seq = React.useRef(0)
  const key = change ? `${worktreePath}\0${change.id}` : null
  const request = change ? JSON.stringify({ repo: { name: repo.name, path: repo.path }, registered, change: { area: change.area, paths: changePaths(change) } }) : null
  React.useEffect(() => {
    const id = ++seq.current
    if (!request) { setState(EMPTY); return undefined }
    let live = true
    const r = JSON.parse(request)
    setState(s => (s.key === key ? { ...s, loading: true, error: null } : { ...EMPTY, key, loading: true }))
    adapter.diff(r.repo, worktreePath, r.registered, r.change).then(
      result => { if (live && id === seq.current) setState({ key, result, files: parseDiff(result.text).files, error: null, loading: false }) },
      e => { if (live && id === seq.current) setState({ ...EMPTY, key, error: e?.message || 'Could not load the diff' }) },
    )
    return () => { live = false }
  }, [adapter, worktreePath, key, request, version])
  return state
}
