import { describe, it, expect } from 'vitest'
import { mergeWorkItemData, mergeTeam } from '../../src/modules/workitems/merge.js'
import { deriveActivity } from '../../src/modules/ado/derive.js'
import { timeAgo } from '../../src/modules/ado/helpers.js'

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

  it('derives Recent activity from both ADO and Jira items', () => {
    const ado = { ...ADO, WORK_ITEMS: [{ id: 7, title: 'ADO thing', state: 'Active', assignee: 'alex-doe', updated: '5m' }] }
    const jira = { ...JIRA, WORK_ITEMS: [{ ...JIRA.WORK_ITEMS[0], state: 'In Dev', stateCategory: 'InProgress', title: 'Jira thing', updated: '2m' }] }
    const m = mergeWorkItemData({ ado, jira, configured: { ado: true, jira: true } })
    expect(m.ACTIVITY).toEqual([
      { id: 'jira:ABC-1', who: 'sam-roe', action: 'is working on', what: 'ABC-1 Jira thing', when: '2m' },
      { id: 7, who: 'alex-doe', action: 'is working on', what: '#7 ADO thing', when: '5m' },
    ])
  })

  it('keeps ADO-only Recent activity identical to the ADO loader output', () => {
    const items = [
      { id: 7, title: 'ADO thing', state: 'Active', assignee: 'alex-doe', updated: '5m' },
      { id: 8, title: 'Other', state: 'Done', assignee: 'alex-doe', updated: '1m' },
    ]
    const m = mergeWorkItemData({ ado: { ...ADO, WORK_ITEMS: items }, configured: { ado: true } })
    expect(m.ACTIVITY).toEqual(deriveActivity(items))
  })

  it('surfaces the ADO PR error as the ADO provider warning', () => {
    const bad = mergeWorkItemData({ ado: { ...ADO, PR_ERROR: 'PRs unavailable (HTTP 401) — check the ADO PAT has Code (Read) scope' }, configured: { ado: true } })
    expect(bad.WORK_ITEM_PROVIDERS[0]).toMatchObject({ id: 'ado', warning: 'PRs unavailable (HTTP 401) — check the ADO PAT has Code (Read) scope' })
    const detailed = mergeWorkItemData({ ado: { ...ADO, PR_ERROR: 'PRs unavailable (HTTP 500)', PR_ERROR_DETAIL: 'ADO GET x → 500' }, configured: { ado: true } })
    expect(detailed.WORK_ITEM_PROVIDERS[0]).toMatchObject({ warning: 'PRs unavailable (HTTP 500)', warningDetail: 'ADO GET x → 500' })
    const ok = mergeWorkItemData({ ado: { ...ADO, PR_ERROR: null }, configured: { ado: true } })
    expect(ok.WORK_ITEM_PROVIDERS[0].warning).toBeNull()
  })

  it('recomputes each member\'s open-item count and last activity over the merged items', () => {
    const t1 = Date.now() - 3 * 3600_000
    const t2 = Date.now() - 20 * 60_000
    const jira = { ...JIRA, WORK_ITEMS: [
      { id: 'jira:ABC-1', source: 'jira', state: 'In Dev', stateCategory: 'InProgress', assignee: 'sam-roe', assigneeAccountId: 's1', changedMs: t1 },
      { id: 'jira:ABC-2', source: 'jira', state: 'In QA', stateCategory: 'InProgress', assignee: 'sam-roe', assigneeAccountId: 's1', changedMs: t2 },
      { id: 'jira:ABC-3', source: 'jira', state: 'Released', stateCategory: 'Completed', assignee: 'sam-roe', assigneeAccountId: 's1', changedMs: Date.now() },
    ] }
    const ado = { ...ADO, TEAM: [{ id: 'alex-doe', name: 'Alex Doe', assignedCount: 1, lastActiveAgo: 'stale' }] }
    const m = mergeWorkItemData({ ado, jira, configured: { ado: true, jira: true } })
    const sam = m.TEAM.find(t => t.id === 'sam-roe')
    expect(sam.assignedCount).toBe(2)
    expect(sam.lastActiveAgo).toBe(timeAgo(new Date(t2).toISOString()))
    // ADO item 7 has no changedMs → same '—' as the ADO loader
    expect(m.TEAM.find(t => t.id === 'alex-doe')).toMatchObject({ assignedCount: 1, lastActiveAgo: '—' })
  })

  it('leaves an ADO-only team identical to the ADO loader\'s counts', () => {
    const changed = Date.now() - 2 * 86_400_000
    const items = [
      { id: 7, state: 'Active', adoStateCategory: 'InProgress', assignee: 'alex-doe', changedMs: changed },
      { id: 8, state: 'Closed', adoStateCategory: 'Completed', assignee: 'alex-doe', changedMs: Date.now() },
    ]
    const team = [{ id: 'alex-doe', name: 'Alex Doe', assignedCount: 1, lastActiveAgo: timeAgo(new Date(changed).toISOString()) }]
    const m = mergeWorkItemData({ ado: { ...ADO, WORK_ITEMS: items, TEAM: team }, configured: { ado: true } })
    expect(m.TEAM).toEqual(team)
  })

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
      { id: 'ado', label: 'Azure DevOps', status: 'ok', error: null, warning: null, warningDetail: null },
      { id: 'jira', label: 'Jira', status: 'stale', error: 'auth failed — check settings', warning: null, warningDetail: null },
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

