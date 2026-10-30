import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useGitSnapshot, clearGitSnapshotCache } from './use-git-snapshot.js'
import { getProfileKey } from '@nexusmd/shell-sdk'

// Lets every promise callback already queued run (setImmediate comes after them all): ordering, not a wait on the clock.
const flushPromises = () => act(() => new Promise(r => setImmediate(r)))

afterEach(() => { cleanup(); clearGitSnapshotCache() })

const repos = [{ name: 'A', path: 'C:/repos/A' }]
function adapterWith(resolveImpl) {
  return {
    resolve: vi.fn(resolveImpl),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\x00HEAD a\x00branch refs/heads/main\x00\x00`),
    status: vi.fn(async () => ({ porcelain: '# branch.head main\x00', operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
  }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('useGitSnapshot', () => {
  it('loads a snapshot of the registered repos', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(result.current.snapshot?.worktrees).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  it('does nothing while disabled', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: dir }))
    renderHook(() => useGitSnapshot({ adapter, repos, enabled: false, intervalMs: null }))
    await flushPromises()
    expect(adapter.resolve).not.toHaveBeenCalled()
  })

  it('skips polls while a load is still running', async () => {
    const pending = deferred()
    const adapter = adapterWith(() => pending.promise)
    // Polls run on a fake clock: eight of them come due while the first load is still out.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: 10 }))
    await act(() => vi.advanceTimersByTimeAsync(80))
    expect(adapter.resolve).toHaveBeenCalledTimes(1)
    pending.resolve({ commonDir: 'C:/repos/A/.git' })
  })

  it('keeps only the newest response when loads overlap', async () => {
    const first = deferred()
    let calls = 0
    const adapter = adapterWith(() => (++calls === 1 ? first.promise : Promise.resolve({ commonDir: 'second' })))
    const { result, rerender } = renderHook(props => useGitSnapshot({ adapter, repos: props.repos, intervalMs: null }), { initialProps: { repos } })
    rerender({ repos: [{ name: 'A', path: 'C:/repos/A2' }] })
    await waitFor(() => expect(result.current.snapshot?.worktrees[0].commonDir).toBe('second'))
    await act(async () => { first.resolve({ commonDir: 'first' }) })
    await flushPromises()
    expect(result.current.snapshot.worktrees[0].commonDir).toBe('second')
  })

  it('ignores a manual refresh while a load is running', async () => {
    const pending = deferred()
    let calls = 0
    const adapter = adapterWith(() => (++calls === 1 ? pending.promise : Promise.resolve({ commonDir: 'C:/repos/A/.git' })))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await act(async () => { result.current.refresh() })
    expect(adapter.resolve).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({ commonDir: 'C:/repos/A/.git' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { result.current.refresh() })
    expect(adapter.resolve).toHaveBeenCalledTimes(2)
  })

  it('queues exactly one quiet load after the running one when reloads are asked for mid-load', async () => {
    const pending = deferred()
    let calls = 0
    const adapter = adapterWith(() => (++calls === 1 ? pending.promise : Promise.resolve({ commonDir: `after-${calls}` })))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    let done
    await act(async () => { done = result.current.reload(); result.current.reload() })
    expect(adapter.resolve).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({ commonDir: 'before-write' }) })
    await act(async () => { await done })
    expect(adapter.resolve).toHaveBeenCalledTimes(2)
    expect(result.current.snapshot.worktrees[0].commonDir).toBe('after-2')
  })

  it('reloads at once and quietly when nothing is running', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())
    const pending = deferred()
    adapter.resolve.mockImplementation(() => pending.promise)
    await act(async () => { result.current.reload() })
    expect(adapter.resolve).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    await act(async () => { pending.resolve({ commonDir: 'x' }) })
  })

  it('shows the last snapshot immediately when the screen is reopened, then refreshes quietly', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const first = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(first.result.current.snapshot?.worktrees).toHaveLength(1))
    const cached = first.result.current.snapshot
    first.unmount()
    const pending = deferred()
    adapter.resolve.mockImplementation(() => pending.promise)
    const second = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    expect(second.result.current.snapshot).toBe(cached)
    expect(second.result.current.loading).toBe(false)
    await act(async () => { pending.resolve({ commonDir: 'refreshed' }) })
    await waitFor(() => expect(second.result.current.snapshot.worktrees[0].commonDir).toBe('refreshed'))
  })

  it('after a restart, shows the snapshot kept from the last run straight away, stale until a fresh read', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const first = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(first.result.current.snapshot?.worktrees).toHaveLength(1))
    expect(first.result.current.stale).toBe(false)
    first.unmount()
    // A restart: memory is gone, the profile's storage isn't.
    const kept = localStorage.getItem(getProfileKey('git.snapshot'))
    clearGitSnapshotCache()
    localStorage.setItem(getProfileKey('git.snapshot'), kept)
    const pending = deferred()
    adapter.resolve.mockImplementation(() => pending.promise)
    const second = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    expect(second.result.current.snapshot.worktrees).toHaveLength(1)
    expect(second.result.current).toMatchObject({ stale: true, loading: false })
    await act(async () => { pending.resolve({ commonDir: 'refreshed' }) })
    await waitFor(() => expect(second.result.current.stale).toBe(false))
    expect(second.result.current.snapshot.worktrees[0].commonDir).toBe('refreshed')
  })

  it('ignores a kept snapshot for a different repo list or one that does not parse', () => {
    const adapter = adapterWith(() => new Promise(() => {}))
    localStorage.setItem(getProfileKey('git.snapshot'), JSON.stringify({ key: '[]', snapshot: { takenAt: 'x', worktrees: [] } }))
    expect(renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null })).result.current).toMatchObject({ snapshot: null, stale: false })
    localStorage.setItem(getProfileKey('git.snapshot'), '{nope')
    expect(renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null })).result.current.snapshot).toBeNull()
  })

  it('a reload naming repos reads only those, keeping the others as they are', async () => {
    const two = [...repos, { name: 'B', path: 'C:/repos/B' }]
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos: two, intervalMs: null }))
    await waitFor(() => expect(result.current.snapshot?.worktrees).toHaveLength(2))
    adapter.resolve.mockClear()
    const before = result.current.snapshot
    await act(async () => { await result.current.reload(['B']) })
    expect(adapter.resolve.mock.calls.map(c => c[0])).toEqual(['C:/repos/B'])
    expect(result.current.snapshot).not.toBe(before)
    expect(result.current.snapshot.worktrees[0]).toEqual(before.worktrees[0])
    await act(async () => { await result.current.reload() })
    expect(adapter.resolve.mock.calls.map(c => c[0])).toEqual(['C:/repos/B', 'C:/repos/A', 'C:/repos/B'])
  })

  it('starts empty when the registered repos changed since the last visit', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const first = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(first.result.current.snapshot).not.toBeNull())
    first.unmount()
    adapter.resolve.mockImplementation(() => new Promise(() => {}))
    const other = renderHook(() => useGitSnapshot({ adapter, repos: [...repos, { name: 'B', path: 'C:/repos/B' }], intervalMs: null }))
    expect(other.result.current.snapshot).toBeNull()
  })

  it('runs a reload queued during an older load with the current repo list', async () => {
    const first = deferred()
    let calls = 0
    const adapter = adapterWith(dir => (++calls === 1 ? first.promise : Promise.resolve({ commonDir: `${dir}/.git` })))
    const { result, rerender } = renderHook(p => useGitSnapshot({ adapter, repos: p.repos, intervalMs: null }), { initialProps: { repos } })
    let queued
    act(() => { queued = result.current.reload() })
    rerender({ repos: [{ name: 'B', path: 'C:/repos/B' }] })
    await act(async () => { first.resolve({ commonDir: 'C:/repos/A/.git' }); await queued })
    expect(adapter.resolve.mock.calls.at(-1)[0]).toBe('C:/repos/B')
  })
})

describe('useGitSnapshot untracked listing', () => {
  const modes = adapter => adapter.status.mock.calls.map(c => c[3]?.untracked)

  it('polls collapsed when no worktree is on screen', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(result.current.snapshot?.worktrees).toHaveLength(1))
    expect(modes(adapter)).toEqual(['normal'])
  })

  it('reads the worktree on screen in full', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null, full: 'C:/repos/A' }))
    await waitFor(() => expect(result.current.snapshot?.worktrees[0]?.untrackedFull).toBe(true))
    expect(modes(adapter)).toEqual(['all'])
  })

  it('reads a worktree in full once it is opened, without waiting for the next poll', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result, rerender } = renderHook(({ full }) => useGitSnapshot({ adapter, repos, intervalMs: null, full }), { initialProps: { full: null } })
    await waitFor(() => expect(result.current.snapshot?.worktrees[0]?.untrackedFull).toBe(false))
    rerender({ full: 'C:/repos/A' })
    await waitFor(() => expect(result.current.snapshot?.worktrees[0]?.untrackedFull).toBe(true))
    expect(modes(adapter)).toEqual(['normal', 'all'])
  })
})
