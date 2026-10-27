import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '../../src/modules/workitems/snapshot.js'
import { ADO_CACHE_KEY } from '../../src/modules/ado/loader.js'

const EMPTY = { SPRINT: { name: 'Current Sprint', burndown: [] }, AVG_RESOLUTION_DAYS: null }

// An ADO cache from before its work items were switched off.
const adoCache = {
  ORG: 'myorg',
  WORK_ITEMS: [{ id: 1, title: 'ADO item', state: 'Active', assignee: 'amy' }],
  RESOLVED_WI: [{ id: 2, title: 'Done', closedDate: '2026-10-01' }],
  STATES: ['Active', 'Closed'], TYPES: ['Bug'], PRIORITIES: [1, 2], WI_TYPE_STATES: { Bug: ['Active'] },
  SPRINT: { name: 'Sprint 9', burndown: [1] }, AVG_RESOLUTION_DAYS: 4,
  PRS: [{ id: 7, title: 'PR' }], BUILDS: [{ id: 'b1' }], TESTS: [{ id: 't1' }],
  TEAM: [{ id: 'amy', name: 'Amy' }],
}

function storageWith(cache) {
  const m = new Map([[ADO_CACHE_KEY, cache]])
  return { get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v) }
}

const build = (adoWorkItems) => buildSnapshot({
  adoConfig: { org: 'myorg' }, adoConfigured: true, adoWorkItems,
  jiraConfig: {}, jiraActive: false, storage: storageWith(adoCache), empty: EMPTY,
})

describe('buildSnapshot with ADO work items switched off', () => {
  it('keeps PRs, builds, tests and the team from ADO', () => {
    const s = build(false)
    expect(s.PRS.map(p => p.id)).toEqual([7])
    expect(s.BUILDS).toHaveLength(1)
    expect(s.TESTS).toHaveLength(1)
    expect(s.TEAM.map(m => m.id)).toEqual(['amy'])
  })

  it('leaves out ADO work items, even cached ones, and what is worked out from them', () => {
    const s = build(false)
    expect(s.WORK_ITEMS).toEqual([])
    expect(s.WORK_ITEMS_BY_SOURCE.ado).toEqual([])
    expect(s.RESOLVED_WI).toEqual([])
    expect(s.STATES).toEqual([])
    expect(s.TYPES).toEqual([])
    expect(s.SPRINT).toBe(EMPTY.SPRINT)
    expect(s.AVG_RESOLUTION_DAYS).toBeNull()
    expect(s.TEAM[0].assignedCount).toBe(0)
  })

  it('does not list ADO as a work item provider', () => {
    expect(build(false).WORK_ITEM_PROVIDERS).toEqual([])
    expect(build(true).WORK_ITEM_PROVIDERS.map(p => p.id)).toEqual(['ado'])
  })

  it('is unchanged when they are on', () => {
    const s = build(true)
    expect(s.WORK_ITEMS.map(w => w.id)).toEqual([1])
    expect(s.SPRINT.name).toBe('Sprint 9')
    expect(s.AVG_RESOLUTION_DAYS).toBe(4)
  })
})
