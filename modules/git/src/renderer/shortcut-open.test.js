import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listLocalRepos, forgetRepoRemotes, requestOpen, takeOpenRequest, OPEN_EVENT, explorerState, planOpen, localPinTarget,
} from './shortcut-open.js'

beforeEach(() => { forgetRepoRemotes(); takeOpenRequest() })

const listing = (url) => `origin\t${url} (fetch)\norigin\t${url} (push)\n`

describe('listLocalRepos', () => {
  const repos = [{ name: 'nexus', path: 'C:/repos/nexus' }, { name: 'scratch', path: 'C:/repos/scratch' }]

  it('gives each registered repository its normalized origin, without credentials', async () => {
    const adapter = { remotes: vi.fn(async (repo) => (repo.name === 'nexus' ? listing('https://me:tok@github.com/KnownExus/Nexus.git') : '')) }
    const list = await listLocalRepos(adapter, repos)
    expect(list).toEqual([
      { name: 'nexus', path: 'C:/repos/nexus', provider: 'local', remote: 'github.com/knownexus/nexus' },
      { name: 'scratch', path: 'C:/repos/scratch', provider: 'local', remote: '' },
    ])
    expect(JSON.stringify(list)).not.toContain('tok')
  })

  it('asks git for each repository in its own folder, with the registered paths', async () => {
    const adapter = { remotes: vi.fn(async () => '') }
    await listLocalRepos(adapter, repos)
    expect(adapter.remotes).toHaveBeenCalledWith({ name: 'nexus', path: 'C:/repos/nexus' }, 'C:/repos/nexus', ['C:/repos/nexus', 'C:/repos/scratch'])
  })

  it('remembers a remote for a minute, then asks again', async () => {
    const adapter = { remotes: vi.fn(async () => listing('git@github.com:o/n.git')) }
    await listLocalRepos(adapter, repos, 1000)
    await listLocalRepos(adapter, repos, 1000 + 59_000)
    expect(adapter.remotes).toHaveBeenCalledTimes(2)
    await listLocalRepos(adapter, repos, 1000 + 61_000)
    expect(adapter.remotes).toHaveBeenCalledTimes(4)
  })

  it('treats a repository git cannot read as having no remote, and carries on', async () => {
    const adapter = { remotes: vi.fn(async (repo) => { if (repo.name === 'nexus') throw new Error('not a worktree'); return listing('https://github.com/o/s.git') }) }
    const list = await listLocalRepos(adapter, repos)
    expect(list.map(r => r.remote)).toEqual(['', 'github.com/o/s'])
  })

  it('runs only a few git processes at once', async () => {
    let running = 0
    let peak = 0
    const adapter = { remotes: async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return '' } }
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `r${i}`, path: `C:/r${i}` }))
    const list = await listLocalRepos(adapter, many)
    expect(list).toHaveLength(12)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('is empty for no repositories', async () => {
    expect(await listLocalRepos({ remotes: vi.fn() }, [])).toEqual([])
  })
})

