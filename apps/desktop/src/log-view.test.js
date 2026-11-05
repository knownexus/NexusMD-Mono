import { describe, it, expect } from 'vitest'
import { moduleColor, messageParts, offsetLabel, routeOf, laneSpans, entryMatches, mergeLive, laneLayout, describeTrail, formatTime, formatDuration, formatSize, todayUtc, entryKey } from './log-view.js'

const e = (o = {}) => ({ sid: 's1', seq: 0, ts: '2026-11-04T12:00:00.000Z', lvl: 'info', mod: 'git', msg: 'hello', ...o })

describe('moduleColor', () => {
  it('is stable per module, differs between modules, and keeps core neutral', () => {
    expect(moduleColor('git')).toBe(moduleColor('git'))
    expect(moduleColor('git')).not.toBe(moduleColor('devenv'))
    expect(moduleColor('core')).toBe('var(--text-muted)')
    expect(moduleColor('git')).toMatch(/^oklch\(0\.\d+ 0\.\d+ \d+\)$/)
  })
})

describe('entryMatches', () => {
  it('applies module, level and text together; empty filters match everything', () => {
    const x = e({ mod: 'git', lvl: 'error', msg: 'push failed', err: { name: 'Error', message: 'Rejected by remote' } })
    expect(entryMatches(x, {})).toBe(true)
    expect(entryMatches(x, { mods: new Set(['git']), levels: new Set(['error']), text: 'REJECTED' })).toBe(true)
    expect(entryMatches(x, { mods: new Set(['work']) })).toBe(false)
    expect(entryMatches(x, { levels: new Set(['info']) })).toBe(false)
    expect(entryMatches(x, { text: 'nothing like it' })).toBe(false)
    expect(entryMatches(e({ data: { account: 'a1' } }), { text: 'a1' })).toBe(true)
  })
})

describe('mergeLive', () => {
  it('adds new matching entries, skips ones already shown, and drops the oldest past the limit', () => {
    const list = [e({ seq: 1 }), e({ seq: 2 })]
    const next = mergeLive(list, [e({ seq: 2 }), e({ seq: 3 }), e({ seq: 4, mod: 'work' })], { mods: new Set(['git']) })
    expect(next.map(x => x.seq)).toEqual([1, 2, 3])
    expect(mergeLive(next, [e({ seq: 5 })], {}, 3).map(x => x.seq)).toEqual([2, 3, 5])
  })
  it('returns the same list when nothing is added', () => {
    const list = [e({ seq: 1 })]
    expect(mergeLive(list, [e({ seq: 1 })], {})).toBe(list)
  })
  it('keys entries by session and sequence, so a restart does not hide new ones', () => {
    expect(entryKey(e({ sid: 'a', seq: 1 }))).not.toBe(entryKey(e({ sid: 'b', seq: 1 })))
  })
})

describe('laneLayout and describeTrail', () => {
  const chain = [
    e({ seq: 1, mod: 'core', ts: '2026-11-04T12:00:00.000Z' }),
    e({ seq: 2, mod: 'git', lvl: 'error', ts: '2026-11-04T12:00:00.400Z' }),
    e({ seq: 3, mod: 'devenv', lvl: 'warn', ts: '2026-11-04T12:00:01.500Z' }),
    e({ seq: 4, mod: 'git', lvl: 'error', ts: '2026-11-04T12:00:02.000Z' }),
  ]
  it('gives each module a lane in the order the call reached it', () => {
    const { lanes, rows } = laneLayout(chain)
    expect(lanes).toEqual(['core', 'git', 'devenv'])
    expect(rows.map(r => r.lane)).toEqual([0, 1, 2, 1])
  })
  it('summarises the route, its duration and where it first failed', () => {
    const t = describeTrail(chain)
    expect(t.hops).toEqual([
      { mod: 'core', count: 1, errors: 0, warns: 0 },
      { mod: 'git', count: 2, errors: 2, warns: 0 },
      { mod: 'devenv', count: 1, errors: 0, warns: 1 },
    ])
    expect(t.ms).toBe(2000)
    expect(t.failedIn).toBe('git')
  })
  it('handles an empty trail', () => {
    expect(describeTrail([])).toEqual({ hops: [], ms: 0, failedIn: null })
  })
})

