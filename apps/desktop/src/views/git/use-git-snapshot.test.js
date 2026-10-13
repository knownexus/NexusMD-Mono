import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useGitSnapshot } from './use-git-snapshot.js'

afterEach(cleanup)

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
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await act(async () => { result.current.refresh() })
    await waitFor(() => expect(result.current.snapshot?.worktrees[0].commonDir).toBe('second'))
    await act(async () => { first.resolve({ commonDir: 'first' }) })
    await new Promise(r => setTimeout(r, 20))
    expect(result.current.snapshot.worktrees[0].commonDir).toBe('second')
  })
})
