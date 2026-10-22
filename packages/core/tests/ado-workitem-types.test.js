import { describe, it, expect, vi } from 'vitest'
import {
  makeWorkItemTypeDefsStore, fetchWorkItemTypes, fetchClassificationPaths, loadWorkItemTypeDefs,
  fieldBucket, fieldGroup, TYPE_LAYOUTS, resolveTypeLayout, LINK_TYPES,
  buildFieldPatchOps, buildAttachmentRelationOps, buildLinkRelationOps, submitNewWorkItem,
} from '../src/index.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function memoryStore() {
  const m = new Map()
  return makeWorkItemTypeDefsStore({
    storage: { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) },
    key: (p, t) => `defs.${p}.${t}`,
  })
}

describe('makeWorkItemTypeDefsStore', () => {
  it('round-trips defs and isolates keys per project + type', () => {
    const store = memoryStore()
    expect(store.getCachedDefs('A', 'Task')).toBeNull()
    store.setCachedDefs('A', 'Task', { fields: [1] })
    expect(store.getCachedDefs('A', 'Task')).toEqual({ fields: [1] })
    expect(store.getCachedDefs('A', 'Bug')).toBeNull()
  })

  it('treats unparseable cache content as a miss', () => {
    const store = makeWorkItemTypeDefsStore({ storage: { get: () => '{nope', set() {} }, key: () => 'k' })
    expect(store.getCachedDefs('A', 'Task')).toBeNull()
  })
})

describe('fetching through the http adapter', () => {
  it('fetchWorkItemTypes drops disabled types and maps the rest', async () => {
    const http = { fetch: vi.fn(async () => ok({ value: [
      { name: 'Bug', referenceName: 'Sys.Bug', icon: { id: 'i' }, color: 'f00' },
      { name: 'Old', referenceName: 'Sys.Old', isDisabled: true },
    ] })) }
    expect(await fetchWorkItemTypes(http, 'My Proj')).toEqual([{ name: 'Bug', referenceName: 'Sys.Bug', icon: 'i', color: 'f00' }])
    expect(http.fetch).toHaveBeenCalledWith('My%20Proj/_apis/wit/workitemtypes?api-version=7.0')
  })

  it('fetchClassificationPaths flattens both trees', async () => {
    const http = { fetch: vi.fn(async (p) => ok(p.includes('areas')
      ? { name: 'P', children: [{ name: 'A' }] }
      : { name: 'P', children: [{ name: 'S1' }] })) }
    expect(await fetchClassificationPaths(http, 'P')).toEqual({ areas: ['P', 'P\\A'], iterations: ['P', 'P\\S1'] })
  })

  it('throws on a non-ok response', async () => {
    const http = { fetch: async () => ({ ok: false, status: 403 }) }
    await expect(fetchWorkItemTypes(http, 'P')).rejects.toThrow('HTTP 403')
  })
})

describe('loadWorkItemTypeDefs', () => {
  const makeHttp = () => ({ fetch: vi.fn(async (p) => {
    if (p.includes('/workitemtypes/')) return ok({ value: [{ referenceName: 'System.Title', name: 'Title' }] })
    if (p.includes('/workitemtypes?')) return ok({ value: [{ name: 'Task', referenceName: 'Sys.Task' }] })
    if (p.includes('/fields?')) return ok({ value: [{ referenceName: 'System.Title', type: 'string' }] })
    return ok({ name: 'P' })
  }) })

  it('returns the cache without touching http', async () => {
    const store = memoryStore(); store.setCachedDefs('P', 'Task', { cached: true })
    const http = makeHttp()
    expect(await loadWorkItemTypeDefs(http, store, 'P', 'Task')).toEqual({ cached: true })
    expect(http.fetch).not.toHaveBeenCalled()
  })

  it('fetches, caches, and refetches on forceRefresh', async () => {
    const store = memoryStore(); const http = makeHttp()
    const first = await loadWorkItemTypeDefs(http, store, 'P', 'Task')
    expect(first.fields[0]).toMatchObject({ referenceName: 'System.Title', dataType: 'string' })
    expect(store.getCachedDefs('P', 'Task')).toEqual(first)
    const calls = http.fetch.mock.calls.length
    await loadWorkItemTypeDefs(http, store, 'P', 'Task')
    expect(http.fetch.mock.calls.length).toBe(calls)
    await loadWorkItemTypeDefs(http, store, 'P', 'Task', { forceRefresh: true })
    expect(http.fetch.mock.calls.length).toBeGreaterThan(calls)
  })
})

describe('submitNewWorkItem', () => {
  it('creates the item and reports a failed relation patch as a warning', async () => {
    const http = { fetch: vi.fn(async (p, o) => (o?.method === 'PATCH' ? { ok: false, status: 500 } : ok({ id: 55 }))) }
    const result = await submitNewWorkItem(http, {
      project: 'P', type: 'Task', fields: { 'System.Title': 't' }, links: [{ rel: 'System.LinkTypes.Related', id: 9 }],
    })
    expect(result.id).toBe(55)
    expect(result.warnings).toEqual(['1 link relation(s) failed: HTTP 500'])
  })

  it('throws when the create POST fails', async () => {
    const http = { fetch: async () => ({ ok: false, status: 400 }) }
    await expect(submitNewWorkItem(http, { project: 'P', type: 'Task', fields: {} })).rejects.toThrow('HTTP 400')
  })
})

