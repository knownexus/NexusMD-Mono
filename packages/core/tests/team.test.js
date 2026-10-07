import { describe, it, expect } from 'vitest'
import { mergeTeamRoster, enrichTeamMember, enrichTeam } from '../src/modules/team/index.js'

describe('mergeTeamRoster', () => {
  const base = [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Boris' },
    { id: 'c', name: 'Cleo', isCustom: true }, // stale custom member in base list
  ]

  it('returns service members untouched when there are no overrides', () => {
    expect(mergeTeamRoster(base)).toEqual([
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Boris' },
    ])
  })

  it('drops isCustom members from the base list', () => {
    const out = mergeTeamRoster(base)
    expect(out.find(m => m.id === 'c')).toBeUndefined()
  })

  it('hides removed service members', () => {
    const out = mergeTeamRoster(base, { removedIds: ['a'] })
    expect(out.map(m => m.id)).toEqual(['b'])
  })

  it('appends custom members not already present', () => {
    const out = mergeTeamRoster(base, { customMembers: [{ id: 'z', name: 'Zoe', isCustom: true }] })
    expect(out.map(m => m.id)).toEqual(['a', 'b', 'z'])
  })

  it('does not duplicate a custom member whose id matches a visible service member', () => {
    const out = mergeTeamRoster(base, { customMembers: [{ id: 'a', name: 'Imposter' }] })
    expect(out.filter(m => m.id === 'a')).toHaveLength(1)
    expect(out.find(m => m.id === 'a').name).toBe('Ada')
  })

  it('re-adds a custom member whose service counterpart was removed', () => {
    const out = mergeTeamRoster(base, {
      removedIds: ['a'],
      customMembers: [{ id: 'a', name: 'Custom Ada' }],
    })
    expect(out.find(m => m.id === 'a')?.name).toBe('Custom Ada')
  })

  it('ignores custom members without an id', () => {
    const out = mergeTeamRoster(base, { customMembers: [{ name: 'No Id' }, null] })
    expect(out.map(m => m.id)).toEqual(['a', 'b'])
  })

  it('handles a null/undefined base team', () => {
    expect(mergeTeamRoster(null)).toEqual([])
    expect(mergeTeamRoster(undefined, { customMembers: [{ id: 'x' }] })).toEqual([{ id: 'x' }])
  })
})

describe('enrichTeamMember', () => {
  const workItems = [
    { id: 1, assignee: 'a', state: 'Active', priority: 2, sprint: true, points: 3 },
    { id: 2, assignee: 'a', state: 'In Review', priority: 1, sprint: true, points: 5 },
    { id: 3, assignee: 'a', state: 'Blocked', priority: 3, sprint: false, points: 8 },
    { id: 4, assignee: 'a', state: 'Done', priority: 4, sprint: true, points: 2 },
    { id: 5, assignee: 'b', state: 'Active', priority: 1, sprint: true, points: 1 },
  ]
  const prs = [
    { id: 'p1', author: 'a', status: 'active' },
    { id: 'p2', author: 'a', status: 'completed' },
    { id: 'p3', author: 'b', status: 'active' },
  ]

  it('buckets only the member-owned work items', () => {
    const m = enrichTeamMember({ id: 'a', name: 'Ada' }, { workItems, prs })
    expect(m.myWIs.map(w => w.id)).toEqual([1, 2, 3, 4])
    expect(m.active.map(w => w.id)).toEqual([1, 2]) // active + review
    expect(m.blocked.map(w => w.id)).toEqual([3])
    expect(m.done.map(w => w.id)).toEqual([4])
  })

  it('counts only active PRs the member authored', () => {
    const m = enrichTeamMember({ id: 'a' }, { workItems, prs })
    expect(m.myPRs.map(p => p.id)).toEqual(['p1'])
  })

  it('picks the highest-priority active item as current (lowest priority number)', () => {
    const m = enrichTeamMember({ id: 'a' }, { workItems, prs })
    expect(m.current.id).toBe(2) // priority 1 beats priority 2
  })

  it('sums points only for sprint items', () => {
    const m = enrichTeamMember({ id: 'a' }, { workItems, prs })
    expect(m.points).toBe(3 + 5 + 2) // item 3 excluded (sprint:false)
  })

  it('preserves the original member fields', () => {
    const m = enrichTeamMember({ id: 'a', name: 'Ada', role: 'Dev' }, { workItems, prs })
    expect(m.name).toBe('Ada')
    expect(m.role).toBe('Dev')
  })

  it('buckets Jira items by status category and flag', () => {
    const jiraWIs = [
      { id: 'jira:A-1', source: 'jira', assignee: 'a', state: 'In Dev', stateCategory: 'InProgress', priority: 2 },
      { id: 'jira:A-2', source: 'jira', assignee: 'a', state: 'In QA', stateCategory: 'InProgress', priority: 1 },
      { id: 'jira:A-3', source: 'jira', assignee: 'a', state: 'Design', stateCategory: 'InProgress', priority: 3, flagged: true },
      { id: 'jira:A-4', source: 'jira', assignee: 'a', state: 'Released', stateCategory: 'Completed', priority: 3 },
      { id: 'jira:A-5', source: 'jira', assignee: 'a', state: 'To Do', stateCategory: 'Proposed', priority: 3 },
    ]
    const m = enrichTeamMember({ id: 'a' }, { workItems: jiraWIs })
    expect(m.active.map(w => w.id)).toEqual(['jira:A-1', 'jira:A-2'])
    expect(m.blocked.map(w => w.id)).toEqual(['jira:A-3'])
    expect(m.done.map(w => w.id)).toEqual(['jira:A-4'])
    expect(m.current.id).toBe('jira:A-2')
  })

  it('handles a member with no work and no data', () => {
    const m = enrichTeamMember({ id: 'ghost' })
    expect(m.myWIs).toEqual([])
    expect(m.active).toEqual([])
    expect(m.current).toBeUndefined()
    expect(m.points).toBe(0)
  })
})

describe('enrichTeam', () => {
  it('enriches every member', () => {
    const team = [{ id: 'a' }, { id: 'b' }]
    const workItems = [{ assignee: 'a', state: 'Active', priority: 1, sprint: true, points: 4 }]
    const out = enrichTeam(team, { workItems, prs: [] })
    expect(out).toHaveLength(2)
    expect(out[0].points).toBe(4)
    expect(out[1].points).toBe(0)
  })

  it('returns [] for a null team', () => {
    expect(enrichTeam(null, {})).toEqual([])
  })
})

describe('enrichTeamMember with state categories', () => {
  it('counts a custom Completed-category state as done', () => {
    const m = enrichTeamMember({ id: 'a' }, { workItems: [{ assignee: 'a', state: 'Shipped', stateCategory: 'Completed', priority: 1 }] })
    expect(m.done).toHaveLength(1)
  })
})