describe('formatting', () => {
  it('formats time, duration, size and the UTC day', () => {
    expect(formatTime('2026-11-04T12:00:00.481Z')).toMatch(/^\d\d:\d\d:\d\d\.481$/)
    expect(formatTime('garbage')).toBe('garbage')
    expect([formatDuration(412), formatDuration(3200), formatDuration(42000)]).toEqual(['412 ms', '3.2 s', '42 s'])
    expect([formatSize(512), formatSize(2048), formatSize(3 * 1024 * 1024)]).toEqual(['512 B', '2.0 KB', '3.0 MB'])
    expect(todayUtc(Date.parse('2026-11-04T23:59:59Z'))).toBe('2026-11-04')
  })
})

describe('moduleColor palette', () => {
  const mods = ['work', 'git', 'devenv', 'planner', 'time', 'calendar', 'notes', 'documents', 'database', 'api-client', 'editor']
  const hue = (m) => Number(moduleColor(m).match(/ (\d+)\)$/)[1])
  it('gives every shipped module its own hue, at least 25 degrees from any other', () => {
    for (const a of mods) for (const b of mods) if (a < b) {
      const d = Math.abs(hue(a) - hue(b)); expect(Math.min(d, 360 - d), `${a} vs ${b}`).toBeGreaterThanOrEqual(25)
    }
  })
  it('still gives an unknown module a steady colour', () => {
    expect(moduleColor('someday')).toBe(moduleColor('someday'))
    expect(moduleColor('someday')).toMatch(/^oklch\(/)
  })
})

describe('messageParts', () => {
  it('takes the first line and counts the rest', () => {
    expect(messageParts('first\nsecond\nthird')).toEqual({ first: 'first', more: 2 })
    expect(messageParts('one line')).toEqual({ first: 'one line', more: 0 })
  })
  it('drops blank lines, and the %c and style text of a browser console message', () => {
    expect(messageParts('%cElectron Security Warning font-weight: bold; This renderer\n\n  Policy set\nhelp')).toEqual({ first: 'Electron Security Warning This renderer', more: 2 })
  })
  it('copes with nothing', () => { expect(messageParts(undefined)).toEqual({ first: '', more: 0 }) })
})

describe('offsetLabel', () => {
  const t0 = '2026-11-05T10:00:00.000Z'
  it('is how long after the call began', () => {
    expect(offsetLabel(t0, t0)).toBe('+0 ms')
    expect(offsetLabel('2026-11-05T10:00:00.520Z', t0)).toBe('+520 ms')
    expect(offsetLabel('2026-11-05T10:00:01.250Z', t0)).toBe('+1.3 s')
    expect(offsetLabel('2026-11-05T10:00:42.000Z', t0)).toBe('+42 s')
  })
  it('falls back to nothing for a bad time', () => { expect(offsetLabel('x', t0)).toBe('') })
})

describe('routeOf', () => {
  it('is the modules a call came through, then the entry\'s own', () => {
    expect(routeOf({ mod: 'git', via: ['work', 'devenv'] })).toEqual(['work', 'devenv', 'git'])
    expect(routeOf({ mod: 'git', via: ['git', 'core'] })).toEqual(['core', 'git'])
    expect(routeOf({ mod: 'git' })).toEqual(['git'])
  })
})

describe('laneSpans', () => {
  it('says where in the call each lane is first and last used', () => {
    const rows = [{ lane: 0 }, { lane: 1 }, { lane: 2 }, { lane: 1 }, { lane: 0 }]
    expect(laneSpans(rows, 3)).toEqual([{ first: 0, last: 4 }, { first: 1, last: 3 }, { first: 2, last: 2 }])
  })
})
