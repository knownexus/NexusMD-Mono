import { describe, it, expect } from 'vitest'
import {
  categoryOfJiraStatus, discoverFieldIds, fetchJiraMetadata, fillMetadataFromIssues, emptyJiraMeta,
} from '../../src/modules/jira/metadata.js'

function makeClient(routes) {
  return {
    get: async (path) => {
      for (const [pattern, data] of Object.entries(routes)) {
        if (path.includes(pattern)) {
          if (data instanceof Error) throw data
          return data
        }
      }
      throw new Error(`unexpected ${path}`)
    },
  }
}

const STATUSES = [
  { id: '1', name: 'Story', statuses: [
    { name: 'To Do', statusCategory: { key: 'new' } },
    { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    { name: 'Done', statusCategory: { key: 'done' } },
  ] },
  { id: '2', name: 'Bug', statuses: [
    { name: 'Open', statusCategory: { key: 'new' } },
    { name: 'Done', statusCategory: { key: 'done' } },
  ] },
]
const FIELDS = [
  { id: 'customfield_10016', name: 'Story point estimate', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points' } },
  { id: 'customfield_10028', name: 'Story Points' },
  { id: 'customfield_10020', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10040', name: 'Acceptance Criteria' },
]

describe('categoryOfJiraStatus', () => {
  it('maps Jira status categories', () => {
    expect(categoryOfJiraStatus({ statusCategory: { key: 'new' } })).toBe('Proposed')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'indeterminate' } })).toBe('InProgress')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'done' } })).toBe('Completed')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'undefined' } })).toBe('Proposed')
    expect(categoryOfJiraStatus(null)).toBe('Proposed')
  })
})

describe('discoverFieldIds', () => {
  it('prefers "Story point estimate" and finds sprint by schema', () => {
    expect(discoverFieldIds(FIELDS)).toEqual({
      storyPoints: 'customfield_10016', sprint: 'customfield_10020',
      acceptanceCriteria: 'customfield_10040', reproSteps: null,
    })
  })
  it('returns nulls for an empty list', () => {
    expect(discoverFieldIds([])).toEqual({ storyPoints: null, sprint: null, acceptanceCriteria: null, reproSteps: null })
  })
})

describe('fetchJiraMetadata', () => {
  const routes = {
    'project/ABC/statuses': STATUSES,
    'rest/api/3/priority': [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }],
    'rest/api/3/field': FIELDS,
    'rest/api/3/myself': { accountId: 'me-1', displayName: 'Me Person', emailAddress: 'me@x.io' },
    'multiProjectSearch': [
      { accountId: 'u1', displayName: 'Alex Doe', avatarUrls: { '48x48': 'a.png' }, active: true },
      { accountId: 'bot', displayName: 'Automation', accountType: 'app', active: true },
      { accountId: 'gone', displayName: 'Former', active: false },
    ],
  }

  it('collects types, per-type states, categories, priorities, fields, me and people', async () => {
    const meta = await fetchJiraMetadata(makeClient(routes), ['ABC'])
    expect(meta.types).toEqual(['Bug', 'Story'])
    expect(meta.typeStates.Story).toEqual(['To Do', 'In Progress', 'Done'])
    expect(meta.stateCategoryByName).toEqual({ 'To Do': 'Proposed', 'In Progress': 'InProgress', Done: 'Completed', Open: 'Proposed' })
    expect(meta.states).toEqual(['Done', 'In Progress', 'Open', 'To Do'])
    expect(meta.priorities).toEqual([
      { id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }, { id: '3', name: 'Medium', rank: 3 },
    ])
    expect(meta.fieldIds.storyPoints).toBe('customfield_10016')
    expect(meta.me).toEqual({ accountId: 'me-1', displayName: 'Me Person', email: 'me@x.io' })
    expect(meta.people).toEqual([{ accountId: 'u1', displayName: 'Alex Doe', avatarUrl: 'a.png' }])
  })

  it('fails soft on every call', async () => {
    const meta = await fetchJiraMetadata(makeClient({}), ['ABC'])
    expect(meta).toEqual(emptyJiraMeta())
  })

  it('accepts a paged priority response', async () => {
    const meta = await fetchJiraMetadata(makeClient({ ...routes, 'rest/api/3/priority': { values: [{ id: '9', name: 'Only' }] } }), ['ABC'])
    expect(meta.priorities).toEqual([{ id: '9', name: 'Only', rank: 1 }])
  })
})

describe('fillMetadataFromIssues', () => {
  it('derives types and statuses from loaded issues when status metadata failed', () => {
    const issues = [
      { fields: { issuetype: { name: 'Task' }, status: { name: 'Doing', statusCategory: { key: 'indeterminate' } } } },
      { fields: { issuetype: { name: 'Task' }, status: { name: 'Backlog', statusCategory: { key: 'new' } } } },
    ]
    const meta = fillMetadataFromIssues(emptyJiraMeta(), issues)
    expect(meta.types).toEqual(['Task'])
    expect(meta.typeStates.Task).toEqual(['Doing', 'Backlog'])
    expect(meta.stateCategoryByName.Doing).toBe('InProgress')
  })
  it('leaves existing metadata untouched', () => {
    const meta = { ...emptyJiraMeta(), types: ['Story'] }
    expect(fillMetadataFromIssues(meta, [{ fields: { issuetype: { name: 'Bug' }, status: { name: 'X' } } }])).toBe(meta)
  })
})
