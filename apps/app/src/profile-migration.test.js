import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('profile migration pruning keeps account state', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })

  it('does not prune account keys or secrets after 30 days', async () => {
    localStorage.setItem('helm.activeProfileId', 'p1')
    localStorage.setItem('helm.profiles', '[]')
    localStorage.setItem('helm.migrated', String(Date.now() - 31 * 24 * 3600 * 1000))
    localStorage.setItem('helm.android.org', 'old')
    localStorage.setItem('helm.account.deviceId', 'dev1')
    localStorage.setItem('helm.account.meta', '{}')
    localStorage.setItem('helm.sec.account.session', 'cipher')
    await import('./profile-migration.js')
    expect(localStorage.getItem('helm.android.org')).toBeNull()
    expect(localStorage.getItem('helm.account.deviceId')).toBe('dev1')
    expect(localStorage.getItem('helm.account.meta')).toBe('{}')
    expect(localStorage.getItem('helm.sec.account.session')).toBe('cipher')
  })
})
