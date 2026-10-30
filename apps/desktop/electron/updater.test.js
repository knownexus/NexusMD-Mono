// @vitest-environment node
//
// The tray's "Check for Updates" always answers, whatever the check finds.
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { checkForUpdatesManually } = require('./updater.cjs')

function deps({ packaged = true, version = '1.1.0', check } = {}) {
  return {
    app: { isPackaged: packaged, getVersion: () => version },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
    autoUpdater: { checkForUpdates: check ?? vi.fn(async () => ({ isUpdateAvailable: false, updateInfo: { version } })) },
    getWin: () => ({ isDestroyed: () => false }),
    wait: vi.fn(async () => {}),
  }
}
const shown = d => d.dialog.showMessageBox.mock.calls.map(([, opts]) => opts)

describe('checkForUpdatesManually', () => {
  it('says so when this is already the latest version', async () => {
    const d = deps()
    await checkForUpdatesManually(d)
    expect(shown(d)).toEqual([expect.objectContaining({ message: "You're up to date", detail: expect.stringContaining('1.1.0') })])
  })

  it('leaves a newer version to the download prompt, without a second dialog', async () => {
    const d = deps({ check: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })) })
    expect(await checkForUpdatesManually(d)).toEqual({ available: true, version: '1.2.0' })
    expect(shown(d)).toEqual([])
  })

  it('shows why the check failed', async () => {
    const d = deps({ check: vi.fn(async () => { throw new Error('HttpError: 404') }) })
    await checkForUpdatesManually(d)
    expect(shown(d)).toEqual([expect.objectContaining({ type: 'error', message: "Couldn't check for updates", detail: expect.stringContaining('404') })])
  })

  it('retries a dropped connection before reporting anything', async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.1.0' } })
    const d = deps({ check })
    await checkForUpdatesManually(d)
    expect(check).toHaveBeenCalledTimes(2)
    expect(d.wait).toHaveBeenCalledTimes(1)
    expect(shown(d)).toEqual([expect.objectContaining({ message: "You're up to date" })])
  })

  it('shows the error once the retries run out', async () => {
    const check = vi.fn(async () => { throw new Error('net::ERR_CONNECTION_RESET') })
    const d = deps({ check })
    await checkForUpdatesManually(d)
    expect(check).toHaveBeenCalledTimes(3)
    expect(shown(d)).toEqual([expect.objectContaining({ type: 'error', detail: 'net::ERR_CONNECTION_RESET' })])
  })

  it('does not retry an error that is not a network failure', async () => {
    const check = vi.fn(async () => { throw new Error('HttpError: 404') })
    const d = deps({ check })
    await checkForUpdatesManually(d)
    expect(check).toHaveBeenCalledTimes(1)
    expect(d.wait).not.toHaveBeenCalled()
  })

  it('explains that a development build doesn’t update', async () => {
    const d = deps({ packaged: false })
    await checkForUpdatesManually(d)
    expect(d.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(shown(d)).toEqual([expect.objectContaining({ message: 'This is a development build' })])
  })

  it('treats a check that finds nothing (no feed) as up to date', async () => {
    const d = deps({ check: vi.fn(async () => null) })
    await checkForUpdatesManually(d)
    expect(shown(d)[0].message).toBe("You're up to date")
  })
})