describe('the open request', () => {
  it('is taken once, and announced', () => {
    const heard = vi.fn()
    window.addEventListener(OPEN_EVENT, heard)
    requestOpen({ repoPath: 'C:/r', path: '/a', kind: 'file' })
    window.removeEventListener(OPEN_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(takeOpenRequest()).toEqual({ repoPath: 'C:/r', path: '/a', kind: 'file' })
    expect(takeOpenRequest()).toBeNull()
  })
  it('a later request replaces one nobody took', () => {
    requestOpen({ path: '/a', kind: 'file' })
    requestOpen({ path: '/b', kind: 'folder' })
    expect(takeOpenRequest()).toEqual({ path: '/b', kind: 'folder' })
  })
})

describe('explorerState', () => {
  it('opens the folders above a file and picks it', () => {
    expect(explorerState('file', '/src/lib/a.js')).toEqual({ open: ['src', 'src/lib'], selected: 'src/lib/a.js' })
    expect(explorerState('file', '/README.md')).toEqual({ open: [], selected: 'README.md' })
  })
  it('opens a folder and the ones above it, picking nothing', () => {
    expect(explorerState('folder', '/src/lib')).toEqual({ open: ['src', 'src/lib'], selected: null })
    expect(explorerState('folder', '/src/lib/')).toEqual({ open: ['src', 'src/lib'], selected: null })
  })
  it('shows the root as it is', () => {
    expect(explorerState('folder', '/')).toEqual({ open: [], selected: null })
    expect(explorerState('folder', '')).toEqual({ open: [], selected: null })
    expect(explorerState('file', undefined)).toEqual({ open: [], selected: null })
  })
})

describe('planOpen', () => {
  const repos = [{ name: 'nexus', path: 'C:\\repos\\nexus' }]
  const tree = (over) => ({ repo: 'nexus', repoRoot: 'C:/repos/nexus', path: 'C:/repos/nexus', branch: 'master', ...over })
  const trees = [tree(), tree({ path: 'C:/repos/nexus-wt/feature', branch: 'feature' })]
  const req = (over) => ({ repoPath: 'C:/repos/nexus', path: '/src/a.js', kind: 'file', ...over })

  it('shows a file in the main worktree of the registered repository, matching its path however it is written', () => {
    const plan = planOpen(req(), { repos, trees })
    expect(plan).toMatchObject({ kind: 'local', viewKey: 'local:C:/repos/nexus', open: ['src'], selected: 'src/a.js' })
    expect(plan.repo).toBe(repos[0])
    expect(plan.tree).toBe(trees[0])
  })
  it('prefers the worktree on the shortcut’s branch', () => {
    expect(planOpen(req({ branch: 'feature' }), { repos, trees }).tree).toBe(trees[1])
  })
  it('falls back to the main worktree when no worktree is on that branch', () => {
    expect(planOpen(req({ branch: 'gone' }), { repos, trees }).tree).toBe(trees[0])
  })
  it('skips a worktree that is prunable or broken', () => {
    const broken = [tree({ error: 'x' }), tree({ path: 'C:/repos/nexus-wt/ok', branch: 'ok' })]
    expect(planOpen(req(), { repos, trees: broken }).tree).toBe(broken[1])
  })
  it('falls back to the GitHub tab when the repository has no usable worktree', () => {
    const plan = planOpen(req({ githubRepo: 'knownexus/nexus', branch: 'main' }), { repos, trees: [tree({ prunable: true })] })
    expect(plan).toMatchObject({ kind: 'github', githubRepo: 'knownexus/nexus', viewKey: 'github:knownexus/nexus@main', open: ['src'], selected: 'src/a.js' })
  })
  it('has no explorer view for a GitHub repository whose branch is not known', () => {
    expect(planOpen({ githubRepo: 'o/n', path: '/a', kind: 'folder' }, { repos, trees })).toMatchObject({ kind: 'github', viewKey: null })
  })
  it('says there is nowhere to show it', () => {
    expect(planOpen(req({ repoPath: 'C:/repos/other' }), { repos, trees })).toEqual({ kind: 'missing' })
    expect(planOpen(null)).toEqual({ kind: 'missing' })
    expect(planOpen(req(), { repos, trees: [] })).toEqual({ kind: 'missing' })
  })
})

describe('localPinTarget', () => {
  const repo = { name: 'nexus-checkout', path: 'C:/repos/nexus-checkout' }
  const pin = (remotes, over = {}) => localPinTarget({
    adapter: { remotes: vi.fn(async () => remotes) }, repo, worktreePath: repo.path, registered: [repo.path],
    kind: 'file', path: 'src/app.js', ...over,
  })

  it('names a clone of a GitHub repository by its owner and name, whatever the folder is called', async () => {
    expect(await pin(listing('git@github.com:KnownExus/Nexus.git'))).toEqual({
      target: 'git', kind: 'file', path: '/src/app.js',
      repo: { provider: 'github', name: 'knownexus/nexus'.split('/')[1], fullName: 'knownexus/nexus', remote: 'github.com/knownexus/nexus' },
    })
  })
  it('names a clone of anything else by its folder and remote', async () => {
    expect((await pin(listing('https://org@dev.azure.com/org/Core/_git/api'))).repo).toEqual({
      provider: 'local', name: 'nexus-checkout', remote: 'dev.azure.com/org/core/api',
    })
  })
  it('names a clone with no remote by its folder alone, so only this computer can open it', async () => {
    expect((await pin('')).repo).toEqual({ provider: 'local', name: 'nexus-checkout' })
  })
  it('still pins when git cannot be asked', async () => {
    const t = await localPinTarget({
      adapter: { remotes: vi.fn(async () => { throw new Error('boom') }) }, repo, worktreePath: repo.path, registered: [],
      kind: 'folder', path: 'docs/deep',
    })
    expect(t).toMatchObject({ kind: 'folder', path: '/docs/deep', repo: { provider: 'local', name: 'nexus-checkout' } })
  })
  it('never carries credentials from the clone URL', async () => {
    expect(JSON.stringify(await pin(listing('https://me:s3cret@github.com/o/n.git')))).not.toMatch(/s3cret|me:/)
  })
  it('gives a path with a leading slash however it is written', async () => {
    expect((await pin('', { path: '/src/app.js' })).path).toBe('/src/app.js')
  })
})
