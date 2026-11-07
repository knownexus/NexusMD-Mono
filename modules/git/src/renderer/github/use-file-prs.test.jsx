import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useFilePrs, useFileCommits, forgetFilePrs } from './use-file-prs.js'

afterEach(cleanup)
beforeEach(() => forgetFilePrs())

const pr = (number, updated, title = `PR ${number}`) => ({ number, title, lastActivity: updated })
const day = n => `2024-01-${String(n).padStart(2, '0')}T00:00:00Z`
const filesOf = { 1: [{ filename: 'src/a.js', additions: 3, deletions: 1 }], 2: [{ filename: 'other.js', additions: 1, deletions: 0 }], 3: [{ filename: 'src/a.js', additions: 5, deletions: 2 }, { filename: 'x', additions: 1, deletions: 1 }] }
const client = (fail = []) => ({ get: vi.fn(async p => { const n = Number(/pulls\/(\d+)\/files/.exec(p)[1]); if (fail.includes(n)) throw new Error('boom'); return filesOf[n] ?? [] }) })
const run = (c, props = {}) => renderHook(p => useFilePrs({ client: c, repo: 'acme/web', openPRs: [pr(1, day(1)), pr(2, day(2)), pr(3, day(3))], path: 'src/a.js', refreshKey: 0, ...p }), { initialProps: props })

describe('useFilePrs', () => {
  it('lists the open pull requests that change the file, with the lines they change in it', async () => {
    const { result } = run(client())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.prs).toEqual([{ number: 3, title: 'PR 3', add: 5, del: 2 }, { number: 1, title: 'PR 1', add: 3, del: 1 }])
  })

  it('looks at no more than the ten most recently updated pull requests', async () => {
    const many = Array.from({ length: 14 }, (_, i) => pr(i + 1, day(i + 1)))
    const c = { get: vi.fn(async () => []) }
    const { result } = renderHook(() => useFilePrs({ client: c, repo: 'acme/web', openPRs: many, path: 'a.js', refreshKey: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(c.get).toHaveBeenCalledTimes(10)
    expect(c.get.mock.calls.map(([p]) => Number(/pulls\/(\d+)/.exec(p)[1])).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it('reads each pull request\'s files once for a repository and refresh, whatever file is picked', async () => {
    const c = client()
    const { result, rerender } = run(c)
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ path: 'other.js' })
    await waitFor(() => expect(result.current.prs.map(p => p.number)).toEqual([2]))
    expect(c.get).toHaveBeenCalledTimes(3)
    rerender({ path: 'other.js', refreshKey: 1 })
    await waitFor(() => expect(c.get).toHaveBeenCalledTimes(6))
  })

  it('still uses the others when one pull request\'s files cannot be read', async () => {
    const { result } = run(client([3]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.prs.map(p => p.number)).toEqual([1])
  })

  it('reads nothing without a path, a client or any pull request', async () => {
    const c = client()
    renderHook(() => useFilePrs({ client: c, repo: 'acme/web', openPRs: [pr(1, day(1))], path: null, refreshKey: 0 }))
    renderHook(() => useFilePrs({ client: null, repo: 'acme/web', openPRs: [pr(1, day(1))], path: 'a', refreshKey: 0 }))
    renderHook(() => useFilePrs({ client: c, repo: 'acme/web', openPRs: [], path: 'a', refreshKey: 0 }))
    await new Promise(r => setTimeout(r, 20))
    expect(c.get).not.toHaveBeenCalled()
  })
})

describe('useFileCommits', () => {
  const commit = (sha, message) => ({ sha, commit: { message, author: { date: day(5) } } })

  it('reads the three newest commits that touched the file on the branch, by their first line', async () => {
    const c = { get: vi.fn(async () => [commit('a', 'Fix it\n\nbody'), commit('b', 'Older')]) }
    const { result } = renderHook(() => useFileCommits({ client: c, repo: 'acme/web', branch: 'feature/x', path: 'src/a.js', refreshKey: 0 }))
    expect(result.current.commits).toBeNull()
    await waitFor(() => expect(result.current.commits).not.toBeNull())
    expect(result.current.commits).toEqual([{ sha: 'a', subject: 'Fix it', date: day(5) }, { sha: 'b', subject: 'Older', date: day(5) }])
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/commits?path=src%2Fa.js&sha=feature%2Fx&per_page=3')
  })

  it('gives an empty list when GitHub refuses', async () => {
    const c = { get: vi.fn(async () => { throw new Error('rate limited') }) }
    const { result } = renderHook(() => useFileCommits({ client: c, repo: 'acme/web', branch: 'main', path: 'a', refreshKey: 0 }))
    await waitFor(() => expect(result.current.commits).toEqual([]))
  })
})
