import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadAdoData, loadCachedAdoData } from '../../src/modules/ado/loader.js'
import { core } from '../../src/core.js'

afterEach(() => vi.restoreAllMocks())

function makeHttp(overrides = {}) {
  return {
    fetch: vi.fn(async (path) => {
      for (const [pattern, data] of Object.entries(overrides)) {
        if (path.includes(pattern)) return { ok: true, status: 200, json: async () => data }
      }
      return { ok: true, status: 200, json: async () => ({ value: [] }) }
    }),
  }
}

function makeStorage() {
  const store = {}
  return {
    get: vi.fn(key => store[key] ?? null),
    set: vi.fn((key, val) => { store[key] = val }),
    remove: vi.fn(key => { delete store[key] }),
    keys: vi.fn(() => Object.keys(store)),
    _store: store,
  }
}

const CACHE_KEY = 'nexusmd.ado.cache.v1'

// ── loadCachedAdoData ─────────────────────────────────────────────────────────

describe('loadCachedAdoData', () => {
  it('returns null when cache is empty', () => {
    const storage = makeStorage()
    expect(loadCachedAdoData({ org: 'myorg' }, { storage })).toBeNull()
  })

  it('returns cached object when valid', () => {
    const storage = makeStorage()
    storage.set(CACHE_KEY, { WORK_ITEMS: [], ORG: 'myorg' })
    const result = loadCachedAdoData({ org: 'myorg' }, { storage })
    expect(result).toMatchObject({ WORK_ITEMS: [] })
  })

  it('returns null when cached ORG does not match config org', () => {
    const storage = makeStorage()
    storage.set(CACHE_KEY, { WORK_ITEMS: [], ORG: 'other-org' })
    expect(loadCachedAdoData({ org: 'myorg' }, { storage })).toBeNull()
  })

  it('returns null when cached value has no WORK_ITEMS array', () => {
    const storage = makeStorage()
    storage.set(CACHE_KEY, { foo: 'bar' })
    expect(loadCachedAdoData({ org: 'myorg' }, { storage })).toBeNull()
  })

  it('returns cached object when stored as a JSON string', () => {
    const storage = makeStorage()
    storage.set(CACHE_KEY, JSON.stringify({ WORK_ITEMS: [], ORG: 'myorg' }))
    const result = loadCachedAdoData({ org: 'myorg' }, { storage })
    expect(result).toMatchObject({ WORK_ITEMS: [] })
  })
})

// ── loadAdoData ───────────────────────────────────────────────────────────────

describe('loadAdoData — validation', () => {
  it('throws when config.org is missing', async () => {
    await expect(loadAdoData({}, { http: makeHttp(), storage: makeStorage() }))
      .rejects.toThrow('config.org is required')
  })

  it('throws when http adapter is null', async () => {
    await expect(loadAdoData({ org: 'myorg' }, { http: null, storage: makeStorage() }))
      .rejects.toThrow('http adapter is required')
  })
})

describe('loadAdoData — events', () => {
  it('emits ado:loaded on first load', async () => {
    const spy = vi.spyOn(core, '_emit').mockImplementation(() => {})
    await loadAdoData({ org: 'myorg', projects: [] }, { http: makeHttp(), storage: makeStorage() })
    expect(spy).toHaveBeenCalledWith('ado:loaded', expect.any(Object))
  })

  it('emits ado:updated on refresh', async () => {
    const spy = vi.spyOn(core, '_emit').mockImplementation(() => {})
    const priorData = { TEAM: [], ME: { id: 'me', name: 'Test', role: 'EM', initials: 'T', org: 'myorg' }, _iterMeta: null }
    await loadAdoData(
      { org: 'myorg', projects: [] },
      { http: makeHttp(), storage: makeStorage() },
      { isRefresh: true, priorData },
    )
    expect(spy).toHaveBeenCalledWith('ado:updated', expect.any(Object))
  })
})

describe('loadAdoData — cache', () => {
  it('writes result to storage under CACHE_KEY', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const storage = makeStorage()
    await loadAdoData({ org: 'myorg', projects: [] }, { http: makeHttp(), storage })
    expect(storage.set).toHaveBeenCalledWith(CACHE_KEY, expect.any(Object))
  })
})

