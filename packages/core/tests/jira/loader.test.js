import { describe, it, expect, vi } from 'vitest'
import {
  JIRA_CACHE_KEY, buildActiveJql, buildResolvedJql, searchAllIssues, loadJiraData, loadCachedJiraData,
} from '../../src/modules/jira/loader.js'

function res(body) {
  const text = JSON.stringify(body)
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => text, json: async () => body }
}

function makeStorage() {
  const store = {}
  return { get: vi.fn(k => store[k] ?? null), set: vi.fn((k, v) => { store[k] = v }), _store: store }
}

const CONFIG = { site: 'https://acme.atlassian.net', projectKeys: ['ABC'], jql: '' }
const ISSUE = (key, status = 'To Do', cat = 'new') => ({
  key, fields: { summary: key, issuetype: { name: 'Story' }, status: { name: status, statusCategory: { key: cat } }, project: { key: 'ABC', name: 'Alpha' } },
})

function makeHttp({ searchPages = [[ISSUE('ABC-1')]], resolved = [], board = null } = {}) {
  let page = 0
  return {
    fetch: vi.fn(async (path, opts) => {
      if (path === 'rest/api/3/search/jql') {
        const body = JSON.parse(opts.body)
        if (body.jql.includes('statusCategory = Done')) return res({ issues: resolved })
        const issues = searchPages[page] || []
        page += 1
        return res({ issues, ...(page < searchPages.length ? { nextPageToken: `t${page}` } : {}) })
      }
      if (path.includes('/statuses')) return res([{ name: 'Story', statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }] }])
      if (path.includes('rest/api/3/priority')) return res([{ id: '3', name: 'Medium' }])
      if (path.includes('rest/api/3/field')) return res([])
      if (path.includes('myself')) return res({ accountId: 'me', displayName: 'Me' })
      if (path.includes('multiProjectSearch')) return res([])
      if (path.includes('rest/agile/1.0/board/')) {
        if (board instanceof Error) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '', json: async () => ({}) }
        return res(board || { columnConfig: { columns: [] } })
      }
      throw new Error(`unexpected ${path}`)
    }),
  }
}

describe('JQL builders', () => {
  it('limits active issues to the configured projects and open categories', () => {
    expect(buildActiveJql(['ABC', 'DEF'])).toBe('project in ("ABC", "DEF") AND statusCategory != Done ORDER BY updated DESC')
  })
  it('wraps user JQL in parentheses so OR cannot widen the project scope', () => {
    expect(buildActiveJql(['ABC'], 'labels = a OR labels = b'))
      .toBe('project in ("ABC") AND statusCategory != Done AND (labels = a OR labels = b) ORDER BY updated DESC')
  })
  it('builds the resolved-in-14-days query', () => {
    expect(buildResolvedJql(['ABC'], ' ')).toBe('project in ("ABC") AND statusCategory = Done AND resolved >= -14d ORDER BY resolved DESC')
  })
})

