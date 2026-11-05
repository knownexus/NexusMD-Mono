import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { plannerCollection, notesCollection, createSyncRuntime, createSyncController, decryptSync, encryptSync } from '../src/index.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { purgeProfileLocal, clearAccountLocalData } from '../src/modules/account/account-clear.js'
import { isSkippedKey } from '../src/index.js'

// Restore from cloud: a user action that replaces an item this device cannot read (see sync-corrupt-local)
// with the copy the cloud holds. It overwrites, so: the damaged bytes are kept first, and if they cannot be
// kept nothing is replaced; it never touches a readable item or one the cloud does not have.

const KEY = 'a'.repeat(64)
const WEEK = 'nexusmd.p.p1.planner.week.2026-W26'
const week = txt => JSON.stringify({ data: { tasks: [{ id: 'r1', txt }] }, themes: {} })
const getProfileKey = k => k.replace('nexusmd.', 'nexusmd.p.p1.')

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
    keys: () => [...m.keys()],
  }
}
const opts = storage => ({ storage, getProfileKey, namespace: 'nexusmd' })
function fakeCloud(store) {
  return {
    async upload(name, text) { store.set(name, text) },
    async getText(name) { return store.has(name) ? store.get(name) : null },
    async listNames() { return [] },
    async remove(name) { store.delete(name) },
  }
}
function device(seed, cloudStore, deviceId, tick, extra = {}) {
  const storage = extra.storage ?? memStorage(seed)
  const collections = [plannerCollection(opts(storage)), notesCollection(opts(storage))]
  const runtime = createSyncRuntime({ ...opts(storage), profileId: 'p1', cloud: fakeCloud(cloudStore), getKey: async () => KEY, deviceId, now: tick, collections })
  return { storage, runtime, collections }
}
async function twoDevicesInSync() {
  const cloud = new Map(); let t = 1; const tick = () => t++
  const A = device({ [WEEK]: week('important') }, cloud, 'A', tick)
  const B = device({}, cloud, 'B', tick)
  await A.runtime.syncNow()
  await B.runtime.syncNow()
  return { cloud, A, B, tick }
}

