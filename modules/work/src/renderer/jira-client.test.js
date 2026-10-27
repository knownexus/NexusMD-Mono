import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', () => ({ getProfileKey: k => `p.${k}` }))

import { createJiraHttpAdapter, createJiraWorkItemSource, saveJiraConfig, getJiraConfig, isJiraActive } from './jira-client.js'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

const CONFIG = { site: 'https://acme.atlassian.net', email: 'me@acme.io', apiToken: 'tok' }

function ipcReply(status, body) {
  return { ok: status < 300, status, headers: { 'retry-after': null }, body: body === undefined ? '' : JSON.stringify(body) }
}

describe('config', () => {
  it('stores settings under profile-scoped jira.* keys', () => {
    saveJiraConfig({ site: 'acme', email: 'me@acme.io', apiToken: 'tok', projectKeys: ['abc'] })
    expect(localStorage.getItem('p.jira.site')).toBe('https://acme.atlassian.net')
    expect(getJiraConfig().projectKeys).toEqual(['ABC'])
    expect(isJiraActive()).toBe(true)
  })
})

describe('createJiraHttpAdapter', () => {
  it('sends Basic email:token auth through the IPC proxy and wraps the reply', async () => {
    const invoke = vi.fn(async () => ipcReply(200, { displayName: 'Me' }))
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke })
    const res = await http.fetch('rest/api/3/myself')
    expect(invoke).toHaveBeenCalledWith({
      url: 'https://acme.atlassian.net/rest/api/3/myself', method: 'GET',
      headers: { Authorization: 'Basic ' + btoa('me@acme.io:tok'), Accept: 'application/json' },
      body: undefined, attachment: undefined,
    })
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ displayName: 'Me' })
    expect(res.headers.get('Retry-After')).toBeNull()
  })

  it('throws a readable error when the site is not configured', async () => {
    const http = createJiraHttpAdapter({ getConfig: () => ({ site: '' }), invoke: vi.fn() })
    await expect(http.fetch('x')).rejects.toThrow('Jira site not configured')
  })

  it('surfaces proxy network errors', async () => {
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke: async () => ({ ok: false, status: 0, error: 'ENOTFOUND' }) })
    await expect(http.fetch('x')).rejects.toThrow('ENOTFOUND')
  })
})

