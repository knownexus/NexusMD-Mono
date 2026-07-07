// apps/desktop/src/cloud-auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  makeGoogleDriveProvider: (b) => b, makeOneDriveProvider: (b) => b, toast: () => {},
}))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => k }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: { get: async () => null, set: async () => {} } }))

import { makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken } from './cloud-auth.js'

// Build a minimal JWT (header.payload.signature) with the given exp claim.
const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwtWithExp = (expSeconds) => `eyJhbGciOiJub25lIn0.${b64url({ exp: expSeconds })}.sig`

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
