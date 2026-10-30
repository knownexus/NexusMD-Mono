import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', () => ({ getProfileKey: k => `p.${k}` }))

import { createGithubHttpAdapter, saveGithubConfig, getGithubConfig, isGithubConfigured, usesGithubWorkItems, desktopGithubSource } from './github-client.js'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

const reply = (status) => ({ ok: status < 300, status, headers: new Headers(), text: async () => '{}', json: async () => ({}) })

describe('config', () => {
  it('stores settings under profile-scoped github.* keys', () => {
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'], issues: false })
    expect(localStorage.getItem('p.github.pat')).toBe('ghp_x')
    expect(getGithubConfig().repos).toEqual(['acme/web'])
    expect(isGithubConfigured()).toBe(true)
    expect(usesGithubWorkItems()).toBe(false)
  })
})

describe('createGithubHttpAdapter', () => {
  it('calls api.github.com with the bearer token and the REST v3 headers', async () => {
    const fetchImpl = vi.fn(async () => reply(200))
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 'ghp_x' }), fetchImpl })
    await http.fetch('repos/acme/web/issues', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/acme/web/issues', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ghp_x',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-cache',
    })
  })

  // GitHub allows its replies to be kept for 60s. A read straight after a change (the refresh after
  // a merge) must ask GitHub again, or the merged PR comes back still open.
  it('has every read checked with GitHub rather than answered from the browser cache', async () => {
    const fetchImpl = vi.fn(async () => reply(200))
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 'ghp_x' }), fetchImpl })
    await http.fetch('repos/acme/web/pulls?state=open')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-cache' })
  })

  it('throws a readable error when there is no token', async () => {
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: '' }), fetchImpl: vi.fn() })
    await expect(http.fetch('user')).rejects.toThrow('GitHub token not configured — open Settings first.')
  })

  it('fires nexusmd:github-401 on a 401 and still returns the response', async () => {
    const seen = vi.fn()
    window.addEventListener('nexusmd:github-401', seen)
    try {
      const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 'ghp_x' }), fetchImpl: vi.fn(async () => reply(401)) })
      const r = await http.fetch('user')
      expect(r.status).toBe(401)
      expect(seen).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('nexusmd:github-401', seen) }
  })

  it('does not fire nexusmd:github-401 on success', async () => {
    const seen = vi.fn()
    window.addEventListener('nexusmd:github-401', seen)
    try {
      const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 'ghp_x' }), fetchImpl: vi.fn(async () => reply(200)) })
      await http.fetch('user')
      expect(seen).not.toHaveBeenCalled()
    } finally { window.removeEventListener('nexusmd:github-401', seen) }
  })
})

describe('desktopGithubSource', () => {
  it('is a GitHub work-item source', () => {
    expect(desktopGithubSource.webUrl({ id: 'gh:acme/web#2' })).toBe('https://github.com/acme/web/issues/2')
  })
})
