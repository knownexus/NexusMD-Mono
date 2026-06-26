import { describe, it, expect } from 'vitest'
import {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
} from '../src/modules/planner/index.js'

describe('ISO week/date helpers', () => {
  it('getIsoYearWeek: 2026-01-01 (Thursday) is week 1 of 2026', () => {
    expect(getIsoYearWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 })
  })

  it('getIsoYearWeek: 2021-01-01 (Friday) belongs to ISO week 53 of 2020', () => {
    expect(getIsoYearWeek(new Date(2021, 0, 1))).toEqual({ year: 2020, week: 53 })
  })

  it('getIsoYearWeek: mid-year date (2026-06-25, Thursday) → week 26', () => {
    expect(getIsoYearWeek(new Date(2026, 5, 25))).toEqual({ year: 2026, week: 26 })
  })

  it('getIsoWeek matches the week component of getIsoYearWeek', () => {
    const d = new Date(2026, 5, 25)
    expect(getIsoWeek(d)).toBe(getIsoYearWeek(d).week)
  })

  it('getMondayOfDate returns the Monday at local midnight', () => {
    const mon = getMondayOfDate(new Date(2026, 5, 25)) // a Thursday
    expect(mon.getDay()).toBe(1)
    expect(mon.getHours()).toBe(0)
    expect(mon.getMinutes()).toBe(0)
    expect(mon.getDate()).toBe(22) // Mon 2026-06-22
  })

  it('getMondayOfDate on a Sunday returns the preceding Monday (ISO week start)', () => {
    const mon = getMondayOfDate(new Date(2026, 5, 28)) // Sunday
    expect(mon.getDay()).toBe(1)
    expect(mon.getDate()).toBe(22)
  })

  it('fmtDateShort produces a non-empty label', () => {
    expect(typeof fmtDateShort(new Date(2026, 5, 25))).toBe('string')
    expect(fmtDateShort(new Date(2026, 5, 25)).length).toBeGreaterThan(0)
  })
})

describe('weekStorageKey', () => {
  it('zero-pads the week number', () => {
    expect(weekStorageKey(2026, 3)).toBe('nexusmd.planner.week.2026-W03')
    expect(weekStorageKey(2026, 26)).toBe('nexusmd.planner.week.2026-W26')
  })
})

describe('weekKeyToOffset', () => {
  it('current week → 0 (round-trips through getYearWeekForOffset)', () => {
    const { year, week } = getYearWeekForOffset(0)
    const key = weekStorageKey(year, week)
    expect(weekKeyToOffset(key)).toBe(0)
  })

  it('next week → 1, last week → -1', () => {
    const next = getYearWeekForOffset(1)
    const prev = getYearWeekForOffset(-1)
    expect(weekKeyToOffset(weekStorageKey(next.year, next.week))).toBe(1)
    expect(weekKeyToOffset(weekStorageKey(prev.year, prev.week))).toBe(-1)
  })

  it('accepts a bare YYYY-Www key', () => {
    const { year, week } = getYearWeekForOffset(0)
    expect(weekKeyToOffset(`${year}-W${String(week).padStart(2, '0')}`)).toBe(0)
  })

  it('unmatched / malformed key → 0', () => {
    expect(weekKeyToOffset('not-a-key')).toBe(0)
    expect(weekKeyToOffset('')).toBe(0)
    expect(weekKeyToOffset(null)).toBe(0)
    expect(weekKeyToOffset('1900-W01')).toBe(0) // outside ±52 weeks
  })
})

describe('section schema', () => {
  it('every section has a unique id', () => {
    const ids = PLANNER_SECTIONS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every section has a known type', () => {
    const types = new Set(['table', 'keyval', 'textarea', 'eow'])
    for (const s of PLANNER_SECTIONS) expect(types.has(s.type)).toBe(true)
  })

  it('every table section column has k/l/t', () => {
    for (const s of PLANNER_SECTIONS.filter(s => s.type === 'table')) {
      for (const c of s.cols) {
        expect(c).toHaveProperty('k')
        expect(c).toHaveProperty('l')
        expect(c).toHaveProperty('t')
      }
    }
  })

  it('every PL_GROUPS id references a real section, and every section is grouped exactly once', () => {
    const sectionIds = new Set(PLANNER_SECTIONS.map(s => s.id))
    const grouped = PL_GROUPS.flatMap(g => g.ids)
    for (const id of grouped) expect(sectionIds.has(id)).toBe(true)
    expect(new Set(grouped).size).toBe(grouped.length)            // no section in two groups
    expect(new Set(grouped)).toEqual(sectionIds)                  // every section grouped
  })

  it('plSectionGroup finds the owning group', () => {
    expect(plSectionGroup('tasks').id).toBe('personal')
    expect(plSectionGroup('oneOnOnes').id).toBe('people')
    expect(plSectionGroup('nonexistent')).toBeUndefined()
  })
})

describe('buildEmptyPlannerData', () => {
  const empty = buildEmptyPlannerData()

  it('produces the right shape per section type', () => {
    expect(empty.tasks).toEqual([])              // table
    expect(empty.themes).toEqual({})             // keyval
    expect(empty.notes).toBe('')                 // textarea
    expect(empty.eow).toEqual({ well:'', didNot:'', carry:'' }) // eow
  })

  it('has a key for every section', () => {
    for (const s of PLANNER_SECTIONS) expect(empty).toHaveProperty(s.id)
  })
})

describe('hasMeaningfulPlannerData', () => {
  it('false for null / empty data', () => {
    expect(hasMeaningfulPlannerData(null)).toBe(false)
    expect(hasMeaningfulPlannerData(buildEmptyPlannerData())).toBe(false)
  })

  it('true when a table section has rows', () => {
    const d = buildEmptyPlannerData()
    d.tasks = [{ task: 'do thing' }]
    expect(hasMeaningfulPlannerData(d)).toBe(true)
  })

  it('true when a textarea has non-whitespace text', () => {
    const d = buildEmptyPlannerData()
    d.notes = '   '
    expect(hasMeaningfulPlannerData(d)).toBe(false)
    d.notes = 'remember this'
    expect(hasMeaningfulPlannerData(d)).toBe(true)
  })

  it('true when a keyval/eow field is filled', () => {
    const d = buildEmptyPlannerData()
    d.eow = { well: 'shipped', didNot: '', carry: '' }
    expect(hasMeaningfulPlannerData(d)).toBe(true)
  })

  it('true when only themes are filled', () => {
    const d = buildEmptyPlannerData()
    expect(hasMeaningfulPlannerData(d, { morale: 'good' })).toBe(true)
    expect(hasMeaningfulPlannerData(d, { morale: '  ' })).toBe(false)
  })
})
