import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
vi.mock('./toast.jsx', () => ({ toast: (...a) => toast(...a) }))
vi.mock('./adapters/deepLink.js', () => ({ deepLinkAdapter: { onLink: () => {} } }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: { get: async () => null, set: async () => {}, remove: async () => {} } }))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => 'p.' + k, getActiveProfileId: () => 'p' }))

import { makeAppOAuthService, signInFailure } from './cloud-auth.js'

beforeEach(() => { toast.mockClear(); window.open = vi.fn(() => ({})) })

const google = () => makeAppOAuthService('google')

describe('connecting a cloud account', () => {
  it('says the sign-in server cannot be reached instead of doing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await google().connect()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Can't reach the sign-in server/), 'error')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('says when the server has no client ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'google oauth not configured' }) })))
    await google().connect()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/no client ID/), 'error')
  })

  it('opens the browser when the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://accounts.google.com/x' }) })))
    await google().connect()
    expect(window.open).toHaveBeenCalledWith('https://accounts.google.com/x', '_system')
    expect(toast).not.toHaveBeenCalled()
  })

  it('describes other failures with the status', async () => {
    expect(await signInFailure({ status: 502, json: async () => { throw new Error('x') } })).toMatch(/answered 502/)
  })
})
