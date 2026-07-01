// apps/desktop/src/cloud-auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  makeGoogleDriveProvider: (b) => b, makeOneDriveProvider: (b) => b, toast: () => {},
}))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => k }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: { get: async () => null, set: async () => {} } }))

import { makeNativeGoogleBinding, makeNativeMicrosoftBinding } from './cloud-auth.js'

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
