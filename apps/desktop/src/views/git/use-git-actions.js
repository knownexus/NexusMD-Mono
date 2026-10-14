import React from 'react'
import { fileReview, changePaths } from '@nexusmd/core'

const METHOD = { stage: 'stage', unstage: 'unstage', discard: 'discard', delete: 'deleteUntracked' }
const repoOf = tree => ({ name: tree.repo, path: tree.repoRoot })
const message = e => e?.message || String(e)

// Reviews and runs file writes. One write per worktree at a time here (main also locks per repo),
// so a double click can never run a write twice. The last result is kept per worktree.
export function useGitActions({ adapter, registered, refresh }) {
  const [review, setReview] = React.useState(null)
  const [busy, setBusy] = React.useState({})
  const [status, setStatus] = React.useState({})
  const running = React.useRef(new Set())
  const reviews = React.useRef(0)

  const guard = async (tree, write) => {
    if (running.current.has(tree.path)) return
    running.current.add(tree.path)
    setBusy(b => ({ ...b, [tree.path]: true }))
    let r
    try { r = await write() } catch (e) { r = { ok: false, detail: message(e) } }
    running.current.delete(tree.path)
    setBusy(b => { const next = { ...b }; delete next[tree.path]; return next })
    setStatus(s => ({ ...s, [tree.path]: { ok: !!r.ok, text: r.detail } }))
    refresh()
  }

  const openReview = (action, tree, selectedIds) => {
    const r = fileReview(action, tree.changes, selectedIds)
    if (!r.files.length) return
    const id = ++reviews.current
    setReview({ id, tree, review: r, stamp: null, error: null })
    adapter.stamp(repoOf(tree), tree.path, registered, { kind: 'files', paths: r.paths }).then(
      stamp => setReview(cur => (cur?.id === id ? { ...cur, stamp } : cur)),
      e => setReview(cur => (cur?.id === id ? { ...cur, error: message(e) } : cur)),
    )
  }

  const confirm = () => {
    const cur = review
    if (!cur?.stamp) return
    setReview(null)
    guard(cur.tree, () => adapter[METHOD[cur.review.action]](repoOf(cur.tree), cur.tree.path, registered, cur.review.paths, cur.stamp))
  }

  const hunk = (tree, change, index, stamp) => guard(tree, () =>
    adapter[change.area === 'staged' ? 'unstageHunk' : 'stageHunk'](repoOf(tree), tree.path, registered, changePaths(change), index, stamp))

  return { review, openReview, closeReview: () => setReview(null), confirm, hunk, busy, status }
}
