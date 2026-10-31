import { describe, it, expect } from 'vitest'
import { eventBadge, joinUrlOf, safeTeamsUrl, shiftEvent, layoutDay, hourRange, stamp } from './calendar-phone.js'

const at = (h, m = 0) => new Date(2026, 10, 2, h, m)            // 2 Nov 2026, local
const ev = (id, start, end, extra = {}) => ({ id, title: id, start: stamp(start), end: end ? stamp(end) : undefined, ...extra })

describe('now and starting soon', () => {
  const e = ev('a', at(10), at(11))
  it('is "now" while the event is on', () => {
    expect(eventBadge(e, at(10, 30).getTime())).toBe('now')
    expect(eventBadge(e, at(10).getTime())).toBe('now')
  })
  it('is "soon" within 30 minutes of the start, and not before that', () => {
    expect(eventBadge(e, at(9, 40).getTime())).toBe('soon')
    expect(eventBadge(e, at(9, 29).getTime())).toBe('')
  })
  it('is nothing once it has finished or when the date is bad', () => {
    expect(eventBadge(e, at(11).getTime())).toBe('')
    expect(eventBadge({ start: 'nope' }, Date.now())).toBe('')
  })
})

describe('joining a meeting', () => {
  it('uses the link Outlook gave, else a Teams link in the text', () => {
    expect(joinUrlOf({ joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' })).toBe('https://teams.microsoft.com/l/meetup-join/abc')
    expect(joinUrlOf({ description: 'Join: https://teams.microsoft.com/l/meetup-join/xyz?a=1 thanks' })).toBe('https://teams.microsoft.com/l/meetup-join/xyz?a=1')
    expect(joinUrlOf({ description: 'Room 4' })).toBe('')
    expect(joinUrlOf(null)).toBe('')
  })
})

describe('only Teams links over https are followed', () => {
  it('refuses scripts, other schemes, look-alike hosts and embedded credentials', () => {
    expect(safeTeamsUrl('javascript:alert(1)')).toBe('')
    expect(safeTeamsUrl('data:text/html,<script>1</script>')).toBe('')
    expect(safeTeamsUrl('http://teams.microsoft.com/l/meetup-join/a')).toBe('')
    expect(safeTeamsUrl('https://teams.microsoft.com.evil.example/l/a')).toBe('')
    expect(safeTeamsUrl('https://evil.example/teams.microsoft.com/')).toBe('')
    expect(safeTeamsUrl('https://teams.microsoft.com@evil.example/l/a')).toBe('')
    expect(safeTeamsUrl('https://user:pw@teams.microsoft.com/l/a')).toBe('')
    expect(safeTeamsUrl('not a url')).toBe('')
    expect(safeTeamsUrl(undefined)).toBe('')
  })
  it('accepts a real Teams link, and ignores a bad joinUrl in favour of a good one in the text', () => {
    expect(safeTeamsUrl('https://teams.microsoft.com/l/meetup-join/abc?x=1')).toBe('https://teams.microsoft.com/l/meetup-join/abc?x=1')
    expect(joinUrlOf({ joinUrl: 'javascript:alert(1)' })).toBe('')
    expect(joinUrlOf({ joinUrl: 'javascript:alert(1)', description: 'https://teams.live.com/meet/9' })).toBe('https://teams.live.com/meet/9')
  })
})

describe('moving an event later', () => {
  it('shifts the start and the end', () => {
    expect(shiftEvent(ev('a', at(10), at(11)), 30)).toEqual({ start: '2026-11-02T10:30', end: '2026-11-02T11:30' })
  })
  it('carries over midnight, and keeps a missing end missing', () => {
    expect(shiftEvent(ev('a', at(23, 45), at(23, 59)), 30).start).toBe('2026-11-03T00:15')
    expect(shiftEvent(ev('a', at(9)), 30).end).toBeUndefined()
  })
})

describe('day timeline layout', () => {
  it('puts overlapping events side by side and leaves others full width', () => {
    const items = layoutDay([ev('a', at(9), at(11)), ev('b', at(10), at(12)), ev('c', at(13), at(14))])
    const by = Object.fromEntries(items.map(i => [i.ev.id, i]))
    expect([by.a.col, by.a.cols]).toEqual([0, 2])
    expect([by.b.col, by.b.cols]).toEqual([1, 2])
    expect([by.c.col, by.c.cols]).toEqual([0, 1])
  })
  it('reuses a free column in a chain of overlaps', () => {
    const items = layoutDay([ev('a', at(9), at(10, 30)), ev('b', at(10), at(11)), ev('c', at(10, 30), at(12))])
    const by = Object.fromEntries(items.map(i => [i.ev.id, i]))
    expect(by.c.col).toBe(0)
    expect(by.c.cols).toBe(2)
  })
  it('draws short or open-ended events at least 30 minutes tall', () => {
    const [a, b] = layoutDay([ev('a', at(9), at(9, 10)), ev('b', at(15))])
    expect(a.endMin - a.startMin).toBe(30)
    expect(b.endMin - b.startMin).toBe(60)
  })
  it('keeps 7:00 to 21:00 unless an event falls outside it', () => {
    expect(hourRange([])).toEqual([7, 21])
    expect(hourRange(layoutDay([ev('a', at(5, 30), at(6, 30)), ev('b', at(22), at(23))]))).toEqual([5, 23])
  })
})
