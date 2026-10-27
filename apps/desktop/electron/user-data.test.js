import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { resolveUserDataDir, pinUserData } from './user-data.cjs'

const appData = path.join('C:', 'Users', 'x', 'AppData', 'Roaming')

describe('resolveUserDataDir', () => {
  it('pins packaged builds to <appData>/NexusMD', () => {
    expect(resolveUserDataDir({ isPackaged: true, appData }))
      .toBe(path.join(appData, 'NexusMD'))
  })
  it('leaves dev runs on Electron\'s default', () => {
    expect(resolveUserDataDir({ isPackaged: false, appData })).toBeNull()
  })
  it('does nothing without an appData path', () => {
    expect(resolveUserDataDir({ isPackaged: true, appData: '' })).toBeNull()
  })
})

describe('pinUserData', () => {
  it('sets userData on a packaged app', () => {
    const app = { isPackaged: true, getPath: vi.fn(() => appData), setPath: vi.fn() }
    pinUserData(app)
    expect(app.setPath).toHaveBeenCalledWith('userData', path.join(appData, 'NexusMD'))
  })
  it('leaves an explicit --user-data-dir alone', () => {
    const app = { isPackaged: true, commandLine: { hasSwitch: vi.fn(name => name === 'user-data-dir') }, getPath: vi.fn(() => appData), setPath: vi.fn() }
    expect(pinUserData(app)).toBeNull()
    expect(app.setPath).not.toHaveBeenCalled()
  })
  it('does not touch userData in dev', () => {
    const app = { isPackaged: false, getPath: vi.fn(() => appData), setPath: vi.fn() }
    pinUserData(app)
    expect(app.setPath).not.toHaveBeenCalled()
  })
})
