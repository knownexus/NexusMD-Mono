import { describe, it, expect } from 'vitest'
import { parseLog } from './log-parse.js'

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
