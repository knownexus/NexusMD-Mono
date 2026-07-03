import { describe, it, expect } from 'vitest'
import {
  slugify, timeAgo, formatDateTime, adoTypeToHelm, adoStateToHelm,
  isTerminalState, isActiveState, isReviewState, isBlockedState, stateCategory,
  PROJECT_COLORS, STATES,
} from '../../src/modules/ado/helpers.js'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('My Project')).toBe('my-project')
  })
  it('collapses multiple non-alphanumeric chars into one hyphen', () => {
    expect(slugify('hello -- world')).toBe('hello-world')
  })
  it('trims leading and trailing hyphens', () => {
    expect(slugify('-hello-')).toBe('hello')
  })
  it('returns "unknown" for empty string', () => {
    expect(slugify('')).toBe('unknown')
  })
  it('returns "unknown" for null', () => {
    expect(slugify(null)).toBe('unknown')
  })
})

describe('timeAgo', () => {
  it('returns "—" for null', () => {
    expect(timeAgo(null)).toBe('—')
  })
  it('returns "—" for undefined', () => {
    expect(timeAgo(undefined)).toBe('—')
  })
  it('returns minutes for timestamps < 1h ago', () => {
    const d = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(timeAgo(d)).toBe('5m')
  })
  it('returns hours for timestamps 1h–23h ago', () => {
    const d = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(timeAgo(d)).toBe('3h')
  })
  it('returns days for timestamps >= 24h ago', () => {
    const d = new Date(Date.now() - 2 * 86_400_000).toISOString()
    expect(timeAgo(d)).toBe('2d')
  })
})

describe('formatDateTime', () => {
  it('returns "—" for null/undefined', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
  })
  it('returns "—" for an unparseable value', () => {
    expect(formatDateTime('not a date')).toBe('—')
  })
  it('formats as HH:MM DD/MM/YY in local time', () => {
    // No timezone suffix → parsed as local time, matching the local getters used.
    expect(formatDateTime('2026-07-03T14:05:00')).toBe('14:05 03/07/26')
  })
  it('zero-pads single-digit hours, minutes, day, and month', () => {
    expect(formatDateTime('2026-01-09T09:07:00')).toBe('09:07 09/01/26')
  })
})

describe('adoTypeToHelm', () => {
  it.each([
    ['Bug', 'bug'], ['Task', 'task'], ['User Story', 'story'],
    ['Feature', 'feature'], ['Epic', 'epic'], ['Spike', 'spike'],
  ])('maps "%s" → "%s"', (input, expected) => {
    expect(adoTypeToHelm(input)).toBe(expected)
  })
  it('maps unknown types to "task"', () => expect(adoTypeToHelm('Requirement')).toBe('task'))
  it('handles null', () => expect(adoTypeToHelm(null)).toBe('task'))
})

describe('adoStateToHelm', () => {
  it.each([
    ['Active', 'In Progress'], ['in progress', 'In Progress'],
    ['In Review', 'In Review'],
    ['Resolved', 'Done'], ['Closed', 'Done'], ['Done', 'Done'],
    ['Blocked', 'Blocked'],
    ['New', 'To Do'], ['To Do', 'To Do'],
    ['Backlog', 'Backlog'],
  ])('maps "%s" → "%s"', (input, expected) => {
    expect(adoStateToHelm(input)).toBe(expected)
  })
  it('passes through unknown states unchanged', () => {
    expect(adoStateToHelm('Custom State')).toBe('Custom State')
  })
})

describe('state classifiers', () => {
  it('isTerminalState: done/closed/resolved/completed/removed are terminal', () => {
    for (const s of ['Done', 'Closed', 'Resolved', 'Completed', 'Removed']) {
      expect(isTerminalState(s)).toBe(true)
    }
    expect(isTerminalState('Active')).toBe(false)
  })
  it('isActiveState: active/in progress/in testing/specced/assigned are active', () => {
    for (const s of ['Active', 'In Progress', 'In Testing', 'Specced', 'Assigned']) {
      expect(isActiveState(s)).toBe(true)
    }
    expect(isActiveState('Done')).toBe(false)
  })
  it('isReviewState: in review/needs review/review/pull request/pr are review', () => {
    for (const s of ['In Review', 'Needs Review', 'Review', 'Pull Request', 'PR']) {
      expect(isReviewState(s)).toBe(true)
    }
    expect(isReviewState('Active')).toBe(false)
  })
  it('isBlockedState: only "Blocked" matches', () => {
    expect(isBlockedState('Blocked')).toBe(true)
    expect(isBlockedState('Active')).toBe(false)
  })
  it('stateCategory maps to the correct bucket', () => {
    expect(stateCategory('Done')).toBe('done')
    expect(stateCategory('Active')).toBe('active')
    expect(stateCategory('In Review')).toBe('review')
    expect(stateCategory('Blocked')).toBe('blocked')
    expect(stateCategory('To Do')).toBe('todo')
    expect(stateCategory('')).toBe('todo')
  })
})

describe('constants', () => {
  it('PROJECT_COLORS is a non-empty array of strings', () => {
    expect(Array.isArray(PROJECT_COLORS)).toBe(true)
    expect(PROJECT_COLORS.length).toBeGreaterThan(0)
    expect(typeof PROJECT_COLORS[0]).toBe('string')
  })
  it('STATES contains the standard ADO state names', () => {
    expect(STATES).toContain('Active')
    expect(STATES).toContain('Done')
    expect(STATES).toContain('Blocked')
  })
})
