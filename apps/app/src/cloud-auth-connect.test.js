import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
const store = new Map()
let onLink = null
vi.mock('./toast.jsx', () => ({ toast: (...a) => toast(...a) }))
vi.mock('./adapters/deepLink.js', () => ({ deepLinkAdapter: { onLink: (cb) => { onLink = cb } } }))
vi.mock('./adapters/secureStorage.js', () => ({
  secureStorageAdapter: {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v) },
    remove: async (k) => { store.delete(k) },
  },
}))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => 'p.' + k, getActiveProfileId: () => 'p' }))

import { makeAppOAuthService, appCloudProviders, signInFailure, registerCloudDeepLink, hydrateCloudTokens, getOAuthToken } from './cloud-auth.js'

const reload = vi.fn()
beforeEach(() => {
  toast.mockClear(); store.clear(); localStorage.clear(); reload.mockClear()
  window.open = vi.fn(() => ({}))
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true })
})

const setClientId = (clientId) => store.set('p.helm.google.oauthCreds', JSON.stringify({ clientId }))
const tokenResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

describe('connecting Google (no server)', () => {
  it('asks for a client ID first instead of doing nothing', async () => {
    await makeAppOAuthService('google').connect()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Add your Google client ID/), 'error')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('opens Google\'s consent page directly, with PKCE, and never calls a server of ours', async () => {
    setClientId('cid.apps.googleusercontent.com')
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy)
    await makeAppOAuthService('google').connect()
    const url = new URL(window.open.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(url.searchParams.get('scope')).toMatch(/calendar\.events/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('asks Drive backup for the Drive scope with the same client ID', async () => {
    setClientId('cid')
    await appCloudProviders[0].connect()
    expect(new URL(window.open.mock.calls[0][0]).searchParams.get('scope')).toMatch(/drive\.file/)
  })

  it('finishes the sign-in when the browser returns, then holds and refreshes tokens', async () => {
    setClientId('cid'); registerCloudDeepLink()
    await makeAppOAuthService('google').connect()
    const state = new URL(window.open.mock.calls[0][0]).searchParams.get('state')

    const fetchSpy = vi.fn().mockResolvedValue(tokenResponse({ access_token: 'AT1', refresh_token: 'RT', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchSpy)
    await onLink(`com.knownexus.nexus:/oauth2redirect?code=abc&state=${state}`)
    expect(Object.fromEntries(new URLSearchParams(fetchSpy.mock.calls[0][1].body))).toMatchObject({ code: 'abc', client_id: 'cid', grant_type: 'authorization_code' })
    expect(reload).toHaveBeenCalled()
    expect(JSON.parse(store.get('p.helm.google.auth'))).toMatchObject({ accessToken: 'AT1', refreshToken: 'RT' })

    // After a restart the token is loaded again, and a stale one is refreshed from Google with the refresh token.
    store.set('p.helm.google.auth', JSON.stringify({ accessToken: 'AT1', refreshToken: 'RT', expiresAt: Date.now() - 1000 }))
    await hydrateCloudTokens()
    fetchSpy.mockResolvedValue(tokenResponse({ access_token: 'AT2', expires_in: 3600 }))
    expect(await getOAuthToken('google')).toBe('AT2')
    expect(Object.fromEntries(new URLSearchParams(fetchSpy.mock.calls.at(-1)[1].body))).toMatchObject({ refresh_token: 'RT', grant_type: 'refresh_token' })
  })

  it('ignores a return link it did not start', async () => {
    setClientId('cid'); registerCloudDeepLink()
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy)
    await onLink('com.knownexus.nexus:/oauth2redirect?code=abc&state=forged')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('forgets the connection when Google says access was revoked', async () => {
    store.set('p.helm.google.auth', JSON.stringify({ accessToken: 'old', refreshToken: 'RT', expiresAt: 1 }))
    setClientId('cid'); await hydrateCloudTokens()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)))
    expect(await getOAuthToken('google')).toBeNull()
    expect(store.has('p.helm.google.auth')).toBe(false)
  })

  it('reports Google declining the sign-in', async () => {
    setClientId('cid'); registerCloudDeepLink()
    await makeAppOAuthService('google').connect()
    const state = new URL(window.open.mock.calls[0][0]).searchParams.get('state')
    await onLink(`com.knownexus.nexus:/oauth2redirect?error=access_denied&state=${state}`)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not completed \(access_denied\)/), 'error')
  })
})

describe('connecting the other providers (still through the server)', () => {
  it('says the sign-in server cannot be reached instead of doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await makeAppOAuthService('github').connect()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Can't reach the sign-in server/), 'error')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('says when the server has no client ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'github oauth not configured' }) })))
    await makeAppOAuthService('github').connect()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/no client ID/), 'error')
  })

  it('describes other failures with the status', async () => {
    expect(await signInFailure({ status: 502, json: async () => { throw new Error('x') } })).toMatch(/answered 502/)
  })
})
