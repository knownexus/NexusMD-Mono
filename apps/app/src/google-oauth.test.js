import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makePkce, randomString, buildAuthUrl, parseRedirect, exchangeCode, refreshAccessToken,
  markGooglePending, takeGooglePending, REDIRECT_URI, SCOPES,
} from './google-oauth.js'

const sha256b64url = async (s) => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body })

describe('PKCE and the consent link', () => {
  it('makes a URL-safe verifier and its S256 challenge', async () => {
    const { verifier, challenge } = await makePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(await sha256b64url(verifier))
    expect(randomString(16)).not.toBe(randomString(16))
  })

  it('builds the Google consent URL with offline access and the app redirect', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid.apps.googleusercontent.com', scope: SCOPES.calendar, challenge: 'ch', state: 'st' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = Object.fromEntries(u.searchParams)
    expect(q).toMatchObject({ client_id: 'cid.apps.googleusercontent.com', redirect_uri: REDIRECT_URI, response_type: 'code', code_challenge: 'ch', code_challenge_method: 'S256', state: 'st', access_type: 'offline', scope: SCOPES.calendar })
    expect(q.client_secret).toBeUndefined()
  })

  it('reads only the app\'s own redirect link', () => {
    expect(parseRedirect('com.knownexus.nexus:/oauth2redirect?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz', error: null })
    expect(parseRedirect('com.knownexus.nexus:/oauth2redirect?error=access_denied&state=xyz').error).toBe('access_denied')
    expect(parseRedirect('nexusmd://oauth/google?otc=1')).toBeNull()
    expect(parseRedirect('com.knownexus.nexus:/other?code=abc')).toBeNull()
    expect(parseRedirect('not a url')).toBeNull()
  })
})

describe('trading the code for tokens', () => {
  it('posts the code and verifier with no client secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }))
    const auth = await exchangeCode({ clientId: 'cid', code: 'abc', verifier: 'ver', fetchImpl, now: () => 1000 })
    expect(auth).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600_000 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init.body)
    expect(Object.fromEntries(body)).toEqual({ client_id: 'cid', code: 'abc', code_verifier: 'ver', redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
  })

  it('refreshes with the refresh token and reports a revoked grant', async () => {
    const ok = vi.fn().mockResolvedValue(jsonRes(200, { access_token: 'NEW', expires_in: 100 }))
    expect(await refreshAccessToken({ clientId: 'cid', refreshToken: 'RT', fetchImpl: ok, now: () => 0 })).toEqual({ accessToken: 'NEW', expiresAt: 100_000 })
    expect(Object.fromEntries(new URLSearchParams(ok.mock.calls[0][1].body))).toEqual({ client_id: 'cid', refresh_token: 'RT', grant_type: 'refresh_token' })
    const revoked = vi.fn().mockResolvedValue(jsonRes(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }))
    await expect(refreshAccessToken({ clientId: 'cid', refreshToken: 'RT', fetchImpl: revoked })).rejects.toMatchObject({ code: 'invalid_grant', message: 'Token has been expired or revoked.' })
  })

  it('throws Google\'s message when the exchange fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(400, { error: 'invalid_request', error_description: 'Missing code verifier' }))
    await expect(exchangeCode({ clientId: 'c', code: 'x', verifier: 'v', fetchImpl })).rejects.toThrow('Missing code verifier')
  })
})

describe('pending sign-in', () => {
  beforeEach(() => localStorage.clear())
  it('accepts the matching state once, with the verifier it kept', () => {
    markGooglePending({ from: 'google', state: 's1', verifier: 'v' }, 1000)
    expect(takeGooglePending('s1', 2000)).toMatchObject({ from: 'google', verifier: 'v' })
    expect(takeGooglePending('s1', 2000)).toBeNull()
  })
  it('ignores a forged state without cancelling the real sign-in', () => {
    markGooglePending({ from: 'google', state: 's1', verifier: 'v' }, 1000)
    expect(takeGooglePending('forged', 2000)).toBeNull()
    expect(takeGooglePending('s1', 2000)).not.toBeNull()
  })
  it('expires after 10 minutes', () => {
    markGooglePending({ from: 'google', state: 's1', verifier: 'v' }, 0)
    expect(takeGooglePending('s1', 11 * 60 * 1000)).toBeNull()
  })
})
