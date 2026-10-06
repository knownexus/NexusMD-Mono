import { describe, it, expect } from 'vitest'
import { applyHiddenPeople } from '../../src/modules/workitems/people.js'

const data = {
  ORG: 'o',
  TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }, { id: 'sam-roe', name: 'Sam Roe' }],
  JIRA_PEOPLE: [{ accountId: 'a1', displayName: 'Alex Doe' }, { accountId: 's1', displayName: 'Sam Roe' }],
  WORK_ITEMS: [
    { id: 1, assignee: 'alex-doe', assigneeAccountId: 'a1' },
    { id: 2, assignee: 'sam-roe', assigneeAccountId: 's1' },
    { id: 3, assignee: null },
  ],
}

describe('applyHiddenPeople', () => {
  it('returns the same reference when nothing is hidden', () => {
    expect(applyHiddenPeople(data, [])).toBe(data)
    expect(applyHiddenPeople(data, undefined)).toBe(data)
  })

  it('filters TEAM but keeps the full roster as TEAM_ALL', () => {
    const out = applyHiddenPeople(data, ['alex-doe'])
    expect(out.TEAM.map(m => m.id)).toEqual(['sam-roe'])
    expect(out.TEAM_ALL).toBe(data.TEAM)
  })

  it('filters JIRA_PEOPLE by slugified display name', () => {
    const out = applyHiddenPeople(data, ['alex-doe'])
    expect(out.JIRA_PEOPLE.map(p => p.accountId)).toEqual(['s1'])
  })

  it('unassigns work items of hidden people only', () => {
    const out = applyHiddenPeople(data, ['alex-doe'])
    expect(out.WORK_ITEMS[0]).toMatchObject({ id: 1, assignee: null, assigneeAccountId: null })
    expect(out.WORK_ITEMS[1]).toBe(data.WORK_ITEMS[1])
    expect(out.WORK_ITEMS[2]).toBe(data.WORK_ITEMS[2])
  })

  it('passes other fields through', () => {
    expect(applyHiddenPeople(data, ['alex-doe']).ORG).toBe('o')
  })

  it('tolerates missing collections', () => {
    expect(applyHiddenPeople({ ORG: 'x' }, ['a'])).toMatchObject({ ORG: 'x' })
  })
})
