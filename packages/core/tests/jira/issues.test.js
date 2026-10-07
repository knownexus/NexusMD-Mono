import { describe, it, expect, vi } from 'vitest'
import {
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields,
  buildJiraFieldsPayload, updateJiraIssue, listJiraTransitions, pickTransition,
  transitionJiraIssue, transitionJiraIssueToAny, jiraPatchFromAdoField,
} from '../../src/modules/jira/issues.js'

const META = {
  fieldIds: { storyPoints: 'customfield_10016', sprint: null, acceptanceCriteria: 'customfield_10040', reproSteps: null },
  priorities: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }],
}

function makeClient(responses = {}) {
  const calls = []
  const handle = (method) => vi.fn(async (path, body) => {
    calls.push({ method, path, body })
    for (const [pattern, data] of Object.entries(responses)) if (path.includes(pattern)) return data
    return null
  })
  return { get: handle('GET'), post: handle('POST'), put: handle('PUT'), calls }
}

describe('reads', () => {
  it('loads rendered description and acceptance criteria', async () => {
    const client = makeClient({ 'issue/ABC-1?': { renderedFields: { description: '<p>d</p>', customfield_10040: '<p>ac</p>' } } })
    expect(await loadJiraDetail(client, 'ABC-1', META)).toEqual({ description: '<p>d</p>', acceptanceCriteria: '<p>ac</p>', reproSteps: null })
    expect(client.get.mock.calls[0][0]).toBe('rest/api/3/issue/ABC-1?fields=description,customfield_10040&expand=renderedFields')
  })

  it('loads rendered comments', async () => {
    const client = makeClient({ '/comment': { comments: [{ id: '5', author: { displayName: 'Sam' }, renderedBody: '<p>hi</p>', created: 't' }] } })
    expect(await loadJiraComments(client, 'ABC-1')).toEqual([{ id: '5', author: 'Sam', text: '<p>hi</p>', createdDate: 't' }])
  })

  it('adds a comment as ADF and returns the normalised comment', async () => {
    const client = makeClient({ '/comment': { id: '6', author: { displayName: 'Me' }, renderedBody: '<p>yo</p>', created: 't2' } })
    expect(await addJiraComment(client, 'ABC-1', '<p>yo</p>')).toEqual({ id: '6', author: 'Me', text: '<p>yo</p>', createdDate: 't2' })
    expect(client.post.mock.calls[0][1]).toEqual({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'yo' }] }] } })
  })

  it('labels raw custom fields with their names', async () => {
    const client = makeClient({ 'expand=names': { fields: { summary: 's', customfield_1: 3 }, names: { summary: 'Summary', customfield_1: 'Points' } } })
    expect(await loadJiraRawFields(client, 'ABC-1')).toEqual({ 'Summary (summary)': 's', 'Points (customfield_1)': 3 })
  })
})

describe('buildJiraFieldsPayload', () => {
  it('maps each normalised patch key', () => {
    expect(buildJiraFieldsPayload({
      title: 'T', assigneeAccountId: 'u1', priorityName: 'High', tags: ['a'], points: '5',
    }, META)).toEqual({
      summary: 'T', assignee: { accountId: 'u1' }, priority: { name: 'High' }, labels: ['a'], customfield_10016: 5,
    })
  })
  it('converts description to ADF and unassigns with null', () => {
    const f = buildJiraFieldsPayload({ description: '<p>x</p>', assigneeAccountId: null }, META)
    expect(f.description.type).toBe('doc')
    expect(f.assignee).toBeNull()
  })
  it('turns spaces in labels into hyphens because Jira rejects spaces', () => {
    expect(buildJiraFieldsPayload({ tags: ['needs review', ' x '] }, META).labels).toEqual(['needs-review', 'x'])
  })
  it('writes points to the board estimation field when one is known', () => {
    expect(buildJiraFieldsPayload({ points: '8' }, { ...META, pointsFieldId: 'customfield_10028' }))
      .toEqual({ customfield_10028: 8 })
    expect(buildJiraFieldsPayload({ points: '' }, { fieldIds: {}, pointsFieldId: 'customfield_10028' }))
      .toEqual({ customfield_10028: null })
  })
  it('explains when the site has no story points field', () => {
    expect(() => buildJiraFieldsPayload({ points: 3 }, { fieldIds: {} })).toThrow('no story points field')
  })
})

describe('updateJiraIssue', () => {
  it('PUTs the fields', async () => {
    const client = makeClient()
    await updateJiraIssue(client, 'ABC-1', { title: 'New' }, META)
    expect(client.put).toHaveBeenCalledWith('rest/api/3/issue/ABC-1', { fields: { summary: 'New' } })
  })
  it('sends nothing for an empty patch', async () => {
    const client = makeClient()
    await updateJiraIssue(client, 'ABC-1', {}, META)
    expect(client.put).not.toHaveBeenCalled()
  })
})

