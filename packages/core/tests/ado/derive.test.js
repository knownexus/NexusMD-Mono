import { describe, it, expect } from 'vitest'
import { deriveProjects, deriveSprint, deriveActivity, derivePrSparkline } from '../../src/modules/ado/derive.js'

// ── deriveProjects ────────────────────────────────────────────────────────────

describe('deriveProjects', () => {
  it('returns empty array for no items and no config', () => {
    expect(deriveProjects([], [])).toEqual([])
  })
  it('derives projects from work item project slugs, sorted by count', () => {
    const items = [
      { project: 'alpha' }, { project: 'alpha' }, { project: 'beta' },
    ]
    const projects = deriveProjects(items, [])
    expect(projects[0].id).toBe('alpha')
    expect(projects[1].id).toBe('beta')
  })
  it('always includes configured projects even with zero items', () => {
    const projects = deriveProjects([], ['My Project'])
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('my-project')
  })
  it('uses the config project name as display name', () => {
    const projects = deriveProjects([{ project: 'my-project' }], ['My Project'])
    expect(projects[0].name).toBe('My Project')
  })
  it('assigns a color to each project', () => {
    const projects = deriveProjects([{ project: 'alpha' }], [])
    expect(typeof projects[0].color).toBe('string')
    expect(projects[0].color.length).toBeGreaterThan(0)
  })
})

// ── deriveSprint ──────────────────────────────────────────────────────────────

const sprintWIs = [
  { iterationPath: 'Proj\\Sprint 1', state: 'Done',      points: 5,  sprint: true, changedMs: Date.now() - 1000 },
  { iterationPath: 'Proj\\Sprint 1', state: 'Active',    points: 3,  sprint: true, changedMs: null },
  { iterationPath: 'Proj\\Sprint 1', state: 'In Review', points: 2,  sprint: true, changedMs: null },
  { iterationPath: 'Other\\Path',    state: 'Active',    points: 99, sprint: false, changedMs: null },
]

const iterMeta = {
  name: 'Sprint 1',
  path: 'Proj\\Sprint 1',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
}

describe('deriveSprint', () => {
  it('counts done/active/review points within the iteration path', () => {
    const sprint = deriveSprint(sprintWIs, iterMeta)
    expect(sprint.donePoints).toBe(5)
    expect(sprint.inProgPoints).toBe(3)
    expect(sprint.reviewPoints).toBe(2)
    expect(sprint.totalPoints).toBe(10)
  })
  it('uses totalPoints=1 when all points are zero to avoid division by zero', () => {
    const sprint = deriveSprint([], iterMeta)
    expect(sprint.totalPoints).toBe(1)
  })
  it('falls back to sprint=true flag when iterMeta is null', () => {
    const sprint = deriveSprint(sprintWIs, null)
    expect(sprint.donePoints).toBe(5)
  })
  it('returns name from iterMeta', () => {
    expect(deriveSprint(sprintWIs, iterMeta).name).toBe('Sprint 1')
  })
  it('returns "Current Sprint" when iterMeta is null', () => {
    expect(deriveSprint([], null).name).toBe('Current Sprint')
  })
  it('generates burndown array with one entry per day', () => {
    const sprint = deriveSprint(sprintWIs, iterMeta)
    const expectedDays = Math.ceil((new Date('2026-06-30').getTime() - new Date('2026-06-01').getTime()) / 86_400_000) + 1
    expect(sprint.burndown).toHaveLength(expectedDays)
  })
})

// ── deriveActivity ────────────────────────────────────────────────────────────

