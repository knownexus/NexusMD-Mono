import { describe, it, expect, vi, afterEach } from 'vitest'
import { linkAdapter } from './link.js'
import { oauthAdapter } from './oauth.js'
import { windowControlsAdapter } from './windowControls.js'
import { logsAdapter } from './logs.js'
import { appPrefsAdapter } from './appPrefs.js'

afterEach(() => { delete window.electronAPI })

describe('linkAdapter', () => {
  it('reports availability from the bridge and forwards both link kinds', async () => {
    expect(linkAdapter.canOpenLink()).toBe(false)
    expect(linkAdapter.canOpenExternal()).toBe(false)
    window.electronAPI = { openLink: vi.fn(async () => 'tab'), openExternal: vi.fn(async () => 'browser') }
    expect(linkAdapter.canOpenLink()).toBe(true)
    expect(linkAdapter.canOpenExternal()).toBe(true)
    expect(await linkAdapter.openLink('https://a')).toBe('tab')
    expect(await linkAdapter.openExternal('nexusmd://x')).toBe('browser')
    expect(window.electronAPI.openLink).toHaveBeenCalledWith('https://a')
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('nexusmd://x')
  })
})

describe('oauthAdapter', () => {
  it('starts sign-in and refreshes tokens through the bridge', async () => {
    window.electronAPI = { oauth: { start: vi.fn(async () => ({ accessToken: 'a' })), refresh: vi.fn(async () => ({ accessToken: 'b' })) } }
    expect(await oauthAdapter.start('google')).toEqual({ accessToken: 'a' })
    expect(await oauthAdapter.refresh('rt', 'google')).toEqual({ accessToken: 'b' })
    expect(window.electronAPI.oauth.refresh).toHaveBeenCalledWith('rt', 'google')
  })
})

describe('windowControlsAdapter', () => {
  it('drives the window buttons and subscribes to refresh requests', () => {
    const win = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() }
    const onRefreshData = vi.fn()
    window.electronAPI = { platform: 'win32', window: win, onRefreshData }
    expect(windowControlsAdapter.platform()).toBe('win32')
    windowControlsAdapter.minimize(); windowControlsAdapter.maximize(); windowControlsAdapter.close()
    expect(win.minimize).toHaveBeenCalled(); expect(win.maximize).toHaveBeenCalled(); expect(win.close).toHaveBeenCalled()
    const cb = () => {}
    windowControlsAdapter.onRefreshData(cb)
    expect(onRefreshData).toHaveBeenCalledWith(cb)
  })

  it('does nothing without a bridge', () => {
    expect(windowControlsAdapter.platform()).toBeUndefined()
    expect(() => { windowControlsAdapter.minimize(); windowControlsAdapter.onRefreshData(() => {}) }).not.toThrow()
  })
})

describe('logsAdapter', () => {
  it('lists, reads and deletes logs', async () => {
    window.electronAPI = { logs: { list: vi.fn(async () => [{ date: 'd' }]), read: vi.fn(async () => 'text'), delete: vi.fn(async () => true) } }
    expect(await logsAdapter.list()).toEqual([{ date: 'd' }])
    expect(await logsAdapter.read('d')).toBe('text')
    expect(await logsAdapter.delete('d')).toBe(true)
  })

  it('resolves undefined outside Electron', async () => {
    expect(await logsAdapter.list()).toBeUndefined()
    expect(await logsAdapter.read('d')).toBeUndefined()
  })
})

describe('appPrefsAdapter', () => {
  it('is unavailable without a bridge and tolerates missing methods', async () => {
    expect(appPrefsAdapter.isAvailable()).toBe(false)
    window.electronAPI = {}
    expect(appPrefsAdapter.isAvailable()).toBe(true)
    expect(await appPrefsAdapter.getLoginItemEnabled()).toBeUndefined()
    expect(appPrefsAdapter.onZoomChanged(() => {})).toBeUndefined()
  })

  it('reads and writes the preferences and zoom through the bridge', async () => {
    window.electronAPI = {
      getLoginItemEnabled: vi.fn(async () => true), setLoginItemEnabled: vi.fn(async () => {}),
      getCloseToTray: vi.fn(async () => false), setCloseToTray: vi.fn(async () => {}),
      pickOutputFolder: vi.fn(async () => 'C:\out'),
      getZoomFactor: vi.fn(async () => 1.2), setZoomFactor: vi.fn(), onZoomChanged: vi.fn(() => () => {}),
    }
    expect(await appPrefsAdapter.getLoginItemEnabled()).toBe(true)
    expect(await appPrefsAdapter.getCloseToTray()).toBe(false)
    expect(await appPrefsAdapter.pickOutputFolder()).toBe('C:\out')
    expect(await appPrefsAdapter.getZoomFactor()).toBe(1.2)
    await appPrefsAdapter.setLoginItemEnabled(false)
    appPrefsAdapter.setZoomFactor(1.5)
    expect(window.electronAPI.setLoginItemEnabled).toHaveBeenCalledWith(false)
    expect(window.electronAPI.setZoomFactor).toHaveBeenCalledWith(1.5)
    expect(typeof appPrefsAdapter.onZoomChanged(() => {})).toBe('function')
  })
})
