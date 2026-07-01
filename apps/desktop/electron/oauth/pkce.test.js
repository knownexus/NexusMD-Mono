// @vitest-environment node
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { makePkce } from './pkce.cjs'

describe('makePkce', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { verifier, challenge, state } = makePkce()
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
    expect(state.length).toBeGreaterThan(0)
  })

  it('produces url-safe values (no +, /, or = padding)', () => {
    const { verifier, challenge, state } = makePkce()
    for (const v of [verifier, challenge, state]) expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces unique verifiers per call', () => {
    expect(makePkce().verifier).not.toBe(makePkce().verifier)
  })
})
