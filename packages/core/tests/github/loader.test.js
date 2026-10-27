import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadGithubData, loadCachedGithubData, GITHUB_CACHE_KEY } from '../../src/modules/github/loader.js'
import { GithubError } from '../../src/modules/github/client.js'
import { core } from '../../src/core.js'

afterEach(() => vi.restoreAllMocks())

const PAT = 'ghp_SECRET_TOKEN_123'
const resp = (status, data) => ({
  ok: status >= 200 && status < 300, status, headers: {},
  text: async () => JSON.stringify(data ?? {}),
})

// routes matched by substring in insertion order; a number is an error status
function makeHttp(routes = {}) {
  return {
    fetch: vi.fn(async (path) => {
      for (const [pattern, v] of Object.entries(routes)) {
        if (path.includes(pattern)) {
          if (typeof v === 'number') return resp(v, { message: 'x' })
          return resp(200, v)
        }
      }
      return resp(200, [])
    }),
  }
}
function makeStorage() {
  const store = {}
  return { get: vi.fn(k => store[k] ?? null), set: vi.fn((k, v) => { store[k] = v }), _store: store }
}
const cfg = (repos = ['acme/web', 'acme/api']) => ({ pat: PAT, repos, issues: true, login: '', refreshSecs: 60 })
const issue = (n, extra = {}) => ({ number: n, title: `Issue ${n}`, state: 'open', labels: [], updated_at: new Date().toISOString(), html_url: `u${n}`, ...extra })
const pr = (n, extra = {}) => ({ number: n, title: `PR ${n}`, state: 'open', body: '', user: { login: 'bob' }, head: { ref: 'f' }, base: { ref: 'main' }, created_at: new Date().toISOString(), ...extra })
const urls = (http) => http.fetch.mock.calls.map(c => c[0])

describe('loadCachedGithubData', () => {
  it('null when empty or lacking WORK_ITEMS; returns object as is', () => {
    const storage = makeStorage()
    expect(loadCachedGithubData(cfg(), { storage })).toBeNull()
    storage.set(GITHUB_CACHE_KEY, { foo: 1 })
    expect(loadCachedGithubData(cfg(), { storage })).toBeNull()
    storage.set(GITHUB_CACHE_KEY, { WORK_ITEMS: [] })
    expect(loadCachedGithubData(cfg(), { storage })).toEqual({ WORK_ITEMS: [] })
  })
  it('parses a JSON string', () => {
    const storage = makeStorage()
    storage.set(GITHUB_CACHE_KEY, JSON.stringify({ WORK_ITEMS: [] }))
    expect(loadCachedGithubData(cfg(), { storage })).toEqual({ WORK_ITEMS: [] })
  })
})

