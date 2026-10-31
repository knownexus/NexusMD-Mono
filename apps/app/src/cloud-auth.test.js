import { describe, it, expect, beforeEach } from 'vitest'
import { markPending, takePending } from './cloud-auth.js'

describe('pending sign-in', () => {
  beforeEach(() => localStorage.clear())
  it('accepts the provider that started the sign-in, once', () => {
    markPending('google', 1000)
    expect(takePending('google', 2000)).toBe(true)
    expect(takePending('google', 2000)).toBe(false)
  })
  it('rejects a different provider and still consumes the record', () => {
    markPending('gdrive', 1000)
    expect(takePending('google', 2000)).toBe(false)
    expect(takePending('gdrive', 2000)).toBe(false)
  })
  it('rejects with nothing pending or after 10 minutes', () => {
    expect(takePending('google')).toBe(false)
    markPending('google', 0)
    expect(takePending('google', 11 * 60 * 1000)).toBe(false)
  })
})
