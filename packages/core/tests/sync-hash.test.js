import { describe, it, expect } from 'vitest'
import { stableStringify, contentHash } from '../src/index.js'

describe('stableStringify', () => {
  it('orders object keys so equal objects stringify identically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })
  it('preserves array order and handles nesting/null', () => {
    expect(stableStringify([3, { y: 1, x: 2 }, null])).toBe('[3,{"x":2,"y":1},null]')
  })
})

describe('contentHash', () => {
  it('is stable across key order and differs for different content', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })
  it('maps null/undefined to "0"', () => {
    expect(contentHash(null)).toBe('0')
    expect(contentHash(undefined)).toBe('0')
  })
})
