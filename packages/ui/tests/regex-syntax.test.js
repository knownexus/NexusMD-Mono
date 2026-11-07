import { describe, it, expect } from 'vitest'
import { tokenizePattern, regexErrorInfo, insertAt, replaceSegments, stepIndex } from '../src/views/regex-syntax.js'

const joined = pattern => tokenizePattern(pattern).map(t => t.text).join('')
const kinds = pattern => tokenizePattern(pattern).map(t => [t.text, t.kind, t.group])
const errorOf = (pattern, flags = '') => { try { new RegExp(pattern, flags); return null } catch (e) { return e.message } }

describe('tokenizePattern', () => {
  it('splits the demo pattern into its parts and gives the capture groups their numbers', () => {
    const tokens = tokenizePattern('(\\w+)@([\\w.-]+\\.[a-z]{2,})')
    expect(tokens.map(t => t.text).join('')).toBe('(\\w+)@([\\w.-]+\\.[a-z]{2,})')
    expect(tokens.filter(t => t.kind === 'group-open').map(t => t.group)).toEqual([1, 2])
    expect(tokens.filter(t => t.kind === 'group-close').map(t => t.group)).toEqual([1, 2])
    // The \w inside [\w.-] belongs to that class token.
    expect(tokens.filter(t => t.kind === 'escape').map(t => t.text)).toEqual(['\\w', '\\.'])
    expect(tokens.filter(t => t.kind === 'class').map(t => t.text)).toEqual(['[\\w.-]', '[a-z]'])
    expect(tokens.filter(t => t.kind === 'quant').map(t => t.text)).toEqual(['+', '+', '{2,}'])
    expect(tokens.find(t => t.text === '@').kind).toBe('literal')
  })

  it('numbers only capturing groups: non-capturing and lookaround groups have no number', () => {
    expect(kinds('(?:a)(b)')).toEqual([['(?:', 'group-open', undefined], ['a', 'literal', undefined], [')', 'group-close', undefined], ['(', 'group-open', 1], ['b', 'literal', undefined], [')', 'group-close', 1]])
    const look = tokenizePattern('(?=a)(?!b)(?<=c)(?<!d)(e)').filter(t => t.kind === 'group-open')
    expect(look.map(t => t.group)).toEqual([undefined, undefined, undefined, undefined, 1])
  })

  it('numbers a named group like any capture, and nested groups by where they open', () => {
    expect(kinds('(?<y>\\d+)')[0]).toEqual(['(?<y>', 'group-open', 1])
    const nested = tokenizePattern('((a)(b))').filter(t => t.kind === 'group-open').map(t => t.group)
    expect(nested).toEqual([1, 2, 3])
    const closes = tokenizePattern('((a)(b))').filter(t => t.kind === 'group-close').map(t => t.group)
    expect(closes).toEqual([2, 3, 1])
  })

  it('reads {n}, {n,} and {n,m} and a lazy ? as quantifiers, and a lone { as a literal', () => {
    expect(kinds('a{3}b{1,}c{2,5}d+?').filter(t => t[1] === 'quant').map(t => t[0])).toEqual(['{3}', '{1,}', '{2,5}', '+?'])
    expect(kinds('a{x}').map(t => t[1])).toEqual(['literal', 'literal', 'literal', 'literal'])
  })

  it('marks the ( of a group that is never closed', () => {
    const tokens = tokenizePattern('(abc')
    expect(tokens[0]).toMatchObject({ text: '(', kind: 'unclosed' })
    expect(tokens.map(t => t.text).join('')).toBe('(abc')
    expect(tokenizePattern('(a)(b').filter(t => t.kind === 'unclosed')).toHaveLength(1)
    expect(tokenizePattern('(a)(b').find(t => t.kind === 'unclosed').text).toBe('(')
  })

  it('never throws and always gives back the pattern: empty, lone backslash, open class, stray )', () => {
    for (const p of ['', '\\', '[abc', '[', ')', 'a)', '[\\]', '(?<', '(?<n', '\\u{1F600}', '\\p{L}', '\\k<a>', '{', '}', 'a||b']) {
      expect(() => tokenizePattern(p)).not.toThrow()
      expect(joined(p)).toBe(p)
    }
    expect(tokenizePattern('')).toEqual([])
  })

  it('treats an escape inside a class as part of the class, and a ] after \\ as escaped', () => {
    expect(kinds('[\\]a]b')).toEqual([['[\\]a]', 'class', undefined], ['b', 'literal', undefined]])
  })
})