describe('board layout passthrough', () => {
  it('passes Jira board columns and error through, with a provider warning', () => {
    const cols = [{ name: 'Todo', statuses: ['To Do'] }]
    const ok = mergeWorkItemData({ ado: null, jira: { ...JIRA, BOARD_COLUMNS: cols, BOARD_ERROR: null }, configured: { jira: true } })
    expect(ok.JIRA_BOARD_COLUMNS).toEqual(cols)
    expect(ok.WORK_ITEM_PROVIDERS[0].warning).toBeNull()
    const bad = mergeWorkItemData({ ado: null, jira: { ...JIRA, BOARD_COLUMNS: null, BOARD_ERROR: 'Not found in Jira (404)' }, configured: { jira: true } })
    expect(bad.JIRA_BOARD_COLUMNS).toBeNull()
    expect(bad.JIRA_BOARD_ERROR).toBe('Not found in Jira (404)')
    expect(bad.WORK_ITEM_PROVIDERS[0].warning).toBe('Jira board unavailable — using status columns')
  })
  it('defaults to null when Jira has no board data', () => {
    const m = mergeWorkItemData({ ado: null, jira: null, configured: {} })
    expect(m.JIRA_BOARD_COLUMNS).toBeNull()
    expect(m.JIRA_BOARD_ERROR).toBeNull()
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

describe('mergeWorkItemData with GitHub', () => {
  const GH = {
    WORK_ITEMS: [{ id: 'o/r#1', source: 'github', displayId: 'o/r#1', state: 'Open', stateCategory: 'Proposed', assignee: 'alex-doe' }],
    PROJECTS: [{ id: 'o-r', name: 'o/r', key: 'o/r', source: 'github', color: 'c1' }],
    PEOPLE: [{ login: 'Alex Doe', avatarUrl: 'a' }, { login: 'octo', avatarUrl: 'b' }],
    ME: { login: 'me-login', name: 'Me', avatarUrl: 'm' },
    STATES: ['Open', 'Closed'], TYPES: ['issue'], WI_TYPE_STATES: { issue: ['Open', 'Closed'] },
    PR_ERROR: null, REPO_ERRORS: [],
  }
  const ok = { github: { status: 'ok' } }

  it('only GitHub configured', () => {
    const m = mergeWorkItemData({ github: GH, status: ok, configured: { github: true } })
    expect(m.WORK_ITEMS).toEqual(GH.WORK_ITEMS)
    expect(m.WORK_ITEM_PROVIDERS).toEqual([expect.objectContaining({ id: 'github', label: 'GitHub', status: 'ok' })])
    expect(m.PROJECTS).toEqual(GH.PROJECTS)
    expect(m.STATES).toEqual(['Open', 'Closed'])
    expect(m.STATE_CATEGORIES_BY_SOURCE.github).toBeDefined()
    expect(m.WI_TYPE_STATES_BY_SOURCE.github.issue).toEqual(['Open', 'Closed'])
  })

  it('all three providers, in order', () => {
    const m = mergeWorkItemData({ ado: ADO, jira: JIRA, github: GH, configured: { ado: true, jira: true, github: true } })
    expect(Object.keys(m.WORK_ITEMS_BY_SOURCE)).toEqual(['ado', 'jira', 'github'])
    expect(m.WORK_ITEM_PROVIDERS.map(p => p.id)).toEqual(['ado', 'jira', 'github'])
  })

  it('error status is stale with data, error without', () => {
    const st = { github: { status: 'error', error: 'x' } }
    expect(mergeWorkItemData({ github: GH, status: st, configured: { github: true } }).WORK_ITEM_PROVIDERS[0].status).toBe('stale')
    expect(mergeWorkItemData({ github: null, status: st, configured: { github: true } }).WORK_ITEM_PROVIDERS[0].status).toBe('error')
  })

  it('warning and detail come from PR_ERROR and REPO_ERRORS', () => {
    const g = { ...GH, PR_ERROR: 'PRs unavailable', REPO_ERRORS: [{ repo: 'o/r', kind: 'auth', message: 'bad' }] }
    const p = mergeWorkItemData({ github: g, configured: { github: true } }).WORK_ITEM_PROVIDERS[0]
    expect(p.warning).toBe('PRs unavailable')
    expect(p.warningDetail).toContain('o/r')
  })

  it('a login equal to an ADO member name does not duplicate the member', () => {
    const m = mergeWorkItemData({ ado: ADO, github: GH, configured: { ado: true, github: true } })
    expect(m.TEAM.filter(t => t.name === 'Alex Doe')).toHaveLength(1)
    const octo = m.TEAM.find(t => t.name === 'octo')
    expect(octo).toMatchObject({ id: 'octo', source: 'github', avatarUrl: 'b' })
    expect(m.TEAM.find(t => t.name === 'me-login')).toBeTruthy()
  })
})
