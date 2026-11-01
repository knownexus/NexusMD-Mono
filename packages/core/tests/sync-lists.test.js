import { describe, it, expect } from 'vitest'
import { listsCollection, createSyncController } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}

describe('listsCollection', () => {
  it('is a singleton collection over ${namespace}.lists', () => {
    const storage = memStorage()
    const getProfileKey = k => k.replace('helm.', 'helm.p.p1.')
    const c = listsCollection({ storage, getProfileKey, namespace: 'helm' })
    expect(c.id).toBe('lists')
    expect(c.listLocal()).toEqual([])
    c.writeLocal('data', { lists: [{ id: 'a', name: 'A', items: [] }] })
    expect(storage.getItem('helm.p.p1.lists')).toBe(JSON.stringify({ lists: [{ id: 'a', name: 'A', items: [] }] }))
    expect(c.listLocal()).toEqual(['data'])
    expect(c.readLocal('data')).toEqual({ lists: [{ id: 'a', name: 'A', items: [] }] })
    const base = { lists: [{ id: 'a', name: 'A', items: [{ id: '1', t: 'x' }, { id: '2', t: 'y' }] }] }
    const l = { lists: [{ id: 'a', name: 'A', items: [{ id: '1', t: 'L' }, { id: '2', t: 'y' }] }] }
    const r = { lists: [{ id: 'a', name: 'A', items: [{ id: '1', t: 'x' }, { id: '2', t: 'R' }] }] }
    expect(c.merge(base, l, r, { from: 'dev', prefer: 'local' }).merged.lists[0].items)
      .toEqual([{ id: '1', t: 'L' }, { id: '2', t: 'R' }])
    c.removeLocal('data')
    expect(c.listLocal()).toEqual([])
  })
})

// One in-memory cloud shared by a mobile-namespace (helm) and a desktop-namespace
// (nexusmd) controller. Cloud file names carry the profile id and collection id,
// not the namespace, so both devices meet on the same `lists` item.
function cloudProvider(store) {
  return {
    id: 'mem', label: 'Memory', isConnected: () => true,
    async upload(name, text) { store.set(name, text) },
    async getText(name) { return store.has(name) ? store.get(name) : null },
    async listNames(prefix) { return [...store.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name, modifiedAt: 't' })) },
    async remove(name) { store.delete(name) },
  }
}
function deviceController(namespace, cloud, seed = {}) {
  const storage = memStorage(seed)
  const keyStore = { get: async () => 'a'.repeat(64), set: async () => {}, remove: async () => {} }
  const ctrl = createSyncController({
    storage, namespace, getProfileKey: k => k, getActiveProfileId: () => 'p1',
    providers: [cloudProvider(cloud)], keyStore, deviceIdPrefix: namespace,
    dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
  })
  ctrl.setSyncProvider('mem')
  return { storage, ctrl }
}
const readKey = (storage, key) => JSON.parse(storage.getItem(key))

describe('Lists sync across namespaces', () => {
  it('mobile (helm) and desktop (nexusmd) exchange and merge lists through the cloud', async () => {
    const cloud = new Map()
    const mobileLists = { lists: [{ id: 'a', name: 'Groceries', color: '#6c8ebf', items: [{ id: '1', title: 'milk' }, { id: '2', title: 'eggs' }] }] }
    const mobile = deviceController('helm', cloud, { 'helm.lists': JSON.stringify(mobileLists) })
    const desktop = deviceController('nexusmd', cloud)

    await mobile.ctrl.syncOnce()   // push the existing mobile lists
    await desktop.ctrl.syncOnce()  // pull them

    expect(readKey(desktop.storage, 'nexusmd.lists')).toEqual(mobileLists)

    // Each device edits a different item in the same list.
    desktop.storage.setItem('nexusmd.lists', JSON.stringify({ lists: [{ ...mobileLists.lists[0], items: [{ id: '1', title: 'oat milk' }, { id: '2', title: 'eggs' }] }] }))
    mobile.storage.setItem('helm.lists', JSON.stringify({ lists: [{ ...mobileLists.lists[0], items: [{ id: '1', title: 'milk' }, { id: '2', title: 'eggs' }, { id: '3', title: 'bread' }] }] }))

    await desktop.ctrl.syncOnce()  // push desktop edit
    await mobile.ctrl.syncOnce()   // merge with mobile edit, push
    await desktop.ctrl.syncOnce()  // pull merged

    const expected = [{ id: '1', title: 'oat milk' }, { id: '2', title: 'eggs' }, { id: '3', title: 'bread' }]
    const onMobile = readKey(mobile.storage, 'helm.lists')
    const onDesktop = readKey(desktop.storage, 'nexusmd.lists')
    expect(onMobile.lists).toHaveLength(1)
    expect(onMobile.lists[0].items).toEqual(expected)
    expect(onDesktop).toEqual(onMobile)
  })
})
