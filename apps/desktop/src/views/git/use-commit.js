import React from 'react'
import { parseCommitDetails, parseNameStatus, parseDiff } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'
import { historyCache } from './history-cache.js'

export const MISSING_COMMIT = 'This commit no longer exists - refresh.'
const PREFETCH = 5
const MISSING = Object.freeze({ missing: true })

/**
 * The focused commit: its details, its files against the chosen parent, and the focused file's
 * diff. After the focused commit is in, the next few commits' details and files are fetched in
 * the background. Moving focus drops any request still queued, so scrolling fast never builds a
 * backlog behind the status polls.
 * @param {{ adapter: object, repo: object, cwd: string, registered: string[], oid: string|null,
 *   parentIndex?: number, file?: { path: string, oldPath?: string|null }|null, nextOids?: string[], cache?: object }} p
 */
export function useCommit({ adapter, repo, cwd, registered, oid, parentIndex = 0, file = null, nextOids = [], cache = historyCache }) {
  const ctx = JSON.stringify({ repo: { name: repo.name, path: repo.path }, cwd, registered })
  const base = `${repo.path}\0${cwd}`
  const [details, setDetails] = React.useState(null)
  const [files, setFiles] = React.useState(null)
  const [diff, setDiff] = React.useState(null)
  const [missing, setMissing] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)

  const loaders = React.useMemo(() => {
    const c = JSON.parse(ctx)
    const forget = o => {
      cache.details.delete(`${base}\0details\0${o}`)
    }
    const details = (o, priority) => {
      const k = `${base}\0details\0${o}`
      const hit = cache.details.get(k)
      if (hit) return Promise.resolve(hit)
      return cache.queue.run(k, async () => {
        const r = await adapter.commitDetails(c.repo, c.cwd, c.registered, o)
        if (r?.missing) { forget(o); return MISSING }
        const d = parseCommitDetails(r.details)
        cache.details.set(k, d)
        return d
      }, { priority, tag: 'commit' })
    }
    const fileList = (o, parent, priority) => {
      const k = `${base}\0files\0${o}\0${parent}`
      const hit = cache.files.get(k)
      if (hit) return Promise.resolve(hit)
      return cache.queue.run(k, async () => {
        const r = await adapter.commitFiles(c.repo, c.cwd, c.registered, o, parent)
        if (r?.missing) return MISSING
        const list = parseNameStatus(r.files)
        cache.files.set(k, list)
        return list
      }, { priority, tag: 'commit' })
    }
    const fileDiff = (o, parent, paths) => {
      const k = `${base}\0diff\0${o}\0${parent}\0${paths.join('\0')}`
      const hit = cache.diffs.get(k)
      if (hit) return Promise.resolve(hit)
      return cache.queue.run(k, async () => {
        const r = await adapter.commitDiff(c.repo, c.cwd, c.registered, o, parent, paths)
        if (r?.missing) return MISSING
        const value = { result: r, files: parseDiff(r.text).files }
        cache.diffs.set(k, value)
        return value
      }, { tag: 'diff' })
    }
    return { details, fileList, fileDiff }
  }, [adapter, cache, ctx, base])

  // Details, then files for the chosen parent.
  React.useEffect(() => {
    setDetails(null); setFiles(null); setDiff(null); setMissing(false); setError(null)
    if (!oid) { setLoading(false); return undefined }
    // Requests for commits the user has moved past are dropped before they start.
    cache.queue.cancel(j => j.tag === 'commit' || j.tag === 'diff')
    let live = true
    setLoading(true)
    loaders.details(oid, 'focus').then(
      d => {
        if (!live) return
        if (d === MISSING) { setMissing(true); setLoading(false); return }
        setDetails(d)
      },
      e => { if (live && !e?.cancelled) { setError(ipcMessage(e)); setLoading(false) } },
    )
    return () => { live = false }
  }, [oid, loaders, cache])

  const parent = details ? (details.parents[parentIndex] ?? details.parents[0] ?? null) : undefined
  React.useEffect(() => {
    if (!oid || parent === undefined) return undefined
    let live = true
    setFiles(null)
    loaders.fileList(oid, parent, 'focus').then(
      list => {
        if (!live) return
        if (list === MISSING) setMissing(true)
        else setFiles(list)
        setLoading(false)
      },
      e => { if (live && !e?.cancelled) { setError(ipcMessage(e)); setLoading(false) } },
    )
    return () => { live = false }
  }, [oid, parent, loaders])

  const filePaths = file ? [file.path, ...(file.oldPath ? [file.oldPath] : [])] : null
  const fileKey = filePaths ? filePaths.join('\0') : null
  React.useEffect(() => {
    setDiff(null)
    if (!oid || parent === undefined || !fileKey) return undefined
    let live = true
    setDiff({ loading: true, result: null, files: [], error: null })
    loaders.fileDiff(oid, parent, fileKey.split('\0')).then(
      v => {
        if (!live) return
        if (v === MISSING) { setMissing(true); setDiff(null); return }
        setDiff({ loading: false, result: v.result, files: v.files, error: null })
      },
      e => { if (live && !e?.cancelled) setDiff({ loading: false, result: null, files: [], error: ipcMessage(e) }) },
    )
    return () => { live = false }
  }, [oid, parent, fileKey, loaders])

  // Background: the next commits' details and first-parent files, once the focused one is in.
  const nextKey = nextOids.slice(0, PREFETCH).join(',')
  React.useEffect(() => {
    if (!files || !nextKey) return
    for (const o of nextKey.split(',')) {
      loaders.details(o, 'prefetch')
        .then(d => (d === MISSING ? null : loaders.fileList(o, d.parents[0] ?? null, 'prefetch')))
        .catch(() => {})
    }
  }, [files, nextKey, loaders])

  return { details, parent: parent ?? null, files, diff, missing, error, loading }
}
