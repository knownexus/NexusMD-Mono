import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useLastCommit } from './use-last-commit.js'

afterEach(cleanup)

const RS = '\x1e'
const US = '\x1f'
const record = (oid, subject, parents = ['p'.repeat(40)]) => `* ${RS}${[oid, parents.join(' '), 'Ann', 'a@x', 1700000000, '', subject].join(US)}`
const OID = 'a'.repeat(40)
const repo = { name: 'A', path: '/r' }
const tree = (over = {}) => ({ path: '/r', head: OID, upstream: 'origin/main', upstreamGone: false, ahead: 0, ...over })

function adapter(over = {}) {
  return {
    log: vi.fn(async () => ({ text: `${record(OID, 'Fix the thing')}\n${record('b'.repeat(40), 'Older')}\n`, tip: OID })),
    commitFiles: vi.fn(async () => ({ files: 'M\0a.txt\0A\0b.txt\0', numstat: '3\t1\ta.txt\0' + '5\t0\tb.txt\0' })),
    ...over,
  }
}
const run = (a, t = tree(), extra = {}) => renderHook(() => useLastCommit({ adapter: a, repo, cwd: '/r', registered: ['/r'], tree: t, version: 'v1', ...extra }))

describe('useLastCommit', () => {
  it('reads the newest commit with its file and line counts', async () => {
    const a = adapter()
    const { result } = run(a)
    await waitFor(() => expect(result.current.commit).not.toBeNull())
    expect(result.current.commit).toMatchObject({ oid: OID, subject: 'Fix the thing', files: 2, add: 8, del: 1, pushed: true })
    expect(result.current.commit.when).toBe(1700000000 * 1000)
    expect(a.log).toHaveBeenCalledWith(repo, '/r', ['/r'], expect.objectContaining({ ref: 'HEAD' }))
    expect(a.commitFiles).toHaveBeenCalledWith(repo, '/r', ['/r'], OID, 'p'.repeat(40))
  })

  it('is not pushed while commits are ahead, or without an upstream', async () => {
    const ahead = run(adapter(), tree({ ahead: 1 }))
    await waitFor(() => expect(ahead.result.current.commit).not.toBeNull())
    expect(ahead.result.current.commit.pushed).toBe(false)
    cleanup()
    const none = run(adapter(), tree({ upstream: null }))
    await waitFor(() => expect(none.result.current.commit).not.toBeNull())
    expect(none.result.current.commit.pushed).toBe(false)
  })

  it('gives null for a repository with no commits', async () => {
    const a = adapter({ log: vi.fn(async () => ({ text: '', tip: null })) })
    const { result } = run(a)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.commit).toBeNull()
    expect(a.commitFiles).not.toHaveBeenCalled()
  })

  it('still gives the commit when its file counts cannot be read', async () => {
    const a = adapter({ commitFiles: vi.fn(async () => { throw new Error('nope') }) })
    const { result } = run(a)
    await waitFor(() => expect(result.current.commit).not.toBeNull())
    expect(result.current.commit.files).toBeNull()
  })

  it('reads nothing while disabled', async () => {
    const a = adapter()
    run(a, tree(), { enabled: false })
    await new Promise(r => setTimeout(r, 20))
    expect(a.log).not.toHaveBeenCalled()
  })

  it('also hands back the commits it read, newest first, for amending the message', async () => {
    const { result } = run(adapter())
    await waitFor(() => expect(result.current.commits.length).toBe(2))
    expect(result.current.commits[0].oid).toBe(OID)
  })
})
