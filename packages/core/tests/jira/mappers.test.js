import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapJiraIssue, mapResolvedJiraIssue, pickSprint } from '../../src/modules/jira/mappers.js'

afterEach(() => vi.useRealTimers())

const META = {
  stateCategoryByName: { 'In Review': 'InProgress' },
  priorities: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }, { id: '3', name: 'Medium', rank: 3 }],
  fieldIds: { storyPoints: 'customfield_10016', sprint: 'customfield_10020', acceptanceCriteria: null, reproSteps: null },
}

const ISSUE = {
  key: 'ABC-12',
  fields: {
    summary: 'Fix login',
    issuetype: { name: 'Story' },
    status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
    assignee: { accountId: 'u1', displayName: 'Alex Doe' },
    priority: { name: 'High' },
    labels: ['auth', 'urgent'],
    components: [{ name: 'API' }, { name: 'Web' }],
    project: { key: 'ABC', name: 'Alpha Beta' },
    updated: '2026-10-05T10:00:00.000+0000',
    created: '2026-09-01T10:00:00.000+0000',
    customfield_10016: 5,
    customfield_10020: [{ id: 1, name: 'Sprint 1', state: 'closed' }, { id: 2, name: 'Sprint 2', state: 'active' }],
  },
}

describe('mapJiraIssue', () => {
  it('maps every field to the internal model', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00Z'))
    const w = mapJiraIssue(ISSUE, { meta: META })
    expect(w).toMatchObject({
      id: 'jira:ABC-12', displayId: 'ABC-12', key: 'ABC-12', source: 'jira',
      type: 'story', typeName: 'Story', title: 'Fix login',
      project: 'abc', projectKey: 'ABC', projectName: 'Alpha Beta',
      state: 'In Review', stateCategory: 'InProgress',
      assignee: 'alex-doe', assigneeAccountId: 'u1',
      priority: 2, priorityName: 'High', points: 5,
      tags: ['auth', 'urgent'], sprint: true, iterationPath: 'Sprint 2',
      areaPath: 'API, Web', area: '', comments: 0, prs: 0, isNew: true,
    })
    expect(w.changedMs).toBe(new Date('2026-10-05T10:00:00.000+0000').getTime())
  })

  it('uses nameToId when the assignee is a known team member', () => {
    expect(mapJiraIssue(ISSUE, { meta: META, nameToId: { 'Alex Doe': 'alex' } }).assignee).toBe('alex')
  })

  it('falls back to the status category on the issue when metadata lacks the state', () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, status: { name: 'Shipped', statusCategory: { key: 'done' } } } }
    expect(mapJiraIssue(issue, { meta: META }).stateCategory).toBe('Completed')
  })

  it('maps a sparse issue without throwing, using ADO-style defaults', () => {
    const w = mapJiraIssue({ key: 'XYZ-1', fields: { summary: 'Bare' } }, { meta: {} })
    expect(w).toMatchObject({
      id: 'jira:XYZ-1', type: 'task', project: 'xyz', projectKey: 'XYZ', state: '',
      stateCategory: 'Proposed', assignee: null, assigneeAccountId: null,
      priority: 3, priorityName: null, points: 0, tags: [], sprint: false,
      iterationPath: '', areaPath: '', changedMs: null, isNew: false,
    })
  })

  it('takes points from the first field in pointsFieldOrder that has a number', () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10016: null, customfield_10028: 8, customfield_10099: 3 } }
    expect(mapJiraIssue(issue, { meta: META, pointsFieldOrder: ['customfield_10099', 'customfield_10028'] }).points).toBe(3)
    expect(mapJiraIssue(issue, { meta: META, pointsFieldOrder: ['customfield_10016', 'customfield_10028'] }).points).toBe(8)
    expect(mapJiraIssue(issue, { meta: { ...META, pointsFieldOrder: ['customfield_10028'] } }).points).toBe(8)
    expect(mapJiraIssue({ ...ISSUE, fields: { ...ISSUE.fields, customfield_10028: 2.6 } }, { meta: META, pointsFieldOrder: ['customfield_10028'] }).points).toBe(3)
    expect(mapJiraIssue(issue, { meta: META }).points).toBe(0)
  })

  it('maps the Flagged field to flagged', () => {
    const meta = { ...META, fieldIds: { ...META.fieldIds, flagged: 'customfield_10021' } }
    const flaggedIssue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10021: [{ value: 'Impediment' }] } }
    expect(mapJiraIssue(flaggedIssue, { meta }).flagged).toBe(true)
    const cleared = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10021: [] } }
    expect(mapJiraIssue(cleared, { meta }).flagged).toBe(false)
    expect(mapJiraIssue({ ...ISSUE, fields: { ...ISSUE.fields, customfield_10021: null } }, { meta }).flagged).toBe(false)
    expect(mapJiraIssue(flaggedIssue, { meta: META }).flagged).toBe(false)
  })

  it('treats a closed-only sprint list as not in the current sprint', () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10020: [{ name: 'Old', state: 'closed' }] } }
    expect(mapJiraIssue(issue, { meta: META })).toMatchObject({ sprint: false, iterationPath: 'Old' })
  })
})

describe('pickSprint', () => {
  it('returns null for empty input', () => {
    expect(pickSprint(null)).toBeNull()
    expect(pickSprint([])).toBeNull()
  })
})

describe('mapResolvedJiraIssue', () => {
  it('matches the ADO resolved-item shape', () => {
    expect(mapResolvedJiraIssue({
      key: 'ABC-3',
      fields: { summary: 'Done thing', issuetype: { name: 'Bug' }, status: { name: 'Done' }, created: 'c', resolutiondate: 'r' },
    })).toEqual({ id: 'jira:ABC-3', title: 'Done thing', type: 'Bug', state: 'Done', createdDate: 'c', closedDate: 'r' })
  })
})