let error, warn, debug
beforeEach(() => {
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('quarantineLocal: keeping the damaged bytes before anything replaces them', () => {
  it('copies the stored text to a key that is not synced, and returns it', () => {
    const storage = memStorage({ [WEEK]: '{ torn' })
    const c = plannerCollection(opts(storage))
    const q = c.quarantineLocal('2026-W26')
    expect(storage.getItem(q)).toBe('{ torn')
    expect(storage.getItem(WEEK)).toBe('{ torn') // a copy, not a move
    // inside the profile, so deleting the profile deletes it too, but never picked up by the account sync
    expect(q.startsWith('nexusmd.p.p1.sync.quarantine.planner.2026-W26.')).toBe(true)
    expect(isSkippedKey(q)).toBe(true)
    expect(createKeyRegistry({ namespace: 'nexusmd' }).classify(q)).toBeNull()
    // nor listed as a planner week by this engine
    expect(c.listLocal()).toEqual(['2026-W26'])
  })

  it('does not copy the same damaged text twice, but does copy different text', () => {
    vi.useFakeTimers()
    try {
      const storage = memStorage({ [WEEK]: '{ torn' })
      const c = plannerCollection(opts(storage))
      vi.setSystemTime(1_000_000); const first = c.quarantineLocal('2026-W26')
      vi.setSystemTime(2_000_000); const again = c.quarantineLocal('2026-W26')
      expect(again).toBe(first)
      expect(storage.keys().filter(k => k.includes('sync.quarantine'))).toHaveLength(1)
      storage.setItem(WEEK, '{ torn differently')
      vi.setSystemTime(3_000_000); const other = c.quarantineLocal('2026-W26')
      expect(other).not.toBe(first)
      expect(storage.keys().filter(k => k.includes('sync.quarantine'))).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('keeps only the newest few copies of one item, so they cannot pile up', () => {
    vi.useFakeTimers()
    try {
      const storage = memStorage({ [WEEK]: '{ torn' })
      const c = plannerCollection(opts(storage))
      const made = []
      for (let i = 0; i < 5; i++) { vi.setSystemTime(1_000_000 + i * 1000); storage.setItem(WEEK, '{ torn ' + i); made.push(c.quarantineLocal('2026-W26')) }
      const left = storage.keys().filter(k => k.includes('sync.quarantine'))
      expect(left).toEqual(made.slice(-3))
      // copies of a different item are not counted against it
      storage.setItem('nexusmd.p.p1.planner.week.2026-W27', '{ also torn')
      vi.setSystemTime(2_000_000)
      c.quarantineLocal('2026-W27')
      expect(storage.keys().filter(k => k.includes('sync.quarantine')).length).toBe(4)
    } finally { vi.useRealTimers() }
  })

  // The damaged text can be private (notes, plans). Whatever removes a profile's data, or the account's, must
  // remove it too, not leave it behind.
  it('goes when its profile is purged, and when the account data is cleared', async () => {
    const storage = memStorage({ [WEEK]: 'private torn text', 'nexusmd.p.other.planner.week.2026-W26': 'another profile text' })
    const q = plannerCollection(opts(storage)).quarantineLocal('2026-W26')
    expect(storage.getItem(q)).toBe('private torn text')

    await purgeProfileLocal({ storage, secure: { remove: async () => {} }, namespace: 'nexusmd', pid: 'p1' })
    expect(storage.getItem(q)).toBeNull()
    expect(storage.getItem('nexusmd.p.other.planner.week.2026-W26')).toBe('another profile text') // another profile is not touched

    const again = plannerCollection(opts(memStorage({ [WEEK]: 'private torn text' })))
    const s2 = memStorage({ [WEEK]: 'private torn text' })
    const q2 = plannerCollection(opts(s2)).quarantineLocal('2026-W26')
    await clearAccountLocalData({ registry: createKeyRegistry({ namespace: 'nexusmd' }), storage: s2, secure: { remove: async () => {} }, metaKey: 'nexusmd.sync.account.meta' })
    expect(s2.getItem(q2)).toBeNull()
    void again
  })

  it('is not carried by the settings file either (it skips what the account sync skips)', () => {
    const q = plannerCollection(opts(memStorage({ [WEEK]: 'x' }))).quarantineLocal('2026-W26')
    expect(isSkippedKey(q)).toBe(true)
  })

  it('works for a single-value collection, and gives null when there is nothing stored', () => {
    const storage = memStorage({ 'nexusmd.p.p1.planner.globalNotes': 'not json' })
    expect(storage.getItem(notesCollection(opts(storage)).quarantineLocal('data'))).toBe('not json')
    expect(plannerCollection(opts(memStorage())).quarantineLocal('2026-W01')).toBeNull()
  })

  it('throws when the copy cannot be stored, so the caller can stop', () => {
    const storage = memStorage({ [WEEK]: '{ torn' })
    storage.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => plannerCollection(opts(storage)).quarantineLocal('2026-W26')).toThrow(/Quota/)
  })
})

describe('restore from cloud', () => {
  it('replaces an unreadable item with the cloud copy, keeps the damaged one, and the next sync is quiet', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem(WEEK, '{ torn mid-write')

    const r = await A.runtime.restore(['planner/2026-W26'])

    expect(r.failed).toEqual([])
    expect(r.restored).toHaveLength(1)
    expect(JSON.parse(A.storage.getItem(WEEK)).data.tasks[0].txt).toBe('important')
    expect(A.storage.getItem(r.restored[0].backup)).toBe('{ torn mid-write')
    const after = await A.runtime.syncNow()
    expect(after.unreadable).toBeUndefined()
    expect(after.pushed).toBe(0)
  })

  it('calls onChanged so the screen reloads the restored item', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const changed = []
    const storage = memStorage({ [WEEK]: week('x') })
    const collections = [plannerCollection(opts(storage))]
    const mk = (st, id, onChanged) => createSyncRuntime({ ...opts(st), profileId: 'p1', cloud: fakeCloud(cloud), getKey: async () => KEY, deviceId: id, now: tick, collections: [plannerCollection(opts(st))], onChanged })
    await mk(storage, 'A').syncNow()
    storage.setItem(WEEK, 'broken')
    await mk(storage, 'A', (id) => changed.push(id)).restore(['planner/2026-W26'])
    expect(changed).toEqual(['planner'])
  })

  it('leaves a readable item alone', async () => {
    const { A } = await twoDevicesInSync()
    const before = A.storage.getItem(WEEK)
    const r = await A.runtime.restore(['planner/2026-W26'])
    expect(r).toEqual({ restored: [], failed: [{ item: 'planner/2026-W26', reason: 'readable' }] })
    expect(A.storage.getItem(WEEK)).toBe(before)
    expect(A.storage.keys().some(k => k.includes('quarantine'))).toBe(false)
  })

  it('leaves an item the cloud does not have alone, with no backup made', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem('nexusmd.p.p1.planner.week.2026-W40', '{ torn')   // never synced
    const r = await A.runtime.restore(['planner/2026-W40'])
    expect(r.failed).toEqual([{ item: 'planner/2026-W40', reason: 'not-in-cloud' }])
    expect(A.storage.getItem('nexusmd.p.p1.planner.week.2026-W40')).toBe('{ torn')
    expect(A.storage.keys().some(k => k.includes('quarantine'))).toBe(false)
  })

  it('does not restore something that was deleted (a tombstone is not a copy)', async () => {
    const { A, cloud } = await twoDevicesInSync()
    const manifestName = 'nmdsync__p1__manifest.json'
    const manifest = await decryptSync(cloud.get(manifestName), KEY)
    manifest.tombstones.push('planner/2026-W26')
    cloud.set(manifestName, await encryptSync(manifest, KEY))
    A.storage.setItem(WEEK, '{ torn')
    expect((await A.runtime.restore(['planner/2026-W26'])).failed[0].reason).toBe('not-in-cloud')
    expect(A.storage.getItem(WEEK)).toBe('{ torn')
  })

  it('does not replace anything when the cloud copy itself cannot be read', async () => {
    const { A, cloud } = await twoDevicesInSync()
    cloud.set('nmdsync__p1__planner__2026-W26.nmdsync', 'garbage that does not decrypt')
    A.storage.setItem(WEEK, '{ torn')
    const r = await A.runtime.restore(['planner/2026-W26'])
    expect(r.failed).toEqual([{ item: 'planner/2026-W26', reason: 'cloud-copy-unreadable' }])
    expect(A.storage.getItem(WEEK)).toBe('{ torn')
    expect(A.storage.keys().some(k => k.includes('quarantine'))).toBe(false)
  })

  it('replaces nothing if the damaged copy cannot be kept first', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem(WEEK, '{ torn')
    const set = A.storage.setItem
    A.storage.setItem = (k, v) => { if (String(k).includes('quarantine')) throw new Error('QuotaExceededError'); return set(k, v) }
    const r = await A.runtime.restore(['planner/2026-W26'])
    expect(r.failed).toEqual([{ item: 'planner/2026-W26', reason: 'could-not-back-up' }])
    expect(A.storage.getItem(WEEK)).toBe('{ torn')   // the only copy of those bytes is still where it was
  })

  it('restores what it can, item by item, and reports the rest', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem(WEEK, '{ torn')
    A.storage.setItem('nexusmd.p.p1.planner.week.2026-W41', '{ torn too')
    const r = await A.runtime.restore(['planner/2026-W26', 'planner/2026-W41', 'mystery/x'])
    expect(r.restored.map(x => x.item)).toEqual(['planner/2026-W26'])
    expect(r.failed).toEqual([{ item: 'planner/2026-W41', reason: 'not-in-cloud' }, { item: 'mystery/x', reason: 'unknown' }])
  })

  it('logs what it replaced, naming the item and never the content', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem(WEEK, 'secret torn')
    await A.runtime.restore(['planner/2026-W26'])
    const all = JSON.stringify([...warn.mock.calls, ...error.mock.calls])
    expect(all).toContain('restored an unreadable item from the cloud')
    expect(all).not.toContain('secret')
  })
})

