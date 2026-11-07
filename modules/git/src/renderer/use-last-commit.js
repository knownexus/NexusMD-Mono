import React from 'react'
import { parseLog, parseNameStatus, parseNumstat, historyQuery, HISTORY_STEP, rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('git', 'last-commit')

/**
 * The worktree's newest commit for the clean-tree panel: its subject, time, how many files it changed and
 * their line counts (null when those can't be read), and whether it is on the upstream. `commits` are the
 * commits read (newest first), which the message edit needs. Read again when the head or `version` changes.
 */
export function useLastCommit({ adapter, repo, cwd, registered, tree, version, enabled = true }) {
  const [read, setRead] = React.useState({ loading: enabled, commits: [], counts: null })
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const head = tree?.head ?? null
  React.useEffect(() => {
    if (!enabled) return undefined
    let live = true
    const c = JSON.parse(ctx)
    setRead(r => ({ ...r, loading: true }))
    ;(async () => {
      let commits = []
      let counts = null
      try {
        const r = await adapter.log(c.repo, c.cwd, c.registered, historyQuery({ ref: 'HEAD', limit: HISTORY_STEP }))
        commits = parseLog(r?.text).filter(row => row.commit).map(row => row.commit)
        if (commits[0]) {
          try {
            const f = await adapter.commitFiles(c.repo, c.cwd, c.registered, commits[0].oid, commits[0].parents[0] ?? null)
            if (f && !f.missing) {
              const list = parseNameStatus(f.files)
              const n = f.numstat != null ? parseNumstat(f.numstat) : null
              counts = { files: list.length, add: n ? list.reduce((t, e) => t + (n.get(e.path)?.added ?? 0), 0) : null, del: n ? list.reduce((t, e) => t + (n.get(e.path)?.removed ?? 0), 0) : null }
            }
          } catch (err) { ignore(log, "the last commit's file counts could not be read, so the panel shows it without them", err, 'warn'); counts = null }
        }
      } catch (err) { ignore(log, 'the last commit could not be read, so the panel says there are none', err, 'warn'); commits = [] }
      if (live) setRead({ loading: false, commits, counts })
    })()
    return () => { live = false }
  }, [adapter, ctx, head, version, enabled])
  const first = read.commits[0]
  const pushed = !!tree?.upstream && !tree.upstreamGone && !tree.ahead
  const commit = first
    ? { oid: first.oid, subject: first.subject, when: first.time, pushed, merge: first.parents.length > 1, files: read.counts?.files ?? null, add: read.counts?.add ?? null, del: read.counts?.del ?? null }
    : null
  return { loading: read.loading, commit, commits: read.commits }
}
