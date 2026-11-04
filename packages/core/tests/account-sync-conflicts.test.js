// Conflict queue (Profiles that sync everything, Task 4): on the desktop, a value the owner edits
// that changed on two devices is parked for the owner instead of last-writer-wins.
import { describe, it, expect, vi } from 'vitest'
import { generateContainerKey } from '../src/modules/account/crypto.js'
import { createAccountSync } from '../src/modules/account/account-sync.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { fakeServer, decryptAll, device, META } from './helpers/account-fakes.js'

const D = 'nexusmd.p.A.md_documents'
const N1 = 'nexusmd:p.A.md_documents#n1'
const docsOf = (d, key = D) => JSON.parse(d.storage.getItem(key) || '{"docs":[]}').docs
const setDocs = (d, docs, key = D) => d.storage.setItem(key, JSON.stringify({ docs }))
const doc = (id, content, name = id) => ({ id, name, content })
const serverValue = async (srv, ck, id) => {
  const p = (await decryptAll(srv, ck))[id]
  return p && !p.deleted ? JSON.parse(p.value) : p ? 'deleted' : undefined
}

/** a and b in sync on n1, then each edits n1; a syncs first, so b holds the conflict. */
async function conflictPair() {
  const srv = fakeServer()
  const ck = await generateContainerKey()
  const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'base')] }) } })
  await a.sync.syncNow()
  const b = device({ srv, ck, deviceId: 'dev-b' })
  await b.sync.syncNow()
  expect(docsOf(b)).toEqual([doc('n1', 'base')])
  setDocs(a, [doc('n1', 'from A')])
  await a.sync.syncNow()
  setDocs(b, [doc('n1', 'from B')])
  await b.sync.syncNow()
  return { srv, ck, a, b }
}

