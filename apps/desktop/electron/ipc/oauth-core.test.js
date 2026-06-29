import { describe, it, expect } from 'vitest'
import core from './oauth-core.cjs'

const { base64url, makePkce, randomState, buildAuthUrl, decodeJwtEmail, parseTokenResponse, PROVIDERS } = core

describe('base64url', () => {
  it('encodes without +, / or = padding', () => {
    expect(base64url(Buffer.from('foobar'))).toBe('Zm9vYmFy')
    const enc = base64url(Buffer.from([251, 255, 191]))
    expect(enc).not.toMatch(/[+/=]/)
  })
})

describe('makePkce', () => {
  it('produces an RFC 7636 verifier and an S256 challenge derived from it', () => {
    const crypto = require('crypto')
    const { verifier, challenge } = makePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    const expected = base64url(crypto.createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
  })
  it('is random per call', () => {
    expect(makePkce().verifier).not.toBe(makePkce().verifier)
  })
})

describe('randomState', () => {
  it('returns a non-empty url-safe string', () => {
    expect(randomState()).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildAuthUrl', () => {
  const p = {
    authEndpoint: 'https://example.com/auth',
    clientId: 'cid-123',
    scope: 'openid email scope/x',
    authParams: { access_type: 'offline', prompt: 'consent' },
  }
  it('includes PKCE, state, encoded redirect and provider extras', () => {
    const url = buildAuthUrl(p, { redirectUri: 'http://127.0.0.1:5500', challenge: 'CH', state: 'ST' })
    expect(url.startsWith('https://example.com/auth?')).toBe(true)
    expect(url).toContain('client_id=cid-123')
    expect(url).toContain('response_type=code')
    expect(url).toContain('code_challenge=CH')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('state=ST')
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A5500')
    expect(url).toContain('scope=openid%20email%20scope%2Fx')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
  })
})

describe('decodeJwtEmail', () => {
  it('reads email from a JWT payload', () => {
    const payload = core.base64url(Buffer.from(JSON.stringify({ email: 'a@b.com' })))
    expect(decodeJwtEmail(`h.${payload}.s`)).toBe('a@b.com')
  })
  it('returns null on garbage', () => {
    expect(decodeJwtEmail('not-a-jwt')).toBeNull()
  })
})

describe('parseTokenResponse', () => {
  it('maps snake_case fields and extracts email from id_token', () => {
    const idToken = `h.${core.base64url(Buffer.from(JSON.stringify({ email: 'u@x.com' })))}.s`
    const out = parseTokenResponse({ access_token: 'AT', refresh_token: 'RT', id_token: idToken })
    expect(out).toEqual({ accessToken: 'AT', refreshToken: 'RT', email: 'u@x.com' })
  })
  it('tolerates missing fields', () => {
    expect(parseTokenResponse({})).toEqual({ accessToken: null, refreshToken: null, email: null })
  })
})

describe('PROVIDERS', () => {
  it('defines google and microsoft with correct redirect hosts', () => {
    expect(PROVIDERS.google.redirectHost).toBe('127.0.0.1')
    expect(PROVIDERS.microsoft.redirectHost).toBe('localhost')
    expect(PROVIDERS.google.scope).toContain('drive.file')
    expect(PROVIDERS.microsoft.scope).toContain('Files.ReadWrite')
    expect(PROVIDERS.microsoft.scope).toContain('offline_access')
  })
})
