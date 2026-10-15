import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { createLru, createQueue, createHistoryCache } from './history-cache.js'
import { useHistory, GONE_REF } from './use-history.js'
import { useCommit, MISSING_COMMIT } from './use-commit.js'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const oid = n => String(n).padStart(40, '0')
const rec = (n, subject = `c${n}`, parents = '') => `* \x1e${oid(n)}\x1f${parents}\x1fAna\x1fa@b\x1f1\x1f\x1f${subject}`
const REFS = 'refs/heads/main\0aaa\0refs/remotes/origin/main\0*\nrefs/remotes/origin/main\0bbb\0\0 \n'
const details = (o, parents = [oid(99)]) => [o, parents.join(' '), 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', 'msg'].join('\0')

function historyAdapter(over = {}) {
  return {
    refs: vi.fn(async () => ({ refs: REFS, originHead: null, shallow: false })),
    log: vi.fn(async (_r, _c, _g, q) => ({ text: [rec(1), rec(2)].join('\n') + '\n', tip: 'T1', unpushed: [oid(1)], truncated: q.limit < 400, limit: q.limit })),
    ...over,
  }
}

describe('createLru', () => {
  it('evicts the least recently used entry', () => {
    const l = createLru(2)
    l.set('a', 1); l.set('b', 2); l.get('a'); l.set('c', 3)
    expect([l.has('a'), l.has('b'), l.has('c')]).toEqual([true, false, true])
  })
})

describe('createQueue', () => {
  it('runs at most two at once and shares a key', async () => {
    const q = createQueue(2)
    const gates = [deferred(), deferred(), deferred()]
    let running = 0
    let peak = 0
    const job = i => () => { running++; peak = Math.max(peak, running); return gates[i].promise.finally(() => { running-- }) }
    const a = q.run('a', job(0))
    const a2 = q.run('a', job(0))
    q.run('b', job(1)); q.run('c', job(2))
    expect(a2).toBe(a)
    await Promise.resolve(); await Promise.resolve()
    expect(q.running).toBe(2)
    expect(q.queued).toBe(1)
    gates.forEach(g => g.resolve())
    await a
    await vi.waitFor(() => expect(q.running).toBe(0))
    expect(peak).toBe(2)
  })
  it('starts focus jobs before prefetches and cancels only queued jobs', async () => {
    const q = createQueue(1)
    const order = []
    const hold = deferred()
    q.run('busy', () => hold.promise)
    const pre = q.run('pre', async () => { order.push('pre') }, { priority: 'prefetch', tag: 'commit' })
    q.run('focus', async () => { order.push('focus') })
    const dropped = q.run('drop', async () => { order.push('drop') }, { priority: 'prefetch', tag: 'commit' })
    q.cancel(j => j.key === 'drop')
    await expect(dropped).rejects.toMatchObject({ cancelled: true })
    hold.resolve()
    await pre
    expect(order).toEqual(['focus', 'pre'])
  })
})

describe('useHistory', () => {
  const render = (adapter, target = { ref: 'HEAD', head: 'T1' }, cache = createHistoryCache()) =>
    renderHook(p => useHistory({ adapter, repo, cwd: repo.path, registered, target: p.target, cache }), { initialProps: { target } })

  it('reads refs, then the first page, and marks unpushed commits', async () => {
    const adapter = historyAdapter()
    const { result } = render(adapter)
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(adapter.log).toHaveBeenCalledWith(repo, repo.path, registered, { ref: 'HEAD', filter: 'all', base: null, search: null, limit: 200 })
    expect(result.current.unpushed.has(oid(1))).toBe(true)
    // main is the checked-out branch and there's no origin/HEAD, so there is no default base.
    expect(result.current.base).toBeNull()
  })

  it('a bad search shows its message and runs nothing', async () => {
    const adapter = historyAdapter()
    const { result } = render(adapter)
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    act(() => { result.current.setSearch('@') })
    expect(result.current.searchError).toBe('Type a name after @')
    expect(adapter.log).toHaveBeenCalledTimes(1)
    act(() => { result.current.setSearch(':src/a.cs') })
    await waitFor(() => expect(adapter.log).toHaveBeenCalledTimes(2))
    expect(adapter.log.mock.calls[1][3].search).toEqual({ kind: 'path', text: 'src/a.cs' })
  })

  it('load more raises the limit by a page', async () => {
    const adapter = historyAdapter()
    const { result } = render(adapter)
    await waitFor(() => expect(result.current.truncated).toBe(true))
    act(() => result.current.loadMore())
    await waitFor(() => expect(adapter.log.mock.calls.at(-1)[3].limit).toBe(400))
  })

  it('does not re-read when the snapshot reports the same tip, and does when it moves (keeping old rows)', async () => {
    const next = deferred()
    let n = 0
    const adapter = historyAdapter({ log: vi.fn(() => (++n === 1 ? Promise.resolve({ text: rec(1) + '\n', tip: 'T1', unpushed: null, truncated: false, limit: 200 }) : next.promise)) })
    const { result, rerender } = render(adapter)
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    rerender({ target: { ref: 'HEAD', head: 'T1' } })
    expect(adapter.log).toHaveBeenCalledTimes(1)
    rerender({ target: { ref: 'HEAD', head: 'T2' } })
    await waitFor(() => expect(adapter.log).toHaveBeenCalledTimes(2))
    expect(result.current.rows).toHaveLength(1)
    await act(async () => next.resolve({ text: [rec(3), rec(1)].join('\n') + '\n', tip: 'T2', unpushed: null, truncated: false, limit: 200 }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
  })

  it('a branch that disappeared re-reads the refs and shows why', async () => {
    const adapter = historyAdapter({ log: vi.fn(async () => { throw new Error(`Error invoking remote method 'git:log': Error: ${GONE_REF}`) }) })
    const { result } = render(adapter, { ref: 'refs/heads/main', head: null })
    await waitFor(() => expect(result.current.error).toBe(GONE_REF))
    await waitFor(() => expect(adapter.refs).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 50))
    expect(adapter.log).toHaveBeenCalledTimes(1)
    expect(adapter.refs).toHaveBeenCalledTimes(2)
  })

  it('since base with no base waits for one to be picked', async () => {
    const adapter = historyAdapter({ refs: vi.fn(async () => ({ refs: 'refs/heads/feature\0a\0\0*\n', originHead: null, shallow: false })) })
    const { result } = render(adapter)
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    act(() => result.current.setFilter('sinceBase'))
    expect(result.current.needsBase).toBe(true)
    expect(adapter.log).toHaveBeenCalledTimes(1)
  })
})

describe('useCommit', () => {
  const commitAdapter = (over = {}) => ({
    commitDetails: vi.fn(async (_r, _c, _g, o) => ({ details: details(o, o === oid(1) ? [oid(98), oid(99)] : [oid(99)]) })),
    commitFiles: vi.fn(async () => ({ files: 'M\0f\0' })),
    commitDiff: vi.fn(async () => ({ text: 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n', truncated: false, binary: false, size: 40 })),
    ...over,
  })
  const render = (adapter, props, cache = createHistoryCache()) =>
    renderHook(p => useCommit({ adapter, repo, cwd: repo.path, registered, cache, ...p }), { initialProps: props })

  it('loads details, then files against the first parent, then a focused file\'s diff', async () => {
    const adapter = commitAdapter()
    const { result, rerender } = render(adapter, { oid: oid(1) })
    await waitFor(() => expect(result.current.files).toEqual([{ status: 'M', score: null, oldPath: null, path: 'f' }]))
    expect(adapter.commitFiles).toHaveBeenCalledWith(repo, repo.path, registered, oid(1), oid(98))
    rerender({ oid: oid(1), focusedPath: 'f' })
    await waitFor(() => expect(result.current.diff?.files?.[0]?.hunks).toHaveLength(1))
    rerender({ oid: oid(1), focusedPath: 'f', parentIndex: 1 })
    await waitFor(() => expect(adapter.commitFiles).toHaveBeenLastCalledWith(repo, repo.path, registered, oid(1), oid(99)))
  })

  it('diffs a renamed file with both of its names', async () => {
    const adapter = commitAdapter({ commitFiles: vi.fn(async () => ({ files: 'R100\0old name\0new name\0' })) })
    const { result } = render(adapter, { oid: oid(2), focusedPath: 'new name' })
    await waitFor(() => expect(result.current.diff?.result).toBeTruthy())
    expect(adapter.commitDiff).toHaveBeenCalledWith(repo, repo.path, registered, oid(2), oid(99), ['new name', 'old name'])
  })

  it('a cached commit makes no new request', async () => {
    const adapter = commitAdapter()
    const cache = createHistoryCache()
    const first = render(adapter, { oid: oid(2) }, cache)
    await waitFor(() => expect(first.result.current.files).not.toBeNull())
    first.unmount()
    const again = render(adapter, { oid: oid(2) }, cache)
    await waitFor(() => expect(again.result.current.files).not.toBeNull())
    expect(adapter.commitDetails).toHaveBeenCalledTimes(1)
    expect(adapter.commitFiles).toHaveBeenCalledTimes(1)
  })

  it('fifty quick focus moves never have more than two requests in flight', async () => {
    let inFlight = 0
    let peak = 0
    const slow = () => new Promise(r => setTimeout(r, 5))
    const adapter = commitAdapter({
      commitDetails: vi.fn(async (_r, _c, _g, o) => { inFlight++; peak = Math.max(peak, inFlight); await slow(); inFlight--; return { details: details(o) } }),
    })
    const { result, rerender } = render(adapter, { oid: oid(1) })
    for (let i = 2; i <= 50; i++) rerender({ oid: oid(i) })
    await waitFor(() => expect(result.current.details?.oid).toBe(oid(50)))
    expect(peak).toBeLessThanOrEqual(2)
    expect(adapter.commitDetails.mock.calls.length).toBeLessThan(10)
  })

  it('prefetches the next commits once the focused one is in', async () => {
    const adapter = commitAdapter()
    const { result } = render(adapter, { oid: oid(1), nextOids: [oid(2), oid(3)] })
    await waitFor(() => expect(result.current.files).not.toBeNull())
    await waitFor(() => expect(adapter.commitDetails.mock.calls.map(c => c[3])).toEqual([oid(1), oid(2), oid(3)]))
  })

  it('a commit that no longer exists is reported as missing', async () => {
    const adapter = commitAdapter({ commitDetails: vi.fn(async () => ({ missing: true })) })
    const { result } = render(adapter, { oid: oid(7) })
    await waitFor(() => expect(result.current.missing).toBe(true))
    expect(MISSING_COMMIT).toBe('This commit no longer exists - refresh.')
  })
})
