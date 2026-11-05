import { describe, it, expect, vi, afterEach } from 'vitest'

const { startAuto } = vi.hoisted(() => ({ startAuto: vi.fn() }))
vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), createSyncController: () => ({ startAuto }) }))
vi.mock('@nexusmd/web-adapters', () => ({ domDispatch: {}, domSubscribeForeground: {}, domSubscribeChange: {} }))
vi.mock('./cloud-auth.js', () => ({ desktopCloudProviders: [] }))
vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k, getActiveProfileId: () => 'p' }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: {} }))

import { startDesktopAutoSync } from './sync.js'
import { isLegacyCloudSyncOn, setLegacyCloudSyncOn } from './legacy-cloud-sync.js'

afterEach(() => { localStorage.clear(); startAuto.mockClear() })

describe('legacy Cloud sync switch', () => {
  it('auto-sync does not start with the flag off, and starts with it on', () => {
    setLegacyCloudSyncOn(false)
    startDesktopAutoSync()
    expect(startAuto).not.toHaveBeenCalled()
    setLegacyCloudSyncOn(true)
    startDesktopAutoSync()
    expect(startAuto).toHaveBeenCalledTimes(1)
  })

  it('default follows whether a provider was configured', () => {
    expect(isLegacyCloudSyncOn()).toBe(false)
    localStorage.setItem('nexusmd.sync.provider', 'google')
    expect(isLegacyCloudSyncOn()).toBe(true)
    setLegacyCloudSyncOn(false)
    expect(isLegacyCloudSyncOn()).toBe(false)
  })
})
