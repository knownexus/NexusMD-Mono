import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedDefs, setCachedDefs, fetchWorkItemTypes, fetchProjectFieldTypes, fetchTypeFields, fetchClassificationPaths } from './ado-workitem-types.js'
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
