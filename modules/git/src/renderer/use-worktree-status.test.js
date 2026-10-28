import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useWorktreeStatus } from './use-worktree-status.js'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const args = extra => ({ repo, worktree: 'C:/repos/A-wt', registered: ['C:/repos/A'], intervalMs: null, ...extra })
const porcelain = '# branch.head main\x001 .M N... 100644 100644 100644 a b src/app.jsx\x00'
const adapterWith = status => ({ status: vi.fn(status ?? (async () => ({ porcelain, operation: '' }))) })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('useWorktreeStatus', () => {
  it('reads only its own worktree, listing untracked files one by one', async () => {
    const adapter = adapterWith()
    const { result } = renderHook(() => useWorktreeStatus({ adapter, ...args() }))
    await waitFor(() => expect(result.current.reads).toBe(1))
    expect(adapter.status).toHaveBeenCalledTimes(1)
    expect(adapter.status).toHaveBeenCalledWith(repo, 'C:/repos/A-wt', ['C:/repos/A'], { untracked: 'all' })
    expect(result.current.tree).toMatchObject({ repo: 'A', path: 'C:/repos/A-wt', branch: 'main' })
    expect(result.current.tree.changes.map(c => c.path)).toEqual(['src/app.jsx'])
    expect(result.current.takenAt).toBeTruthy()
  })

  it('does nothing while disabled', async () => {
    const adapter = adapterWith()
    renderHook(() => useWorktreeStatus({ adapter, ...args({ enabled: false }) }))
    await new Promise(r => setTimeout(r, 20))
    expect(adapter.status).not.toHaveBeenCalled()
  })

  it('carries a status the worktree could not give as the tree’s error', async () => {
    const { result } = renderHook(() => useWorktreeStatus({ adapter: adapterWith(async () => ({ error: 'Not a git repository' })), ...args() }))
    await waitFor(() => expect(result.current.tree?.error).toBe('Not a git repository'))
  })

  it('reports a read that failed', async () => {
    const { result } = renderHook(() => useWorktreeStatus({ adapter: adapterWith(async () => { throw new Error('boom') }), ...args() }))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.tree).toBeNull()
  })

  it('skips polls while a read is still running', async () => {
    const pending = deferred()
    const adapter = adapterWith(() => pending.promise)
    renderHook(() => useWorktreeStatus({ adapter, ...args({ intervalMs: 10 }) }))
    await new Promise(r => setTimeout(r, 60))
    expect(adapter.status).toHaveBeenCalledTimes(1)
    pending.resolve({ porcelain })
  })

  it('reads once more after a running read when reloaded after a write', async () => {
    const first = deferred()
    const adapter = adapterWith()
    adapter.status.mockImplementationOnce(() => first.promise)
    const { result } = renderHook(() => useWorktreeStatus({ adapter, ...args() }))
    let done
    act(() => { done = result.current.reload(); result.current.reload() })
    expect(adapter.status).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve({ porcelain: '# branch.head main\x00' }); await done })
    expect(adapter.status).toHaveBeenCalledTimes(2)
    expect(result.current.reads).toBe(2)
    expect(result.current.tree.changes).toHaveLength(1)
  })
})
