import { describe, it, expect } from 'vitest'
import { mergeWorkItemData, mergeTeam } from '../../src/modules/workitems/merge.js'

const ADO = {
  WORK_ITEMS: [{ id: 7, type: 'story', state: 'Active', adoStateCategory: 'InProgress', assignee: 'alex-doe' }],
  TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }],
  PROJECTS: [{ id: 'web', name: 'Web', color: 'c1' }],
  STATES: ['Active', 'Closed'], TYPES: ['User Story'], PRIORITIES: [1, 2, 3, 4],
  WI_TYPE_STATES: { 'User Story': ['New', 'Active', 'Closed'] },
  RESOLVED_WI: [{ id: 1, closedDate: '2026-10-01' }],
  _adoMeta: { stateCategoryByName: { Active: 'InProgress' } },
}
const JIRA = {
  SITE: 'https://acme.atlassian.net',
  WORK_ITEMS: [{ id: 'jira:ABC-1', source: 'jira', displayId: 'ABC-1', state: 'To Do', stateCategory: 'Proposed', assignee: 'sam-roe', assigneeAccountId: 's1' }],
  PROJECTS: [{ id: 'abc', name: 'Alpha', key: 'ABC', source: 'jira', color: 'c9' }],
  STATES: ['To Do', 'Done'], TYPES: ['Story'], PRIORITIES: [{ id: '1', name: 'High', rank: 1 }],
  WI_TYPE_STATES: { Story: ['To Do', 'Done'], 'Sub-task': ['Open'] },
  PEOPLE: [
    { accountId: 'a1', displayName: 'Alex Doe' },
    { accountId: 's1', displayName: 'Sam Roe' },
    { accountId: 'x1', displayName: 'Unrelated Person' },
  ],
  ME: { accountId: 'me', displayName: 'Me' },
  RESOLVED_WI: [{ id: 'jira:ABC-0', closedDate: '2026-10-03' }],
  _jiraMeta: { stateCategoryByName: { 'To Do': 'Proposed' } },
}

describe('mergeWorkItemData', () => {
  const merged = mergeWorkItemData({ ado: ADO, jira: JIRA, status: {}, configured: { ado: true, jira: true } })

  it('tags ADO items and concatenates both sources', () => {
    expect(merged.WORK_ITEMS.map(w => w.id)).toEqual([7, 'jira:ABC-1'])
    expect(merged.WORK_ITEMS[0]).toMatchObject({ source: 'ado', displayId: '#7', stateCategory: 'InProgress' })
    expect(merged.WORK_ITEMS_BY_SOURCE.jira).toHaveLength(1)
  })

  it('merges projects, states, types and per-source lookups', () => {
    expect(merged.PROJECTS.map(p => p.id)).toEqual(['web', 'abc'])
    expect(merged.STATES).toEqual(['Active', 'Closed', 'To Do', 'Done'])
    expect(merged.TYPES).toEqual(['User Story', 'Story'])
    expect(merged.WI_TYPE_STATES_BY_SOURCE.ado).toEqual({ story: ['New', 'Active', 'Closed'] })
    expect(merged.WI_TYPE_STATES_BY_SOURCE.jira).toEqual({ story: ['To Do', 'Done'], 'sub-task': ['Open'] })
    expect(merged.STATE_CATEGORIES_BY_SOURCE.jira).toEqual({ 'To Do': 'Proposed' })
    expect(merged.PRIORITIES_BY_SOURCE.jira).toEqual([{ id: '1', name: 'High', rank: 1 }])
    expect(merged.JIRA_SITE).toBe('https://acme.atlassian.net')
  })

  it('sorts resolved items newest first across sources', () => {
    expect(merged.RESOLVED_WI.map(r => r.id)).toEqual(['jira:ABC-0', 1])
  })

  it('reports provider status, marking errors with cached data as stale', () => {
    const m = mergeWorkItemData({
      ado: ADO, jira: JIRA, configured: { ado: true, jira: true },
      status: { jira: { status: 'error', error: 'auth failed — check settings' } },
    })
    expect(m.WORK_ITEM_PROVIDERS).toEqual([
      { id: 'ado', label: 'Azure DevOps', status: 'ok', error: null },
      { id: 'jira', label: 'Jira', status: 'stale', error: 'auth failed — check settings' },
    ])
    const noCache = mergeWorkItemData({ ado: ADO, jira: null, configured: { ado: true, jira: true }, status: { jira: { status: 'error', error: 'e' } } })
    expect(noCache.WORK_ITEM_PROVIDERS[1].status).toBe('error')
  })

  it('lists only configured providers and copes with no data at all', () => {
    const m = mergeWorkItemData({ ado: null, jira: null, configured: {} })
    expect(m.WORK_ITEMS).toEqual([])
    expect(m.WORK_ITEM_PROVIDERS).toEqual([])
  })
})

describe('mergeTeam', () => {
  it('keeps one entry for a person in both providers, adding their Jira account id', () => {
    const team = mergeTeam(ADO.TEAM, JIRA.PEOPLE, JIRA.WORK_ITEMS, JIRA.ME)
    const alex = team.filter(m => m.name === 'Alex Doe')
    expect(alex).toHaveLength(1)
    expect(alex[0]).toMatchObject({ id: 'alex-doe', jiraAccountId: 'a1' })
  })
  it('adds Jira-only people who are assigned work, but not every assignable user', () => {
    const team = mergeTeam(ADO.TEAM, JIRA.PEOPLE, JIRA.WORK_ITEMS, JIRA.ME)
    expect(team.find(m => m.name === 'Sam Roe')).toMatchObject({ id: 'sam-roe', jiraAccountId: 's1', source: 'jira', initials: 'SR' })
    expect(team.find(m => m.name === 'Unrelated Person')).toBeUndefined()
  })
  it('does not mutate the ADO team', () => {
    const ado = [{ id: 'alex-doe', name: 'Alex Doe' }]
    mergeTeam(ado, JIRA.PEOPLE, [], null)
    expect(ado[0].jiraAccountId).toBeUndefined()
  })
})

import * as pub from '../../src/index.js'

describe('public API', () => {
  it('re-exports the work-item and Jira modules from @nexusmd/core', () => {
    for (const name of ['mergeWorkItemData', 'isJiraId', 'itemCategory', 'loadJiraData', 'makeJiraConfig', 'createJiraIssue', 'htmlToAdf']) {
      expect(typeof pub[name]).toBe('function')
    }
  })
})
