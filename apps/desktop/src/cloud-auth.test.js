// apps/desktop/src/cloud-auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@nexusmd/core', async (importOriginal) => ({
  ...(await importOriginal()), makeGoogleDriveProvider: (b) => b, makeOneDriveProvider: (b) => b,
}))
vi.mock('@nexusmd/ui', () => ({
  toast: () => {},
}))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => k }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: { get: async () => null, set: async () => {} } }))

import { makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken, decodeJwtClaims, redeem } from './cloud-auth.js'
import { beginSignIn } from './oauth-pending.js'

// Build a minimal JWT (header.payload.signature) with the given exp claim.
const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwtWithExp = (expSeconds) => `eyJhbGciOiJub25lIn0.${b64url({ exp: expSeconds })}.sig`
const jwtWithClaims = (claims) => `eyJhbGciOiJub25lIn0.${b64url(claims)}.sig`

const KEY = 'nexusmd.google.auth'

beforeEach(() => {
  localStorage.clear()
  window.electronAPI = { oauth: { start: vi.fn(), refresh: vi.fn() } }
})

describe('makeNativeGoogleBinding', () => {
  it('returns null token when disconnected', async () => {
    expect(await makeNativeGoogleBinding().getToken()).toBeNull()
  })

  it('returns the cached token when unexpired', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }))
    const b = makeNativeGoogleBinding()
    expect(await b.getToken()).toBe('good')
    expect(window.electronAPI.oauth.refresh).not.toHaveBeenCalled()
  })

  it('refreshes and re-stores when the token is expired', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 }))
    window.electronAPI.oauth.refresh.mockResolvedValue({ accessToken: 'new', expiresAt: Date.now() + 3_600_000 })
    const b = makeNativeGoogleBinding()
    expect(await b.getToken()).toBe('new')
    expect(window.electronAPI.oauth.refresh).toHaveBeenCalledWith('r', 'google')
    expect(JSON.parse(localStorage.getItem(KEY)).accessToken).toBe('new')
  })

  it('connect stores tokens returned by the native flow', async () => {
    window.electronAPI.oauth.start.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 42 })
    await makeNativeGoogleBinding().connect()
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' })
  })
})

describe('makeNativeMicrosoftBinding', () => {
  const KEY = 'nexusmd.microsoft.auth'
  beforeEach(() => {
    localStorage.clear()
    window.electronAPI = { oauth: { start: vi.fn(), refresh: vi.fn() } }
  })

  it('connect stores tokens under microsoft.auth', async () => {
    window.electronAPI.oauth.start.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 42 })
    await makeNativeMicrosoftBinding().connect()
    expect(window.electronAPI.oauth.start).toHaveBeenCalledWith('microsoft')
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' })
  })

  it('persists a rotated refresh token on refresh', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'old', refreshToken: 'RT1', expiresAt: Date.now() - 1000 }))
    window.electronAPI.oauth.refresh.mockResolvedValue({ accessToken: 'new', refreshToken: 'RT2', expiresAt: Date.now() + 3_600_000 })
    const tok = await makeNativeMicrosoftBinding().getToken()
    expect(window.electronAPI.oauth.refresh).toHaveBeenCalledWith('RT1', 'microsoft')
    expect(tok).toBe('new')
    expect(JSON.parse(localStorage.getItem(KEY)).refreshToken).toBe('RT2')
  })
})

describe('setManualMicrosoftToken', () => {
  const KEY = 'nexusmd.microsoft.auth'
  beforeEach(() => { localStorage.clear() })

  it('stores a pasted token so getToken serves it', async () => {
    setManualMicrosoftToken('  paste-me  ')
    expect(JSON.parse(localStorage.getItem(KEY)).accessToken).toBe('paste-me')
    expect(await makeNativeMicrosoftBinding().getToken()).toBe('paste-me')
  })

  it('derives expiresAt from the JWT exp claim', () => {
    const exp = Math.floor(Date.now() / 1000) + 1800
    setManualMicrosoftToken(jwtWithExp(exp))
    expect(JSON.parse(localStorage.getItem(KEY)).expiresAt).toBe(exp * 1000)
  })

  it('falls back to a 1h TTL for non-JWT tokens', () => {
    const before = Date.now()
    setManualMicrosoftToken('opaque-token')
    const { expiresAt } = JSON.parse(localStorage.getItem(KEY))
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000)
  })

  it('ignores empty input', () => {
    setManualMicrosoftToken('   ')
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('redeem (the nexusmd://oauth link)', () => {
  const nonceOf = uri => new URL(uri).searchParams.get('n')
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'AT', refreshToken: 'RT' }), text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    // reloading the page is what follows a good sign-in
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() })
  })

  it('redeems the code of a sign-in this app started, once', async () => {
    const n = nonceOf(beginSignIn('gdrive'))
    const link = `nexusmd://oauth/gdrive?n=${n}&provider=gdrive&otc=CODE`
    await redeem(link)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('nexusmd.gdrive.auth'))).toMatchObject({ accessToken: 'AT' })
    await redeem(link)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts the server naming the provider differently from the link\'s path', async () => {
    const n = nonceOf(beginSignIn('microsoft'))
    await redeem(`nexusmd://oauth/microsoft?n=${n}&provider=onedrive&otc=CODE`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a code nobody asked for: no sign-in waiting, no nonce, a wrong nonce, another host', async () => {
    await redeem('nexusmd://oauth/gdrive?provider=gdrive&otc=EVIL')
    beginSignIn('gdrive')
    await redeem('nexusmd://oauth/gdrive?provider=gdrive&otc=EVIL')
    await redeem(`nexusmd://oauth/gdrive?n=${'0'.repeat(32)}&provider=gdrive&otc=EVIL`)
    const n = nonceOf(beginSignIn('gdrive'))
    await redeem(`nexusmd://elsewhere/gdrive?n=${n}&provider=gdrive&otc=EVIL`)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('nexusmd.gdrive.auth')).toBeNull()
  })
})

describe('decodeJwtClaims', () => {
  it('decodes claims from a valid JWT', () => {
    const token = jwtWithClaims({ scp: 'User.Read Calendars.ReadWrite', exp: 123 })
    expect(decodeJwtClaims(token)).toEqual({ scp: 'User.Read Calendars.ReadWrite', exp: 123 })
  })

  it('returns null for a malformed token', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(decodeJwtClaims('')).toBeNull()
  })
})