describe('fieldBucket', () => {
  it('classifies known html fields', () => {
    expect(fieldBucket({ referenceName: 'System.Description', dataType: 'html', allowedValues: [] })).toBe('html')
  })
  it('classifies area/iteration path fields as treePath', () => {
    expect(fieldBucket({ referenceName: 'System.AreaPath', dataType: 'treePath', allowedValues: [] })).toBe('treePath')
  })
  it('classifies AssignedTo as identity', () => {
    expect(fieldBucket({ referenceName: 'System.AssignedTo', dataType: 'string', allowedValues: [] })).toBe('identity')
  })
  it('classifies fields with allowedValues as picklist', () => {
    expect(fieldBucket({ referenceName: 'Custom.Env', dataType: 'string', allowedValues: ['Dev', 'Prod'] })).toBe('picklist')
  })
  it('classifies integer/double as number, dateTime, boolean, and falls back to text', () => {
    expect(fieldBucket({ referenceName: 'Microsoft.VSTS.Scheduling.RemainingWork', dataType: 'double', allowedValues: [] })).toBe('number')
    expect(fieldBucket({ referenceName: 'Microsoft.VSTS.Scheduling.TargetDate', dataType: 'dateTime', allowedValues: [] })).toBe('dateTime')
    expect(fieldBucket({ referenceName: 'Custom.Flag', dataType: 'boolean', allowedValues: [] })).toBe('boolean')
    expect(fieldBucket({ referenceName: 'Custom.Notes', dataType: 'string', allowedValues: [] })).toBe('text')
  })
})

describe('fieldGroup', () => {
  it('groups known status/classification/planning/tags fields', () => {
    expect(fieldGroup({ referenceName: 'System.AssignedTo', dataType: 'string', allowedValues: [] })).toBe('status')
    expect(fieldGroup({ referenceName: 'System.AreaPath', dataType: 'treePath', allowedValues: [] })).toBe('classification')
    expect(fieldGroup({ referenceName: 'Microsoft.VSTS.Scheduling.StoryPoints', dataType: 'double', allowedValues: [] })).toBe('planning')
    expect(fieldGroup({ referenceName: 'System.Tags', dataType: 'string', allowedValues: [] })).toBe('tags')
  })
  it('groups html fields as main and everything unrecognized as additional', () => {
    expect(fieldGroup({ referenceName: 'System.Description', dataType: 'html', allowedValues: [] })).toBe('main')
    expect(fieldGroup({ referenceName: 'Custom.Whatever', dataType: 'string', allowedValues: [] })).toBe('additional')
  })
})

describe('TYPE_LAYOUTS / resolveTypeLayout', () => {
  it('returns null for a type with no configured layout', () => {
    expect(resolveTypeLayout('CustomThing', [])).toBe(null)
  })

  it('resolves Bug fields into left, middleTop, planning, and additional, in config order', () => {
    const fields = [
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false },
      { referenceName: 'System.AreaPath', name: 'Area', dataType: 'treePath', allowedValues: [], alwaysRequired: false },
    ]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.left.map((f) => f.name)).toEqual(['Description', 'Repro Steps'])
    expect(layout.middleTop.name).toBe('Acceptance Criteria')
    expect(layout.planning.map((f) => f.name)).toEqual(['Area', 'Priority'])
    expect(layout.additional.map((f) => f.name)).toEqual(['Assigned To'])
  })

  it('skips config field names that have no matching field, without throwing', () => {
    const fields = [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.left.map((f) => f.name)).toEqual(['Description'])
    expect(layout.middleTop).toBe(null)
    expect(layout.planning).toEqual([])
    expect(layout.additional).toEqual([])
  })

  it('excludes System.State from additional even when unmatched by the layout', () => {
    const fields = [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.State', name: 'State', dataType: 'string', allowedValues: ['New'], alwaysRequired: false },
    ]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.additional).toEqual([])
  })

  it('returns null middleTop for Issue, which has no Acceptance Criteria in its layout', () => {
    const layout = resolveTypeLayout('Issue', [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }])
    expect(layout.middleTop).toBe(null)
  })
})

describe('LINK_TYPES', () => {
  it('exposes the seven ADO relation types with rel URNs', () => {
    expect(LINK_TYPES).toHaveLength(7)
    expect(LINK_TYPES.find((l) => l.label === 'Parent').rel).toBe('System.LinkTypes.Hierarchy-Reverse')
    expect(LINK_TYPES.find((l) => l.label === 'Related').rel).toBe('System.LinkTypes.Related')
  })
})

describe('buildFieldPatchOps', () => {
  it('builds one add op per populated field', () => {
    expect(buildFieldPatchOps({ 'System.Title': 'Fix bug', 'Microsoft.VSTS.Common.Priority': 2 })).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Fix bug' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
    ])
  })
})

describe('buildAttachmentRelationOps', () => {
  it('builds one AttachedFile relation op per url', () => {
    expect(buildAttachmentRelationOps(['https://x/attachments/1'])).toEqual([
      { op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: 'https://x/attachments/1' } },
    ])
  })
})

describe('buildLinkRelationOps', () => {
  it('builds one relation op per link with the vstfs URL format', () => {
    expect(buildLinkRelationOps([{ rel: 'System.LinkTypes.Related', id: 1234 }])).toEqual([
      { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: 'vstfs:///WorkItemTracking/WorkItem/1234' } },
    ])
  })
})

