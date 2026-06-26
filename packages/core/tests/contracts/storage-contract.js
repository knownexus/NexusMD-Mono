import { describe, it, expect, beforeEach } from 'vitest'

// Reusable behavioral contract for any IStorageAdapter implementation.
// Every platform's storage adapter (web-adapters localStorageAdapter, app's, etc.)
// runs this same factory against its real implementation so they can't silently drift.
//
// Usage (from any test file):
//   import { runStorageAdapterContract } from '@nexusmd/core/tests/contracts/storage-contract.js'
//   runStorageAdapterContract('localStorageAdapter', () => { localStorage.clear(); return localStorageAdapter })
export function runStorageAdapterContract(label, makeAdapter) {
  describe(`IStorageAdapter contract: ${label}`, () => {
    let s
    beforeEach(() => { s = makeAdapter() })

    it('returns null for a missing key', () => {
      expect(s.get('missing-key')).toBeNull()
    })

    it('round-trips set → get for a string value', () => {
      s.set('k', 'value')
      expect(s.get('k')).toBe('value')
    })

    it('overwrites on a second set', () => {
      s.set('k', 'one'); s.set('k', 'two')
      expect(s.get('k')).toBe('two')
    })

    it('remove deletes the key', () => {
      s.set('k', 'v'); s.remove('k')
      expect(s.get('k')).toBeNull()
    })

    it('keys() lists set keys and isolates unset ones', () => {
      s.set('a', '1'); s.set('b', '2')
      expect(s.keys().sort()).toEqual(expect.arrayContaining(['a', 'b']))
      expect(s.get('c')).toBeNull()
    })
  })
}
