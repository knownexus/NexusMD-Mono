import { describe, it, expect } from 'vitest'
import { filterTriageItems, buildTriageCsv } from '../src/index.js'

const items = [
  { id: 1, title: 'Alpha bug',  type: 'Bug',  state: 'Active',   assignee: 'alex-doe', project: 'Web',  priority: 1, changedMs: 1_000, tags: ['urgent'] },
  { id: 2, title: 'Beta task',  type: 'Task', state: 'New',      assignee: null,       project: 'Web',  priority: 2, changedMs: 2_000, tags: ['backend'] },
  { id: 3, title: 'Gamma "x"',  type: 'Bug',  state: 'Resolved', assignee: 'sam-roe',  project: 'Api',  priority: 3, changedMs: 3_000, tags: ['urgent', 'backend'] },
]

describe('filterTriageItems', () => {
  it('returns all items with no filters', () => {
    expect(filterTriageItems(items)).toHaveLength(3)
    expect(filterTriageItems(items, {})).toHaveLength(3)
  })
  it('filters by project', () => {
    expect(filterTriageItems(items, { projects: ['Web'] }).map(i => i.id)).toEqual([1, 2])
  })
  it('filters by state', () => {
    expect(filterTriageItems(items, { states: ['Active', 'New'] }).map(i => i.id)).toEqual([1, 2])
  })
  it('filters by assignee id and __unassigned__', () => {
    expect(filterTriageItems(items, { assigneeId: 'alex-doe' }).map(i => i.id)).toEqual([1])
    expect(filterTriageItems(items, { assigneeId: '__unassigned__' }).map(i => i.id)).toEqual([2])
  })
  it('resolves assignee by display name (slugified)', () => {
    expect(filterTriageItems(items, { assigneeName: 'Sam Roe' }).map(i => i.id)).toEqual([3])
  })
  it('filters by changed-date range', () => {
    expect(filterTriageItems(items, { dateFrom: 2_000 }).map(i => i.id)).toEqual([2, 3])
    expect(filterTriageItems(items, { dateTo: 2_000 }).map(i => i.id)).toEqual([1, 2])
  })
  it('includes/excludes by tags (case-insensitive)', () => {
    expect(filterTriageItems(items, { tags: ['URGENT'] }).map(i => i.id)).toEqual([1, 3])
    expect(filterTriageItems(items, { excludedTags: ['backend'] }).map(i => i.id)).toEqual([1])
  })
})

describe('buildTriageCsv', () => {
  it('emits a header plus one row per item', () => {
    const csv = buildTriageCsv(items)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('ID,Title,Type,State,Assignee,Priority,Project,Changed,Tags')
    expect(lines).toHaveLength(4)
  })
  it('escapes quotes (RFC 4180) and joins tags', () => {
    const csv = buildTriageCsv([items[2]])
    expect(csv).toContain('"Gamma ""x"""')
    expect(csv).toContain('"urgent; backend"')
  })
  it('renders changed date as ISO yyyy-mm-dd', () => {
    const csv = buildTriageCsv([{ id: 9, title: 't', changedMs: Date.UTC(2026, 0, 2) }])
    expect(csv).toContain('2026-01-02')
  })
  it('handles empty input', () => {
    expect(buildTriageCsv([]).split('\n')).toHaveLength(1)
  })
})
