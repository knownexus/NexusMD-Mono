// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { register } from './oauth.cjs'

// Fake ipcMain that captures handlers by channel name
function fakeIpc() {
  const h = {}
  return { ipcMain: { handle: (c, fn) => { h[c] = fn } }, h }
}

// Silent fake logger so test output stays pristine
function fakeLogger() {
  const noop = vi.fn()
  return { scope: () => ({ info: noop, error: noop }) }
}

// Minimal fake config (provider lookup just needs a truthy value)
const fakeConfig = { google: { clientId: 'test-client' } }

describe('oauth ipc', () => {
  let refreshAccessTokenSpy

  beforeEach(() => {
    refreshAccessTokenSpy = vi.fn(async () => ({ accessToken: 'AT2', expiresAt: 123 }))
  })

  it('oauth:refresh delegates to refreshAccessToken', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, {
      config: fakeConfig,
      refreshAccessToken: refreshAccessTokenSpy,
      logger: fakeLogger(),
    })
    const out = await h['oauth:refresh'](null, { provider: 'google', refreshToken: 'RT' })
    expect(refreshAccessTokenSpy).toHaveBeenCalledWith(fakeConfig.google, 'RT')
    expect(out).toEqual({ accessToken: 'AT2', expiresAt: 123 })
  })

  it('oauth:refresh returns null with no refresh token', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, {
      config: fakeConfig,
      refreshAccessToken: refreshAccessTokenSpy,
      logger: fakeLogger(),
    })
    expect(await h['oauth:refresh'](null, { provider: 'google' })).toBeNull()
  })

  it('rejects an unknown provider (both handlers)', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { config: fakeConfig, logger: fakeLogger() })
    await expect(h['oauth:start'](null, { provider: 'nope' })).rejects.toThrow(/unknown oauth provider/)
    await expect(h['oauth:refresh'](null, { provider: 'nope' })).rejects.toThrow(/unknown oauth provider/)
  })

  it('oauth:start happy path with injected fakes', async () => {
    const verifier = 'VER'
    const challenge = 'CHAL'
    const state = 'STATE'
    const closeSpy = vi.fn()
    const openExternalSpy = vi.fn(async () => {})
    const exchangeCodeSpy = vi.fn(async () => ({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 999 }))

    const fakeLoop = { port: 5555, waitForCode: async () => 'CODE', close: closeSpy }

    const { ipcMain, h } = fakeIpc()
    register(ipcMain, {
      config: fakeConfig,
      makePkce: () => ({ verifier, challenge, state }),
      startLoopback: async () => fakeLoop,
      buildAuthUrl: () => 'https://auth',
      exchangeCode: exchangeCodeSpy,
      shell: { openExternal: openExternalSpy },
      logger: fakeLogger(),
    })

    const tokens = await h['oauth:start'](null, { provider: 'google' })

    expect(openExternalSpy).toHaveBeenCalledWith('https://auth')
    expect(exchangeCodeSpy).toHaveBeenCalledWith(
      fakeConfig.google,
      { code: 'CODE', verifier, redirectUri: 'http://127.0.0.1:5555' }
    )
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 999 })
    expect(closeSpy).toHaveBeenCalled()
  })
})
