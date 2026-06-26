import { describe, it, expect } from 'vitest'
import {
  isAllDayEvent, getEventsForDay, sortEventsByTime, buildAlertKey, pendingAlerts,
} from '../src/index.js'

describe('isAllDayEvent', () => {
  it('detects date-only (length-10) starts', () => {
    expect(isAllDayEvent({ start: '2026-06-26' })).toBe(true)
    expect(isAllDayEvent({ start: '2026-06-26T09:00:00Z' })).toBe(false)
    expect(isAllDayEvent({})).toBe(false)
  })
})

describe('getEventsForDay', () => {
  it('returns only events on the target local day', () => {
    const day = new Date(2026, 5, 26)
    const events = [
      { id: 'a', start: '2026-06-26T09:00:00' },
      { id: 'b', start: '2026-06-27T09:00:00' },
    ]
    expect(getEventsForDay(events, day).map(e => e.id)).toEqual(['a'])
  })
})

describe('sortEventsByTime', () => {
  it('puts all-day events first, then chronological', () => {
    const events = [
      { id: 'late',  start: '2026-06-26T15:00:00' },
      { id: 'allday', start: '2026-06-26' },
      { id: 'early', start: '2026-06-26T08:00:00' },
    ]
    expect(sortEventsByTime(events).map(e => e.id)).toEqual(['allday', 'early', 'late'])
  })
  it('does not mutate the input', () => {
    const events = [{ id: 'b', start: '2026-06-26T15:00:00' }, { id: 'a', start: '2026-06-26T08:00:00' }]
    const copy = [...events]
    sortEventsByTime(events)
    expect(events).toEqual(copy)
  })
})

describe('buildAlertKey', () => {
  it('encodes remind vs start with reminder minutes', () => {
    expect(buildAlertKey('e1', 'remind', 15)).toBe('e1:remind:15')
    expect(buildAlertKey('e1', 'remind')).toBe('e1:remind:10')
    expect(buildAlertKey('e1', 'start')).toBe('e1:start')
  })
})

describe('pendingAlerts', () => {
  const now = new Date('2026-06-26T09:00:00Z')

  it('fires a reminder when within the reminder window', () => {
    const events = [{ id: 'e1', start: '2026-06-26T09:10:00Z' }] // 10 min out, reminder=10
    const alerts = pendingAlerts(events, now, 10)
    expect(alerts.some(a => a.type === 'remind')).toBe(true)
  })
  it('fires a start alert at start time (within jitter window)', () => {
    const events = [{ id: 'e1', start: '2026-06-26T09:00:30Z' }] // 30s out
    const alerts = pendingAlerts(events, now, 10)
    expect(alerts.some(a => a.type === 'start')).toBe(true)
  })
  it('skips already-alerted keys and never mutates the set', () => {
    const events = [{ id: 'e1', start: '2026-06-26T09:00:30Z' }]
    const alerted = new Set([buildAlertKey('e1', 'start')])
    const before = new Set(alerted)
    const alerts = pendingAlerts(events, now, 10, alerted)
    expect(alerts.some(a => a.type === 'start')).toBe(false)
    expect(alerted).toEqual(before)
  })
  it('ignores all-day events and far-future events', () => {
    const events = [
      { id: 'allday', start: '2026-06-26' },
      { id: 'far', start: '2026-06-26T23:00:00Z' },
    ]
    expect(pendingAlerts(events, now, 10)).toHaveLength(0)
  })
})
