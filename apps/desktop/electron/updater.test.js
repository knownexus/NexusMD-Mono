// @vitest-environment node
//
// The tray's "Check for Updates" always answers, whatever the check finds.
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { checkForUpdatesManually, useNewestDesktopRelease } = require('./updater.cjs')

describe('useNewestDesktopRelease', () => {
  const rel = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, ...extra })
  const respond = (body, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  const updaterMock = () => ({ setFeedURL: vi.fn() })
  const BASE = 'https://github.com/knownexus/NexusMD-Mono/releases/download/'

  it('skips an android-v release listed first in favour of the newest v<semver> tag, with a timeout', async () => {
    const u = updaterMock()
    const fetchFn = respond([rel('android-v1.4.2'), rel('apps-latest'), rel('v1.2'), rel('v1.2.3/../x'), rel('v2.0.1'), rel('v2.0.0')])
    await useNewestDesktopRelease(u, fetchFn)
    expect(u.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: `${BASE}v2.0.1` })
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('skips draft and prerelease entries', async () => {
    const u = updaterMock()
    await useNewestDesktopRelease(u, respond([rel('v3.0.0', { draft: true }), rel('v2.1.0-beta.1', { prerelease: true }), rel('v2.0.0-rc.1'), rel('v1.9.0')]))
    expect(u.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: `${BASE}v2.0.0-rc.1` })
  })

  it('leaves the feed untouched on a non-ok response', async () => {
    const u = updaterMock()
    await useNewestDesktopRelease(u, respond([rel('v2.0.0')], false))
    expect(u.setFeedURL).not.toHaveBeenCalled()
  })

  it('catches a non-array body without throwing and leaves the feed untouched', async () => {
    const u = updaterMock()
    await expect(useNewestDesktopRelease(u, respond({ message: 'API rate limit exceeded' }))).resolves.toBeUndefined()
    expect(u.setFeedURL).not.toHaveBeenCalled()
  })
})

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

  it('explains a release that is still being published, without the raw HTTP dump', async () => {
    const raw = ['Cannot find channel "latest.yml" update info: HttpError: 404', 'Headers: {', '  "cache-control": "no-cache"', '}', '    at createHttpError'].join('\n')
    const d = deps({ check: vi.fn(async () => { throw new Error(raw) }) })
    await checkForUpdatesManually(d)
    const [box] = shown(d)
    expect(box).toMatchObject({ type: 'info', message: "Couldn't check for updates right now", detail: 'The newest version is still being published. Try again in a few minutes.' })
    expect(JSON.stringify(box)).not.toMatch(/Headers|createHttpError/)
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
    expect(shown(d)).toEqual([expect.objectContaining({ type: 'info', detail: expect.stringContaining('Check your connection') })])
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
