import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useGitSnapshot, clearGitSnapshotCache } from './use-git-snapshot.js'

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
    await new Promise(r => setTimeout(r, 20))
    expect(adapter.resolve).not.toHaveBeenCalled()
  })

  it('skips polls while a load is still running', async () => {
    const pending = deferred()
    const adapter = adapterWith(() => pending.promise)
    renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: 10 }))
    await new Promise(r => setTimeout(r, 80))
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
    await new Promise(r => setTimeout(r, 20))
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

  it('starts empty when the registered repos changed since the last visit', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const first = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(first.result.current.snapshot).not.toBeNull())
    first.unmount()
    adapter.resolve.mockImplementation(() => new Promise(() => {}))
    const other = renderHook(() => useGitSnapshot({ adapter, repos: [...repos, { name: 'B', path: 'C:/repos/B' }], intervalMs: null }))
    expect(other.result.current.snapshot).toBeNull()
  })
})