describe('regexErrorInfo', () => {
  it('gives the reason without the /pattern/ prefix, with the 1-based column of an unclosed ( and a hint', () => {
    const info = regexErrorInfo(errorOf('a(b'), 'a(b')
    expect(info.message).toMatch(/Unterminated group/)
    expect(info.message).not.toMatch(/Invalid regular expression/)
    expect(info.column).toBe(2)
    expect(typeof info.hint).toBe('string')
  })

  it('finds the column of an unmatched ), an open [ and a quantifier with nothing to repeat', () => {
    expect(regexErrorInfo(errorOf('ab)'), 'ab)').column).toBe(3)
    expect(regexErrorInfo(errorOf('x[ab'), 'x[ab').column).toBe(2)
    expect(regexErrorInfo(errorOf('+a'), '+a').column).toBe(1)
    expect(regexErrorInfo(errorOf('a|*'), 'a|*').column).toBe(3)
  })

  it('gives the message alone, with no column or hint, for an error it does not recognise', () => {
    const info = regexErrorInfo(errorOf('\\k<x>', 'u'), '\\k<x>')
    expect(info.column).toBeNull()
    expect(info.hint).toBeNull()
    expect(info.message.length).toBeGreaterThan(0)
  })

  it('copes with a message that is not a RegExp error', () => {
    expect(regexErrorInfo('Something odd', 'x')).toEqual({ message: 'Something odd', column: null, hint: null })
  })
})

describe('insertAt', () => {
  it('puts the token where the caret is and leaves the caret after it', () => {
    expect(insertAt('abcdef', 3, 3, '\\d')).toEqual({ text: 'abc\\ddef', caret: 5 })
  })

  it('replaces a selection', () => {
    expect(insertAt('abcdef', 1, 4, 'X')).toEqual({ text: 'aXef', caret: 2 })
  })

  it('appends when the range is past the end, and clamps a reversed range', () => {
    expect(insertAt('ab', 99, 99, 'c')).toEqual({ text: 'abc', caret: 3 })
    expect(insertAt('abcd', 3, 1, 'X')).toEqual({ text: 'aXd', caret: 2 })
  })
})

describe('replaceSegments', () => {
  const text = segs => segs.map(s => s.text).join('')

  it('splits the result into untouched and replaced spans, and joins to what replace() gives', () => {
    const segs = replaceSegments('a1b22c', /\d+/g, '#')
    expect(segs).toEqual([{ text: 'a', replaced: false }, { text: '#', replaced: true }, { text: 'b', replaced: false }, { text: '#', replaced: true }, { text: 'c', replaced: false }])
    expect(text(segs)).toBe('a1b22c'.replace(/\d+/g, '#'))
  })

  it('expands $1, $&, $<name>, $$ and $` like replace() does', () => {
    for (const [src, re, rep] of [['john@x.org', /(\w+)@(\w+)/g, '$2:$1'], ['abc', /b/g, '[$&]'], ['2024-01', /(?<y>\d+)-(?<m>\d+)/g, '$<m>/$<y>'], ['a', /a/g, '$$'], ['xay', /a/g, "<$`|$'>"]]) {
      expect(text(replaceSegments(src, re, rep))).toBe(src.replace(re, rep))
    }
  })

  it('terminates on a pattern that matches the empty string, and matches replace()', () => {
    for (const [src, re] of [['aaa', /a*/g], ['baab', /a*/g], ['', /x*/g], ['abc', /(?:)/g]]) {
      expect(text(replaceSegments(src, re, 'X'))).toBe(src.replace(re, 'X'))
    }
  })

  it('replaces only the first match without the g flag', () => {
    expect(text(replaceSegments('aaa', /a/, 'b'))).toBe('baa')
    expect(replaceSegments('aaa', /a/, 'b').filter(s => s.replaced)).toHaveLength(1)
  })

  it('gives the whole text untouched when nothing matches', () => {
    expect(replaceSegments('abc', /x/g, 'y')).toEqual([{ text: 'abc', replaced: false }])
    expect(replaceSegments('', /x/g, 'y')).toEqual([])
  })

  it('marks nothing replaced for a replacement that is empty (the deleted text has no span)', () => {
    const segs = replaceSegments('a1b', /\d/g, '')
    expect(text(segs)).toBe('ab')
    expect(segs.every(s => !s.replaced)).toBe(true)
  })
})

describe('stepIndex', () => {
  it('starts at the first match going forward and the last going back, and wraps at both ends', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(1, 1, 3)).toBe(2)
  })

  it('has nothing to step to without matches', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1)
  })
})