describe('createJiraWorkItemSource', () => {
  it('moves into the first reachable status of a column', async () => {
    const { invoke, source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [
        { id: '21', to: { name: 'Code Review', statusCategory: { key: 'indeterminate' } } },
      ] }),
    })
    expect(await source.moveToStatuses('jira:ABC-1', ['In Progress', 'Code Review'], { state: 'To Do' }))
      .toEqual({ state: 'Code Review', stateCategory: 'InProgress' })
    const post = invoke.mock.calls.find(([r]) => r.method === 'POST')[0]
    expect(JSON.parse(post.body)).toEqual({ transition: { id: '21' } })
  })

  it('lists boards for project keys', async () => {
    const { source } = makeSource({
      'GET https://acme.atlassian.net/rest/agile/1.0/board?projectKeyOrId=ABC': ipcReply(200, { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] }),
    })
    expect(await source.getBoards(['ABC'])).toEqual([{ id: '7', name: 'Team board', type: 'scrum', projectKey: 'ABC' }])
  })

  const meta = { priorities: [{ id: '2', name: 'High', rank: 2 }], fieldIds: {} }
  const people = [{ accountId: 'u1', displayName: 'Alex Doe' }]

  function makeSource(routes) {
    const invoke = vi.fn(async ({ url, method }) => {
      for (const [pattern, reply] of Object.entries(routes)) {
        if (`${method} ${url}`.includes(pattern)) return reply
      }
      return ipcReply(204)
    })
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke })
    return { invoke, source: createJiraWorkItemSource({ http, getMeta: () => meta, getPeople: () => people, getSite: () => CONFIG.site }) }
  }

  it('turns a state write into a workflow transition', async () => {
    const { invoke, source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }] }),
    })
    await source.saveField('jira:ABC-1', 'System.State', 'Done')
    const post = invoke.mock.calls.find(([r]) => r.method === 'POST')[0]
    expect(post.url).toBe('https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions')
    expect(JSON.parse(post.body)).toEqual({ transition: { id: '31' } })
  })

  it('assigns by display name and sets priority by rank', async () => {
    const { invoke, source } = makeSource({})
    await source.saveField('jira:ABC-1', 'System.AssignedTo', 'Alex Doe')
    await source.saveField('jira:ABC-1', 'Microsoft.VSTS.Common.Priority', 2)
    const puts = invoke.mock.calls.filter(([r]) => r.method === 'PUT').map(([r]) => JSON.parse(r.body))
    expect(puts).toEqual([{ fields: { assignee: { accountId: 'u1' } } }, { fields: { priority: { name: 'High' } } }])
  })

  it('rejects assigning someone who is not assignable in Jira', async () => {
    const { source } = makeSource({})
    await expect(source.saveField('jira:ABC-1', 'System.AssignedTo', 'Nobody')).rejects.toThrow("can't be assigned in Jira")
  })

  it('moves to a category via the first matching transition', async () => {
    const { source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [{ id: '5', to: { name: 'Shipped', statusCategory: { key: 'done' } } }] }),
    })
    expect(await source.moveToCategory('jira:ABC-1', 'Completed', { state: 'To Do' })).toEqual({ state: 'Shipped', stateCategory: 'Completed' })
  })

  it('writes points to the board estimation field and maps it to the create form', async () => {
    const invoke = vi.fn(async ({ url }) => (url.includes('createmeta')
      ? ipcReply(200, { fields: [
        { fieldId: 'customfield_10016', name: 'Story point estimate', schema: { type: 'number' } },
        { fieldId: 'customfield_10028', name: 'Story Points', schema: { type: 'number' } },
      ] })
      : ipcReply(204)))
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke })
    const source = createJiraWorkItemSource({
      http, getSite: () => CONFIG.site, getPeople: () => people,
      getMeta: () => ({ ...meta, fieldIds: { storyPoints: 'customfield_10016' } }),
      getPointsFieldId: () => 'customfield_10028',
    })
    await source.saveField('jira:ABC-1', 'Microsoft.VSTS.Scheduling.StoryPoints', 5)
    const put = invoke.mock.calls.find(([r]) => r.method === 'PUT')[0]
    expect(JSON.parse(put.body)).toEqual({ fields: { customfield_10028: 5 } })
    const fields = await source.getCreateFields('ABC', '1')
    expect(fields.find(f => f.role === 'points').key).toBe('customfield_10028')
  })

  it('reads the board estimation field from the cached Jira data by default', async () => {
    saveJiraConfig({ site: 'acme', email: 'me@acme.io', apiToken: 'tok', projectKeys: ['ABC'] })
    localStorage.setItem('nexusmd.jira.cache.v1', JSON.stringify({
      SITE: 'https://acme.atlassian.net', WORK_ITEMS: [], BOARD_ESTIMATION_FIELD: 'customfield_10028',
      _jiraMeta: { ...meta, fieldIds: { storyPoints: 'customfield_10016' } },
    }))
    const invoke = vi.fn(async () => ipcReply(204))
    const source = createJiraWorkItemSource({ http: createJiraHttpAdapter({ getConfig: () => CONFIG, invoke }), getPeople: () => people })
    await source.saveField('jira:ABC-1', 'Microsoft.VSTS.Scheduling.StoryPoints', 3)
    const put = invoke.mock.calls.find(([r]) => r.method === 'PUT')[0]
    expect(JSON.parse(put.body)).toEqual({ fields: { customfield_10028: 3 } })
  })

  it('builds browse URLs', () => {
    const { source } = makeSource({})
    expect(source.webUrl({ id: 'jira:ABC-1' })).toBe('https://acme.atlassian.net/browse/ABC-1')
  })
})
