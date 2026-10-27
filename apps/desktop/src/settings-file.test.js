import { describe, it, expect, vi } from 'vitest'
import { collectSettings, applySettings, encodeSettings, decodeSettings, isExported } from './settings-file.js'

function memStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    dump: () => Object.fromEntries(m),
  }
}

// Stands in for the IndexedDB-keyed secure store: "ciphertext" in storage under nexusmd.sec.*.
function memSecure(storage) {
  return {
    get: async k => { const raw = storage.getItem('nexusmd.sec.' + k); return raw ? raw.replace(/^enc:/, '') : null },
    set: async (k, v) => storage.setItem('nexusmd.sec.' + k, 'enc:' + v),
  }
}

describe('settings file', () => {
  it('round-trips profiles, global keys, secrets and desktop prefs through an encrypted file', async () => {
    const from = memStorage({
      'nexusmd.profiles': '[{"id":"p1","name":"Work"}]',
      'nexusmd.activeProfileId': 'p1',
      'nexusmd.p.p1.ado.pat': 'ado-token',
      'nexusmd.p.p1.git.config': '{"repos":[{"name":"mono","path":"C:/repos/mono"}]}',
      'nexusmd.p.p1.dbManager.connections': '[{"id":"c1"}]',
      'nexusmd.tweaks': '{"theme":"dark"}',
      'nexusmd.sec.nexusmd.p.p1.dbManager.secret.c1': 'enc:db-password',
      'nexusmd.ado.cache.v1': '{"stale":true}',
      'nexusmd.oauth.pending': 'x',
    })
    const prefs = { getCloseToTray: () => false, getZoomFactor: () => 1.1, getLoginItemEnabled: () => true, getDisabledApps: () => ['git'] }

    const text = await encodeSettings(await collectSettings({ storage: from, secure: memSecure(from), prefs }), 'pw')
    expect(text).not.toContain('ado-token')
    expect(text).not.toContain('db-password')

    const to = memStorage({ 'nexusmd.outputPath': 'D:/out' })
    const toPrefs = { setCloseToTray: vi.fn(), setZoomFactor: vi.fn(), setLoginItemEnabled: vi.fn(), setDisabledApps: vi.fn() }
    const res = await applySettings(await decodeSettings(text, 'pw'), { storage: to, secure: memSecure(to), prefs: toPrefs, installedApps: ['git', 'work'] })

    expect(res).toEqual({ keys: 6, secrets: 1, disabledApps: ['git'] })
    expect(toPrefs.setDisabledApps).toHaveBeenCalledWith(['git'])
    const out = to.dump()
    expect(out['nexusmd.p.p1.ado.pat']).toBe('ado-token')
    expect(out['nexusmd.tweaks']).toBe('{"theme":"dark"}')
    expect(out['nexusmd.sec.nexusmd.p.p1.dbManager.secret.c1']).toBe('enc:db-password')
    expect(out['nexusmd.outputPath']).toBe('D:/out')          // untouched
    expect(out['nexusmd.ado.cache.v1']).toBeUndefined()       // caches stay behind
    expect(out['nexusmd.oauth.pending']).toBeUndefined()
    expect(toPrefs.setCloseToTray).toHaveBeenCalledWith(false)
    expect(toPrefs.setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(toPrefs.setLoginItemEnabled).toHaveBeenCalledWith(true)
  })

  it('keeps every app on when the file would switch off all the apps this machine has', async () => {
    const prefs = { setDisabledApps: vi.fn() }
    const res = await applySettings({ storage: {}, desktop: { disabledApps: ['git', 'work'] } },
      { storage: memStorage(), secure: memSecure(memStorage()), prefs, installedApps: ['git'] })
    expect(res.disabledApps).toEqual([])
    expect(prefs.setDisabledApps).toHaveBeenCalledWith([])
  })

  it('rejects a wrong password and a file that is not a settings file', async () => {
    const text = await encodeSettings({ storage: {}, secrets: {}, desktop: {} }, 'right')
    await expect(decodeSettings(text, 'wrong')).rejects.toThrow('Wrong password')
    await expect(decodeSettings('{"format":"nexusmd-profile-bundle-enc"}', 'x')).rejects.toThrow('Not a NexusMD settings file')
    await expect(encodeSettings({}, '')).rejects.toThrow('password is required')
  })

  it('leaves out caches and transient keys', () => {
    expect(isExported('nexusmd.p.p1.git.snapshot')).toBe(false)
    expect(isExported('nexusmd.jira.cache.v1')).toBe(false)
    expect(isExported('nexusmd.wi.wiTypeStates.cache')).toBe(false)
    expect(isExported('nexusmd.sync.base.gdrive')).toBe(false)
    expect(isExported('nexusmd.p.p1.jira.apiToken')).toBe(true)
    expect(isExported('nx-db:saved-queries')).toBe(true)
  })
})
