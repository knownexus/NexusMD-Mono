import React from 'react'
import { parseLog, parseRefList, parseSearch, historyQuery, defaultBase, HISTORY_STEP, HISTORY_MAX } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'
import { historyCache } from './history-cache.js'

export const GONE_REF = 'That branch no longer exists.'

/**
 * One History view's data: the repo's refs, the query built from the toolbar, and the current page.
 * `target.head` is the tip the snapshot reports; a page read at another tip is re-read, and the old
 * rows stay on screen until the new page arrives.
 * @param {{ adapter: object, repo: { name: string, path: string }, cwd: string, registered: string[],
 *   target: { ref: string, head?: string|null }, cache?: object }} p
 */
export function useHistory({ adapter, repo, cwd, registered, target, cache = historyCache }) {
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const [refsInfo, setRefsInfo] = React.useState(null)
  const [refsNonce, setRefsNonce] = React.useState(0)
  const [filter, setFilterState] = React.useState('all')
  const [chosenBase, setChosenBase] = React.useState(null)
  const [search, setSearchState] = React.useState(null)
  const [searchError, setSearchError] = React.useState(null)
  const [limit, setLimit] = React.useState(HISTORY_STEP)
  const [page, setPage] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [nonce, setNonce] = React.useState(0)
  const seq = React.useRef(0)
  const forced = React.useRef(0)

  React.useEffect(() => {
    let live = true
    const c = JSON.parse(ctx)
    adapter.refs(c.repo, c.cwd, c.registered).then(
      r => { if (live) setRefsInfo({ list: parseRefList(r.refs), originHead: r.originHead, shallow: !!r.shallow }) },
      e => { if (live) { setRefsInfo({ list: [], originHead: null, shallow: false }); setError(ipcMessage(e)) } },
    )
    return () => { live = false }
  }, [adapter, ctx, refsNonce])

  // Another worktree or branch starts from the first page with its own rows.
  React.useEffect(() => { setLimit(HISTORY_STEP); setPage(null); setError(null) }, [ctx, target.ref])

  const base = chosenBase ?? (refsInfo ? defaultBase(refsInfo.list, { ref: target.ref, originHead: refsInfo.originHead }) : null)
  const needsBase = filter === 'sinceBase' && !base
  let query = null
  if (!needsBase) {
    try { query = historyQuery({ ref: target.ref, filter, base, search, limit }) } catch { query = null }
  }
  const queryKey = query ? JSON.stringify(query) : null
  const head = target.head ?? null
  // Re-reading the refs (after a branch went away) must not re-run the log by itself, or a gone
  // branch would loop: the log only waits for the first refs read.
  const refsLoaded = !!refsInfo

  React.useEffect(() => {
    if (!queryKey || !refsLoaded) return undefined
    const id = ++seq.current
    let live = true
    const c = JSON.parse(ctx)
    const pageKey = `${c.repo.path}\0${c.cwd}\0${queryKey}`
    const force = forced.current !== nonce
    forced.current = nonce
    const cached = cache.pages.get(pageKey)
    if (cached && !force && (head == null || cached.tip === head)) {
      setPage(cached)
      setError(null)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    cache.queue.run(`log\0${pageKey}\0${head}\0${nonce}`, () => adapter.log(c.repo, c.cwd, c.registered, JSON.parse(queryKey)), { tag: 'log' }).then(
      r => {
        const p = {
          key: pageKey, rows: parseLog(r.text), tip: r.tip, truncated: !!r.truncated, limit: r.limit,
          unpushed: Array.isArray(r.unpushed) ? new Set(r.unpushed) : null,
        }
        cache.pages.set(pageKey, p)
        if (!live || id !== seq.current) return
        setPage(p)
        setError(null)
        setLoading(false)
      },
      e => {
        if (e?.cancelled || !live || id !== seq.current) return
        const message = ipcMessage(e)
        setLoading(false)
        setError(message)
        if (message === GONE_REF) setRefsNonce(n => n + 1)
      },
    )
    return () => { live = false }
  }, [adapter, cache, ctx, queryKey, refsLoaded, head, nonce])

  const setFilter = React.useCallback(f => { setFilterState(f); setLimit(HISTORY_STEP) }, [])
  const setBase = React.useCallback(b => { setChosenBase(b); setLimit(HISTORY_STEP) }, [])
  const setSearch = React.useCallback(input => {
    try {
      setSearchState(parseSearch(input))
      setSearchError(null)
      setLimit(HISTORY_STEP)
      return true
    } catch (e) {
      setSearchError(e.message)
      return false
    }
  }, [])
  const loadMore = React.useCallback(() => setLimit(l => Math.min(HISTORY_MAX, l + HISTORY_STEP)), [])
  const refresh = React.useCallback(() => { setRefsNonce(n => n + 1); setNonce(n => n + 1) }, [])

  return {
    refs: refsInfo?.list ?? [], refsLoaded: !!refsInfo, originHead: refsInfo?.originHead ?? null, shallow: !!refsInfo?.shallow,
    filter, setFilter, base, setBase, needsBase, search, setSearch, searchError, limit, loadMore,
    rows: page?.rows ?? [], unpushed: page?.unpushed ?? null, tip: page?.tip ?? null, truncated: !!page?.truncated,
    loaded: !!page, loading, error, refresh,
  }
}