describe('searchAllIssues', () => {
  it('follows nextPageToken until exhausted', async () => {
    const http = makeHttp({ searchPages: [[ISSUE('ABC-1')], [ISSUE('ABC-2')]] })
    const { makeJiraClient } = await import('../../src/modules/jira/client.js')
    const out = await searchAllIssues(makeJiraClient(http), 'jql', ['summary'], 500)
    expect(out.map(i => i.key)).toEqual(['ABC-1', 'ABC-2'])
    const bodies = http.fetch.mock.calls.map(([, o]) => JSON.parse(o.body))
    expect(bodies[1].nextPageToken).toBe('t1')
  })
  it('stops at the max', async () => {
    const http = makeHttp({ searchPages: [[ISSUE('ABC-1'), ISSUE('ABC-2')], [ISSUE('ABC-3')]] })
    const { makeJiraClient } = await import('../../src/modules/jira/client.js')
    const out = await searchAllIssues(makeJiraClient(http), 'jql', ['summary'], 2)
    expect(out).toHaveLength(2)
    expect(http.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('loadJiraData', () => {
  it('loads, maps and caches issues', async () => {
    const storage = makeStorage()
    const data = await loadJiraData(CONFIG, { http: makeHttp(), storage })
    expect(data.SITE).toBe('https://acme.atlassian.net')
    expect(data.WORK_ITEMS.map(w => w.id)).toEqual(['jira:ABC-1'])
    expect(data.PROJECTS).toEqual([expect.objectContaining({ id: 'abc', name: 'Alpha', key: 'ABC', source: 'jira' })])
    expect(data.TYPES).toEqual(['Story'])
    expect(data.WI_TYPE_STATES).toEqual({ Story: ['To Do'] })
    expect(data.PRIORITIES).toEqual([{ id: '3', name: 'Medium', rank: 1 }])
    expect(data.ME).toMatchObject({ accountId: 'me' })
    expect(storage.set).toHaveBeenCalledWith(JIRA_CACHE_KEY, data)
  })

  it('maps resolved issues for the digest', async () => {
    const data = await loadJiraData(CONFIG, {
      http: makeHttp({ resolved: [{ key: 'ABC-9', fields: { summary: 's', issuetype: { name: 'Bug' }, status: { name: 'Done' }, resolutiondate: 'r' } }] }),
      storage: makeStorage(),
    })
    expect(data.RESOLVED_WI).toEqual([expect.objectContaining({ id: 'jira:ABC-9', closedDate: 'r' })])
  })

  const PRIOR_META = {
    types: ['Epic'], typeStates: {}, stateCategoryByName: {}, states: [],
    priorities: [{ id: '1', name: 'High', rank: 1 }], fieldIds: {}, me: null,
    people: [{ id: 'p1', accountId: 'p1', name: 'Pat' }],
  }
  const fetchedMeta = (http) => http.fetch.mock.calls.some(([p]) => p.includes('/statuses'))

  it('reuses prior metadata on refresh', async () => {
    const http = makeHttp()
    const data = await loadJiraData(CONFIG, { http, storage: makeStorage() }, { isRefresh: true, priorData: { PROJECT_KEYS: ['ABC'], _jiraMeta: PRIOR_META } })
    expect(data.TYPES).toEqual(['Epic'])
    expect(fetchedMeta(http)).toBe(false)
  })

  it('stores a sorted copy of the configured project keys', async () => {
    const config = { ...CONFIG, projectKeys: ['ZED', 'ABC'] }
    const data = await loadJiraData(config, { http: makeHttp(), storage: makeStorage() })
    expect(data.PROJECT_KEYS).toEqual(['ABC', 'ZED'])
    expect(config.projectKeys).toEqual(['ZED', 'ABC'])
  })

  it('refetches metadata on refresh when the configured project keys changed', async () => {
    const http = makeHttp()
    const data = await loadJiraData({ ...CONFIG, projectKeys: ['ABC', 'DEF'] }, { http, storage: makeStorage() },
      { isRefresh: true, priorData: { PROJECT_KEYS: ['ABC'], _jiraMeta: PRIOR_META } })
    expect(fetchedMeta(http)).toBe(true)
    expect(data.TYPES).toEqual(['Story'])
  })

  it('refetches metadata on refresh when the prior data has no PROJECT_KEYS', async () => {
    const http = makeHttp()
    await loadJiraData(CONFIG, { http, storage: makeStorage() }, { isRefresh: true, priorData: { _jiraMeta: PRIOR_META } })
    expect(fetchedMeta(http)).toBe(true)
  })

  it('treats project keys in a different order as unchanged', async () => {
    const http = makeHttp()
    await loadJiraData({ ...CONFIG, projectKeys: ['DEF', 'ABC'] }, { http, storage: makeStorage() },
      { isRefresh: true, priorData: { PROJECT_KEYS: ['ABC', 'DEF'], _jiraMeta: PRIOR_META } })
    expect(fetchedMeta(http)).toBe(false)
  })

  it('refetches metadata on refresh when prior people or priorities are empty', async () => {
    for (const patch of [{ people: [] }, { priorities: [] }, { people: undefined }]) {
      const http = makeHttp()
      await loadJiraData(CONFIG, { http, storage: makeStorage() },
        { isRefresh: true, priorData: { PROJECT_KEYS: ['ABC'], _jiraMeta: { ...PRIOR_META, ...patch } } })
      expect(fetchedMeta(http)).toBe(true)
    }
  })

  it('throws when the active search fails so the caller can keep the cache', async () => {
    const http = { fetch: vi.fn(async (path) => (path === 'rest/api/3/search/jql'
      ? { ok: false, status: 401, headers: { get: () => null }, text: async () => '', json: async () => ({}) }
      : res([]))) }
    await expect(loadJiraData(CONFIG, { http, storage: makeStorage() })).rejects.toMatchObject({ status: 401 })
  })

  it('validates its inputs', async () => {
    await expect(loadJiraData({}, { http: makeHttp() })).rejects.toThrow('config.site is required')
    await expect(loadJiraData(CONFIG, {})).rejects.toThrow('http adapter is required')
  })
})

describe('loadCachedJiraData', () => {
  it('returns the cache for the same site and null for another site', () => {
    const storage = makeStorage()
    storage._store[JIRA_CACHE_KEY] = { SITE: 'https://acme.atlassian.net', WORK_ITEMS: [] }
    expect(loadCachedJiraData(CONFIG, { storage })).toMatchObject({ WORK_ITEMS: [] })
    expect(loadCachedJiraData({ site: 'https://other.atlassian.net' }, { storage })).toBeNull()
  })
  it('returns null for missing or malformed cache', () => {
    const storage = makeStorage()
    expect(loadCachedJiraData(CONFIG, { storage })).toBeNull()
    storage._store[JIRA_CACHE_KEY] = '{bad'
    expect(loadCachedJiraData(CONFIG, { storage })).toBeNull()
  })
})

describe('loadJiraData board layout', () => {
  it('publishes the chosen board\'s columns', async () => {
    const http = makeHttp({ board: { columnConfig: { columns: [{ name: 'Todo', statuses: [{ id: '1' }] }] } } })
    const data = await loadJiraData({ ...CONFIG, boardId: '7' }, { http, storage: makeStorage() })
    expect(data.BOARD_ID).toBe('7')
    expect(data.BOARD_COLUMNS).toEqual([{ name: 'Todo', statuses: ['To Do'] }])
    expect(data.BOARD_ERROR).toBeNull()
  })
  it('keeps loading items when the board cannot be read', async () => {
    const data = await loadJiraData({ ...CONFIG, boardId: '7' }, { http: makeHttp({ board: new Error('gone') }), storage: makeStorage() })
    expect(data.WORK_ITEMS).toHaveLength(1)
    expect(data.BOARD_COLUMNS).toBeNull()
    expect(data.BOARD_ERROR).toMatch(/404/)
  })
  it('makes no Agile call when no board is chosen', async () => {
    const http = makeHttp()
    const data = await loadJiraData(CONFIG, { http, storage: makeStorage() })
    expect(data.BOARD_COLUMNS).toBeNull()
    expect(http.fetch.mock.calls.some(([p]) => p.includes('rest/agile'))).toBe(false)
  })
  it('refetches metadata on refresh when a board is chosen but cached meta lacks status ids', async () => {
    const http = makeHttp({ board: { columnConfig: { columns: [] } } })
    const priorMeta = { types: ['Story'], typeStates: {}, stateCategoryByName: {}, states: [], priorities: [{ id: '3', name: 'Medium', rank: 1 }], fieldIds: {}, me: null, people: [{ accountId: 'a', displayName: 'A', avatarUrl: '' }] }
    await loadJiraData({ ...CONFIG, boardId: '7' }, { http, storage: makeStorage() }, { isRefresh: true, priorData: { _jiraMeta: priorMeta, PROJECT_KEYS: ['ABC'] } })
    expect(http.fetch.mock.calls.some(([p]) => p.includes('/statuses'))).toBe(true)
  })
})
