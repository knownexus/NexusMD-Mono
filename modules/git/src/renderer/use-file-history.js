import React from 'react'
import { parseLog, historyQuery, HISTORY_STEP } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const SHOWN = 3

/**
 * The newest commits that touched `path` on the worktree's HEAD ([{ oid, subject, when }], three of them), for
 * the Files panel. `commits` is null until read, [] for a file with no history (or when the log can't be read,
 * with `error` saying why). Nothing is read without a path or while `enabled` is false.
 */
export function useFileHistory({ adapter, repo, cwd, registered, path, version, enabled = true }) {
  const [state, setState] = React.useState({ key: null, commits: null, error: null })
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const key = path && enabled ? `${ctx}\0${path}\0${version}` : null
  React.useEffect(() => {
    if (!key) return undefined
    let live = true
    const c = JSON.parse(ctx)
    if (!adapter.log) { setState({ key, commits: [], error: null }); return undefined }
    adapter.log(c.repo, c.cwd, c.registered, historyQuery({ ref: 'HEAD', search: { kind: 'path', text: path }, limit: HISTORY_STEP })).then(
      r => {
        const commits = parseLog(r?.text).filter(row => row.commit).slice(0, SHOWN).map(row => ({ oid: row.commit.oid, subject: row.commit.subject, when: row.commit.time }))
        if (live) setState({ key, commits, error: null })
      },
      e => { if (live) setState({ key, commits: [], error: ipcMessage(e) || String(e) }) },
    )
    return () => { live = false }
  }, [adapter, ctx, path, key])
  // A result for another file (or an earlier snapshot) is not this one's.
  return state.key === key && key ? { commits: state.commits, error: state.error } : { commits: null, error: null }
}