describe('conflict queue', () => {
  it('different records edited on two devices both survive', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'one')] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [D]: JSON.stringify({ docs: [doc('n2', 'two')] }) } })
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(docsOf(a)).toEqual([doc('n1', 'one'), doc('n2', 'two')])
    expect(docsOf(b)).toEqual([doc('n2', 'two'), doc('n1', 'one')])
    expect(a.sync.conflicts()).toEqual([])
    expect(b.sync.conflicts()).toEqual([])
  })

  it('the same record edited on both devices becomes one conflict on the second to sync; neither value is lost', async () => {
    const { srv, ck, a, b } = await conflictPair()
    const list = b.sync.conflicts()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: N1, profileId: 'A', kind: 'record', local: { deleted: false }, remote: { deleted: false } })
    expect(JSON.parse(list[0].local.value)).toEqual(doc('n1', 'from B'))
    expect(JSON.parse(list[0].remote.value)).toEqual(doc('n1', 'from A'))
    expect(Number.isInteger(list[0].remote.revision)).toBe(true)
    expect(typeof list[0].detectedAt).toBe('number')
    expect(docsOf(b)).toEqual([doc('n1', 'from B')])
    expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'from A'))
    expect(a.sync.conflicts()).toEqual([])
  })

  it('first sync after upgrade: local notes the server never saw, with different content under the same id, conflict instead of being overwritten', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'X')] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [D]: JSON.stringify({ docs: [doc('n1', 'Y')] }) } })
    await b.sync.syncNow()
    expect(docsOf(b)).toEqual([doc('n1', 'Y')])
    expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'X'))
    expect(b.sync.conflicts().map(c => c.id)).toEqual([N1])
  })

  it('first sync: identical values are adopted without a conflict', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'X')] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [D]: JSON.stringify({ docs: [{ content: 'X', name: 'n1', id: 'n1' }] }) } })
    const before = srv.putCalls
    await b.sync.syncNow()
    expect(b.sync.conflicts()).toEqual([])
    expect(srv.putCalls).toBe(before) // nothing to push
    expect(JSON.parse(b.storage.getItem(META)).entries[N1].revision).toBe(1)
  })

  it('a former device-level tweak field differing at first sync adopts the server value silently', async () => {
    const T = 'nexusmd.p.A.tweaks'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [T]: JSON.stringify({ fontScale: 1.2, theme: 'dark' }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [T]: JSON.stringify({ fontScale: 1, theme: 'light' }) } })
    await b.sync.syncNow()
    const tweaks = JSON.parse(b.storage.getItem(T))
    expect(tweaks.fontScale).toBe(1.2) // was per device in M1: the server's view setting is adopted
    expect(tweaks.theme).toBe('light') // an account field the owner set: a conflict, kept
    expect(b.sync.conflicts().map(c => [c.id, c.kind])).toEqual([['nexusmd:p.A.tweaks#theme', 'field']])
  })

  it('record deleted on A and edited on B is a conflict on whichever syncs second', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'base'), doc('n2', 'keep')] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    setDocs(a, [doc('n2', 'keep')])
    await a.sync.syncNow()
    expect(await serverValue(srv, ck, N1)).toBe('deleted')
    setDocs(b, [doc('n1', 'edited'), doc('n2', 'keep')])
    await b.sync.syncNow()
    expect(docsOf(b)).toEqual([doc('n1', 'edited'), doc('n2', 'keep')]) // not lost
    expect(await serverValue(srv, ck, N1)).toBe('deleted') // not resurrected either
    const [c] = b.sync.conflicts()
    expect(c).toMatchObject({ id: N1, local: { deleted: false }, remote: { deleted: true, value: null } })

    // the other order: B deletes, A (which edited) syncs second
    const a2 = device({ srv, ck, deviceId: 'dev-c' })
    await a2.sync.syncNow()
    const N2 = 'nexusmd:p.A.md_documents#n2'
    setDocs(a2, [doc('n2', 'edited on C')])
    setDocs(b, [doc('n1', 'edited')])
    await b.sync.syncNow() // pushes n2's deletion
    await a2.sync.syncNow()
    expect(docsOf(a2)).toEqual([doc('n2', 'edited on C')])
    expect(a2.sync.conflicts()).toMatchObject([{ id: N2, local: { deleted: false }, remote: { deleted: true } }])
  })

  it('machine-written values (github.auth) resolve newest-wins without a conflict', async () => {
    const S = 'nexusmd.p.A.github.auth'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { [S]: '{"t":"a0"}' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.secure.vals.get(S)).toBe('{"t":"a0"}')
    await a.secure.set(S, '{"t":"a1"}')
    await a.sync.syncNow()
    await b.secure.set(S, '{"t":"b1"}')
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(a.sync.conflicts()).toEqual([])
    expect(b.sync.conflicts()).toEqual([])
    expect(a.secure.vals.get(S)).toBe(b.secure.vals.get(S))
  })

  it('a token conflict never stores either value in plain localStorage; take remote writes it to secure storage', async () => {
    const S = 'nexusmd.p.A.ado.pat'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { [S]: 'pat-base' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    await a.secure.set(S, 'pat-from-A')
    await a.sync.syncNow()
    await b.secure.set(S, 'pat-from-B')
    await b.sync.syncNow()
    const [c] = b.sync.conflicts()
    expect(c).toMatchObject({ kind: 'secret', profileId: 'A', local: { value: null }, remote: { value: null } })
    const plain = [...b.storage.map.values()].join('\n')
    expect(plain).not.toContain('pat-from-A')
    expect(plain).not.toContain('pat-from-B')
    expect(await b.sync.resolve(c.id, { take: 'remote' })).toEqual({})
    expect(b.secure.vals.get(S)).toBe('pat-from-A')
    expect(b.sync.conflicts()).toEqual([])
  })

  describe('resolve', () => {
    it('take remote writes the server value, pushes nothing and clears the conflict', async () => {
      const { srv, b } = await conflictPair()
      const before = srv.putCalls
      expect(await b.sync.resolve(N1, { take: 'remote' })).toEqual({})
      expect(docsOf(b)).toEqual([doc('n1', 'from A')])
      expect(b.sync.conflicts()).toEqual([])
      expect(srv.putCalls).toBe(before) // the server already holds it
      expect((await b.sync.syncNow()).pushed).toBe(0)
    })

    it('take local pushes once over the stored revision and clears the conflict', async () => {
      const { srv, ck, a, b } = await conflictPair()
      const before = srv.putCalls
      expect(await b.sync.resolve(N1, { take: 'local' })).toEqual({})
      expect(srv.putCalls).toBe(before + 1)
      expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'from B'))
      expect(b.sync.conflicts()).toEqual([])
      expect((await b.sync.syncNow()).pushed).toBe(0)
      await a.sync.syncNow()
      expect(docsOf(a)).toEqual([doc('n1', 'from B')])
      expect(a.sync.conflicts()).toEqual([])
    })

    it('a merged value is written locally, pushed once, and clears the conflict', async () => {
      const { srv, ck, a, b } = await conflictPair()
      const merged = JSON.stringify(doc('n1', 'from A\nfrom B'))
      const before = srv.putCalls
      expect(await b.sync.resolve(N1, { value: merged })).toEqual({})
      expect(srv.putCalls).toBe(before + 1)
      expect(docsOf(b)).toEqual([doc('n1', 'from A\nfrom B')])
      expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'from A\nfrom B'))
      expect((await b.sync.syncNow()).pushed).toBe(0)
      await a.sync.syncNow()
      expect(docsOf(a)).toEqual([doc('n1', 'from A\nfrom B')])
    })

    it('a value that does not fit the item is refused and the conflict stays', async () => {
      const { b } = await conflictPair()
      const r = await b.sync.resolve(N1, { value: JSON.stringify({ id: 'other' }) })
      expect(r.error).toBeTruthy()
      expect(b.sync.conflicts()).toHaveLength(1)
    })

    it('when the server moved on again, resolving reports it and the conflict stays for the newer value', async () => {
      const { srv, ck, a, b } = await conflictPair()
      setDocs(a, [doc('n1', 'A again')])
      await a.sync.syncNow()
      const r = await b.sync.resolve(N1, { take: 'local' })
      expect(r.error).toBeTruthy()
      expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'A again'))
      await b.sync.syncNow()
      const [c] = b.sync.conflicts()
      expect(JSON.parse(c.remote.value)).toEqual(doc('n1', 'A again'))
    })
  })

  it('keepBoth adds the remote record as a copy named with the suffix and both records sync', async () => {
    const { srv, ck, a, b } = await conflictPair()
    const copyName = (name) => `${name} (conflicted copy, dev-a, 2026-11-04)`
    expect(await b.sync.keepBoth(N1, { copyName })).toEqual({})
    const docs = docsOf(b)
    expect(docs).toHaveLength(2)
    expect(docs[0]).toEqual(doc('n1', 'from B'))
    expect(docs[1]).toMatchObject({ name: 'n1 (conflicted copy, dev-a, 2026-11-04)', content: 'from A' })
    expect(docs[1].id).toMatch(/^n1-c\d+$/)
    expect(b.sync.conflicts()).toEqual([])
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(docsOf(a)).toEqual([doc('n1', 'from B'), docs[1]])
    expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'from B'))
  })

  it('keepBoth is refused for anything but a record', async () => {
    const T = 'nexusmd.p.A.tweaks'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [T]: JSON.stringify({ theme: 'dark' }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [T]: JSON.stringify({ theme: 'light' }) } })
    await b.sync.syncNow()
    const r = await b.sync.keepBoth('nexusmd:p.A.tweaks#theme', { copyName: (n) => n })
    expect(r.error).toBeTruthy()
    expect(b.sync.conflicts()).toHaveLength(1)
  })

  it('a conflict for profile B resolves into B\'s key while profile A is active, and survives a reload', async () => {
    const DB = 'nexusmd.p.B.md_documents'
    const NB = 'nexusmd:p.B.md_documents#n1'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [DB]: JSON.stringify({ docs: [doc('n1', 'X')] }) } })
    await a.sync.syncNow()
    const b = device({
      srv, ck, deviceId: 'dev-b',
      init: { 'nexusmd.activeProfileId': 'A', [D]: JSON.stringify({ docs: [doc('a1', 'A only')] }), [DB]: JSON.stringify({ docs: [doc('n1', 'Y')] }) },
    })
    await b.sync.syncNow()
    expect(b.sync.conflicts()).toMatchObject([{ id: NB, profileId: 'B' }])
    // a fresh engine over the same storage (an app restart) still has it
    const again = createAccountSync({
      client: srv.client, containerKey: ck, registry: createKeyRegistry({ namespace: 'nexusmd' }),
      storage: b.storage, secure: b.secure, deviceId: 'dev-b', metaKey: META,
    })
    expect(again.conflicts().map(c => c.id)).toEqual([NB])
    expect(await again.resolve(NB, { take: 'remote' })).toEqual({})
    expect(docsOf(b, DB)).toEqual([doc('n1', 'X')])
    expect(docsOf(b)).toEqual([doc('a1', 'A only')])
  })

  it('conflicted ids are not pushed until resolved; other items keep syncing', async () => {
    const { srv, ck, b } = await conflictPair()
    setDocs(b, [doc('n1', 'B again'), doc('n3', 'new')])
    await b.sync.syncNow()
    expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'from A'))
    expect(await serverValue(srv, ck, 'nexusmd:p.A.md_documents#n3')).toEqual(doc('n3', 'new'))
    expect(b.sync.conflicts()).toHaveLength(1)
    // taking local now pushes the latest local value
    await b.sync.resolve(N1, { take: 'local' })
    expect(await serverValue(srv, ck, N1)).toEqual(doc('n1', 'B again'))
  })

  it('a conflict clears on its own when the two sides become identical', async () => {
    const { a, b } = await conflictPair()
    setDocs(a, [doc('n1', 'from B')])
    await a.sync.syncNow()
    await b.sync.syncNow()
    expect(b.sync.conflicts()).toEqual([])
    expect((await b.sync.syncNow()).pushed).toBe(0)
  })

  it('onConflict reports the queue size when it grows', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: JSON.stringify({ docs: [doc('n1', 'X'), doc('n2', 'X')] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [D]: JSON.stringify({ docs: [doc('n1', 'Y'), doc('n2', 'Y')] }) } })
    const cb = vi.fn()
    const off = b.sync.onConflict(cb)
    await b.sync.syncNow()
    expect(cb).toHaveBeenCalledWith({ count: 2 })
    off()
    cb.mockClear()
    await b.sync.syncNow()
    expect(cb).not.toHaveBeenCalled()
  })

  it('Android (helm) keeps newest-wins: no conflicts are raised', async () => {
    const H = 'helm.p.1.lists'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const getActiveProfileId = () => '1'
    const a = device({ srv, ck, ns: 'helm', getActiveProfileId, init: { 'helm.activeProfileId': '1', [H]: '[{"id":"x","v":1}]' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, ns: 'helm', deviceId: 'dev-b', getActiveProfileId, init: { 'helm.activeProfileId': '1' } })
    await b.sync.syncNow()
    a.storage.setItem(H, '[{"id":"x","v":2}]')
    await a.sync.syncNow()
    b.storage.setItem(H, '[{"id":"x","v":3}]')
    await b.sync.syncNow()
    expect(b.sync.conflicts()).toEqual([])
  })
})
