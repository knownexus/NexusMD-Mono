import { describe, it, expect } from 'vitest'
import { parseLine, CONTROL_PREFIX, PROTOCOL_VERSION } from './protocol.js'

describe('parseLine', () => {
  it('treats ordinary lines as output', () => {
    expect(parseLine('Building api...')).toEqual({ type: 'output', text: 'Building api...' })
  })
  it('parses control lines', () => {
    const msg = parseLine(CONTROL_PREFIX + '{"type":"prompt","id":"p1","kind":"choice","options":[{"value":"1","label":"a"}]}')
    expect(msg).toEqual({ type: 'prompt', id: 'p1', kind: 'choice', options: [{ value: '1', label: 'a' }] })
  })
  it('falls back to output for malformed JSON or a missing type', () => {
    expect(parseLine('@@devenv {nope')).toEqual({ type: 'output', text: '@@devenv {nope' })
    expect(parseLine('@@devenv {"id":"p1"}')).toEqual({ type: 'output', text: '@@devenv {"id":"p1"}' })
  })
  it('handles non-strings', () => {
    expect(parseLine(undefined)).toEqual({ type: 'output', text: '' })
  })
  it('is protocol 1', () => { expect(PROTOCOL_VERSION).toBe(1) })
})
