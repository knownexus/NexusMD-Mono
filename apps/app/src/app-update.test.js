import { describe, it, expect } from 'vitest'
import { compareVersions, newestAndroidRelease, checkForUpdate } from './app-update.js'

const rel = (tag, extra = {}) => ({ tag_name: tag, assets: [{ name: 'nexus.apk', browser_download_url: `https://github.com/x/${tag}.apk` }], ...extra })
const fetchOf = (releases) => async () => ({ ok: true, json: async () => releases })

describe('app-update', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('android-v1.0.1', '1.1.0')).toBe(-1)
  })

  it('picks the newest published Android release with an APK', () => {
    const best = newestAndroidRelease([
      rel('v9.0.0'), rel('android-v1.2.0'), rel('android-v1.3.0'), rel('android-v2.0.0', { draft: true }),
      rel('android-v1.4.0', { prerelease: true }), { tag_name: 'android-v1.5.0', assets: [] },
    ])
    expect(best.version).toBe('1.3.0')
    expect(best.url).toContain('android-v1.3.0')
  })

  it('reports an update only when the release is newer', async () => {
    const plugin = { getInfo: async () => ({ versionName: '1.2.0', fromPlay: false }) }
    const run = (releases) => checkForUpdate({ plugin, fetchImpl: fetchOf(releases), supported: () => true })
    expect((await run([rel('android-v1.3.0')])).available).toBe(true)
    expect((await run([rel('android-v1.2.0')])).available).toBe(false)
  })

  it('leaves Play installs to Play', async () => {
    const plugin = { getInfo: async () => ({ versionName: '1.2.0', fromPlay: true }) }
    const r = await checkForUpdate({ plugin, fetchImpl: () => { throw new Error('no network call') }, supported: () => true })
    expect(r).toMatchObject({ fromPlay: true, available: false })
  })

  it('does nothing outside the native app', async () => {
    expect(await checkForUpdate({ supported: () => false })).toEqual({ supported: false })
  })
})