describe('controller.restoreUnreadable', () => {
  function connected(seed = {}) {
    const cloud = new Map()
    const provider = {
      id: 'gdrive', label: 'Drive', isConnected: () => true,
      async getText(name) { return cloud.has(name) ? cloud.get(name) : null },
      async upload(name, text) { cloud.set(name, text) },
      async listNames() { return [] }, async remove(name) { cloud.delete(name) },
    }
    const storage = memStorage(seed)
    const c = createSyncController({
      storage, namespace: 'nexusmd', getProfileKey: k => k, getActiveProfileId: () => 'p1',
      providers: [provider], keyStore: { get: async () => KEY, set: async () => {}, remove: async () => {} },
      deviceIdPrefix: 'test', dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
    })
    c.setSyncProvider('gdrive')
    return { c, storage }
  }

  it('restores, then syncs again so the last run no longer lists the item', async () => {
    const { c, storage } = connected({ 'nexusmd.planner.week.2026-W26': JSON.stringify({ data: {}, themes: { mon: 'a' } }) })
    await c.syncOnce()
    storage.setItem('nexusmd.planner.week.2026-W26', '{ torn')
    await c.syncOnce()
    expect(c.getLastResult().unreadable).toEqual(['planner/2026-W26'])

    const r = await c.restoreUnreadable(['planner/2026-W26'])
    expect(r.restored).toHaveLength(1)
    expect(c.getLastResult().unreadable).toBeUndefined()
    expect(JSON.parse(storage.getItem('nexusmd.planner.week.2026-W26')).themes.mon).toBe('a')
  })

  it('says why when it cannot run, the way syncOnce does', async () => {
    const { c } = connected()
    c.setSyncProvider(null)
    expect(await c.restoreUnreadable(['planner/x'])).toEqual({ skipped: 'no-provider' })
  })
})
