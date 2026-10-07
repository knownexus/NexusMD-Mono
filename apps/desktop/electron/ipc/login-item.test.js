// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { register, loginItemPath } = require('./login-item.cjs')

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
