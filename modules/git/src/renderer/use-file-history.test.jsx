import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useFileHistory } from './use-file-history.js'

afterEach(cleanup)
const RS = '\x1e'
const US = '\x1f'
const record = (n, subject) => `* ${RS}${[String(n).repeat(40), '', 'Ann', 'a@x', 1700000000 + n, '', subject].join(US)}`
const repo = { name: 'A', path: '/r' }
const run = (a, extra = {}) => renderHook(() => useFileHistory({ adapter: a, repo, cwd: '/r', registered: ['/r'], path: 'src/a.js', version: 1, ...extra }))

describe('useFileHistory', () => {
  it('reads the commits that touched the file, keeping the newest three', async () => {
    const a = { log: vi.fn(async () => ({ text: [1, 2, 3, 4, 5].map(n => record(n, `c${n}`)).join('\n') + '\n', tip: 'x' })) }
    const { result } = run(a)
    expect(result.current.commits).toBeNull()
    await waitFor(() => expect(result.current.commits).not.toBeNull())
    expect(result.current.commits.map(c => c.subject)).toEqual(['c1', 'c2', 'c3'])
    expect(result.current.commits[0]).toMatchObject({ oid: '1'.repeat(40), when: (1700000000 + 1) * 1000 })
    expect(a.log).toHaveBeenCalledWith(repo, '/r', ['/r'], expect.objectContaining({ ref: 'HEAD', search: { kind: 'path', text: 'src/a.js' } }))
  })

  it('gives an empty list for a file with no history, and when the log cannot be read', async () => {
    const none = run({ log: vi.fn(async () => ({ text: '', tip: null })) })
    await waitFor(() => expect(none.result.current.commits).toEqual([]))
    cleanup()
    const bad = run({ log: vi.fn(async () => { throw new Error('nope') }) })
    await waitFor(() => expect(bad.result.current.commits).toEqual([]))
    expect(bad.result.current.error).toBe('nope')
  })

  it('reads nothing without a path or while disabled', async () => {
    const a = { log: vi.fn() }
    run(a, { path: null })
    run(a, { enabled: false })
    await new Promise(r => setTimeout(r, 20))
    expect(a.log).not.toHaveBeenCalled()
  })

  it('starts again when another file is picked', async () => {
    const a = { log: vi.fn(async () => ({ text: record(1, 'c1') + '\n', tip: 'x' })) }
    const { result, rerender } = renderHook(({ path }) => useFileHistory({ adapter: a, repo, cwd: '/r', registered: ['/r'], path, version: 1 }), { initialProps: { path: 'a.js' } })
    await waitFor(() => expect(result.current.commits).not.toBeNull())
    rerender({ path: 'b.js' })
    expect(result.current.commits).toBeNull()
    await waitFor(() => expect(a.log).toHaveBeenCalledTimes(2))
  })
})
