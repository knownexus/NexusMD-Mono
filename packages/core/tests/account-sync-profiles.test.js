// Profile lifecycle in sync (Profiles that sync everything, Task 5): soft delete, restore, purge.
import { describe, it, expect, vi } from 'vitest'
import { generateContainerKey } from '../src/modules/account/crypto.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { purgeProfileLocal } from '../src/modules/account/account-clear.js'
import { fakeServer, fakeStorage, fakeSecure, decryptAll, device } from './helpers/account-fakes.js'

const PROFILES = 'nexusmd.profiles'
const profilesOf = (d) => JSON.parse(d.storage.getItem(PROFILES) || '[]')
const setProfiles = (d, list) => d.storage.setItem(PROFILES, JSON.stringify(list))
const P = (id, extra = {}) => ({ id, name: id === 'W' ? 'Work' : 'Home', updatedAt: 100, deletedAt: null, purgedAt: null, ...extra })
const ORG = 'nexusmd.p.W.ado.org'
const DOCS = 'nexusmd.p.W.md_documents'

/** a and b in sync with profiles W and H, W holding a setting, a document and a token. */
async function pair() {
  const srv = fakeServer()
  const ck = await generateContainerKey()
  const a = device({
    srv, ck,
    init: { [PROFILES]: JSON.stringify([P('W'), P('H')]), [ORG]: 'acme', [DOCS]: JSON.stringify({ docs: [{ id: 'd1', name: 'n' }] }) },
    secrets: { 'nexusmd.p.W.ado.pat': 'pat-W' },
  })
  await a.sync.syncNow()
  const b = device({ srv, ck, deviceId: 'dev-b' })
  await b.sync.syncNow()
  expect(b.storage.getItem(ORG)).toBe('acme')
  return { srv, ck, a, b }
}

describe('mergeProfiles (desktop)', () => {
  const merge = createKeyRegistry({ namespace: 'nexusmd' }).mergers.profiles
  it('the record with the larger updatedAt wins, whichever side it is on', () => {
    const local = [P('W', { name: 'Old', updatedAt: 300 })]
    const remote = [P('W', { name: 'New', updatedAt: 200, deletedAt: 200 })]
    expect(merge(local, remote)).toEqual([P('W', { name: 'Old', updatedAt: 300 })])
    expect(merge(remote, local)).toEqual([P('W', { name: 'Old', updatedAt: 300 })])
  })
  it('a purged record always wins and keeps no data', () => {
    const tomb = { id: 'W', name: 'Work', updatedAt: 100, deletedAt: 90, purgedAt: 100 }
    const live = P('W', { updatedAt: 999, color: '#f00', config: { x: 1 } })
    expect(merge([live], [{ ...tomb, color: '#000' }])).toEqual([tomb])
    expect(merge([tomb], [live])).toEqual([tomb])
  })
  it('records without updatedAt keep the Milestone 1 field merge, the later list winning', () => {
    expect(merge([{ id: 'W', name: 'A', color: 1 }], [{ id: 'W', name: 'B' }])).toEqual([{ id: 'W', name: 'B', color: 1 }])
  })
  it('Android (helm) keeps the Milestone 1 union merge', () => {
    const helm = createKeyRegistry({ namespace: 'helm' }).mergers.profiles
    expect(helm([{ id: 'W', name: 'A', updatedAt: 300 }], [{ id: 'W', name: 'B', updatedAt: 1 }])).toEqual([{ id: 'W', name: 'B', updatedAt: 1 }])
  })
})

describe('purgeProfileLocal', () => {
  it('removes the profile\'s keys and secrets, nothing else', async () => {
    const storage = fakeStorage({ 'nexusmd.p.W.a': '1', 'nexusmd.p.WX.a': '2', 'nexusmd.p.H.a': '3', 'nexusmd.profiles': '[]' })
    const secure = fakeSecure(storage, 'nexusmd', { 'nexusmd.p.W.ado.pat': 't', 'nexusmd.p.H.ado.pat': 'h' })
    await purgeProfileLocal({ storage, secure, namespace: 'nexusmd', pid: 'W' })
    expect([...storage.map.keys()].sort()).toEqual(['nexusmd.p.H.a', 'nexusmd.p.WX.a', 'nexusmd.profiles', 'nexusmd.sec.nexusmd.p.H.ado.pat'])
    expect(secure.vals.has('nexusmd.p.W.ado.pat')).toBe(false)
    expect(secure.vals.get('nexusmd.p.H.ado.pat')).toBe('h')
  })
})

