import { describe, it, expect, vi } from 'vitest'
import {
  githubRepoFromRemote, githubRepoInfo, listGithubBranches, createGithubBranch, deleteGithubBranch,
  listGithubCommits, getGithubCommit, listGithubContents, getGithubFile,
} from '../../src/modules/github/repo-browse.js'

const b64 = (s) => Buffer.from(s, 'binary').toString('base64')

describe('githubRepoFromRemote', () => {
  it('parses https, ssh and scp urls', () => {
    expect(githubRepoFromRemote('https://github.com/Acme/Web.git')).toBe('acme/web')
    expect(githubRepoFromRemote('git@github.com:acme/web.git')).toBe('acme/web')
    expect(githubRepoFromRemote('ssh://git@github.com/acme/web')).toBe('acme/web')
  })
  it('rejects other hosts and garbage', () => {
    expect(githubRepoFromRemote('https://gitlab.com/acme/web.git')).toBeNull()
    expect(githubRepoFromRemote('nonsense')).toBeNull()
    expect(githubRepoFromRemote(undefined)).toBeNull()
  })
})

describe('repo info and branches', () => {
  it('reads default branch and url', async () => {
    const c = { get: vi.fn().mockResolvedValue({ default_branch: 'main', html_url: 'https://github.com/acme/web' }) }
    expect(await githubRepoInfo(c, 'acme/web')).toEqual({ defaultBranch: 'main', htmlUrl: 'https://github.com/acme/web' })
  })
  it('lists branches default first then alphabetical', async () => {
    const c = {
      get: vi.fn().mockResolvedValue({ default_branch: 'main' }),
      getPaged: vi.fn().mockResolvedValue([
        { name: 'zeta', commit: { sha: 'z1' } },
        { name: 'main', protected: true, commit: { sha: 'm1' } },
        { name: 'alpha', commit: { sha: 'a1' } },
      ]),
    }
    const out = await listGithubBranches(c, 'acme/web')
    expect(out.map(b => b.name)).toEqual(['main', 'alpha', 'zeta'])
    expect(out.map(b => b.isDefault)).toEqual([true, false, false])
    expect(out[0]).toEqual({ name: 'main', sha: 'm1', protected: true, isDefault: true })
    expect(out[1].protected).toBe(false)
    expect(c.getPaged).toHaveBeenCalledWith('repos/acme/web/branches')
  })
  it('creates a branch from another branch head', async () => {
    const c = { get: vi.fn().mockResolvedValue({ object: { sha: 'abc' } }), post: vi.fn().mockResolvedValue({}) }
    const r = await createGithubBranch(c, 'acme/web', { name: 'feature/x', from: 'release/1' })
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/git/ref/heads/release/1')
    expect(c.post).toHaveBeenCalledWith('repos/acme/web/git/refs', { ref: 'refs/heads/feature/x', sha: 'abc' })
    expect(r).toEqual({ name: 'feature/x', sha: 'abc' })
  })
  it('deletes a branch with encoded segments', async () => {
    const c = { del: vi.fn().mockResolvedValue(undefined) }
    await deleteGithubBranch(c, 'acme/web', 'feature/x y')
    expect(c.del).toHaveBeenCalledWith('repos/acme/web/git/refs/heads/feature/x%20y')
  })
})

