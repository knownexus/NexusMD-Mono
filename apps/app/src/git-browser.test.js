import { describe, it, expect, vi } from 'vitest'
import { listRepos, listBranches, listCommits, listItems, getFile, groupCommitsByDay } from './git-browser.js'

describe('git browser', () => {
  it('lists enabled repos across projects, sorted', async () => {
    const get = vi.fn(async (p) => p.startsWith('B/')
      ? { value: [{ id: '2', name: 'zeta', defaultBranch: 'refs/heads/main' }] }
      : { value: [{ id: '1', name: 'alpha', defaultBranch: 'refs/heads/dev' }, { id: '3', name: 'off', isDisabled: true }] })
    expect(await listRepos(get, ['B', 'A'])).toEqual([
      { id: '1', name: 'alpha', project: 'A', defaultBranch: 'dev' },
      { id: '2', name: 'zeta', project: 'B', defaultBranch: 'main' },
    ])
  })

  it('puts the default branch first', async () => {
    const get = async () => ({ value: [{ name: 'refs/heads/feature/b', objectId: 'x' }, { name: 'refs/heads/main', objectId: 'y' }, { name: 'refs/heads/a', objectId: 'z' }] })
    const branches = await listBranches(get, { id: '1', project: 'P', defaultBranch: 'main' })
    expect(branches.map(b => b.name)).toEqual(['main', 'a', 'feature/b'])
    expect(branches[0].isDefault).toBe(true)
  })

  it('asks for the commits of a branch and keeps the first message line', async () => {
    const get = vi.fn(async () => ({ value: [{ commitId: 'abcdef1234567', comment: 'Fix it\n\nlong body', author: { name: 'Ann', date: '2026-10-01' } }] }))
    const commits = await listCommits(get, { id: 'r', project: 'P Q' }, 'feature/x')
    expect(get.mock.calls[0][0]).toContain('P%20Q/_apis/git/repositories/r/commits')
    expect(get.mock.calls[0][0]).toContain('version=feature%2Fx')
    expect(commits).toEqual([{ id: 'abcdef1234567', shortId: 'abcdef12', message: 'Fix it', author: 'Ann', date: '2026-10-01', url: '' }])
  })

  it('lists one folder level, folders first, without the folder itself', async () => {
    const get = vi.fn(async () => ({ value: [
      { path: '/src', isFolder: true }, { path: '/b.md' }, { path: '/a.md' }, { path: '/docs', isFolder: true },
    ] }))
    const items = await listItems(get, { id: 'r', project: 'P' }, 'main', '/')
    expect(items.map(i => i.name)).toEqual(['docs', 'src', 'a.md', 'b.md'])
    expect(get.mock.calls[0][0]).toContain('recursionLevel=OneLevel')
  })

  it('reads a file as text from either response shape', async () => {
    expect(await getFile(async () => ({ content: 'hi' }), { id: 'r', project: 'P' }, 'main', '/a.txt')).toBe('hi')
    expect(await getFile(async () => 'raw', { id: 'r', project: 'P' }, 'main', '/a.txt')).toBe('raw')
  })

  it('groups commits by day', () => {
    const g = groupCommitsByDay([{ date: '2026-10-02T10:00:00' }, { date: '2026-10-02T09:00:00' }, { date: '2026-10-01T09:00:00' }])
    expect(g.map(x => x.commits.length)).toEqual([2, 1])
  })
})
