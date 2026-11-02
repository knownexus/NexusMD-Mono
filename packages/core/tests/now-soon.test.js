import { describe, it, expect } from 'vitest'
import { eventBadge } from '../src/index.js'

const at = (h, m = 0) => new Date(2026, 10, 3, h, m).getTime()
const ev = { start: '2026-11-03T10:00', end: '2026-11-03T11:00' }

describe('eventBadge', () => {
  it("an event in progress is 'now'", () => {
    expect(eventBadge(ev, at(10, 30))).toBe('now')
  })
  it("an event starting within the soon window is 'soon'", () => {
    expect(eventBadge(ev, at(9, 40))).toBe('soon')
    expect(eventBadge(ev, at(9, 29))).toBe(null)
    expect(eventBadge(ev, at(9, 50), 5)).toBe(null)
  })
  it('an all-day or past event is null', () => {
    expect(eventBadge({ start: '2026-11-03' }, at(10))).toBe(null)
    expect(eventBadge(ev, at(12))).toBe(null)
    expect(eventBadge({ start: 'nope' }, at(10))).toBe(null)
  })
  it('an event with no end time does not throw', () => {
    const open = { start: '2026-11-03T10:00' }
    expect(eventBadge(open, at(10, 30))).toBe('now')
    expect(eventBadge(open, at(11, 30))).toBe(null)
    expect(eventBadge(undefined, at(10))).toBe(null)
  })
  it('boundaries: start is now, end is not, 30 minutes out is soon', () => {
    expect(eventBadge(ev, at(10))).toBe('now')
    expect(eventBadge(ev, at(11))).toBe(null)
    expect(eventBadge(ev, at(9, 30))).toBe('soon')
  })
})
