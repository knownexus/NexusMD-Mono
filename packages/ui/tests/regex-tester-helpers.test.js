import { describe, it, expect } from 'vitest'
import {
  findMatches, groupHighlightSpans, buildOverlaySegments, splitMatchByGroups,
  runUnitTests, genCode, REFERENCE_DATA,
} from '../src/views/regex-tester-helpers.js'

describe('findMatches', () => {
  it('returns all matches when the g flag is set', () => {
    const ms = findMatches('a+', 'g', 'aa b aaa')
    expect(ms.map(m => m.value)).toEqual(['aa', 'aaa'])
  })

  it('returns only the first match without the g flag', () => {
    const ms = findMatches('a+', '', 'aa b aaa')
    expect(ms.map(m => m.value)).toEqual(['aa'])
  })

  it('captures groups and their indices', () => {
    const ms = findMatches('(\\w+)@(\\w+)', '', 'user@host')
    expect(ms[0].groups).toEqual(['user', 'host'])
    expect(ms[0].indices).toBeTruthy()
    expect(ms[0].indices[0]).toEqual([0, 4])
    expect(ms[0].indices[1]).toEqual([5, 9])
  })

  it('captures named groups', () => {
    const ms = findMatches('(?<user>\\w+)@(?<host>\\w+)', '', 'user@host')
    expect(ms[0].named).toEqual({ user: 'user', host: 'host' })
  })

  it('returns null for an invalid pattern', () => {
    expect(findMatches('(unterminated', 'g', 'x')).toBeNull()
  })

  it('returns an empty array when there are no matches', () => {
    expect(findMatches('zzz', 'g', 'abc')).toEqual([])
  })
})

describe('groupHighlightSpans', () => {
  it('converts absolute indices to match-relative spans', () => {
    const match = { index: 5, value: 'user@host', indices: [[5, 9], [10, 14]] }
    expect(groupHighlightSpans(match)).toEqual([
      { start: 0, end: 4, colorIndex: 0 },
      { start: 5, end: 9, colorIndex: 1 },
    ])
  })

  it('returns an empty array when there are no capture group indices', () => {
    expect(groupHighlightSpans({ index: 0, value: 'x', indices: null })).toEqual([])
  })

  it('drops a span that overlaps a preceding one', () => {
    const match = { index: 0, value: 'abcdef', indices: [[0, 4], [2, 6]] }
    expect(groupHighlightSpans(match)).toEqual([{ start: 0, end: 4, colorIndex: 0 }])
  })
})

describe('buildOverlaySegments', () => {
  it('splits text into unmatched and matched segments in order', () => {
    const matches = [{ index: 2, value: 'bb', indices: null }]
    const segs = buildOverlaySegments('aabbcc', matches)
    expect(segs).toEqual([
      { text: 'aa', matchIndex: null },
      { text: 'bb', matchIndex: 0, groupSpans: [] },
      { text: 'cc', matchIndex: null },
    ])
  })

  it('returns the whole string unmatched when there are no matches', () => {
    expect(buildOverlaySegments('hello', [])).toEqual([{ text: 'hello', matchIndex: null }])
  })
})

describe('splitMatchByGroups', () => {
  it('splits a match value into colored and plain pieces', () => {
    const pieces = splitMatchByGroups('user@host', [{ start: 0, end: 4, colorIndex: 0 }])
    expect(pieces).toEqual([
      { text: 'user', colorIndex: 0 },
      { text: '@host', colorIndex: null },
    ])
  })

  it('returns the whole value as one plain piece with no group spans', () => {
    expect(splitMatchByGroups('abc', [])).toEqual([{ text: 'abc', colorIndex: null }])
  })
})

describe('runUnitTests', () => {
  const tests = [{ str: 'user@host.com', expectMatch: true }, { str: 'nope', expectMatch: true }]

  it('marks tests pending when the pattern is empty', () => {
    expect(runUnitTests(tests, '', '')).toEqual([
      { str: 'user@host.com', expectMatch: true, result: 'pending' },
      { str: 'nope', expectMatch: true, result: 'pending' },
    ])
  })

  it('marks tests pending when the pattern is invalid', () => {
    const r = runUnitTests(tests, '(unterminated', '')
    expect(r.every(t => t.result === 'pending')).toBe(true)
  })

  it('passes or fails tests against a valid pattern', () => {
    const r = runUnitTests(tests, '\\w+@\\w+\\.\\w+', '')
    expect(r[0].result).toBe('pass')
    expect(r[1].result).toBe('fail')
  })
})

describe('genCode', () => {
  it('generates JS code containing the pattern and flags', () => {
    const code = genCode('JS', '\\d+', 'gi')
    expect(code).toContain('/\\d+/gi')
    expect(code).toContain('matchAll')
  })

  it('generates Python code with mapped flags', () => {
    const code = genCode('Python', '\\d+', 'im')
    expect(code).toContain('re.IGNORECASE | re.MULTILINE')
  })

  it('generates code for every supported language without throwing', () => {
    for (const lang of ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']) {
      const code = genCode(lang, '\\d+', 'g')
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    }
  })

  it('returns an empty string for an unrecognized language', () => {
    expect(genCode('COBOL', '\\d+', '')).toBe('')
  })
})

describe('REFERENCE_DATA', () => {
  it('is a non-empty list of groups with items', () => {
    expect(REFERENCE_DATA.length).toBeGreaterThan(0)
    for (const g of REFERENCE_DATA) {
      expect(typeof g.t).toBe('string')
      expect(g.i.length).toBeGreaterThan(0)
      for (const item of g.i) {
        expect(typeof item.k).toBe('string')
        expect(typeof item.d).toBe('string')
      }
    }
  })
})
