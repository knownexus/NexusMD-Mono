import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => 'p.' + k, getActiveProfileId: () => 'p' }))

const { createGithubHttpAdapter, getGithubConfig, saveGithubConfig, usesGithubWorkItems, isGithubConfigured } = await import('./github-client.js')

const okResp = (data, status = 200) => ({ status, data, headers: { 'X-RateLimit-Remaining': '4999' } })

describe('github http adapter', () => {
  beforeEach(() => { localStorage.clear() })

  it('sends the token and GitHub headers to api.github.com', async () => {
    const request = vi.fn(async () => okResp({ login: 'me' }))
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 'tok' }), request })
    const r = await http.fetch('user')
    expect(request).toHaveBeenCalledOnce()
    const req = request.mock.calls[0][0]
    expect(req.url).toBe('https://api.github.com/user')
    expect(req.headers.Authorization).toBe('Bearer tok')
    expect(req.headers.Accept).toBe('application/vnd.github+json')
    expect(req.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(r.ok).toBe(true)
    expect(await r.json()).toEqual({ login: 'me' })
    expect(r.headers.get('x-ratelimit-remaining')).toBe('4999')
  })

  it('fires nexusmd:github-401 on a 401 and not on a 200', async () => {
    const seen = vi.fn()
    window.addEventListener('nexusmd:github-401', seen)
    const http = (status) => createGithubHttpAdapter({ getConfig: () => ({ pat: 't' }), request: async () => okResp({}, status) })
    await http(200).fetch('user')
    expect(seen).not.toHaveBeenCalled()
    const r = await http(401).fetch('user')
    expect(seen).toHaveBeenCalledOnce()
    expect(r.ok).toBe(false)
    window.removeEventListener('nexusmd:github-401', seen)
  })

  it('throws without a token', async () => {
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: '' }), request: vi.fn() })
    await expect(http.fetch('user')).rejects.toThrow('GitHub token not configured')
  })

  it('sends a JSON body as data', async () => {
    const request = vi.fn(async () => okResp({}))
    const http = createGithubHttpAdapter({ getConfig: () => ({ pat: 't' }), request })
    await http.fetch('repos/a/b/issues/1/comments', { method: 'POST', body: JSON.stringify({ body: 'hi' }) })
    expect(request.mock.calls[0][0].data).toEqual({ body: 'hi' })
  })
})

describe('github config', () => {
  beforeEach(() => { localStorage.clear() })

  it('round-trips under the helm.android.github keys', () => {
    saveGithubConfig({ pat: 'tok', repos: ['a/b'], issues: true, login: 'me' })
    expect(localStorage.getItem('p.helm.android.github.pat')).toBe('tok')
    expect(getGithubConfig()).toMatchObject({ pat: 'tok', repos: ['a/b'], issues: true, login: 'me' })
    expect(isGithubConfigured()).toBe(true)
  })

  it('does not use work items when issues are off or GitHub is not connected', () => {
    expect(usesGithubWorkItems()).toBe(false)
    saveGithubConfig({ pat: 'tok', repos: ['a/b'], issues: false })
    expect(usesGithubWorkItems()).toBe(false)
    saveGithubConfig({ issues: true })
    expect(usesGithubWorkItems()).toBe(true)
  })
})
