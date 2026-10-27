import { describe, it, expect, vi } from 'vitest'
import { GithubError, classifyGithubError, makeGithubClient } from '../../src/modules/github/index.js'
import { describeProviderError } from '../../src/modules/workitems/status.js'

const hdrs = (o = {}) => ({ get: (n) => o[String(n).toLowerCase()] ?? null })
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status, headers: hdrs(headers),
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? '')),
})

describe('classifyGithubError', () => {
  const sso = 'https://github.com/orgs/acme/sso?authorization_request=1'
  const cases = {
    auth: classifyGithubError(401, hdrs(), ''),
    sso: classifyGithubError(403, hdrs({ 'x-github-sso': `required; url=${sso}` }), ''),
    rl1: classifyGithubError(403, hdrs({ 'x-ratelimit-remaining': '0' }), ''),
    rl2: classifyGithubError(403, hdrs({ 'retry-after': '30' }), ''),
    scope: classifyGithubError(403, hdrs(), '{"message":"Resource not accessible by personal access token"}'),
    nf: classifyGithubError(404, hdrs(), ''),
    gone: classifyGithubError(410, hdrs(), ''),
  }
  it('classifies kinds', () => {
    expect(cases.auth.kind).toBe('auth')
    expect(cases.sso.kind).toBe('sso')
    expect(cases.sso.ssoUrl).toBe(sso)
    expect(cases.rl1.kind).toBe('rate-limit')
    expect(cases.rl2.kind).toBe('rate-limit')
    expect(cases.scope.kind).toBe('scope')
    expect(cases.nf.kind).toBe('not-found')
    expect(cases.gone.kind).toBe('gone')
  })
  it('has distinct non-empty messages', () => {
    const msgs = [cases.auth, cases.sso, cases.rl1, cases.scope, cases.nf, cases.gone].map(c => c.message)
    expect(msgs.every(m => m && m.length)).toBe(true)
    expect(new Set(msgs).size).toBe(msgs.length)
  })
})

describe('makeGithubClient', () => {
  it('requires an adapter', () => { expect(() => makeGithubClient({})).toThrow() })

  it('adds no Authorization header but sends GitHub headers', async () => {
    const fetch = vi.fn(async () => res(200, { a: 1 }))
    const c = makeGithubClient({ fetch })
    await c.get('user')
    await c.post('repos/a/b/issues', { title: 'x' })
    for (const [, opts] of fetch.mock.calls) {
      const keys = Object.keys(opts.headers || {}).map(k => k.toLowerCase())
      expect(keys).not.toContain('authorization')
      expect(opts.headers.Accept).toBe('application/vnd.github+json')
      expect(opts.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    }
    expect(fetch.mock.calls[1][1].method).toBe('POST')
    expect(fetch.mock.calls[1][1].headers['Content-Type']).toBe('application/json')
    expect(fetch.mock.calls[1][1].body).toBe('{"title":"x"}')
  })

  it('get throws GithubError on !ok', async () => {
    const c = makeGithubClient({ fetch: async () => res(404, '{"message":"Not Found"}') })
    const err = await c.get('repos/a/b').catch(e => e)
    expect(err).toBeInstanceOf(GithubError)
    expect(err.status).toBe(404)
    expect(err.kind).toBe('not-found')
    expect(describeProviderError(err)).toBe(err.message)
  })

  it('getPaged follows Link next in order', async () => {
    const fetch = vi.fn(async (path) => path.includes('page=2')
      ? res(200, [3, 4])
      : res(200, [1, 2], { link: '<https://api.github.com/x?per_page=100&page=2>; rel="next", <https://api.github.com/x?page=2>; rel="last"' }))
    const c = makeGithubClient({ fetch })
    expect(await c.getPaged('x')).toEqual([1, 2, 3, 4])
    expect(fetch.mock.calls[0][0]).toContain('per_page=100')
    expect(fetch.mock.calls[1][0]).toBe('x?per_page=100&page=2')
  })

  it('getPaged stops at max', async () => {
    const fetch = async () => res(200, [1, 2], { link: '<https://api.github.com/x?page=2>; rel="next"' })
    const c = makeGithubClient({ fetch })
    expect(await c.getPaged('x', { max: 3 })).toEqual([1, 2, 1])
  })
})
