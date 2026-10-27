import { describe, it, expect, beforeEach } from 'vitest'
import { beginSignIn, finishSignIn, PENDING_TTL_MS } from './oauth-pending.js'

const nonceOf = uri => new URL(uri).searchParams.get('n')

beforeEach(() => localStorage.clear())

describe('sign-in nonce', () => {
  it('puts a random nonce in the return link, which differs each time', () => {
    const a = beginSignIn('gdrive'), b = beginSignIn('gdrive')
    expect(a).toMatch(/^nexusmd:\/\/oauth\/gdrive\?n=[0-9a-f]{32}$/)
    expect(nonceOf(a)).not.toBe(nonceOf(b))
  })

  it('accepts the right nonce once', () => {
    const n = nonceOf(beginSignIn('gdrive'))
    expect(finishSignIn('gdrive', n)).toBe(true)
    expect(finishSignIn('gdrive', n)).toBe(false)
  })

  it('rejects a missing or wrong nonce, and a wrong nonce uses the waiting sign-in up', () => {
    const n = nonceOf(beginSignIn('gdrive'))
    expect(finishSignIn('gdrive', null)).toBe(false)
    expect(finishSignIn('gdrive', 'f'.repeat(32))).toBe(false)
    expect(finishSignIn('gdrive', n)).toBe(false)
  })

  it('rejects when no sign-in is waiting, or it is for another provider', () => {
    expect(finishSignIn('gdrive', 'a'.repeat(32))).toBe(false)
    const n = nonceOf(beginSignIn('onedrive'))
    expect(finishSignIn('gdrive', n)).toBe(false)
  })

  it('rejects an expired one', () => {
    const t = 1_000_000
    const n = nonceOf(beginSignIn('gdrive', t))
    expect(finishSignIn('gdrive', n, t + PENDING_TTL_MS + 1)).toBe(false)
  })

  it('keeps sign-ins with different providers apart', () => {
    const g = nonceOf(beginSignIn('gdrive')), o = nonceOf(beginSignIn('onedrive'))
    expect(finishSignIn('gdrive', g)).toBe(true)
    expect(finishSignIn('onedrive', o)).toBe(true)
  })
})
