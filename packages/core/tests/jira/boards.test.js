import { describe, it, expect, vi } from 'vitest'
import { fetchJiraBoards, fetchJiraBoardColumns, fetchJiraBoardConfig, jiraColumnForStatus } from '../../src/modules/jira/boards.js'

function client(routes) {
  return { get: vi.fn(async (path) => {
    for (const [p, v] of Object.entries(routes)) if (path.includes(p)) { if (v instanceof Error) throw v; return v }
    throw new Error(`unexpected ${path}`)
  }) }
}

describe('fetchJiraBoards', () => {
  it('merges boards across projects, de-duplicating by id', async () => {
    const c = client({
      'projectKeyOrId=ABC': { values: [{ id: 1, name: 'ABC board', type: 'scrum', location: { projectKey: 'ABC' } }, { id: 9, name: 'Shared', type: 'kanban', location: { projectKey: 'ABC' } }] },
      'projectKeyOrId=DEF': { values: [{ id: 9, name: 'Shared', type: 'kanban', location: { projectKey: 'ABC' } }] },
    })
    expect(await fetchJiraBoards(c, ['ABC', 'DEF'])).toEqual([
      { id: '1', name: 'ABC board', type: 'scrum', projectKey: 'ABC' },
      { id: '9', name: 'Shared', type: 'kanban', projectKey: 'ABC' },
    ])
    expect(c.get).toHaveBeenCalledWith('rest/agile/1.0/board?projectKeyOrId=ABC&maxResults=50')
  })
  it('fails soft per project', async () => {
    const c = client({ 'projectKeyOrId=ABC': new Error('403'), 'projectKeyOrId=DEF': { values: [{ id: 2, name: 'D', type: 'scrum', location: { projectKey: 'DEF' } }] } })
    expect((await fetchJiraBoards(c, ['ABC', 'DEF'])).map(b => b.id)).toEqual(['2'])
  })
})

describe('fetchJiraBoardColumns', () => {
  const names = { 1: 'To Do', 3: 'In Progress', 4: 'Code Review', 10001: 'Done' }
  it('maps column status ids to names, dropping unknown ids and keeping empty columns', async () => {
    const c = client({ 'board/7/configuration': { columnConfig: { columns: [
      { name: 'Backlog', statuses: [] },
      { name: 'To Do', statuses: [{ id: '1' }] },
      { name: 'In Progress', statuses: [{ id: '3' }, { id: '4' }, { id: '999' }] },
      { name: 'Done', statuses: [{ id: '10001' }] },
    ] } } })
    expect(await fetchJiraBoardColumns(c, '7', names)).toEqual([
      { name: 'Backlog', statuses: [] },
      { name: 'To Do', statuses: ['To Do'] },
      { name: 'In Progress', statuses: ['In Progress', 'Code Review'] },
      { name: 'Done', statuses: ['Done'] },
    ])
    expect(c.get).toHaveBeenCalledWith('rest/agile/1.0/board/7/configuration')
  })
  it('throws when the configuration cannot be read', async () => {
    await expect(fetchJiraBoardColumns(client({ 'board/7/configuration': new Error('Not found in Jira (404)') }), '7', names))
      .rejects.toThrow('404')
  })
  it('returns [] for a configuration with no columns', async () => {
    expect(await fetchJiraBoardColumns(client({ 'board/7/configuration': {} }), '7', names)).toEqual([])
  })
})

describe('fetchJiraBoardConfig', () => {
  it('returns the columns and the board estimation field', async () => {
    const c = client({ 'board/7/configuration': {
      columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] },
      estimation: { type: 'field', field: { fieldId: 'customfield_10028', displayName: 'Story Points' } },
    } })
    expect(await fetchJiraBoardConfig(c, '7', { 1: 'To Do' })).toEqual({
      columns: [{ name: 'To Do', statuses: ['To Do'] }], estimationFieldId: 'customfield_10028',
    })
  })
  it('reports no estimation field when the board has none', async () => {
    expect(await fetchJiraBoardConfig(client({ 'board/7/configuration': {} }), '7', {}))
      .toEqual({ columns: [], estimationFieldId: null })
  })
})

describe('jiraColumnForStatus', () => {
  const cols = [{ name: 'To Do', statuses: ['To Do'] }, { name: 'In Progress', statuses: ['In Progress', 'Code Review'] }]
  it('finds the column containing the status, case-insensitively', () => {
    expect(jiraColumnForStatus(cols, 'code review').name).toBe('In Progress')
    expect(jiraColumnForStatus(cols, 'In progress').name).toBe('In Progress')
  })
  it('returns null when no column holds the status or input is empty', () => {
    expect(jiraColumnForStatus(cols, 'Blocked')).toBeNull()
    expect(jiraColumnForStatus(null, 'To Do')).toBeNull()
    expect(jiraColumnForStatus(cols, '')).toBeNull()
  })
})
