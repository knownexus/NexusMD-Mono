import { describe, it, expect } from 'vitest'
import { parseLog } from './log-parse.js'
import { filterEntries } from './log-parse.js'

describe('parseLog', () => {
  it('returns [] for empty or nullish input', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog(null)).toEqual([])
    expect(parseLog(undefined)).toEqual([])
  })

  it('parses a single line with timestamp, level, area and message', () => {
    const [e, ...rest] = parseLog('[2026-07-01 13:18:08.111] [warn]  [notifications] No port provided.')
    expect(rest).toHaveLength(0)
    expect(e.ts).toBe('2026-07-01 13:18:08.111')
    expect(e.level).toBe('warn')
    expect(e.area).toBe('notifications')
    expect(e.message).toBe('No port provided.')
    expect(e.extraLines).toEqual([])
  })

  it('parses a line with no area tag as area: null', () => {
    const [e] = parseLog('[2026-07-01 13:18:08.374] [error] Error: HttpError: 404')
    expect(e.level).toBe('error')
    expect(e.area).toBeNull()
    expect(e.message).toBe('Error: HttpError: 404')
  })

  it('groups continuation lines into extraLines of the preceding entry', () => {
    const text = [
      '[2026-07-01 13:18:08.374] [error] Error: HttpError: 404',
      'Headers: {',
      '  "server": "github.com"',
      '}',
    ].join('\n')
    const entries = parseLog(text)
    expect(entries).toHaveLength(1)
    expect(entries[0].message).toBe('Error: HttpError: 404')
    expect(entries[0].extraLines).toEqual(['Headers: {', '  "server": "github.com"', '}'])
  })

  it('parses multiple sequential entries with unique ids', () => {
    const text = [
      '[2026-07-01 13:18:08.111] [warn]  [notifications] a',
      '[2026-07-01 13:18:09.222] [info]  [updater] b',
    ].join('\n')
    const entries = parseLog(text)
    expect(entries.map(e => e.level)).toEqual(['warn', 'info'])
    expect(entries.map(e => e.area)).toEqual(['notifications', 'updater'])
    expect(entries[0].id).not.toBe(entries[1].id)
  })

  it('keeps leading text before the first header as one unparsed entry', () => {
    const text = 'stray startup text\n[2026-07-01 13:18:08.111] [warn]  [x] real'
    const entries = parseLog(text)
    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('')
    expect(entries[0].area).toBeNull()
    expect(entries[0].message).toBe('stray startup text')
    expect(entries[1].level).toBe('warn')
  })

  it('ignores a trailing newline (no spurious empty extraLine)', () => {
    const entries = parseLog('[2026-07-01 13:18:08.111] [info]  [x] hi\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].extraLines).toEqual([])
  })
})

const SAMPLE = parseLog([
  '[2026-07-01 10:00:00.000] [info]  [alpha] hello world',
  '[2026-07-01 10:00:01.000] [warn]  [beta] goodbye moon',
  '[2026-07-01 10:00:02.000] [error] no area here',
  'continuation detail xyz',
].join('\n'))

describe('filterEntries', () => {
  it('returns all entries when no options are given', () => {
    expect(filterEntries(SAMPLE, {})).toHaveLength(3)
  })

  it('keeps only entries whose level is in the set', () => {
    const out = filterEntries(SAMPLE, { levels: new Set(['warn']) })
    expect(out.map(e => e.level)).toEqual(['warn'])
  })

  it('accepts levels as an array', () => {
    const out = filterEntries(SAMPLE, { levels: ['info', 'error'] })
    expect(out.map(e => e.level)).toEqual(['info', 'error'])
  })

  it('never hides unparsed (level "") entries via the level filter', () => {
    const withUnparsed = parseLog('stray\n[2026-07-01 10:00:00.000] [info]  [a] x')
    const out = filterEntries(withUnparsed, { levels: new Set(['info']) })
    expect(out).toHaveLength(2) // unparsed kept even though "" not in set
  })

  it('filters by area, with NO_AREA matching null-area entries', () => {
    expect(filterEntries(SAMPLE, { area: 'alpha' }).map(e => e.area)).toEqual(['alpha'])
    expect(filterEntries(SAMPLE, { area: '(no area)' }).map(e => e.area)).toEqual([null])
  })

  it('search matches message, is case-insensitive', () => {
    expect(filterEntries(SAMPLE, { search: 'HELLO' }).map(e => e.message)).toEqual(['hello world'])
  })

  it('search matches text inside continuation lines', () => {
    const out = filterEntries(SAMPLE, { search: 'xyz' })
    expect(out).toHaveLength(1)
    expect(out[0].level).toBe('error')
  })

  it('search matches the area tag', () => {
    expect(filterEntries(SAMPLE, { search: 'beta' }).map(e => e.area)).toEqual(['beta'])
  })

  it('combines level, area and search with AND', () => {
    const out = filterEntries(SAMPLE, { levels: new Set(['info', 'warn']), area: 'alpha', search: 'hello' })
    expect(out.map(e => e.area)).toEqual(['alpha'])
  })
})
