import { describe, it, expect } from 'vitest'
import { jsonAutoName } from '../src/modules/json/helpers.js'

describe('jsonAutoName', () => {
  it('uses a top-level name or title string, trimmed and cut to 80 characters', () => {
    expect(jsonAutoName('{"name":"  Cfg "}')).toBe('Cfg')
    expect(jsonAutoName('{"title":"T"}')).toBe('T')
    expect(jsonAutoName(JSON.stringify({ name: 'x'.repeat(100) }))).toBe('x'.repeat(80))
  })
  it('falls back to a one-line snippet of up to 60 characters', () => {
    expect(jsonAutoName('[1,2]')).toBe('[1,2]')
    expect(jsonAutoName('{ "a": \n 1 }')).toBe('{ "a": 1 }')
    expect(jsonAutoName('{ "a": ')).toBe('{ "a":')
    expect(jsonAutoName('9'.repeat(70))).toBe('9'.repeat(60))
  })
  it('is Untitled for nothing but whitespace, and ignores a name that is not a string', () => {
    expect(jsonAutoName('')).toBe('Untitled')
    expect(jsonAutoName('  ')).toBe('Untitled')
    expect(jsonAutoName('{"name":5}')).toBe('{"name":5}')
  })
})