describe('loadAdoData — return shape', () => {
  it('returns an object with all required fields', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const result = await loadAdoData(
      { org: 'myorg', projects: [] },
      { http: makeHttp(), storage: makeStorage() },
    )
    expect(result).toMatchObject({
      ORG: 'myorg',
      WORK_ITEMS: expect.any(Array),
      PRS: expect.any(Array),
      BUILDS: expect.any(Array),
      TESTS: expect.any(Array),
      ACTIVITY: expect.any(Array),
      SPRINT: expect.any(Object),
      TEAM: expect.any(Array),
      PROJECTS: expect.any(Array),
      loaded: true,
      configured: true,
    })
  })

  it('uses priorData.TEAM on refresh', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const priorTeam = [{ id: 'alice', name: 'Alice', role: 'Dev', initials: 'A', tz: 'UTC' }]
    const priorData = { TEAM: priorTeam, ME: { id: 'me', name: 'Me', role: 'EM', initials: 'ME', org: 'myorg' }, _iterMeta: null }
    const result = await loadAdoData(
      { org: 'myorg', projects: [] },
      { http: makeHttp(), storage: makeStorage() },
      { isRefresh: true, priorData },
    )
    expect(result.TEAM[0].name).toBe('Alice')
  })
})

describe('loadAdoData — resilience', () => {
  it('returns valid shape even when all fetches return empty value arrays', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp()
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    expect(result.WORK_ITEMS).toEqual([])
    expect(result.PRS).toEqual([])
  })
})

describe('loadAdoData — PR work-item links', () => {
  it('populates PR linkedWorkItems from the PR workitems endpoint', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({
      '/_apis/git/repositories?': { value: [{ id: 'repo1', name: 'Repo One' }] },
      '/pullrequests?': { value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [] }] },
      '/pullRequests/55/workitems': { value: [{ id: '7' }, { id: '9' }] },
    })
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    const pr = result.PRS.find(p => p.id === 55)
    expect(pr).toBeTruthy()
    expect(pr.linkedWorkItems.map(w => w.id)).toEqual([7, 9])
  })

  it('degrades to empty links when the workitems endpoint fails', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = {
      fetch: vi.fn(async (path) => {
        if (path.includes('/pullRequests/55/workitems')) return { ok: false, status: 500, json: async () => ({}) }
        if (path.includes('/_apis/git/repositories?')) return { ok: true, status: 200, json: async () => ({ value: [{ id: 'repo1', name: 'Repo One' }] }) }
        if (path.includes('/pullrequests?')) return { ok: true, status: 200, json: async () => ({ value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [] }] }) }
        return { ok: true, status: 200, json: async () => ({ value: [] }) }
      }),
    }
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    expect(result.PRS.find(p => p.id === 55).linkedWorkItems).toEqual([])
  })
})

describe('loadAdoData — PR web url', () => {
  it('builds a DevOps PR web url from org/project/repo/id when _links is absent', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({
      '/_apis/git/repositories?': { value: [{ id: 'repo1', name: 'Repo One' }] },
      '/pullrequests?': { value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [] }] },
    })
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    expect(result.PRS.find(p => p.id === 55).url)
      .toBe('https://dev.azure.com/myorg/proj-a/_git/Repo%20One/pullrequest/55')
  })

  it('prefers the ADO-provided _links.web.href when present', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({
      '/_apis/git/repositories?': { value: [{ id: 'repo1', name: 'Repo One' }] },
      '/pullrequests?': { value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [], _links: { web: { href: 'https://dev.azure.com/x/y/_git/z/pullrequest/55' } } }] },
    })
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    expect(result.PRS.find(p => p.id === 55).url)
      .toBe('https://dev.azure.com/x/y/_git/z/pullrequest/55')
  })
})

import { ADO_CACHE_KEY } from '../../src/index.js'

describe('ADO_CACHE_KEY', () => {
  it('is the shared ADO snapshot storage key', () => {
    expect(ADO_CACHE_KEY).toBe('nexusmd.ado.cache.v1')
  })
})
