import React from 'react'
import { parseDiff, changePaths } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const EMPTY = { key: null, result: null, files: [], error: null, loading: false }

// Loads the focused change's diff on demand. A new snapshot (`version`) reloads it, because porcelain
// status can't tell whether an unstaged edit changed; the last diff stays on screen meanwhile.
// `reload()` reloads it at once (after a hunk write). Only the newest response is kept, and a
// response with the same text and stamp keeps the previous result and parsed files, so a large
// diff is neither re-parsed nor re-rendered line by line.
export function useDiff({ adapter, repo, worktreePath, registered, change, version }) {
  const [state, setState] = React.useState(EMPTY)
  const [nonce, setNonce] = React.useState(0)
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
      result => {
        if (!live || id !== seq.current) return
        setState(s => (s.key === key && s.result && s.result.text === result.text && s.result.stamp === result.stamp
          ? { ...s, loading: false }
          : { key, result, files: parseDiff(result.text).files, error: null, loading: false }))
      },
      e => { if (live && id === seq.current) setState({ ...EMPTY, key, error: ipcMessage(e) || 'Could not load the diff' }) },
    )
    return () => { live = false }
  }, [adapter, worktreePath, key, request, version, nonce])
  // Loading is set here, not only in the effect, so it lands in the same render as the write's
  // busy flag clearing and hunk buttons never come back live on the old diff.
  const reload = React.useCallback(() => {
    setState(s => (s.key ? { ...s, loading: true } : s))
    setNonce(n => n + 1)
  }, [])
  return React.useMemo(() => ({ ...state, reload }), [state, reload])
}
