import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useDiff } from './use-diff.js'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const change = (path, area = 'unstaged', extra = {}) => ({ path, originalPath: null, area, xy: '.M', sub: 'N...', id: `${area}\0${path}`, ...extra })
const TEXT = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('useDiff', () => {
  it('loads nothing until a change is focused', () => {
    const adapter = { diff: vi.fn() }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: null, version: 1 }))
    expect(adapter.diff).not.toHaveBeenCalled()
    expect(result.current.files).toEqual([])
  })

  it('loads the focused change once, with its area and both rename paths', async () => {
    const adapter = { diff: vi.fn(async () => ({ text: TEXT, stamp: 's1', truncated: false, binary: false, size: 10 })) }
    const moved = change('moved.txt', 'staged', { originalPath: 'was.txt' })
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: p.change, version: 1 }), { initialProps: { change: moved } })
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    expect(adapter.diff).toHaveBeenCalledWith(repo, repo.path, registered, { area: 'staged', paths: ['moved.txt', 'was.txt'] })
    expect(result.current.files[0].hunks).toHaveLength(1)
    rerender({ change: { ...moved } })
    expect(adapter.diff).toHaveBeenCalledTimes(1)
  })

  it('reloads on a new snapshot while keeping the last diff on screen', async () => {
    const next = deferred()
    let calls = 0
    const adapter = { diff: vi.fn(() => (++calls === 1 ? Promise.resolve({ text: TEXT, stamp: 's1' }) : next.promise)) }
    const f = change('f.txt')
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: f, version: p.version }), { initialProps: { version: 1 } })
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    rerender({ version: 2 })
    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.result.stamp).toBe('s1')
    await act(async () => { next.resolve({ text: TEXT, stamp: 's2' }) })
    expect(result.current.result.stamp).toBe('s2')
  })

  it('keeps the parsed diff when a reload brings the same text and stamp', async () => {
    const adapter = { diff: vi.fn(async () => ({ text: TEXT, stamp: 's1' })) }
    const f = change('f.txt')
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: f, version: p.version }), { initialProps: { version: 1 } })
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    const { result: before, files } = result.current
    rerender({ version: 2 })
    await waitFor(() => expect(adapter.diff).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.result).toBe(before)
    expect(result.current.files).toBe(files)
  })

  it('reloads at once when asked, without a new snapshot', async () => {
    let n = 0
    const adapter = { diff: vi.fn(async () => ({ text: TEXT, stamp: `s${++n}` })) }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: change('f.txt'), version: 1 }))
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    act(() => { result.current.reload() })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.result.stamp).toBe('s2'))
  })

  it('keeps only the newest response when the focus moves quickly', async () => {
    const slow = deferred()
    const adapter = { diff: vi.fn(async (_r, _w, _g, ch) => (ch.paths[0] === 'slow.txt' ? slow.promise : { text: TEXT, stamp: 'fast' })) }
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: p.change, version: 1 }), { initialProps: { change: change('slow.txt') } })
    rerender({ change: change('fast.txt') })
    await waitFor(() => expect(result.current.result?.stamp).toBe('fast'))
    await act(async () => { slow.resolve({ text: TEXT, stamp: 'slow' }) })
    expect(result.current.result.stamp).toBe('fast')
  })

  it('reports a failed load', async () => {
    const adapter = { diff: vi.fn(async () => { throw new Error('boom') }) }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: change('f.txt'), version: 1 }))
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })

  it('drops Electron\'s remote-method prefix from errors', async () => {
    const adapter = { diff: vi.fn(async () => { throw new Error("Error invoking remote method 'git:diff': Error: Not a worktree of C:/repos/A: C:/repos/A/sub") }) }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: change('f.txt'), version: 1 }))
    await waitFor(() => expect(result.current.error).toBe('Not a worktree of C:/repos/A: C:/repos/A/sub'))
  })

  it('marks the diff as loading as soon as reload is called, keeping the last diff', async () => {
    const next = deferred()
    let calls = 0
    const adapter = { diff: vi.fn(() => (++calls === 1 ? Promise.resolve({ text: TEXT, stamp: 's1' }) : next.promise)) }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: change('f.txt'), version: 1 }))
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    act(() => { result.current.reload() })
    expect(result.current.loading).toBe(true)
    expect(result.current.result.stamp).toBe('s1')
    await act(async () => { next.resolve({ text: TEXT, stamp: 's2' }) })
    expect([result.current.loading, result.current.result.stamp]).toEqual([false, 's2'])
  })
})
