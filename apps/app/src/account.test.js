import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateContainerKey, exportContainerKey, importContainerKey, createKeyRegistry } from '@nexusmd/core'

const getInfo = vi.fn()
const clearAccountLocalData = vi.fn(async () => {})
// jsdom has no IndexedDB, so stand in for the encrypted store with a plain map in localStorage.
vi.mock('./adapters/secureStorage.js', () => ({
  secureStorageAdapter: {
    async get(n) { return localStorage.getItem('helm.sec.' + n) },
    async set(n, v) { localStorage.setItem('helm.sec.' + n, v) },
    async remove(n) { localStorage.removeItem('helm.sec.' + n) },
  },
}))
vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), clearAccountLocalData: (...a) => clearAccountLocalData(...a) }))
vi.mock('@capacitor/device', () => ({ Device: { getInfo: (...a) => getInfo(...a) } }))

async function load(info) {
  vi.resetModules()
  getInfo.mockReset()
  if (info instanceof Error) getInfo.mockRejectedValue(info)
  else getInfo.mockResolvedValue(info)
  const mod = await import('./account.js')
  await mod.deviceNameReady
  return mod
}

const makeKey = async () => importContainerKey(await exportContainerKey(await generateContainerKey()))

describe('android account wiring', () => {
  beforeEach(() => localStorage.clear())

  it('exposes the shape AccountGate expects', async () => {
    const { account } = await load({ name: 'Pixel 8', model: 'Pixel 8' })
    expect(account.platform).toBe('android')
    expect(typeof account.createSync).toBe('function')
    expect(account.optOutKey).toBe('helm.account.optOut')
    expect(typeof account.sessionStore.load).toBe('function')
    expect(typeof account.sessionStore.save).toBe('function')
  })

  it('binds the install to a user id that is never synced, and clearLocal wipes local data', async () => {
    const { account, createRegistry } = await load({ name: 'Pixel 8' })
    expect(account.boundUserKey).toBe('helm.account.userId')
    expect(createRegistry().classify('helm.account.userId')).toBeNull()
    await account.clearLocal()
    expect(clearAccountLocalData).toHaveBeenCalledTimes(1)
    const arg = clearAccountLocalData.mock.calls[0][0]
    expect(arg.registry.namespace).toBe('helm')
    expect(arg.storage).toBe(localStorage)
    expect(typeof arg.secure.get).toBe('function')
    expect(arg.metaKey).toBe('helm.account.meta')
  })

  it('deviceStore persists the id under helm.account.deviceId', async () => {
    const { account } = await load({ name: 'Pixel 8' })
    expect(account.deviceStore.get()).toBeNull()
    account.deviceStore.set('dev1')
    expect(account.deviceStore.get()).toBe('dev1')
    expect(localStorage.getItem('helm.account.deviceId')).toBe('dev1')
    account.deviceStore.set(null)
    expect(localStorage.getItem('helm.account.deviceId')).toBeNull()
    expect(account.deviceStore.get()).toBeNull()
    account.deviceStore.set('dev2')
    account.deviceStore.set(undefined)
    expect(account.deviceStore.get()).toBeNull()
  })

  it('classifies helm.p.<id>.google.auth to a helm-prefixed id and keeps tokens platform-private', async () => {
    const { account } = await load({ name: 'Pixel 8' })
    localStorage.setItem('helm.activeProfileId', 'abc')
    localStorage.setItem('helm.p.abc.google.auth', '{"t":1}')
    const sync = account.createSync(await makeKey(), 'dev1')
    const snap = await sync.snapshot()
    expect([...snap.keys()]).toContain('helm:p.abc.google.auth')
  })

  it('shares the ADO id with desktop for helm.p.<id>.android.org', async () => {
    const { account } = await load({ name: 'Pixel 8' })
    localStorage.setItem('helm.p.abc.android.org', 'contoso')
    const snap = await account.createSync(await makeKey(), 'dev1').snapshot()
    const desktop = createKeyRegistry({ namespace: 'nexusmd' }).classify('nexusmd.p.abc.ado.org')
    expect(desktop.id).toBe('p.abc.ado.org')
    expect(snap.has(desktop.id)).toBe(true)
    expect(snap.get(desktop.id).value).toBe('contoso')
  })

  it('does not sync planner weeks or the account keys themselves', async () => {
    const { account } = await load({ name: 'Pixel 8' })
    localStorage.setItem('helm.p.abc.planner.week.2026-W01', '{"x":1}')
    localStorage.setItem('helm.account.deviceId', 'dev1')
    localStorage.setItem('helm.account.meta', '{}')
    localStorage.setItem('helm.account.optOut', '1')
    const text = JSON.stringify([...(await account.createSync(await makeKey(), 'dev1').snapshot()).keys()])
    expect(text).not.toContain('planner')
    expect(text).not.toContain('account')
  })

  it('an existing local profile plus a remote list ends as the union by id', async () => {
    const { createRegistry } = await load({ name: 'Pixel 8' })
    const merged = createRegistry().mergers.profiles(
      [{ id: 'local1', name: 'Phone' }, { id: 'shared', name: 'Old' }],
      [{ id: 'shared', name: 'Work' }, { id: 'remote1', name: 'Desktop' }],
    )
    expect(merged.map(p => p.id)).toEqual(['local1', 'shared', 'remote1'])
    expect(merged.find(p => p.id === 'shared').name).toBe('Work')
  })

  it('session store round-trips through secure storage under account.session', async () => {
    const { account } = await load({ name: 'Pixel 8' })
    await account.sessionStore.save({ a: 1 })
    expect(await account.sessionStore.load()).toEqual({ a: 1 })
    expect(Object.keys(localStorage).some(k => k.startsWith('helm.sec.'))).toBe(true)
    await account.sessionStore.save(null)
    expect(await account.sessionStore.load()).toBeNull()
  })
})

describe('deviceNameDefault', () => {
  beforeEach(() => localStorage.clear())

  it('is "Android device" before the plugin answers', async () => {
    vi.resetModules()
    getInfo.mockReset()
    getInfo.mockReturnValue(new Promise(() => {}))
    const { account } = await import('./account.js')
    expect(account.deviceNameDefault()).toBe('Android device')
  })

  it('uses the device name once known', async () => {
    const { account } = await load({ name: '  Phil\'s Pixel ', model: 'Pixel 8' })
    expect(account.deviceNameDefault()).toBe("Phil's Pixel")
  })

  it('falls back to the model when the name is empty', async () => {
    const { account } = await load({ name: '  ', model: 'Pixel 8' })
    expect(account.deviceNameDefault()).toBe('Pixel 8')
  })

  it('falls back to "Android device" when there is neither', async () => {
    const { account } = await load({})
    expect(account.deviceNameDefault()).toBe('Android device')
  })

  it('swallows plugin errors', async () => {
    const { account } = await load(new Error('no plugin'))
    expect(account.deviceNameDefault()).toBe('Android device')
  })
})
