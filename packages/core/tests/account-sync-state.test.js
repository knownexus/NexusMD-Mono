import { describe, it, expect } from 'vitest'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import {
  readSnapshot, resolveTarget, writeLocal, unchangedSince, fingerprint, validValue, hashOf,
} from '../src/modules/account/account-sync-state.js'

const META = 'nexusmd.account.meta'

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    map: m,
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

const noSecure = { get: async () => null, set: async () => {}, remove: async () => {} }

function ctxOf(init = {}, ns = 'nexusmd') {
  const storage = fakeStorage(init)
  const registry = createKeyRegistry({ namespace: ns })
  return { registry, storage, secure: noSecure, metaKey: META }
}

const snapOf = (ctx) => readSnapshot(ctx, null)
const LISTS = 'nexusmd.p.A.lists'
const LID = 'nexusmd:p.A.lists'
const TWEAKS = 'nexusmd.p.A.tweaks'
const TID = 'nexusmd:p.A.tweaks'

describe('account-sync-state: records and fields', () => {
  it('expands a collection into one entry per record', async () => {
    const raw = JSON.stringify({ lists: [{ id: 'l1', name: 'one' }, { id: 'l2', name: 'two' }] })
    const ctx = ctxOf({ [LISTS]: raw })
    const { snap, rawOf } = await snapOf(ctx)
    expect([...snap.keys()].sort()).toEqual([`${LID}#l1`, `${LID}#l2`])
    expect(snap.has(LID)).toBe(false)
    const e = snap.get(`${LID}#l1`)
    expect(e).toMatchObject({ level: 'account', kind: 'record', recordId: 'l1', storageKey: LISTS, raw, auto: false, secret: false })
    expect(e.value).toBe('{"id":"l1","name":"one"}')
    expect(rawOf(`${LID}#l1`)).toBe(raw)
    // a root-array collection, numeric ids
    const notes = 'nexusmd.p.A.planner.globalNotes'
    const s2 = (await snapOf(ctxOf({ [notes]: JSON.stringify([{ id: 7, text: 'x' }]) }))).snap
    expect(s2.get('nexusmd:p.A.planner.globalNotes#7')).toMatchObject({ kind: 'record', recordId: '7' })
  })

  it('serialises a record with keys sorted recursively, so the same record hashes the same anywhere', async () => {
    const a = await snapOf(ctxOf({ [LISTS]: JSON.stringify({ lists: [{ name: 'n', id: 'l1', meta: { z: 1, a: [{ y: 2, b: 3 }] } }] }) }))
    const b = await snapOf(ctxOf({ [LISTS]: JSON.stringify({ lists: [{ id: 'l1', meta: { a: [{ b: 3, y: 2 }], z: 1 }, name: 'n' }] }) }))
    const ea = a.snap.get(`${LID}#l1`)
    const eb = b.snap.get(`${LID}#l1`)
    expect(ea.value).toBe('{"id":"l1","meta":{"a":[{"b":3,"y":2}],"z":1},"name":"n"}')
    expect(ea.value).toBe(eb.value)
    expect(ea.hash).toBe(eb.hash)
    expect(ea.hash).toBe(await fingerprint(resolveTarget(createKeyRegistry({ namespace: 'nexusmd' }), `${LID}#l1`), ea.value, null))
  })

  it('resolves record and field ids at the first #, and nothing else', () => {
    const registry = createKeyRegistry({ namespace: 'nexusmd' })
    expect(resolveTarget(registry, `${LID}#l1`)).toEqual({ kind: 'record', key: LISTS, path: 'lists', recordId: 'l1', level: 'account', auto: false })
    expect(resolveTarget(registry, `${LID}#a#b`)).toMatchObject({ kind: 'record', recordId: 'a#b' })
    expect(resolveTarget(registry, 'nexusmd:p.A.planner.globalNotes#n1')).toMatchObject({ kind: 'record', key: 'nexusmd.p.A.planner.globalNotes', path: null })
    expect(resolveTarget(registry, `${TID}#theme`)).toEqual({ kind: 'field', key: TWEAKS, field: 'theme', level: 'account', auto: false })
    expect(resolveTarget(registry, `${TID}#sidebarCollapsed`)).toMatchObject({ kind: 'field', auto: true })
    expect(resolveTarget(registry, `${TID}#__proto__`)).toBeNull()
    expect(resolveTarget(registry, `${LID}#`)).toBeNull()
    expect(resolveTarget(registry, LID)).toBeNull() // the container itself is not an item
    expect(resolveTarget(registry, TID)).toBeNull()
    expect(resolveTarget(registry, 'nexusmd:p.A.team.custom#x')).toBeNull() // a plain key has no records
    expect(resolveTarget(registry, 'nexusmd:p.A.team.custom')).toEqual({ kind: 'plain', key: 'nexusmd.p.A.team.custom', level: 'account' })
    expect(resolveTarget(registry, 'p.A.ado.pat')).toMatchObject({ kind: 'secret' })
  })

  it('writes a remote record in place and keeps the others and their order', async () => {
    const ctx = ctxOf({ [LISTS]: JSON.stringify({ lists: [{ id: 'l1', n: 1 }, { id: 'l2', n: 2 }, { id: 'l3', n: 3 }], other: 'kept' }) })
    const target = resolveTarget(ctx.registry, `${LID}#l2`)
    expect(validValue(target, '{"id":"l2","n":20}')).toBe(true)
    expect(await writeLocal(ctx, target, '{"id":"l2","n":20}', false)).toBe(true)
    expect(JSON.parse(ctx.storage.getItem(LISTS))).toEqual({ lists: [{ id: 'l1', n: 1 }, { id: 'l2', n: 20 }, { id: 'l3', n: 3 }], other: 'kept' })
    // the same value again changes nothing
    expect(await writeLocal(ctx, target, '{"n":20,"id":"l2"}', false)).toBe(false)
  })

  it('appends a new remote record; deleting removes only that record', async () => {
    const ctx = ctxOf({ [LISTS]: JSON.stringify({ lists: [{ id: 'l1' }, { id: 'l2' }] }) })
    const t3 = resolveTarget(ctx.registry, `${LID}#l3`)
    expect(await writeLocal(ctx, t3, '{"id":"l3"}', false)).toBe(true)
    expect(JSON.parse(ctx.storage.getItem(LISTS)).lists.map((r) => r.id)).toEqual(['l1', 'l2', 'l3'])
    expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), null, true)).toBe(true)
    expect(JSON.parse(ctx.storage.getItem(LISTS)).lists.map((r) => r.id)).toEqual(['l2', 'l3'])
    expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#nope`), null, true)).toBe(false)
    // deleting the last record keeps the key
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l2`), null, true)
    await writeLocal(ctx, t3, null, true)
    expect(JSON.parse(ctx.storage.getItem(LISTS))).toEqual({ lists: [] })
  })

  it('creates the container when a remote record arrives for an absent key', async () => {
    const ctx = ctxOf({})
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), '{"id":"l1"}', false)
    expect(JSON.parse(ctx.storage.getItem(LISTS))).toEqual({ lists: [{ id: 'l1' }] })
    const notes = 'nexusmd:p.A.planner.globalNotes'
    await writeLocal(ctx, resolveTarget(ctx.registry, `${notes}#n1`), '{"id":"n1"}', false)
    expect(JSON.parse(ctx.storage.getItem('nexusmd.p.A.planner.globalNotes'))).toEqual([{ id: 'n1' }])
    expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${notes}#n2`), null, true)).toBe(false)
    const ctx2 = ctxOf({})
    expect(await writeLocal(ctx2, resolveTarget(ctx2.registry, `${LID}#l1`), null, true)).toBe(false)
    expect(ctx2.storage.getItem(LISTS)).toBeNull()
  })

  it('a remote record must be a JSON object carrying the record id', () => {
    const registry = createKeyRegistry({ namespace: 'nexusmd' })
    const t = resolveTarget(registry, `${LID}#l1`)
    expect(validValue(t, '{"id":"l1"}')).toBe(true)
    expect(validValue(t, '{"id":"l2"}')).toBe(false)
    expect(validValue(t, '[{"id":"l1"}]')).toBe(false)
    expect(validValue(t, 'not json')).toBe(false)
    expect(validValue(t, { id: 'l1' })).toBe(false)
    const n = resolveTarget(registry, 'nexusmd:p.A.planner.globalNotes#7')
    expect(validValue(n, '{"id":7}')).toBe(true)
  })

  it('records without an id are left untouched and never pushed', async () => {
    const raw = JSON.stringify({ lists: [{ name: 'no id' }, 'junk', null, { id: 'l1' }, { id: '' }, { id: { x: 1 } }, { id: 'l2' }] })
    const ctx = ctxOf({ [LISTS]: raw })
    const { snap, isUnavailable } = await snapOf(ctx)
    expect([...snap.keys()].sort()).toEqual([`${LID}#l1`, `${LID}#l2`])
    expect(isUnavailable(`${LID}#l1`)).toBe(false)
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), '{"id":"l1","v":2}', false)
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l2`), null, true)
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l9`), '{"id":"l9"}', false)
    expect(JSON.parse(ctx.storage.getItem(LISTS)).lists).toEqual([{ name: 'no id' }, 'junk', null, { id: 'l1', v: 2 }, { id: '' }, { id: { x: 1 } }, { id: 'l9' }])
  })

  it('a collection key that is not valid JSON or has the wrong shape makes its records unavailable, not deleted', async () => {
    for (const bad of ['{not json', JSON.stringify([{ id: 'l1' }]), JSON.stringify({ lists: { id: 'l1' } }), '42', 'null']) {
      const ctx = ctxOf({ [LISTS]: bad, 'nexusmd.p.A.ado.org': 'org' })
      const { snap, isUnavailable, isUnreadable, rawOf } = await snapOf(ctx)
      expect([...snap.keys()]).toEqual(['p.A.ado.org'])
      expect(isUnavailable(`${LID}#l1`)).toBe(true)
      expect(isUnreadable(`${LID}#anything`)).toBe(true)
      expect(isUnavailable('nexusmd:p.A.timelog.v1#e1')).toBe(false)
      expect(rawOf(`${LID}#l1`)).toBe(bad)
      // a write never destroys what it cannot read
      expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), '{"id":"l1"}', false)).toBe(false)
      expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), null, true)).toBe(false)
      expect(ctx.storage.getItem(LISTS)).toBe(bad)
    }
    // a root-array collection holding an object is the wrong shape too
    const notes = 'nexusmd.p.A.planner.globalNotes'
    const s = await snapOf(ctxOf({ [notes]: JSON.stringify({ id: 'n1' }) }))
    expect(s.isUnavailable('nexusmd:p.A.planner.globalNotes#n1')).toBe(true)
    // a container object without the property yet holds no records (and is readable)
    const empty = await snapOf(ctxOf({ [LISTS]: JSON.stringify({ version: 2 }) }))
    expect(empty.snap.size).toBe(0)
    expect(empty.isUnavailable(`${LID}#l1`)).toBe(false)
  })

  it('duplicate record ids: the first wins, the duplicate is kept locally but not synced', async () => {
    const ctx = ctxOf({ [LISTS]: JSON.stringify({ lists: [{ id: 'l1', v: 'first' }, { id: 'l2' }, { id: 'l1', v: 'dup' }] }) })
    const { snap } = await snapOf(ctx)
    expect([...snap.keys()].sort()).toEqual([`${LID}#l1`, `${LID}#l2`])
    expect(JSON.parse(snap.get(`${LID}#l1`).value).v).toBe('first')
    await writeLocal(ctx, resolveTarget(ctx.registry, `${LID}#l1`), '{"id":"l1","v":"remote"}', false)
    expect(JSON.parse(ctx.storage.getItem(LISTS)).lists).toEqual([{ id: 'l1', v: 'remote' }, { id: 'l2' }, { id: 'l1', v: 'dup' }])
  })

  it('tweaks expands to one entry per field; writing a field keeps the other fields', async () => {
    const raw = JSON.stringify({ theme: 'dark', widgets: ['a', 'b'], layout: { b: 1, a: 2 }, sidebarCollapsed: true })
    const ctx = ctxOf({ [TWEAKS]: raw })
    const { snap, rawOf } = await snapOf(ctx)
    expect([...snap.keys()].sort()).toEqual([`${TID}#layout`, `${TID}#sidebarCollapsed`, `${TID}#theme`, `${TID}#widgets`])
    expect(snap.get(`${TID}#theme`)).toMatchObject({ level: 'account', kind: 'field', field: 'theme', value: '"dark"', raw, storageKey: TWEAKS, auto: false })
    expect(snap.get(`${TID}#layout`).value).toBe('{"a":2,"b":1}')
    expect(snap.get(`${TID}#sidebarCollapsed`).auto).toBe(true)
    expect(rawOf(`${TID}#notYetThere`)).toBe(raw)
    const t = resolveTarget(ctx.registry, `${TID}#theme`)
    expect(validValue(t, '"light"')).toBe(true)
    expect(validValue(t, 'nope')).toBe(false)
    expect(await writeLocal(ctx, t, '"light"', false)).toBe(true)
    expect(JSON.parse(ctx.storage.getItem(TWEAKS))).toEqual({ theme: 'light', widgets: ['a', 'b'], layout: { b: 1, a: 2 }, sidebarCollapsed: true })
    expect(await writeLocal(ctx, t, '"light"', false)).toBe(false)
    expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${TID}#widgets`), null, true)).toBe(true)
    expect(JSON.parse(ctx.storage.getItem(TWEAKS))).toEqual({ theme: 'light', layout: { b: 1, a: 2 }, sidebarCollapsed: true })
    expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${TID}#widgets`), null, true)).toBe(false)
    // absent tweaks key: a remote field creates it
    const fresh = ctxOf({})
    await writeLocal(fresh, resolveTarget(fresh.registry, `${TID}#theme`), '"dim"', false)
    expect(JSON.parse(fresh.storage.getItem(TWEAKS))).toEqual({ theme: 'dim' })
  })

  it('unreadable tweaks make every field unavailable and are never overwritten', async () => {
    for (const bad of ['{oops', '[1,2]', '"str"']) {
      const ctx = ctxOf({ [TWEAKS]: bad })
      const { snap, isUnavailable } = await snapOf(ctx)
      expect(snap.size).toBe(0)
      expect(isUnavailable(`${TID}#theme`)).toBe(true)
      expect(await writeLocal(ctx, resolveTarget(ctx.registry, `${TID}#theme`), '"x"', false)).toBe(false)
      expect(ctx.storage.getItem(TWEAKS)).toBe(bad)
    }
  })

  it('the write-race check compares the whole container raw, and follows this device\'s own writes', async () => {
    const raw = JSON.stringify({ lists: [{ id: 'l1' }] })
    const ctx = ctxOf({ [LISTS]: raw })
    const state = await snapOf(ctx)
    const t2 = resolveTarget(ctx.registry, `${LID}#l2`)
    const t3 = resolveTarget(ctx.registry, `${LID}#l3`)
    expect(await unchangedSince(ctx, t2, state.rawOf(`${LID}#l2`))).toBe(true)
    await writeLocal(ctx, t2, '{"id":"l2"}', false)
    state.noteWritten(t2)
    expect(await unchangedSince(ctx, t3, state.rawOf(`${LID}#l3`))).toBe(true)
    // an edit by the app since then is a race
    ctx.storage.setItem(LISTS, JSON.stringify({ lists: [{ id: 'l1', v: 1 }] }))
    expect(await unchangedSince(ctx, t3, state.rawOf(`${LID}#l3`))).toBe(false)
  })

  it('a timelog entry carries its collection\'s path and hashes like the plain helper', async () => {
    const ctx = ctxOf({ 'nexusmd.p.A.timelog.v1': JSON.stringify({ entries: [{ id: 'e1', mins: 30 }], v: 1 }) })
    const { snap } = await snapOf(ctx)
    const e = snap.get('nexusmd:p.A.timelog.v1#e1')
    expect(e.hash).toBe(hashOf('{"id":"e1","mins":30}'))
    expect(resolveTarget(ctx.registry, 'nexusmd:p.A.timelog.v1#e1')).toMatchObject({ path: 'entries' })
  })

  it('helm keeps its split tweaks and plain ids', async () => {
    const ctx = ctxOf({ 'helm.tweaks': JSON.stringify({ theme: 'dark', widgets: ['a'] }), 'helm.p.1.lists': '{"lists":[{"id":"x"}]}' }, 'helm')
    const { snap } = await snapOf(ctx)
    expect(snap.get('tweaks.account')).toMatchObject({ half: 'account', value: { theme: 'dark' } })
    expect([...snap.keys()].some((id) => id.includes('#'))).toBe(false)
    expect(resolveTarget(ctx.registry, 'tweaks.account')).toEqual({ kind: 'tweaks', key: 'helm.tweaks', half: 'account', level: 'account' })
  })
})
