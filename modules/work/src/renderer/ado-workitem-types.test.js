import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedDefs, setCachedDefs, fetchWorkItemTypes, fetchProjectFieldTypes, fetchTypeFields, fetchClassificationPaths, loadWorkItemTypeDefs, submitNewWorkItem } from './ado-workitem-types.js'
import { saveAdoConfig } from './ado-client.js'
import { vi } from 'vitest'

function mockFetchOnce(json) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
  })
}

beforeEach(() => {
  localStorage.clear()
  saveAdoConfig({ org: 'contoso', pat: 'fake-pat', projects: ['ProjectA'] })
})

describe('getCachedDefs / setCachedDefs', () => {
  it('returns null when nothing is cached', () => {
    expect(getCachedDefs('ProjectA', 'Bug')).toBe(null)
  })

  it('round-trips a defs object', () => {
    const defs = { fields: [{ referenceName: 'System.Title' }], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 123 }
    setCachedDefs('ProjectA', 'Bug', defs)
    expect(getCachedDefs('ProjectA', 'Bug')).toEqual(defs)
  })

  it('keys are isolated per project+type', () => {
    setCachedDefs('ProjectA', 'Bug', { fields: [], paths: {}, types: [], fetchedAt: 1 })
    expect(getCachedDefs('ProjectA', 'Task')).toBe(null)
    expect(getCachedDefs('ProjectB', 'Bug')).toBe(null)
  })
})

describe('fetchWorkItemTypes', () => {
  it('maps and filters out disabled types', async () => {
    mockFetchOnce({
      value: [
        { name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: { id: 'icon_bug' }, color: 'CC293D', isDisabled: false },
        { name: 'Old Type', referenceName: 'Custom.OldType', icon: { id: 'icon_x' }, color: '000000', isDisabled: true },
      ],
    })
    const result = await fetchWorkItemTypes('ProjectA')
    expect(result).toEqual([
      { name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: 'icon_bug', color: 'CC293D' },
    ])
  })
})

describe('fetchProjectFieldTypes', () => {
  it('builds a referenceName -> type map', async () => {
    mockFetchOnce({
      value: [
        { referenceName: 'System.Description', type: 'html' },
        { referenceName: 'Microsoft.VSTS.Common.Priority', type: 'integer' },
      ],
    })
    const result = await fetchProjectFieldTypes('ProjectA')
    expect(result).toEqual({
      'System.Description': 'html',
      'Microsoft.VSTS.Common.Priority': 'integer',
    })
  })
})

describe('fetchTypeFields', () => {
  it('merges the per-type field list with the data-type map', async () => {
    mockFetchOnce({
      value: [
        { referenceName: 'System.Title', name: 'Title', alwaysRequired: true, allowedValues: [] },
        { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', alwaysRequired: false, allowedValues: [1, 2, 3, 4] },
      ],
    })
    const fieldTypeMap = { 'System.Title': 'string', 'Microsoft.VSTS.Common.Priority': 'integer' }
    const result = await fetchTypeFields('ProjectA', 'Bug', fieldTypeMap)
    expect(result).toEqual([
      { referenceName: 'System.Title', name: 'Title', alwaysRequired: true, defaultValue: null, allowedValues: [], dataType: 'string' },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', alwaysRequired: false, defaultValue: null, allowedValues: [1, 2, 3, 4], dataType: 'integer' },
    ])
  })

  it('defaults dataType to string when the field is missing from the map', async () => {
    mockFetchOnce({ value: [{ referenceName: 'Custom.Unknown', name: 'Unknown', alwaysRequired: false, allowedValues: [] }] })
    const result = await fetchTypeFields('ProjectA', 'Bug', {})
    expect(result[0].dataType).toBe('string')
  })
})

describe('fetchClassificationPaths', () => {
  it('flattens the area and iteration trees into backslash-joined paths', async () => {
    const areaTree = { name: 'ProjectA', children: [{ name: 'Team1', children: [{ name: 'SubTeam', children: [] }] }] }
    const iterationTree = { name: 'ProjectA', children: [{ name: 'Sprint 1', children: [] }, { name: 'Sprint 2', children: [] }] }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => areaTree })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => iterationTree })

    const result = await fetchClassificationPaths('ProjectA')
    expect(result).toEqual({
      areas: ['ProjectA', 'ProjectA\\Team1', 'ProjectA\\Team1\\SubTeam'],
      iterations: ['ProjectA', 'ProjectA\\Sprint 1', 'ProjectA\\Sprint 2'],
    })
  })
})