describe('loadGithubData', () => {
  it('drops PR-shaped entries from issues and emits github:loaded', async () => {
    const emit = vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({
      'user': { login: 'me', name: 'Me', avatar_url: 'a.png' },
      '/issues?': [issue(1), issue(2, { pull_request: {} })],
    })
    const storage = makeStorage()
    const d = await loadGithubData(cfg(['acme/web']), { http, storage })
    expect(d.WORK_ITEMS.map(w => w.id)).toEqual(['gh:acme/web#1'])
    expect(d.ME).toEqual({ login: 'me', name: 'Me', avatarUrl: 'a.png' })
    expect(d.STATES).toEqual(['Open', 'Closed'])
    expect(d.loaded).toBe(true)
    expect(d.configured).toBe(true)
    expect(d.REPOS).toEqual(['acme/web'])
    expect(emit).toHaveBeenCalledWith('github:loaded', d)
    expect(storage.set).toHaveBeenCalledWith(GITHUB_CACHE_KEY, d)
  })

  it('emits github:updated on refresh and does not call /user', async () => {
    const emit = vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({})
    const prior = { ME: { login: 'me', name: 'Me', avatarUrl: '' } }
    const d = await loadGithubData(cfg(['acme/web']), { http, storage: makeStorage() }, { isRefresh: true, priorData: prior })
    expect(urls(http).some(u => u === 'user')).toBe(false)
    expect(d.ME).toEqual(prior.ME)
    expect(emit).toHaveBeenCalledWith('github:updated', d)
  })

  it('records failing calls in REPO_ERRORS without failing; other repos still load', async () => {
    const http = makeHttp({
      'repos/acme/web/issues': 410,
      'repos/acme/web/actions': 404,
      'repos/acme/api/issues': [issue(7)],
      'repos/acme/api/pulls?': [pr(3)],
      'repos/acme/api/pulls/3/reviews': [],
      'repos/acme/api/pulls/3': { ...pr(3), mergeable_state: 'dirty' },
      'repos/acme/api/actions': { workflow_runs: [{ id: 9, status: 'completed', conclusion: 'success', name: 'CI' }] },
    })
    const d = await loadGithubData(cfg(), { http, storage: makeStorage() })
    const kinds = d.REPO_ERRORS.filter(e => e.repo === 'acme/web').map(e => e.kind).sort()
    expect(kinds).toEqual(['gone', 'not-found'])
    expect(d.REPO_ERRORS.every(e => e.repo === 'acme/web' && typeof e.message === 'string')).toBe(true)
    expect(d.WORK_ITEMS.map(w => w.id)).toEqual(['gh:acme/api#7'])
    expect(d.PRS).toHaveLength(1)
    expect(d.PRS[0].hasConflicts).toBe(true)
    expect(d.BUILDS).toHaveLength(1)
  })

  it('honours skip flags', async () => {
    const http = makeHttp({})
    const d = await loadGithubData(cfg(), { http, storage: makeStorage() }, { skip: { workItems: true } })
    expect(urls(http).some(u => u.includes('/issues'))).toBe(false)
    expect(d.WORK_ITEMS).toEqual([])
    const h2 = makeHttp({})
    await loadGithubData(cfg(), { http: h2, storage: makeStorage() }, { skip: { prs: true } })
    expect(urls(h2).some(u => u.includes('/pulls'))).toBe(false)
    const h3 = makeHttp({})
    await loadGithubData(cfg(), { http: h3, storage: makeStorage() }, { skip: { builds: true } })
    expect(urls(h3).some(u => u.includes('/actions'))).toBe(false)
  })

  it('keeps same issue number in two repos distinct', async () => {
    const http = makeHttp({ '/issues?': [issue(5)] })
    const d = await loadGithubData(cfg(), { http, storage: makeStorage() })
    expect(d.WORK_ITEMS.map(w => w.id).sort()).toEqual(['gh:acme/api#5', 'gh:acme/web#5'])
  })

  it('links PRs to issues from the body', async () => {
    const http = makeHttp({
      'pulls?': [pr(8, { body: 'Closes #4' })],
      'pulls/8/reviews': [],
      'pulls/8': pr(8, { body: 'Closes #4', mergeable_state: 'clean' }),
    })
    const d = await loadGithubData(cfg(['acme/web']), { http, storage: makeStorage() })
    expect(d.PRS[0].linkedWorkItems).toEqual([{ id: 'gh:acme/web#4' }])
  })

  it('never stores the PAT or Authorization', async () => {
    const http = makeHttp({ '/issues?': [issue(1)] })
    const storage = makeStorage()
    const d = await loadGithubData(cfg(), { http, storage })
    const s = JSON.stringify(storage._store) + JSON.stringify(d)
    expect(s).not.toContain(PAT)
    expect(s).not.toContain('Authorization')
  })

  it('sets PR_ERROR when PR lists fail and no PRs load', async () => {
    const http = makeHttp({ 'repos/acme/web/pulls': 403 })
    const d = await loadGithubData(cfg(['acme/web']), { http, storage: makeStorage() })
    expect(typeof d.PR_ERROR).toBe('string')
    expect(d.PR_ERROR.length).toBeGreaterThan(0)
  })

  it('rejects with an auth GithubError when every repo fails with 401', async () => {
    const http = makeHttp({ 'repos/': 401 })
    await expect(loadGithubData(cfg(), { http, storage: makeStorage() }))
      .rejects.toMatchObject({ name: 'GithubError', kind: 'auth' })
    await expect(loadGithubData(cfg(), { http, storage: makeStorage() })).rejects.toBeInstanceOf(GithubError)
  })

  it('does not reject when only some repos fail with 401', async () => {
    const http = makeHttp({ 'repos/acme/web/': 401 })
    const d = await loadGithubData(cfg(), { http, storage: makeStorage() })
    expect(d.REPO_ERRORS.some(e => e.kind === 'auth')).toBe(true)
  })
})
