import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { plannerCollection, notesCollection, createSyncRuntime, exportBundle, importBundle, decryptSync } from '../src/index.js'

// A stored value that is not valid JSON (a torn write, a bad manual edit) used to read as "nothing here".
// The sync engine takes "nothing here" for "deleted on this device" and propagates the deletion: it removed
// the cloud copy and wrote a tombstone, and every other device then deleted its own good copy. An unreadable
// item must be left alone, reported, and never mistaken for a deletion.

const KEY = 'a'.repeat(64)
const WEEK = 'nexusmd.p.p1.planner.week.2026-W26'
const WEEK2 = 'nexusmd.p.p1.planner.week.2026-W27'
const week = txt => JSON.stringify({ data: { tasks: [{ id: 'r1', txt }] }, themes: {} })

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}
const getProfileKey = k => k.replace('nexusmd.', 'nexusmd.p.p1.')
const opts = storage => ({ storage, getProfileKey, namespace: 'nexusmd' })

function fakeCloud(store) {
  return {
    removed: [],
    async upload(name, text) { store.set(name, text) },
    async getText(name) { return store.has(name) ? store.get(name) : null },
    async listNames(prefix) { return [...store.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name, modifiedAt: 't' })) },
    async remove(name) { this.removed.push(name); store.delete(name) },
  }
}
function device(seed, cloudStore, deviceId, tick) {
  const storage = memStorage(seed)
  const cloud = fakeCloud(cloudStore)
  const collection = plannerCollection(opts(storage))
  return {
    storage, cloud, collection,
    runtime: createSyncRuntime({ ...opts(storage), profileId: 'p1', cloud, getKey: async () => KEY, deviceId, now: tick, collections: [collection] }),
  }
}

let error, warn, debug
beforeEach(() => {
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('reading a corrupt stored value', () => {
  it('throws a CorruptLocalError naming the collection and item, for planner weeks and single values alike', () => {
    const planner = plannerCollection(opts(memStorage({ [WEEK]: '{ torn' })))
    let err
    try { planner.readLocal('2026-W26') } catch (e) { err = e }
    expect(err?.name).toBe('CorruptLocalError')
    expect(err.collection).toBe('planner')
    expect(err.key).toBe('2026-W26')

    const notes = notesCollection(opts(memStorage({ 'nexusmd.p.p1.planner.globalNotes': 'not json' })))
    expect(() => notes.readLocal('data')).toThrow(/corrupt/i)
  })

  it('still reads absent, empty and valid values as before', () => {
    const c = plannerCollection(opts(memStorage({ [WEEK]: week('hi'), 'nexusmd.p.p1.planner.week.2026-W28': '' })))
    expect(c.readLocal('2026-W26').data.tasks[0].txt).toBe('hi')
    expect(c.readLocal('2026-W99')).toBeNull()
    expect(c.readLocal('2026-W28')).toBeNull()
  })

  it('logs it as an error the first time, with sizes but never content, then at debug, and again after a repair', () => {
    const storage = memStorage({ [WEEK]: '{ secret torn' })
    const c = plannerCollection(opts(storage))
    for (let i = 0; i < 3; i++) { try { c.readLocal('2026-W26') } catch { /* expected */ } }
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toBe('[sync:collections] a stored value is not valid JSON and was left alone')
    expect(error.mock.calls[0][2]).toEqual({ collection: 'planner', key: '2026-W26', bytes: 13 })
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret')
    expect(debug).toHaveBeenCalledTimes(2)

    storage.setItem(WEEK, week('repaired'))
    expect(c.readLocal('2026-W26').data.tasks[0].txt).toBe('repaired')   // a good read re-arms the report
    storage.setItem(WEEK, '{ broken again')
    expect(() => c.readLocal('2026-W26')).toThrow()
    expect(error).toHaveBeenCalledTimes(2)
  })
})

describe('sync with an unreadable local item', () => {
  async function twoDevicesInSync() {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const A = device({ [WEEK]: week('important') }, cloud, 'A', tick)
    const B = device({}, cloud, 'B', tick)
    await A.runtime.syncNow()
    await B.runtime.syncNow()
    expect(JSON.parse(B.storage.getItem(WEEK)).data.tasks[0].txt).toBe('important')
    return { cloud, A, B }
  }

  it('does not turn the corruption into a deletion on the cloud or on the other device', async () => {
    const { cloud, A, B } = await twoDevicesInSync()
    A.storage.setItem(WEEK, '{ torn mid-write')
    const filesBefore = [...cloud.keys()].sort()

    const result = await A.runtime.syncNow()
    await B.runtime.syncNow()

    expect(A.cloud.removed).toEqual([])
    expect([...cloud.keys()].sort()).toEqual(filesBefore)
    expect(JSON.parse(B.storage.getItem(WEEK)).data.tasks[0].txt).toBe('important')   // B kept its copy
    expect(A.storage.getItem(WEEK)).toBe('{ torn mid-write')                          // and A's bytes are untouched, for recovery
    const manifest = await decryptSync(cloud.get('nmdsync__p1__manifest.json'), KEY)
    expect(manifest.tombstones).toEqual([])
    expect(result.unreadable).toEqual(['planner/2026-W26'])
  })

  it('still syncs the other items in the same run, and reports nothing unreadable when all is well', async () => {
    const { A } = await twoDevicesInSync()
    A.storage.setItem(WEEK, '{ torn')
    A.storage.setItem(WEEK2, week('fine'))
    const result = await A.runtime.syncNow()
    expect(result.pushed).toBe(1)
    expect(result.unreadable).toEqual(['planner/2026-W26'])

    A.storage.setItem(WEEK, week('repaired'))
    const after = await A.runtime.syncNow()
    expect(after.unreadable).toBeUndefined()
    expect(after.pushed).toBe(1)   // the repaired week goes up as an ordinary edit
  })
})

describe('bundles with an unreadable local item', () => {
  const collectionsFor = storage => [plannerCollection(opts(storage))]

  it('export leaves the unreadable item out and exports the rest', async () => {
    const storage = memStorage({ [WEEK]: '{ torn', [WEEK2]: week('fine') })
    const text = await exportBundle({ collections: collectionsFor(storage), getKey: async () => KEY, profileId: 'p1' })
    const bundle = await decryptSync(text, KEY)
    expect(Object.keys(bundle.collections.planner)).toEqual(['2026-W27'])
  })

  it('import replaces an unreadable local item with the imported one, and says so', async () => {
    const source = memStorage({ [WEEK]: week('from the backup') })
    const text = await exportBundle({ collections: collectionsFor(source), getKey: async () => KEY, profileId: 'p1' })

    const target = memStorage({ [WEEK]: '{ torn' })
    const result = await importBundle({ collections: collectionsFor(target), getKey: async () => KEY, text })
    expect(result.collections).toEqual(['planner'])
    expect(JSON.parse(target.getItem(WEEK)).data.tasks[0].txt).toBe('from the backup')
    expect(warn.mock.calls.map(c => c[0])).toContain('[sync:bundle] ignored: replaced an unreadable local item with the imported one')
  })
})