describe('loadWorkItemTypeDefs', () => {
  it('returns the cached value without calling fetch when a cache exists', async () => {
    const cached = { fields: [{ referenceName: 'System.Title' }], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 1 }
    setCachedDefs('ProjectA', 'Bug', cached)
    global.fetch = vi.fn()
    const result = await loadWorkItemTypeDefs('ProjectA', 'Bug')
    expect(result).toEqual(cached)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches and caches when nothing is cached yet', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/_apis/wit/fields?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ referenceName: 'System.Title', type: 'string' }] }) })
      if (url.includes('/workitemtypes/Bug/fields')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ referenceName: 'System.Title', name: 'Title', alwaysRequired: true, allowedValues: [] }] }) })
      if (url.includes('/classificationnodes/areas')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/classificationnodes/iterations')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/_apis/wit/workitemtypes?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: {}, color: '' }] }) })
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const result = await loadWorkItemTypeDefs('ProjectA', 'Bug')
    expect(result.fields).toEqual([{ referenceName: 'System.Title', name: 'Title', alwaysRequired: true, defaultValue: null, allowedValues: [], dataType: 'string' }])
    expect(result.paths).toEqual({ areas: ['ProjectA'], iterations: ['ProjectA'] })
    expect(result.types).toEqual([{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }])
    expect(getCachedDefs('ProjectA', 'Bug')).toEqual(result)
  })

  it('refetches when forceRefresh is true even if a cache exists', async () => {
    setCachedDefs('ProjectA', 'Bug', { fields: [], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 1 })
    global.fetch = vi.fn((url) => {
      if (url.includes('/_apis/wit/fields?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      if (url.includes('/workitemtypes/Bug/fields')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      if (url.includes('/classificationnodes/areas')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/classificationnodes/iterations')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/_apis/wit/workitemtypes?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      return Promise.reject(new Error('unexpected url: ' + url))
    })
    await loadWorkItemTypeDefs('ProjectA', 'Bug', { forceRefresh: true })
    expect(global.fetch).toHaveBeenCalled()
  })
})

describe('submitNewWorkItem', () => {
  function jsonRes(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }

  it('creates the work item and returns { id, warnings: [] } when there are no attachments or links', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(200, { id: 101 }))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const result = await submitNewWorkItem({ project: 'ProjectA', type: 'Task', fields: { 'System.Title': 'Fix bug' } })
    expect(result).toEqual({ id: 101, warnings: [] })
  })

  it('returns the created id with a warning naming the failed attachment when an attachment upload fails, and still applies no-op relations patch', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(200, { id: 202 }))
      }
      if (opts?.method === 'POST' && url.includes('/_apis/wit/attachments')) {
        return Promise.resolve(jsonRes(500, {}))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const file = { name: 'notes.txt' }
    const result = await submitNewWorkItem({ project: 'ProjectA', type: 'Task', fields: {}, attachmentFiles: [file] })
    expect(result.id).toBe(202)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('notes.txt')
  })

  it('returns the created id with a warning when the relations PATCH fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(200, { id: 303 }))
      }
      if (opts?.method === 'POST' && url.includes('/_apis/wit/attachments')) {
        return Promise.resolve(jsonRes(200, { url: 'https://x/attachments/1' }))
      }
      if (opts?.method === 'PATCH') {
        return Promise.resolve(jsonRes(500, {}))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const file = { name: 'notes.txt' }
    const result = await submitNewWorkItem({
      project: 'ProjectA', type: 'Task', fields: {},
      attachmentFiles: [file],
      links: [{ rel: 'System.LinkTypes.Related', id: 5 }],
    })
    expect(result.id).toBe(303)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('1 attachment(s) and 1 link(s)')
  })

  it('names only attachments in the warning when only attachment relations are present and the PATCH fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(200, { id: 404 }))
      }
      if (opts?.method === 'POST' && url.includes('/_apis/wit/attachments')) {
        return Promise.resolve(jsonRes(200, { url: 'https://x/attachments/1' }))
      }
      if (opts?.method === 'PATCH') {
        return Promise.resolve(jsonRes(500, {}))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const file = { name: 'notes.txt' }
    const result = await submitNewWorkItem({ project: 'ProjectA', type: 'Task', fields: {}, attachmentFiles: [file] })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('1 attachment relation(s)')
    expect(result.warnings[0]).not.toContain('link(s)')
  })

  it('names only links in the warning when only link relations are present and the PATCH fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(200, { id: 505 }))
      }
      if (opts?.method === 'PATCH') {
        return Promise.resolve(jsonRes(500, {}))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const result = await submitNewWorkItem({
      project: 'ProjectA', type: 'Task', fields: {},
      links: [{ rel: 'System.LinkTypes.Related', id: 5 }],
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('1 link relation(s)')
    expect(result.warnings[0]).not.toContain('attachment(s)')
  })

  it('throws when the base create POST fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/_apis/wit/workitems/$')) {
        return Promise.resolve(jsonRes(400, {}))
      }
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    await expect(submitNewWorkItem({ project: 'ProjectA', type: 'Task', fields: {} })).rejects.toThrow('HTTP 400')
  })
})
