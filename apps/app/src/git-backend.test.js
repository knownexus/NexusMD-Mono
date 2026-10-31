import { describe, it, expect, vi } from 'vitest'
import { makeGitBackend, githubReposFromConfig, isGithubRepo, providerName } from './git-backend.js'

const reply = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(data) })
const fakeGithub = (routes) => ({ fetch: vi.fn(async (path) => {
  const hit = Object.entries(routes).find(([p]) => path.startsWith(p))
  return hit ? reply(typeof hit[1] === 'function' ? hit[1](path) : hit[1]) : reply({ message: 'nope' }, 404)
}) })

const make = (over = {}) => makeGitBackend({
  adoGet: vi.fn(), getAdoProjects: () => [], githubHttp: fakeGithub({}),
  getGithubConfig: () => ({ repos: ['acme/web', 'me/dots'] }), isGithubConfigured: () => true, ...over,
})

describe('githubReposFromConfig', () => {
  it('turns ticked repos into repo objects owned by their owner', () => {
    expect(githubReposFromConfig({ repos: ['acme/web'] })).toEqual([
      { id: 'gh:acme/web', name: 'web', project: 'acme', fullName: 'acme/web', defaultBranch: '', provider: 'github' },
    ])
    expect(githubReposFromConfig(null)).toEqual([])
  })
})

describe('git backend', () => {
  it('lists the ticked GitHub repos beside ADO ones', async () => {
    const adoGet = vi.fn(async () => ({ value: [{ id: '1', name: 'alpha', defaultBranch: 'refs/heads/main' }] }))
    const { repos, errors } = await make({ adoGet, getAdoProjects: () => ['P'] }).listRepos()
    expect(errors).toEqual([])
    expect(repos.map(r => `${r.provider}:${r.name}`)).toEqual(['ado:alpha', 'github:web', 'github:dots'])
  })

  it('still lists GitHub repos when ADO fails, and reports the error', async () => {
    const adoGet = vi.fn(async () => { throw new Error('ADO 401') })
    const { repos, errors } = await make({ adoGet, getAdoProjects: () => ['P'] }).listRepos()
    expect(repos.map(r => r.provider)).toEqual(['github', 'github'])
    expect(errors[0].message).toBe('ADO 401')
  })

  it('lists no GitHub repos while GitHub is not configured', async () => {
    const { repos } = await make({ isGithubConfigured: () => false }).listRepos()
    expect(repos).toEqual([])
  })

  it('reads GitHub branches, commits, folders and files in the UI shapes', async () => {
    const b = make({ githubHttp: fakeGithub({
      'repos/acme/web/branches': [{ name: 'dev', commit: { sha: 'a' } }, { name: 'main', commit: { sha: 'b' } }],
      'repos/acme/web/commits': [{ sha: 'abcdef1234567', commit: { message: 'Fix it\n\nbody', author: { name: 'Ann', date: '2026-10-01' } } }],
      'repos/acme/web/contents/src': [{ name: 'a.js', path: 'src/a.js', type: 'file' }, { name: 'lib', path: 'src/lib', type: 'dir' }],
      'repos/acme/web/contents/README.md': { content: btoa('# Hi'), size: 4, html_url: 'u' },
      'repos/acme/web': { default_branch: 'main' },
    }) })
    const repo = githubReposFromConfig({ repos: ['acme/web'] })[0]
    expect((await b.listBranches(repo)).map(x => `${x.name}${x.isDefault ? '*' : ''}`)).toEqual(['main*', 'dev'])
    expect(await b.listCommits(repo, 'main')).toEqual([{ id: 'abcdef1234567', shortId: 'abcdef12', message: 'Fix it', author: 'Ann', date: '2026-10-01', url: 'https://github.com/acme/web/commit/abcdef1234567' }])
    expect(await b.listItems(repo, 'main', '/src')).toEqual([{ path: '/src/lib', name: 'lib', isFolder: true }, { path: '/src/a.js', name: 'a.js', isFolder: false }])
    expect(await b.getFile(repo, 'main', '/README.md')).toBe('# Hi')
  })

  it('refuses binary files with a readable message', async () => {
    const b = make({ githubHttp: fakeGithub({ 'repos/acme/web/contents/x.bin': { content: btoa('a\0b'), size: 3 } }) })
    await expect(b.getFile(githubReposFromConfig({ repos: ['acme/web'] })[0], 'main', '/x.bin')).rejects.toThrow('Only text files')
  })

  it('labels repos by provider', () => {
    expect(isGithubRepo({ provider: 'github' })).toBe(true)
    expect(providerName({ provider: 'github' })).toBe('GitHub')
    expect(providerName({ provider: 'ado' })).toBe('Azure DevOps')
  })
})

import { sourcesOf, pickSource, sourceLabel } from './git-backend.js'

describe('repo sources', () => {
  const ado = { id: '1', provider: 'ado' }, gh = { id: 'gh:a/b', provider: 'github' }
  it('lists only the providers that have repos, in a fixed order', () => {
    expect(sourcesOf([gh, ado])).toEqual(['ado', 'github'])
    expect(sourcesOf([gh])).toEqual(['github'])
    expect(sourcesOf([])).toEqual([])
    expect(sourcesOf([{ id: 'old' }])).toEqual(['ado'])
  })
  it('keeps the saved choice while it still has repos, else the first available', () => {
    expect(pickSource('github', ['ado', 'github'])).toBe('github')
    expect(pickSource('github', ['ado'])).toBe('ado')
    expect(pickSource(null, ['github'])).toBe('github')
    expect(pickSource('ado', [])).toBeNull()
  })
  it('names the sources', () => {
    expect(sourceLabel('github')).toBe('GitHub')
    expect(sourceLabel('ado')).toBe('Azure DevOps')
  })
})
