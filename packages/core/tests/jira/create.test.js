import { describe, it, expect, vi } from 'vitest'
import {
  classifyJiraField, normaliseCreateFields, layoutCreateFields, buildJiraCreatePayload,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
} from '../../src/modules/jira/create.js'

const IDS = { storyPoints: 'customfield_10016', sprint: 'customfield_10020', acceptanceCriteria: null, reproSteps: null }

const RAW = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, schema: { type: 'issuetype' } },
  { fieldId: 'description', name: 'Description', required: false, schema: { type: 'string' } },
  { fieldId: 'assignee', name: 'Assignee', required: false, schema: { type: 'user' } },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority' }, allowedValues: [{ id: '2', name: 'High' }] },
  { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string' } },
  { fieldId: 'customfield_10016', name: 'Story point estimate', required: false, schema: { type: 'number' } },
  { fieldId: 'customfield_10020', name: 'Sprint', required: false, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { fieldId: 'components', name: 'Components', required: true, schema: { type: 'array', items: 'component' }, allowedValues: [{ id: '10', name: 'API' }] },
  { fieldId: 'customfield_1', name: 'Team', required: true, schema: { type: 'option' }, allowedValues: [{ id: '7', value: 'Core' }] },
  { fieldId: 'customfield_2', name: 'Release notes', required: false, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  { fieldId: 'customfield_3', name: 'Weird', required: true, schema: { type: 'any' } },
  { fieldId: 'duedate', name: 'Due date', required: false, hasDefaultValue: false, schema: { type: 'date' } },
  { fieldId: 'reporter', name: 'Reporter', required: true, hasDefaultValue: true, schema: { type: 'user' } },
]

describe('classifyJiraField', () => {
  it('classifies by id, schema and allowed values', () => {
    const kinds = Object.fromEntries(RAW.map(f => [f.fieldId, classifyJiraField(f, IDS)]))
    expect(kinds).toMatchObject({
      description: 'richtext', assignee: 'user', priority: 'option', labels: 'labels',
      customfield_10016: 'number', customfield_10020: 'sprint', components: 'multi-option',
      customfield_1: 'option', customfield_2: 'richtext', customfield_3: null, duedate: 'date',
    })
  })

  it('classifies datetime fields separately from date fields', () => {
    expect(classifyJiraField({ fieldId: 'customfield_9', schema: { type: 'datetime' } }, IDS)).toBe('datetime')
    expect(classifyJiraField({ fieldId: 'duedate', schema: { type: 'date' } }, IDS)).toBe('date')
  })
})

describe('normaliseCreateFields + layoutCreateFields', () => {
  const fields = normaliseCreateFields(RAW, IDS)

  it('drops fields the form sets itself and normalises allowed values', () => {
    expect(fields.map(f => f.key)).not.toContain('summary')
    expect(fields.map(f => f.key)).not.toContain('issuetype')
    expect(fields.map(f => f.key)).not.toContain('reporter')
    expect(fields.find(f => f.key === 'customfield_1').allowedValues).toEqual([{ id: '7', name: 'Core' }])
    expect(fields.find(f => f.key === 'customfield_10016').role).toBe('points')
  })

  it('orders core fields first and separates required, optional and unsupported', () => {
    const layout = layoutCreateFields(fields)
    expect(layout.core.map(f => f.key)).toEqual(['description', 'assignee', 'priority', 'labels', 'customfield_10016'])
    expect(layout.required.map(f => f.key)).toEqual(['components', 'customfield_1'])
    expect(layout.more.map(f => f.key)).toEqual(['customfield_2', 'duedate'])
    expect(layout.unsupportedRequired.map(f => f.key)).toEqual(['customfield_3'])
  })

  it('gives the points role to the board estimation field when it is on the form', () => {
    const raw = [...RAW, { fieldId: 'customfield_10028', name: 'Story Points', required: false, schema: { type: 'number' } }]
    const withBoard = normaliseCreateFields(raw, IDS, { pointsFieldId: 'customfield_10028' })
    expect(withBoard.find(f => f.key === 'customfield_10028')).toMatchObject({ role: 'points', kind: 'number' })
    expect(withBoard.find(f => f.key === 'customfield_10016').role).toBeNull()
    expect(layoutCreateFields(withBoard).core.map(f => f.key)).toContain('customfield_10028')
  })

  it('keeps the site story points field as points when the board field is not on the form', () => {
    const fields = normaliseCreateFields(RAW, IDS, { pointsFieldId: 'customfield_10028' })
    expect(fields.find(f => f.key === 'customfield_10016').role).toBe('points')
  })

  it('treats a required sprint as unsupported (not settable at create in v1)', () => {
    const layout = layoutCreateFields(normaliseCreateFields([{ ...RAW[7], required: true }], IDS))
    expect(layout.unsupportedRequired.map(f => f.key)).toEqual(['customfield_10020'])
  })
})

describe('buildJiraCreatePayload', () => {
  it('shapes each kind and skips empty values', () => {
    const fields = normaliseCreateFields(RAW, IDS)
    const payload = buildJiraCreatePayload({
      projectKey: 'ABC', typeId: '10001', summary: '  Title  ', fields,
      values: {
        description: '<p>d</p>', assignee: 'u1', priority: '2', labels: 'a b, c',
        customfield_10016: '3', components: ['10'], customfield_1: '7', duedate: '2026-10-10',
        customfield_2: '',
      },
    })
    expect(payload.fields).toMatchObject({
      project: { key: 'ABC' }, issuetype: { id: '10001' }, summary: 'Title',
      assignee: { accountId: 'u1' }, priority: { id: '2' }, labels: ['a-b', 'c'],
      customfield_10016: 3, components: [{ id: '10' }], customfield_1: { id: '7' }, duedate: '2026-10-10',
    })
    expect(payload.fields.description.type).toBe('doc')
    expect(payload.fields).not.toHaveProperty('customfield_2')
  })

  it('sends a datetime-local value as a full UTC timestamp and keeps dates as YYYY-MM-DD', () => {
    const payload = buildJiraCreatePayload({
      projectKey: 'ABC', typeId: '1', summary: 's',
      fields: [{ key: 'customfield_9', kind: 'datetime' }, { key: 'duedate', kind: 'date' }],
      values: { customfield_9: '2026-10-10T14:30', duedate: '2026-10-11' },
    })
    const expected = new Date(2026, 9, 10, 14, 30).toISOString().replace(/Z$/, '+0000')
    expect(payload.fields.customfield_9).toBe(expected)
    expect(payload.fields.customfield_9).toMatch(/^2026-10-1\dT\d{2}:\d{2}:00\.000\+0000$/)
    expect(payload.fields.duedate).toBe('2026-10-11')
  })

  it('sends a parent key upper-cased', () => {
    const payload = buildJiraCreatePayload({
      projectKey: 'ABC', typeId: '1', summary: 's',
      fields: [{ key: 'parent', kind: 'parent' }], values: { parent: ' abc-5 ' },
    })
    expect(payload.fields.parent).toEqual({ key: 'ABC-5' })
  })
})

describe('create-meta fetchers', () => {
  it('reads issue types from either response shape', async () => {
    const client = { get: vi.fn(async () => ({ issueTypes: [{ id: 1, name: 'Story', subtask: false }] })) }
    expect(await fetchJiraCreateTypes(client, 'ABC')).toEqual([{ id: '1', name: 'Story', subtask: false }])
    client.get.mockResolvedValueOnce({ values: [{ id: 2, name: 'Bug' }] })
    expect(await fetchJiraCreateTypes(client, 'ABC')).toEqual([{ id: '2', name: 'Bug', subtask: false }])
  })
  it('normalises fields for a type', async () => {
    const client = { get: vi.fn(async () => ({ fields: RAW })) }
    const fields = await fetchJiraCreateFields(client, 'ABC', '1', IDS)
    expect(client.get).toHaveBeenCalledWith('rest/api/3/issue/createmeta/ABC/issuetypes/1?maxResults=200')
    expect(fields.length).toBeGreaterThan(0)
  })
  it('passes the board estimation field through to normalisation', async () => {
    const raw = [...RAW, { fieldId: 'customfield_10028', name: 'Story Points', required: false, schema: { type: 'number' } }]
    const client = { get: vi.fn(async () => ({ fields: raw })) }
    const fields = await fetchJiraCreateFields(client, 'ABC', '1', IDS, { pointsFieldId: 'customfield_10028' })
    expect(fields.find(f => f.role === 'points').key).toBe('customfield_10028')
  })
  it('reads link types', async () => {
    const client = { get: vi.fn(async () => ({ issueLinkTypes: [{ id: 1, name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }] })) }
    expect(await fetchJiraLinkTypes(client)).toEqual([{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }])
  })
})

describe('createJiraIssue', () => {
  it('creates, uploads attachments with the no-check header, links, and collects warnings', async () => {
    const client = {
      post: vi.fn(async (path) => (path === 'rest/api/3/issue' ? { key: 'ABC-7' } : null)),
      send: vi.fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('too big')),
    }
    const file = (name) => ({ name, type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(2) })
    const result = await createJiraIssue(client, { projectKey: 'ABC', typeId: '1', summary: 's', values: {}, fields: [] }, {
      attachments: [file('a.txt'), file('b.txt')],
      links: [{ typeName: 'Blocks', key: 'ABC-1' }],
    })
    expect(result).toEqual({ id: 'jira:ABC-7', key: 'ABC-7', warnings: ['attachment "b.txt" failed: too big'] })
    expect(client.send).toHaveBeenCalledWith('rest/api/3/issue/ABC-7/attachments', expect.objectContaining({
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      attachment: expect.objectContaining({ name: 'a.txt', type: 'text/plain' }),
    }))
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issueLink', {
      type: { name: 'Blocks' }, inwardIssue: { key: 'ABC-7' }, outwardIssue: { key: 'ABC-1' },
    })
  })
})