describe('commits', () => {
  it('lists commits', async () => {
    const c = { get: vi.fn().mockResolvedValue([
      { sha: 's1', author: { login: 'bob' }, commit: { message: 'first\nbody', author: { name: 'Bob B', date: 'd1' } } },
      { sha: 's2', author: null, commit: { message: 'two', author: { name: 'Al', date: 'd2' } } },
    ]) }
    const out = await listGithubCommits(c, 'acme/web', 'feature/x')
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/commits?sha=feature%2Fx&per_page=50')
    expect(out).toEqual([
      { sha: 's1', message: 'first', author: 'bob', date: 'd1' },
      { sha: 's2', message: 'two', author: 'Al', date: 'd2' },
    ])
  })
  it('gets a commit with mapped files', async () => {
    const c = { get: vi.fn().mockResolvedValue({
      sha: 's1', author: { login: 'bob' }, commit: { message: 'first\nbody', author: { date: 'd1' } },
      files: [
        { filename: 'a', status: 'added', additions: 1, deletions: 0, patch: '+x' },
        { filename: 'b', status: 'removed' },
        { filename: 'c', status: 'renamed' },
        { filename: 'd', status: 'modified' },
      ],
    }) }
    const out = await getGithubCommit(c, 'acme/web', 's1')
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/commits/s1')
    expect(out.message).toBe('first\nbody')
    expect(out.files.map(f => f.changeType)).toEqual(['add', 'delete', 'rename', 'edit'])
    expect(out.files[0]).toEqual({ path: 'a', changeType: 'add', additions: 1, deletions: 0, patch: '+x' })
  })
})

describe('contents', () => {
  it('lists dirs before files, alphabetical', async () => {
    const c = { get: vi.fn().mockResolvedValue([
      { name: 'b.js', path: 'src/lib/b.js', type: 'file', size: 3 },
      { name: 'z', path: 'src/lib/z', type: 'dir', size: 0 },
      { name: 'a.js', path: 'src/lib/a.js', type: 'file', size: 1 },
      { name: 'm', path: 'src/lib/m', type: 'dir', size: 0 },
    ]) }
    const out = await listGithubContents(c, 'acme/web', { path: 'src/lib', ref: 'main' })
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/contents/src/lib?ref=main')
    expect(out.map(e => e.name)).toEqual(['m', 'z', 'a.js', 'b.js'])
  })
  it('reads text, too-large and binary files', async () => {
    const c = { get: vi.fn() }
    c.get.mockResolvedValueOnce({ content: 'aGk=\n', encoding: 'base64', size: 2, html_url: 'u' })
    expect(await getGithubFile(c, 'acme/web', { path: 'a b.txt', ref: 'main' })).toEqual({ text: 'hi', reason: null, url: 'u' })
    expect(c.get).toHaveBeenCalledWith('repos/acme/web/contents/a%20b.txt?ref=main')
    c.get.mockResolvedValueOnce({ content: '', size: 2_000_000, html_url: 'u' })
    expect(await getGithubFile(c, 'acme/web', { path: 'big', ref: 'main' })).toEqual({ text: null, reason: 'too-large', url: 'u' })
    c.get.mockResolvedValueOnce({ content: b64('a\0b'), size: 3, html_url: 'u' })
    expect(await getGithubFile(c, 'acme/web', { path: 'bin', ref: 'main' })).toEqual({ text: null, reason: 'binary', url: 'u' })
  })
})

describe('getGithubFile without Node globals', () => {
  // The desktop renderer runs with contextIsolation and no nodeIntegration: there is no Buffer.
  it('decodes text, detects binary and reads multi-byte UTF-8 with Buffer undefined', async () => {
    const binary = b64('a\0b')
    const utf8 = Buffer.from('caf\u00e9 \u2713', 'utf8').toString('base64')
    const saved = globalThis.Buffer
    globalThis.Buffer = undefined
    try {
      const c = { get: vi.fn() }
      c.get.mockResolvedValueOnce({ content: 'aG\nk=\n', encoding: 'base64', size: 2, html_url: 'u' })
      expect(await getGithubFile(c, 'acme/web', { path: 'a', ref: 'main' })).toEqual({ text: 'hi', reason: null, url: 'u' })
      c.get.mockResolvedValueOnce({ content: binary, size: 3, html_url: 'u' })
      expect(await getGithubFile(c, 'acme/web', { path: 'bin', ref: 'main' })).toEqual({ text: null, reason: 'binary', url: 'u' })
      c.get.mockResolvedValueOnce({ content: utf8, size: 9, html_url: 'u' })
      expect(await getGithubFile(c, 'acme/web', { path: 'u', ref: 'main' })).toEqual({ text: 'caf\u00e9 \u2713', reason: null, url: 'u' })
    } finally {
      globalThis.Buffer = saved
    }
  })
})
