import { describe, it, expect } from 'vitest'
import { matchSegments } from './match-segments.js'

describe('matchSegments', () => {
  it('marks the typed terms where they start a word, and leaves the rest', () => {
    expect(matchSegments('Button.jsx', 'but')).toEqual([{ text: 'But', hit: true }, { text: 'ton.jsx', hit: false }])
  })

  it('does not mark a term in the middle of a word', () => {
    expect(matchSegments('Button.jsx', 'utt')).toEqual([{ text: 'Button.jsx', hit: false }])
  })

  it('marks every term and every word it starts, in any case', () => {
    const marked = matchSegments('src-util_util.js', 'SRC ut').filter(s => s.hit).map(s => s.text)
    expect(marked).toEqual(['src', 'ut', 'ut'])
  })

  it('gives the whole text unmarked for an empty query', () => {
    expect(matchSegments('a.js', '  ')).toEqual([{ text: 'a.js', hit: false }])
  })

  it('joins back to the original text', () => {
    expect(matchSegments('docs/api/ref.md', 'api ref').map(s => s.text).join('')).toBe('docs/api/ref.md')
  })
})