describe('deriveActivity', () => {
  it('returns up to 10 items', () => {
    const wis = Array.from({ length: 15 }, (_, i) => ({
      id: i, title: `Item ${i}`, state: 'Active', assignee: 'alice', updated: `${i}m`, changedMs: Date.now() - i * 60_000,
    }))
    expect(deriveActivity(wis).length).toBeLessThanOrEqual(10)
  })
  it('excludes terminal-state items', () => {
    const wis = [
      { id: 1, title: 'Done', state: 'Done', assignee: 'alice', updated: '1m', changedMs: Date.now() },
      { id: 2, title: 'Active', state: 'Active', assignee: 'bob', updated: '2m', changedMs: Date.now() - 1000 },
    ]
    const activity = deriveActivity(wis)
    expect(activity.every(a => a.who !== 'alice' || a.what !== '#1 Done')).toBe(true)
    expect(activity.some(a => a.who === 'bob')).toBe(true)
  })
  it('excludes unassigned items', () => {
    const wis = [{ id: 1, title: 'Unowned', state: 'Active', assignee: null, updated: '1m', changedMs: Date.now() }]
    expect(deriveActivity(wis)).toEqual([])
  })
  it('labels Jira items by their key and tolerates a missing title', () => {
    const wis = [{ id: 'jira:ABC-1', source: 'jira', displayId: 'ABC-1', state: 'In Dev', stateCategory: 'InProgress', assignee: 'sam', updated: '1m' }]
    expect(deriveActivity(wis)).toEqual([{ id: 'jira:ABC-1', who: 'sam', action: 'is working on', what: 'ABC-1 ', when: '1m' }])
  })
  it('skips Jira items in a done status category', () => {
    const wis = [{ id: 'jira:ABC-2', source: 'jira', displayId: 'ABC-2', title: 'x', state: 'Shipped', stateCategory: 'Completed', assignee: 'sam', updated: '1m' }]
    expect(deriveActivity(wis)).toEqual([])
  })
  it('skips Jira backlog (Proposed) items but keeps ADO items regardless of category', () => {
    const wis = [
      { id: 'jira:ABC-3', source: 'jira', displayId: 'ABC-3', title: 'Backlog', state: 'To Do', stateCategory: 'Proposed', assignee: 'sam', updated: '1m' },
      { id: 'jira:ABC-4', source: 'jira', displayId: 'ABC-4', title: 'Doing', state: 'In Dev', stateCategory: 'InProgress', assignee: 'sam', updated: '2m' },
      { id: 9, source: 'ado', title: 'New ADO', state: 'New', stateCategory: 'Proposed', assignee: 'bob', updated: '3m' },
    ]
    expect(deriveActivity(wis).map(a => a.id)).toEqual(['jira:ABC-4', 9])
  })
  it('carries the work item id on each entry', () => {
    const wis = [{ id: 42, title: 'T', state: 'Active', assignee: 'alice', updated: '1m' }]
    expect(deriveActivity(wis)[0].id).toBe(42)
  })
  it('truncates long titles to 50 chars + ellipsis', () => {
    const long = 'A'.repeat(60)
    const wis = [{ id: 1, title: long, state: 'Active', assignee: 'alice', updated: '1m', changedMs: Date.now() }]
    const activity = deriveActivity(wis)
    expect(activity[0].what).toBe('#1 ' + 'A'.repeat(50) + '…')
  })
})

// ── derivePrSparkline ─────────────────────────────────────────────────────────

describe('derivePrSparkline', () => {
  it('returns an array of 10 numbers', () => {
    const sparkline = derivePrSparkline([])
    expect(sparkline).toHaveLength(10)
    expect(sparkline.every(n => typeof n === 'number')).toBe(true)
  })
  it('counts active PRs by age in days (bucket 0–9)', () => {
    const prs = [
      { status: 'active', age: '0d' },
      { status: 'active', age: '0d' },
      { status: 'active', age: '3d' },
      { status: 'merged', age: '1d' },
    ]
    const sparkline = derivePrSparkline(prs)
    expect(sparkline[0]).toBe(2)
    expect(sparkline[3]).toBe(1)
    expect(sparkline[1]).toBe(0)
  })
  it('clamps days >= 9 into bucket 9', () => {
    const prs = [{ status: 'active', age: '99d' }]
    expect(derivePrSparkline(prs)[9]).toBe(1)
  })
})