describe('profile lifecycle in sync', () => {
  it('soft delete syncs: deletedAt set on A appears on B and the profile\'s items keep syncing', async () => {
    const { a, b } = await pair()
    setProfiles(a, [P('W', { deletedAt: 500, updatedAt: 500 }), P('H')])
    a.storage.setItem(ORG, 'acme-2')
    await a.sync.syncNow()
    await b.sync.syncNow()
    expect(profilesOf(b).find(p => p.id === 'W').deletedAt).toBe(500)
    expect(b.storage.getItem(ORG)).toBe('acme-2')
  })

  it('restore (deletedAt null with a newer updatedAt) syncs back', async () => {
    const { a, b } = await pair()
    setProfiles(a, [P('W', { deletedAt: 500, updatedAt: 500 }), P('H')])
    await a.sync.syncNow()
    await b.sync.syncNow()
    setProfiles(b, [P('W', { deletedAt: null, updatedAt: 600 }), P('H')])
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(profilesOf(a).find(p => p.id === 'W')).toMatchObject({ deletedAt: null, updatedAt: 600 })
  })

  it('the union merge no longer resurrects a deleted profile', async () => {
    const { a, b } = await pair()
    setProfiles(b, [P('W', { name: 'Renamed earlier', updatedAt: 150 }), P('H')]) // an older offline rename
    await b.sync.observe()
    setProfiles(a, [P('W', { deletedAt: 500, updatedAt: 500 }), P('H')])
    await a.sync.syncNow()
    await b.sync.syncNow()
    await a.sync.syncNow()
    for (const d of [a, b]) expect(profilesOf(d).find(p => p.id === 'W').deletedAt).toBe(500)
  })

  it('purge tombstones every item of the profile on the server and removes local keys and secrets', async () => {
    const { srv, ck, a, b } = await pair()
    expect(await a.sync.purgeProfile('W')).toEqual({})
    const stored = await decryptAll(srv, ck)
    const ofW = Object.values(stored).filter(p => /p\.W\./.test(p.id))
    expect(ofW.length).toBeGreaterThanOrEqual(3) // setting, document, token
    for (const p of ofW) expect(p.deleted, p.id).toBe(true)
    expect([...a.storage.map.keys()].filter(k => k.startsWith('nexusmd.p.W.') || k.startsWith('nexusmd.sec.nexusmd.p.W.'))).toEqual([])
    expect(a.secure.vals.has('nexusmd.p.W.ado.pat')).toBe(false)
    expect(profilesOf(a).find(p => p.id === 'W')).toMatchObject({ id: 'W', purgedAt: expect.any(Number) })
    expect(profilesOf(a).find(p => p.id === 'W').config).toBeUndefined()
    // b, with nothing unpushed for W, purges during the pull
    await b.sync.syncNow()
    expect(b.sync.pendingPurges()).toEqual([])
    expect([...b.storage.map.keys()].filter(k => k.startsWith('nexusmd.p.W.') || k.startsWith('nexusmd.sec.nexusmd.p.W.'))).toEqual([])
    expect(b.secure.vals.has('nexusmd.p.W.ado.pat')).toBe(false)
    expect(profilesOf(b).find(p => p.id === 'W').purgedAt).toEqual(expect.any(Number))
    expect(profilesOf(b).find(p => p.id === 'H')).toMatchObject({ purgedAt: null })
  })

  it('purge on A while B has unpushed edits for that profile: B keeps the data and reports a pending purge until confirmPurge', async () => {
    const { srv, ck, a, b } = await pair()
    b.storage.setItem(ORG, 'edited offline on B')
    await b.sync.observe()
    await a.sync.purgeProfile('W')
    const cb = vi.fn()
    b.sync.onPendingPurge(cb)
    await b.sync.syncNow()
    expect(b.storage.getItem(ORG)).toBe('edited offline on B') // nothing discarded yet
    expect(b.sync.pendingPurges()).toEqual([{ pid: 'W', name: 'Work', unpushed: ['p.W.ado.org'] }])
    expect(cb).toHaveBeenCalledWith({ count: 1 })
    expect(b.sync.conflicts()).toEqual([]) // a purge is not a conflict
    expect((await decryptAll(srv, ck))['p.W.ado.org'].deleted).toBe(true) // and B never resurrects it
    await b.sync.syncNow()
    expect((await decryptAll(srv, ck))['p.W.ado.org'].deleted).toBe(true)
    expect(await b.sync.confirmPurge('W')).toEqual({})
    expect(b.storage.getItem(ORG)).toBeNull()
    expect(b.storage.getItem(DOCS)).toBeNull()
    expect(b.secure.vals.has('nexusmd.p.W.ado.pat')).toBe(false)
    expect(b.sync.pendingPurges()).toEqual([])
  })

  it('a purged profile id is never re-created by an old record', async () => {
    const { srv, ck, a, b } = await pair()
    await a.sync.purgeProfile('W')
    // b still holds the old live record and edits it (a newer updatedAt) before it next syncs
    setProfiles(b, [P('W', { name: 'Edited', updatedAt: 10 ** 12 }), P('H')])
    await b.sync.syncNow()
    await a.sync.syncNow()
    for (const d of [a, b]) expect(profilesOf(d).find(p => p.id === 'W').purgedAt).toEqual(expect.any(Number))
    const stored = await decryptAll(srv, ck)
    expect(JSON.parse(stored.profiles.value).find(p => p.id === 'W').purgedAt).toEqual(expect.any(Number))
  })
})
