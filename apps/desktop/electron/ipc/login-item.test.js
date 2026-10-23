// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { register, loginItemPath, repointLoginItem } = require('./login-item.cjs')

function makeFakeIpcMain() {
  const handlers = {}
  return {
    handle(channel, fn) { handlers[channel] = fn },
    invoke(channel, ...args) { return handlers[channel](null, ...args) },
  }
}

function makeApp(openAtLogin = false) {
  return {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
    setLoginItemSettings: vi.fn(),
  }
}

describe('loginItemPath', () => {
  it('uses the portable exe when PORTABLE_EXECUTABLE_FILE is set, else execPath', () => {
    expect(loginItemPath({ PORTABLE_EXECUTABLE_FILE: 'C:/Apps/NexusMD.exe' }, 'C:/Temp/x/NexusMD.exe')).toBe('C:/Apps/NexusMD.exe')
    expect(loginItemPath({}, 'C:/Program Files/NexusMD/NexusMD.exe')).toBe('C:/Program Files/NexusMD/NexusMD.exe')
  })
})

describe('repointLoginItem', () => {
  const installed = 'C:\\Users\\me\\AppData\\Local\\Programs\\NexusMD\\NexusMD.exe'
  const withItems = launchItems => ({
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, launchItems })),
    setLoginItemSettings: vi.fn(),
  })

  it('moves a start-on-login entry left pointing at another copy of the app onto this one', () => {
    // e.g. an old portable build that opens only to the tray
    const app = withItems([{ name: 'electron.app.NexusMD', path: 'C:\\repos\\dist\\NexusMD 1.0.0.exe', enabled: true }])
    expect(repointLoginItem({ app, env: {}, execPath: installed })).toBe(true)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: installed })
  })

  it('leaves an entry that already points here alone, however the path is written', () => {
    const app = withItems([{ path: '"c:/users/me/appdata/local/programs/nexusmd/NexusMD.exe"', enabled: true }])
    expect(repointLoginItem({ app, env: {}, execPath: installed })).toBe(false)
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('does nothing when start-on-login is off or was turned off in Windows', () => {
    const none = withItems([])
    expect(repointLoginItem({ app: none, env: {}, execPath: installed })).toBe(false)
    const disabled = withItems([{ path: 'C:\\old\\NexusMD.exe', enabled: false }])
    expect(repointLoginItem({ app: disabled, env: {}, execPath: installed })).toBe(false)
    expect(disabled.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('points a portable build at its real exe, not its temp copy', () => {
    const app = withItems([{ path: 'C:\\old\\NexusMD 1.0.0.exe', enabled: true }])
    repointLoginItem({ app, env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\NexusMD 1.0.2.exe' }, execPath: 'C:\\Temp\\x\\NexusMD.exe' })
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'D:\\Apps\\NexusMD 1.0.2.exe' })
  })

  it('copes with a platform that reports no launch items', () => {
    const app = { getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })), setLoginItemSettings: vi.fn() }
    expect(repointLoginItem({ app, env: {}, execPath: installed })).toBe(false)
  })
})

describe('login-item IPC', () => {
  it('targets the real portable exe, not the per-launch temp folder', async () => {
    const ipc = makeFakeIpcMain()
    const app = makeApp(true)
    register(ipc, { app, env: { PORTABLE_EXECUTABLE_FILE: 'C:/Apps/NexusMD.exe' }, execPath: 'C:/Temp/abc/NexusMD.exe' })
    expect(await ipc.invoke('get-login-item-enabled')).toBe(true)
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ path: 'C:/Apps/NexusMD.exe' })
    await ipc.invoke('set-login-item-enabled', true)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'C:/Apps/NexusMD.exe' })
  })

  it('uses execPath for installed builds and coerces the flag to a boolean', async () => {
    const ipc = makeFakeIpcMain()
    const app = makeApp(false)
    register(ipc, { app, env: {}, execPath: 'C:/Program Files/NexusMD/NexusMD.exe' })
    expect(await ipc.invoke('get-login-item-enabled')).toBe(false)
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ path: 'C:/Program Files/NexusMD/NexusMD.exe' })
    await ipc.invoke('set-login-item-enabled', undefined)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, path: 'C:/Program Files/NexusMD/NexusMD.exe' })
  })
})
