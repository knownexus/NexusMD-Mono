import React from 'react'
import { fileReview, changePaths } from '@nexusmd/core'

const METHOD = { stage: 'stage', unstage: 'unstage', discard: 'discard', delete: 'deleteUntracked' }
const repoOf = tree => ({ name: tree.repo, path: tree.repoRoot })

/** An error's message without Electron's "Error invoking remote method 'git:…': Error: " prefix. */
export function ipcMessage(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '')
}

// Reviews and runs file writes. One write per worktree at a time here (main also locks per repo),
// so a double click can never run a write twice. The last result is kept per worktree.
// Every write ends with a quiet snapshot reload that can't be skipped by a poll already running.
export function useGitActions({ adapter, registered, reload }) {
  const [review, setReview] = React.useState(null)
  const [busy, setBusy] = React.useState({})
  const [status, setStatus] = React.useState({})
  const running = React.useRef(new Set())
  const reviews = React.useRef(0)

  // `after` runs before busy clears, so a hunk's diff is already reloading when its buttons re-enable.
  const guard = async (tree, write, after) => {
    if (running.current.has(tree.path)) return
    running.current.add(tree.path)
    setBusy(b => ({ ...b, [tree.path]: true }))
    let r
    try { r = await write() } catch (e) { r = { ok: false, detail: ipcMessage(e) } }
    after?.()
    running.current.delete(tree.path)
    setBusy(b => { const next = { ...b }; delete next[tree.path]; return next })
    setStatus(s => ({ ...s, [tree.path]: { ok: !!r.ok, text: r.detail } }))
    reload()
  }

  const openReview = (action, tree, selectedIds) => {
    const r = fileReview(action, tree.changes, selectedIds)
    if (!r.files.length) return
    const id = ++reviews.current
    setReview({ id, tree, review: r, stamp: null, error: null })
    adapter.stamp(repoOf(tree), tree.path, registered, { kind: 'files', paths: r.paths }).then(
      stamp => setReview(cur => (cur?.id === id ? { ...cur, stamp } : cur)),
      e => setReview(cur => (cur?.id === id ? { ...cur, error: ipcMessage(e) } : cur)),
    )
  }

  const confirm = () => {
    const cur = review
    if (!cur?.stamp) return
    setReview(null)
    guard(cur.tree, () => adapter[METHOD[cur.review.action]](repoOf(cur.tree), cur.tree.path, registered, cur.review.paths, cur.stamp))
  }

  const hunk = (tree, change, index, stamp, after) => guard(tree, () =>
    adapter[change.area === 'staged' ? 'unstageHunk' : 'stageHunk'](repoOf(tree), tree.path, registered, changePaths(change), index, stamp), after)

  // Take one side of a conflicted file whole. The stamp is read here, so a file changed since is refused (stale).
  const resolve = (tree, change, take, onResolved) => guard(tree, async () => {
    const repo = repoOf(tree)
    const expected = await adapter.stamp(repo, tree.path, registered, { kind: 'files', paths: [change.path] })
    const r = await adapter.resolveConflict(repo, tree.path, registered, change.path, { take }, expected)
    if (r.ok) onResolved?.()
    return r.ok ? r : { ok: false, detail: r.detail || (r.stale ? `${change.path} changed since it was listed. Refresh and try again.` : `Could not resolve ${change.path}.`) }
  })

  return { review, openReview, closeReview: () => setReview(null), confirm, hunk, resolve, busy, status }
}