describe('transitions', () => {
  const TRANSITIONS = { transitions: [
    { id: '11', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
    { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } },
  ] }

  it('lists transitions with destination category', async () => {
    expect(await listJiraTransitions(makeClient({ '/transitions': TRANSITIONS }), 'ABC-1')).toEqual([
      { id: '11', name: 'Start', toName: 'In Progress', toCategory: 'InProgress' },
      { id: '31', name: 'Finish', toName: 'Done', toCategory: 'Completed' },
    ])
  })

  it('picks by state name case-insensitively, or by category', () => {
    const list = [{ id: '1', toName: 'Done', toCategory: 'Completed' }]
    expect(pickTransition(list, { state: 'done' })?.id).toBe('1')
    expect(pickTransition(list, { category: 'Completed' })?.id).toBe('1')
    expect(pickTransition(list, { state: 'Nope' })).toBeNull()
    expect(pickTransition(list, {})).toBeNull()
  })

  it('posts the matching transition and returns the new state', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect(await transitionJiraIssue(client, 'ABC-1', { category: 'Completed' })).toEqual({ state: 'Done', stateCategory: 'Completed' })
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issue/ABC-1/transitions', { transition: { id: '31' } })
  })

  it('throws without posting when no transition reaches the target', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    await expect(transitionJiraIssue(client, 'ABC-1', { state: 'Blocked' }, { currentState: 'To Do' }))
      .rejects.toThrow('No transition from "To Do" to "Blocked" in this workflow')
    expect(client.post).not.toHaveBeenCalled()
  })
})

describe('transitionJiraIssueToAny', () => {
  const TRANSITIONS = { transitions: [
    { id: '21', name: 'Review', to: { name: 'Code Review', statusCategory: { key: 'indeterminate' } } },
    { id: '11', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  ] }
  it('takes the first transition in the column\'s status order', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect(await transitionJiraIssueToAny(client, 'ABC-1', ['In Progress', 'Code Review'], { currentState: 'To Do' }))
      .toEqual({ state: 'In Progress', stateCategory: 'InProgress' })
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issue/ABC-1/transitions', { transition: { id: '11' } })
  })
  it('matches status names case-insensitively', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect((await transitionJiraIssueToAny(client, 'ABC-1', ['code review'])).state).toBe('Code Review')
  })
  it('throws without posting when no transition reaches the column', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    await expect(transitionJiraIssueToAny(client, 'ABC-1', ['Done'], { currentState: 'To Do' }))
      .rejects.toThrow('No transition from "To Do" to any status in this column')
    expect(client.post).not.toHaveBeenCalled()
  })
})

describe('jiraPatchFromAdoField', () => {
  const ctx = { people: [{ accountId: 'u1', displayName: 'Alex Doe' }], priorities: META.priorities }

  it('turns a state write into a transition', () => {
    expect(jiraPatchFromAdoField('System.State', 'Done', ctx)).toEqual({ transition: { state: 'Done' } })
  })
  it('maps title, description, acceptance criteria and points', () => {
    expect(jiraPatchFromAdoField('System.Title', 'T', ctx)).toEqual({ patch: { title: 'T' } })
    expect(jiraPatchFromAdoField('System.Description', '<p>d</p>', ctx)).toEqual({ patch: { description: '<p>d</p>' } })
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Common.AcceptanceCriteria', '', ctx)).toEqual({ patch: { acceptanceCriteria: '' } })
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Scheduling.StoryPoints', 8, ctx)).toEqual({ patch: { points: 8 } })
  })
  it('splits ADO-style tag strings', () => {
    expect(jiraPatchFromAdoField('System.Tags', 'a; b ;', ctx)).toEqual({ patch: { tags: ['a', 'b'] } })
  })
  it('maps a priority rank to its Jira name', () => {
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Common.Priority', 2, ctx)).toEqual({ patch: { priorityName: 'High' } })
    expect(() => jiraPatchFromAdoField('Microsoft.VSTS.Common.Priority', 9, ctx)).toThrow('no priority ranked 9')
  })
  it('resolves assignee display names to account ids, and blank to unassigned', () => {
    expect(jiraPatchFromAdoField('System.AssignedTo', 'alex doe', ctx)).toEqual({ patch: { assigneeAccountId: 'u1' } })
    expect(jiraPatchFromAdoField('System.AssignedTo', '', ctx)).toEqual({ patch: { assigneeAccountId: null } })
    expect(() => jiraPatchFromAdoField('System.AssignedTo', 'Nobody', ctx)).toThrow("Nobody can't be assigned in Jira")
  })
  it('rejects fields Jira items do not have', () => {
    expect(() => jiraPatchFromAdoField('Custom.Area', 'x', ctx)).toThrow("Custom.Area can't be edited on Jira items")
  })
})
