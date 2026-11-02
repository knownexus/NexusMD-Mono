import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAccountSync } from '../src/modules/account/account-sync.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { AccountError } from '../src/modules/account/account-client.js'
import { generateContainerKey, encryptJson, decryptJson, opaqueId } from '../src/modules/account/crypto.js'
import { contentHash } from '../src/modules/sync/hash.js'
import * as core from '../src/index.js'

const META = 'nexusmd.account.meta'

// ---- fakes -------------------------------------------------------------------------------

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

// Mirrors the real adapter: values live elsewhere, `<ns>.sec.<name>` holds an opaque blob.
function fakeSecure(storage, ns = 'nexusmd', init = {}) {
  const vals = new Map()
  const s = {
    vals,
    get: vi.fn(async (name) => (vals.has(name) ? vals.get(name) : null)),
    set: vi.fn(async (name, v) => { vals.set(name, v); storage.setItem(`${ns}.sec.${name}`, 'opaque-blob') }),
    remove: vi.fn(async (name) => { vals.delete(name); storage.removeItem(`${ns}.sec.${name}`) }),
  }
  for (const [k, v] of Object.entries(init)) { vals.set(k, v); storage.setItem(`${ns}.sec.${k}`, 'opaque-blob') }
  return s
}

// In-memory server honouring revisions and cursors (task 5 API shape).
// Pages are bounded by `limit` and by a byte budget (`pageBytes`, at least one item per page),
// and say `hasMore` (Ruling 18) unless `legacy` emulates a server from before that field.
// `quotaBytes` is a per-user storage quota answered with the 'quota' item status.
function fakeServer({ maxBytes = Infinity, pageBytes = Infinity, legacy = false, quotaBytes = Infinity } = {}) {
  const items = new Map()
  const prefs = new Map()
  let cursor = 0
  const stored = () => [...items.values()].reduce((n, i) => n + (i.ciphertext || '').length, 0)
  const srv = {
    items, prefs, requests: [], fail: null, putCalls: 0, changesCalls: 0,
    tamper: null,
    check() {
      if (srv.fail) throw new AccountError(srv.fail, srv.fail === 'session-expired' ? 401 : 0)
    },
    client: {
      async putItems(list) {
        srv.check()
        srv.putCalls++
        srv.requests.push(JSON.stringify(list))
        return list.map((i) => {
          const cur = items.get(i.id)
          const rev = cur ? cur.revision : 0
          if (i.ifMatch !== rev) return { id: i.id, status: 'conflict' }
          if ((i.ciphertext || '').length > maxBytes) return { id: i.id, status: 'too_large' }
          if (stored() - (cur ? (cur.ciphertext || '').length : 0) + (i.ciphertext || '').length > quotaBytes) {
            return { id: i.id, status: 'quota' }
          }
          const next = { id: i.id, revision: rev + 1, cursor: ++cursor, ciphertext: i.ciphertext, deleted: !!i.deleted, updatedAt: new Date().toISOString() }
          items.set(i.id, next)
          return { id: i.id, status: 'ok', revision: next.revision, cursor: next.cursor }
        })
      },
      async getChanges(since = 0, limit = 500) {
        srv.check()
        srv.changesCalls++
        const newer = [...items.values()].filter((i) => i.cursor > since).sort((a, b) => a.cursor - b.cursor)
        let list = []
        let bytes = 0
        for (const i of newer) {
          if (list.length >= limit) break
          const size = (i.ciphertext || '').length
          if (list.length && bytes + size > pageBytes) break
          list.push(i)
          bytes += size
        }
        const hasMore = newer.length > list.length
        if (srv.tamper) list = srv.tamper(list)
        const page = { items: list.map((i) => ({ ...i })), cursor: list.length ? list[list.length - 1].cursor : since }
        return legacy ? page : { ...page, hasMore }
      },
      async getDevicePrefs(id) {
        srv.check()
        return prefs.get(id) || { revision: 0, ciphertext: '' }
      },
      async putDevicePrefs(id, ciphertext, revision) {
        srv.check()
        srv.requests.push(JSON.stringify({ id, ciphertext }))
        const cur = prefs.get(id) || { revision: 0 }
        if (revision !== cur.revision) throw new AccountError('conflict', 409)
        const next = { revision: cur.revision + 1, ciphertext }
        prefs.set(id, next)
        return { revision: next.revision }
      },
    },
  }
  return srv
}

async function decryptAll(srv, ck) {
  const out = {}
  for (const it of srv.items.values()) {
    const p = await decryptJson(it.ciphertext, ck, `nexusmd-item|${it.id}`)
    out[p.id] = p
  }
  return out
}

let clock = 1_000_000
function device({ srv, ck, init = {}, secrets = {}, deviceId = 'dev-a', devicePrefs = null, ns = 'nexusmd', now, getActiveProfileId, pageSize }) {
  const storage = fakeStorage(init)
  const secure = fakeSecure(storage, ns, secrets)
  const registry = createKeyRegistry({ namespace: ns, getActiveProfileId })
  const sync = createAccountSync({
    client: srv.client, containerKey: ck, registry, storage, secure, devicePrefs, deviceId,
    metaKey: `${ns}.account.meta`, now: now || (() => (clock += 1000)), pageSize,
  })
  return { storage, secure, sync, registry }
}

const metaOf = (d) => JSON.parse(d.storage.getItem(META) || 'null')

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

// ---- tests -------------------------------------------------------------------------------

describe('createAccountSync', () => {
  it('is exported from the core root', () => {
    expect(typeof core.createAccountSync).toBe('function')
  })

  it('snapshot lists syncable keys via the registry, splits tweaks and reads secrets', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.p.1.ado.org': 'contoso',
        'nexusmd.tweaks': JSON.stringify({ theme: 'dark', widgets: ['a'] }),
        'nexusmd.sidebar.width': '240',
        'nexusmd.planner.week.2026-W40': '{}',
        'nexusmd.account.deviceId': 'dev-a',
      },
      secrets: { 'google.auth': 'tok', 'account.session': 'sess' },
    })
    const snap = await a.sync.snapshot()
    expect(snap.get('p.1.ado.org')).toMatchObject({ level: 'account', value: 'contoso', storageKey: 'nexusmd.p.1.ado.org', secret: false })
    expect(snap.get('tweaks.account')).toMatchObject({ level: 'account', value: { theme: 'dark' } })
    expect(snap.get('tweaks.device')).toMatchObject({ level: 'device', value: { widgets: ['a'] } })
    expect(snap.get('nexusmd:sidebar.width')).toMatchObject({ level: 'device', value: '240' })
    expect(snap.get('sec:nexusmd:google.auth')).toMatchObject({ level: 'account', value: 'tok', secret: true })
    const ids = [...snap.keys()]
    expect(ids.some((id) => id.includes('planner'))).toBe(false)
    expect(ids.filter((id) => id.includes('account'))).toEqual(['tweaks.account'])
  })

  it('first push uploads every account key encrypted; the server never sees plaintext', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.p.1.ado.org': 'contoso-org-value',
        'nexusmd.tweaks': JSON.stringify({ theme: 'midnight-theme', widgets: ['widget-one-value'] }),
        'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'WorkProfileName' }]),
      },
      secrets: { 'google.auth': 'secret-token-value', 'account.session': 'account-session-value' },
    })
    const r = await a.sync.push()
    expect(r.error).toBeUndefined()
    expect(r.pushed).toBe(4)
    const stored = await decryptAll(srv, ck)
    expect(Object.keys(stored).sort()).toEqual(['p.1.ado.org', 'profiles', 'sec:nexusmd:google.auth', 'tweaks.account'])
    expect(stored['p.1.ado.org'].value).toBe('contoso-org-value')
    const wire = srv.requests.join('\n')
    for (const s of ['contoso-org-value', 'midnight-theme', 'WorkProfileName', 'secret-token-value', 'account-session-value',
      'ado.org', 'tweaks', 'profiles', 'google.auth', 'widget-one-value']) {
      expect(wire).not.toContain(s)
    }
  })

  it('an unchanged second push uploads nothing and a changed key uploads once', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'one', 'nexusmd.p.1.github.login': 'me' } })
    await a.sync.push()
    const calls = srv.putCalls
    expect((await a.sync.push()).pushed).toBe(0)
    expect(srv.putCalls).toBe(calls)
    a.storage.setItem('nexusmd.p.1.ado.org', 'two')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await a.sync.push()).pushed).toBe(0)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('two')
  })

  it('a removed key is pushed as a tombstone and the other device removes it', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.ado.pat': 'p' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    a.storage.removeItem('nexusmd.p.1.ado.org')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].deleted).toBe(true)
    const r = await b.sync.pull()
    expect(r.applied).toBe(1)
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
    expect(b.storage.getItem('nexusmd.p.1.ado.pat')).toBe('p')
  })

  it('a locally removed key that was never synced is not tombstoned', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.push()
    a.storage.setItem('nexusmd.p.1.ado.pat', 'never-pushed')
    a.storage.removeItem('nexusmd.p.1.ado.pat')
    expect((await a.sync.push()).pushed).toBe(0)
  })

  it('a remote tombstone is not applied when the local value changed since the last sync', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.removeItem('nexusmd.p.1.ado.org')
    await a.sync.push()
    b.storage.setItem('nexusmd.p.1.ado.org', 'edited-on-b')
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('edited-on-b')
    // and B's edit then resurrects the key on the server
    expect((await b.sync.push()).pushed).toBe(1)
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.ado.org')).toBe('edited-on-b')
  })

  it('two engines converge (A changes, B pulls, B changes later, A pulls)', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.tweaks': JSON.stringify({ theme: 'light', widgets: ['a1'] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.tweaks': JSON.stringify({ widgets: ['b1'] }) } })
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('nexusmd.tweaks'))).toEqual({ theme: 'light', widgets: ['b1'] })

    a.storage.setItem('nexusmd.tweaks', JSON.stringify({ theme: 'dark', widgets: ['a1'] }))
    await a.sync.syncNow()
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('nexusmd.tweaks')).theme).toBe('dark')

    b.storage.setItem('nexusmd.tweaks', JSON.stringify({ theme: 'dim', widgets: ['b1'] }))
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(JSON.parse(a.storage.getItem('nexusmd.tweaks'))).toEqual({ theme: 'dim', widgets: ['a1'] })
  })

  it('first sync on B takes the remote value for shared keys and pushes B-only keys', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'from-a' } })
    await a.sync.seed()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.p.1.ado.org': 'from-b', 'nexusmd.p.1.github.login': 'b-only' } })
    const r = await b.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('from-a')
    const stored = await decryptAll(srv, ck)
    expect(stored['p.1.ado.org'].value).toBe('from-a')
    expect(stored['p.1.github.login'].value).toBe('b-only')
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.github.login')).toBe('b-only')
  })

  describe('last writer wins by the time an edit was first observed', () => {
    const ORG = 'nexusmd.p.1.ado.org'
    async function pair() {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const a = device({ srv, ck, init: { [ORG]: 'base' }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, deviceId: 'dev-b', now })
      await b.sync.syncNow()
      return { srv, ck, a, b, clockRef }
    }

    it('an older offline edit loses to a newer remote edit, everywhere', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.setItem(ORG, 'a-offline-edit')
      srv.fail = 'offline'
      expect((await a.sync.syncNow()).error.code).toBe('offline') // offline, but the edit is observed now
      srv.fail = null
      clockRef.t = 2000
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit')
      expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('b-edit')
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBe('b-edit')
    })

    it('a newer edit wins even when the older edit reaches the server later', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      b.storage.setItem(ORG, 'b-older-edit')
      await b.sync.observe()
      clockRef.t = 2000
      a.storage.setItem(ORG, 'a-newer-edit')
      await a.sync.observe()
      clockRef.t = 2500
      await b.sync.syncNow() // pushes B's edit, stamped 1000
      expect((await decryptAll(srv, ck))['p.1.ado.org'].updatedAt).toBe(1000)
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('a-newer-edit')
      const stored = (await decryptAll(srv, ck))['p.1.ado.org']
      expect(stored.value).toBe('a-newer-edit')
      expect(stored.updatedAt).toBe(2000)
      clockRef.t = 3500
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBe('a-newer-edit')
    })

    it('a tie goes to the remote value', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.setItem(ORG, 'a-edit')
      await a.sync.observe()
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit')
      expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('b-edit')
    })

    it('a local deletion loses to a newer remote edit and beats an older one', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.removeItem(ORG)
      await a.sync.observe()
      clockRef.t = 2000
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit') // restored: the remote edit is newer

      clockRef.t = 4000
      b.storage.setItem(ORG, 'b-older-edit')
      await b.sync.observe()
      clockRef.t = 5000
      a.storage.removeItem(ORG)
      await a.sync.observe()
      clockRef.t = 5500
      await b.sync.syncNow()
      clockRef.t = 6000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBeNull()
      expect((await decryptAll(srv, ck))['p.1.ado.org'].deleted).toBe(true)
      clockRef.t = 6500
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBeNull()
    })

    it('a remote updatedAt far in the future is clamped to now + 5 minutes', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      const skewed = device({ srv, ck, deviceId: 'dev-skew', now: () => clockRef.t + 365 * 24 * 3600 * 1000 })
      await skewed.sync.syncNow()
      skewed.storage.setItem(ORG, 'from-the-future')
      await skewed.sync.syncNow()
      clockRef.t = 1000
      await a.sync.pull()
      expect(a.storage.getItem(ORG)).toBe('from-the-future')
      const m = JSON.parse(a.storage.getItem(META)).entries['p.1.ado.org']
      expect(m.updatedAt).toBe(1000 + 5 * 60 * 1000)
      // a forced re-push does not carry the far-future time on
      await a.sync.seed()
      expect((await decryptAll(srv, ck))['p.1.ado.org'].updatedAt).toBeLessThanOrEqual(1000 + 5 * 60 * 1000)
      expect(b.storage.getItem(ORG)).toBe('base')
    })
  })

  describe('a joining device never overwrites account values', () => {
    for (const op of ['push', 'seed']) {
      it(`${op}() before any pull keeps the remote value and uploads only local-only keys`, async () => {
        const srv = fakeServer()
        const ck = await generateContainerKey()
        const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'from-a' } })
        await a.sync.seed()
        const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.p.1.ado.org': 'from-b', 'nexusmd.p.1.github.login': 'b-only' } })
        const r = await b.sync[op]()
        expect(r.error).toBeUndefined()
        const stored = await decryptAll(srv, ck)
        expect(stored['p.1.ado.org'].value).toBe('from-a')
        expect(stored['p.1.github.login'].value).toBe('b-only')
        expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('from-a')
      })
    }
  })

  it('a stale push conflicts, re-pulls, re-merges and retries once', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'base', 'nexusmd.p.1.ado.pat': 'pat' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem('nexusmd.p.1.ado.pat', 'pat-from-a')
    await a.sync.push()
    b.storage.setItem('nexusmd.p.1.ado.pat', 'pat-from-b')
    const r = await b.sync.push() // B has not pulled A's write: ifMatch is stale
    expect(r.error).toBeUndefined()
    expect(r.conflicts).toBe(0)
    expect(r.pushed).toBe(1)
    expect((await decryptAll(srv, ck))['p.1.ado.pat'].value).toBe('pat-from-b')
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.ado.pat')).toBe('pat-from-b')
  })

  it('quota rejections are reported and not re-sent until the value changes', async () => {
    const srv = fakeServer({ quotaBytes: 400 })
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'small', 'nexusmd.big.blob': 'x'.repeat(300) } })
    const r = await a.sync.push()
    expect(r.pushed).toBe(1)
    expect(r.quota).toEqual(['nexusmd:big.blob'])
    expect(r.tooLarge).toEqual([])
    const calls = srv.putCalls
    const again = await a.sync.syncNow()
    expect(again.pushed).toBe(0)
    expect(again.quota).toEqual(['nexusmd:big.blob'])
    expect(srv.putCalls).toBe(calls)
    a.storage.setItem('nexusmd.big.blob', 'fits')
    const third = await a.sync.push()
    expect(third.pushed).toBe(1)
    expect(third.quota).toEqual([])
  })

  it('too_large items are skipped and reported', async () => {
    const srv = fakeServer({ maxBytes: 300 })
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'small', 'nexusmd.big.blob': 'x'.repeat(1000) } })
    const r = await a.sync.push()
    expect(r.pushed).toBe(1)
    expect(r.tooLarge).toEqual(['nexusmd:big.blob'])
    const calls = srv.putCalls
    const again = await a.sync.syncNow()
    expect(again.pushed).toBe(0)
    expect(again.tooLarge).toEqual(['nexusmd:big.blob']) // still reported, not re-sent
    expect(srv.putCalls).toBe(calls)
    // a new local value is tried again
    a.storage.setItem('nexusmd.big.blob', 'y'.repeat(1000))
    await a.sync.push()
    expect(srv.putCalls).toBe(calls + 1)
    a.storage.setItem('nexusmd.big.blob', 'small now')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await a.sync.push()).tooLarge).toEqual([])
  })

  it('secrets round trip through the secure adapter; account secrets never leave', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 'g-token', 'account.session': 's', 'account.keys': 'k' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.secure.set).toHaveBeenCalledWith('google.auth', 'g-token')
    expect(await b.secure.get('google.auth')).toBe('g-token')
    expect([...b.storage.map.values()].join('|')).not.toContain('g-token') // only the adapter holds it
    expect([...a.storage.map.values()].join('|')).not.toContain('g-token')
    expect(await b.secure.get('account.session')).toBeNull()
    const ids = Object.keys(await decryptAll(srv, ck))
    expect(ids).toEqual(['sec:nexusmd:google.auth'])
    // removal propagates through secure.remove
    await a.secure.remove('google.auth')
    await a.sync.push()
    await b.sync.pull()
    expect(b.secure.remove).toHaveBeenCalledWith('google.auth')
    expect(await b.secure.get('google.auth')).toBeNull()
  })

  it('a secret whose secure entry cannot be read is neither pushed nor tombstoned', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 'g-token' } })
    await a.sync.push()
    a.secure.vals.delete('google.auth') // the blob key is still in storage but get() now fails
    expect((await a.sync.push()).pushed).toBe(0)
    expect((await decryptAll(srv, ck))['sec:nexusmd:google.auth'].deleted).toBeFalsy()
  })

  describe('an unreadable local entry', () => {
    const NAME = 'google.auth'
    async function synced() {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const a = device({ srv, ck, secrets: { [NAME]: 't-old' }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, deviceId: 'dev-b', now })
      await b.sync.syncNow()
      const real = a.secure.get.getMockImplementation()
      const lock = (impl) => a.secure.get.mockImplementation(async (n) => (n === NAME ? impl() : real(n)))
      const unlock = () => a.secure.get.mockImplementation(real)
      return { srv, ck, a, b, clockRef, lock, unlock }
    }

    it('keeps an unpushed local secret edit while the keystore is locked, and reconciles it once readable', async () => {
      const { srv, ck, a, b, clockRef, lock, unlock } = await synced()
      clockRef.t = 1000
      await b.secure.set(NAME, 't-remote-older')
      await b.sync.observe()
      clockRef.t = 2000
      await a.secure.set(NAME, 't-local')
      await a.sync.observe()
      lock(() => null) // the stored blob is still there, it just does not open right now
      clockRef.t = 2500
      await b.sync.syncNow()
      clockRef.t = 3000
      const r = await a.sync.pull()
      expect(r.error).toBeUndefined()
      expect(r.applied).toBe(0)
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect(a.secure.set).not.toHaveBeenCalledWith(NAME, 't-remote-older')
      unlock()
      clockRef.t = 3500
      await a.sync.syncNow() // the held item is fetched again; A's edit (2000) beats B's (1000)
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect((await decryptAll(srv, ck))[`sec:nexusmd:${NAME}`].value).toBe('t-local')
    })

    it('repairs a locked or broken secret from the remote when there is no pending local edit', async () => {
      const { a, b, lock } = await synced()
      lock(() => null)
      await b.secure.set(NAME, 't-remote')
      await b.sync.syncNow()
      const r = await a.sync.pull()
      expect(r.applied).toBe(1)
      expect(a.secure.vals.get(NAME)).toBe('t-remote')
    })

    it('stays safe when secure.get throws', async () => {
      const { a, b, clockRef, lock } = await synced()
      clockRef.t = 1000
      await a.secure.set(NAME, 't-local')
      await a.sync.observe()
      lock(() => { throw new Error('keystore unavailable') })
      clockRef.t = 2000
      await b.secure.set(NAME, 't-remote')
      await b.sync.syncNow()
      const r = await a.sync.pull()
      expect(r.error).toBeUndefined()
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect(a.secure.set).not.toHaveBeenCalledWith(NAME, 't-remote')
    })

    it('keeps unreadable tweaks with a pending edit, and repairs them from the remote without one', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const T = 'nexusmd.tweaks'
      const a = device({ srv, ck, init: { [T]: JSON.stringify({ theme: 'dark' }) }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, deviceId: 'dev-b', now })
      await b.sync.syncNow()
      clockRef.t = 1000
      a.storage.setItem(T, JSON.stringify({ theme: 'light' }))
      await a.sync.observe()
      a.storage.setItem(T, '{not json') // the local value exists but cannot be read
      clockRef.t = 2000
      b.storage.setItem(T, JSON.stringify({ theme: 'dim' }))
      await b.sync.syncNow()
      await a.sync.pull()
      expect(a.storage.getItem(T)).toBe('{not json')

      const c = device({ srv, ck, deviceId: 'dev-c', init: { [T]: JSON.stringify({ theme: 'dim' }) }, now })
      await c.sync.syncNow()
      c.storage.setItem(T, '{broken')
      clockRef.t = 3000
      b.storage.setItem(T, JSON.stringify({ theme: 'sepia' }))
      await b.sync.syncNow()
      await c.sync.pull()
      expect(JSON.parse(c.storage.getItem(T))).toEqual({ theme: 'sepia' })
    })
  })

  it('profiles are unioned by id instead of last-writer-wins', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'Work' }]) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.profiles': JSON.stringify([{ id: '2', name: 'Home' }]) } })
    await b.sync.syncNow()
    const ids = (d) => JSON.parse(d.storage.getItem('nexusmd.profiles')).map((p) => p.id).sort()
    expect(ids(b)).toEqual(['1', '2'])
    await a.sync.syncNow()
    expect(ids(a)).toEqual(['1', '2'])
  })

  it('device prefs, device-level keys and the tweaks device half go to the device blob, not the item feed', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const shell = { closeToTray: true, zoomFactor: 1.2 }
    const devicePrefs = { collect: vi.fn(async () => shell), apply: vi.fn(async () => {}) }
    const a = device({
      srv, ck, devicePrefs,
      init: { 'nexusmd.sidebar.width': '300', 'nexusmd.tweaks': JSON.stringify({ theme: 'dark', widgets: ['w'] }), 'nexusmd.activeProfileId': '1' },
    })
    await a.sync.push()
    const items = await decryptAll(srv, ck)
    expect(Object.keys(items)).toEqual(['tweaks.account'])
    expect(items['tweaks.account'].value).toEqual({ theme: 'dark' })
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.prefs).toEqual(shell)
    expect(blob.entries['nexusmd:sidebar.width'].value).toBe('300')
    expect(blob.entries['tweaks.device'].value).toEqual({ widgets: ['w'] })
    expect(blob.entries.activeProfileId.value).toBe('1')
    expect(srv.requests.join('\n')).not.toContain('closeToTray')

    // unchanged: no second blob write
    const rev = srv.prefs.get('dev-a').revision
    await a.sync.push()
    expect(srv.prefs.get('dev-a').revision).toBe(rev)

    // a reinstall of the same device restores account items and the device blob
    const apply = vi.fn(async () => {})
    const again = device({ srv, ck, deviceId: 'dev-a', devicePrefs: { collect: async () => ({}), apply } })
    const r = await again.sync.pull()
    expect(r.applied).toBeGreaterThan(0)
    expect(again.storage.getItem('nexusmd.sidebar.width')).toBe('300')
    expect(again.storage.getItem('nexusmd.activeProfileId')).toBe('1')
    expect(JSON.parse(again.storage.getItem('nexusmd.tweaks'))).toEqual({ theme: 'dark', widgets: ['w'] })
    expect(apply).toHaveBeenCalledWith(shell)

    // another device does not get dev-a's device prefs
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.sidebar.width')).toBeNull()
    expect(JSON.parse(b.storage.getItem('nexusmd.tweaks'))).toEqual({ theme: 'dark' })
  })

  it('a stale device blob write conflicts, re-pulls the blob and retries', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const first = device({ srv, ck, deviceId: 'dev-a', init: { 'nexusmd.sidebar.width': '300' } })
    await first.sync.push()
    const second = device({ srv, ck, deviceId: 'dev-a', init: { 'nexusmd.sidebar.width': '200', 'nexusmd.wi.view': 'grid' } })
    const r = await second.sync.push() // never pulled: If-Match 0 is stale
    expect(r.error).toBeUndefined()
    expect(r.conflicts).toBe(0)
    expect(second.storage.getItem('nexusmd.sidebar.width')).toBe('300') // first sync: remote wins
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['nexusmd:sidebar.width'].value).toBe('300')
    expect(blob.entries['nexusmd:wi.view'].value).toBe('grid')
    expect(srv.prefs.get('dev-a').revision).toBe(2)
  })

  it('an empty change feed never deletes local keys', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    const cursor = metaOf(b).cursor
    expect(cursor).toBeGreaterThan(0)
    // the server still holds the items but answers with an empty feed (and even a reset cursor)
    srv.client.getChanges = async () => ({ items: [], cursor: 0 })
    const applied = vi.fn()
    b.sync.onApplied(applied)
    const r = await b.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(r.applied).toBe(0)
    expect(r.pushed).toBe(0)
    expect(applied).not.toHaveBeenCalled()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    expect(metaOf(b).cursor).toBe(cursor)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].deleted).toBeFalsy()
  })

  it('a failed pull returns { error }, deletes nothing and leaves meta untouched', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' }, secrets: { 'google.auth': 't' } })
    await a.sync.syncNow()
    a.storage.setItem('nexusmd.p.1.ado.org', 'changed-while-offline') // so push needs the network
    const before = new Map(a.storage.map)
    before.delete(META)
    const serverState = (m) => ({ cursor: m.cursor, entries: Object.fromEntries(Object.entries(m.entries).map(([id, e]) => [id, [e.hash, e.revision, e.deleted]])) })
    const metaBefore = serverState(metaOf(a))
    srv.fail = 'offline'
    for (const op of ['pull', 'push', 'syncNow', 'seed']) {
      const r = await a.sync[op]()
      expect(r.error).toBeInstanceOf(AccountError)
      expect(r.error.code).toBe('offline')
    }
    const after = new Map(a.storage.map)
    after.delete(META)
    expect(after).toEqual(before)
    // meta may only gain the observation stamp of the offline edit
    expect(serverState(metaOf(a))).toEqual(metaBefore)
    expect(metaOf(a).entries['p.1.ado.org'].changedAt).toBeGreaterThan(0)
    expect(await a.secure.get('google.auth')).toBe('t')
  })

  it('session-expired is surfaced to onError and the caller without wiping anything', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const before = new Map(a.storage.map)
    const onError = vi.fn()
    a.sync.onError(onError)
    srv.fail = 'session-expired'
    const r = await a.sync.syncNow()
    expect(r.error.code).toBe('session-expired')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'session-expired' }))
    expect(a.storage.map).toEqual(before)
  })

  it('ignores items whose ciphertext was swapped or whose payload id does not match the wire id', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'org', 'nexusmd.p.1.ado.pat': 'pat' } })
    await a.sync.seed()
    const wOrg = await opaqueId('p.1.ado.org', ck)
    const wPat = await opaqueId('p.1.ado.pat', ck)
    // 1. server swaps ciphertexts between the two items
    srv.tamper = (list) => list.map((i) => (i.id === wOrg ? { ...i, ciphertext: srv.items.get(wPat).ciphertext }
      : i.id === wPat ? { ...i, ciphertext: srv.items.get(wOrg).ciphertext } : i))
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
    expect(b.storage.getItem('nexusmd.p.1.ado.pat')).toBeNull()
    // 2. a validly encrypted payload whose inner id names another entry
    srv.tamper = null
    const forged = await encryptJson({ id: 'p.1.ado.pat', value: 'evil', updatedAt: 1 }, ck, `nexusmd-item|${wOrg}`)
    srv.items.set(wOrg, { ...srv.items.get(wOrg), ciphertext: forged, cursor: 99, revision: 5 })
    const c = device({ srv, ck, deviceId: 'dev-c' })
    await c.sync.pull()
    expect(c.storage.getItem('nexusmd.p.1.ado.pat')).toBe('pat')
    expect(c.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
  })

  it('ignores items of the other platform and ids the registry rejects', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const android = device({ srv, ck, ns: 'helm', deviceId: 'phone', init: { 'helm.p.1.android.org': 'shared-org', 'helm.p.1.google.auth': 'g' } })
    await android.sync.push()
    // a forged item naming a key the registry never syncs
    const bad = 'nexusmd:sec.account.keys'
    const w = await opaqueId(bad, ck)
    await srv.client.putItems([{ id: w, ifMatch: 0, ciphertext: await encryptJson({ id: bad, value: 'x', updatedAt: 1 }, ck, `nexusmd-item|${w}`) }])
    const desk = device({ srv, ck, deviceId: 'pc' })
    await desk.sync.pull()
    expect(desk.storage.getItem('nexusmd.p.1.ado.org')).toBe('shared-org')
    expect([...desk.storage.map.keys()].filter((k) => k !== META)).toEqual(['nexusmd.p.1.ado.org'])
  })

  it('never pushes nexusmd.sec.account.* or the meta record', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.account.deviceId': 'dev-a' }, secrets: { 'account.session': 'S', 'account.keys': 'K' } })
    await a.sync.seed()
    await a.sync.syncNow()
    expect(srv.items.size).toBe(0)
    expect(a.secure.get).not.toHaveBeenCalledWith('account.session')
  })

  it('seed pushes everything local regardless of meta', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.ado.pat': 'y' } })
    const r = await a.sync.seed()
    expect(r.pushed).toBe(2)
    expect(metaOf(a).entries['p.1.ado.org'].revision).toBe(1)
  })

  it('pages through the change feed and stores the cursor', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const init = {}
    for (let i = 0; i < 120; i++) init[`nexusmd.k${i}`] = `v${i}`
    const a = device({ srv, ck, init })
    await a.sync.seed()
    const orig = srv.client.getChanges
    srv.client.getChanges = (since) => orig(since, 50)
    const b = device({ srv, ck, deviceId: 'dev-b' })
    const r = await b.sync.pull()
    expect(r.applied).toBe(120)
    expect(metaOf(b).cursor).toBe(120)
    expect((await b.sync.pull()).applied).toBe(0)
  })

  describe('change feed paging (hasMore)', () => {
    async function seeded(n, opts) {
      const srv = fakeServer(opts)
      const ck = await generateContainerKey()
      const init = {}
      for (let i = 0; i < n; i++) init[`nexusmd.k${i}`] = `v${i}`
      const a = device({ srv, ck, init })
      await a.sync.seed()
      return { srv, ck }
    }

    it('collects every item across byte-limited pages that hold fewer items than the limit', async () => {
      const { srv, ck } = await seeded(120, { pageBytes: 1000 })
      const b = device({ srv, ck, deviceId: 'dev-b' })
      srv.changesCalls = 0
      const r = await b.sync.pull()
      expect(r.error).toBeUndefined()
      expect(r.applied).toBe(120)
      expect(srv.changesCalls).toBeGreaterThan(5) // many short pages, each with hasMore: true
      expect(metaOf(b).cursor).toBe(120)
      for (let i = 0; i < 120; i++) expect(b.storage.getItem(`nexusmd.k${i}`)).toBe(`v${i}`)
    })

    it('stops on hasMore: false even when the page is full', async () => {
      const { srv, ck } = await seeded(100)
      const b = device({ srv, ck, deviceId: 'dev-b', pageSize: 50 })
      srv.changesCalls = 0
      expect((await b.sync.pull()).applied).toBe(100)
      expect(srv.changesCalls).toBe(2)
    })

    it('falls back to "a full page means more" when the server omits hasMore', async () => {
      const { srv, ck } = await seeded(120, { legacy: true })
      const b = device({ srv, ck, deviceId: 'dev-b', pageSize: 50 })
      srv.changesCalls = 0
      expect((await b.sync.pull()).applied).toBe(120)
      expect(srv.changesCalls).toBe(3) // 50, 50, 20: a short page ends the feed
      expect(metaOf(b).cursor).toBe(120)
      const c = device({ srv, ck, deviceId: 'dev-c' }) // default page of 500: one request
      srv.changesCalls = 0
      expect((await c.sync.pull()).applied).toBe(120)
      expect(srv.changesCalls).toBe(1)
    })

    for (const [name, page] of [
      ['an empty page', (since) => ({ items: [], cursor: since, hasMore: true })],
      ['the same items again', (since, first) => ({ items: first, cursor: since, hasMore: true })],
    ]) {
      it(`a hasMore: true page that does not advance the cursor (${name}) ends with a server error and changes nothing`, async () => {
        const { srv, ck } = await seeded(3)
        const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.k0': 'local-b', 'nexusmd.other': 'keep' } })
        await b.sync.syncNow()
        const before = new Map(b.storage.map)
        const cursor = metaOf(b).cursor
        const first = (await srv.client.getChanges(0)).items
        let calls = 0
        srv.client.getChanges = async (since) => { calls++; return page(since, first) }
        const r = await b.sync.pull()
        expect(r.error).toBeInstanceOf(AccountError)
        expect(r.error.code).toBe('server')
        expect(calls).toBe(1)
        expect(b.storage.map).toEqual(before)
        expect(metaOf(b).cursor).toBe(cursor)
      })
    }

    it('caps a pull at 1000 pages and continues from there next time', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const b = device({ srv, ck, deviceId: 'dev-b' })
      let calls = 0
      srv.client.getChanges = async (since) => { calls++; return { items: [], cursor: since + 1, hasMore: true } }
      const r = await b.sync.pull()
      expect(r.error).toBeUndefined()
      expect(calls).toBe(1000)
      expect(metaOf(b).cursor).toBe(1000)
    })
  })

  it('onApplied fires only when a pull changed local data', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.seed()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    const cb = vi.fn()
    const off = b.sync.onApplied(cb)
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    a.storage.setItem('nexusmd.p.1.ado.org', 'y')
    await a.sync.push()
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('start() syncs on an interval, on visibilitychange and online; overlapping syncs coalesce; stop() detaches', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const docListeners = {}
    const winListeners = {}
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (t, f) => { docListeners[t] = f },
      removeEventListener: (t, f) => { if (docListeners[t] === f) delete docListeners[t] },
    })
    vi.stubGlobal('addEventListener', (t, f) => { winListeners[t] = f })
    vi.stubGlobal('removeEventListener', (t, f) => { if (winListeners[t] === f) delete winListeners[t] })
    const srv = fakeServer()
    let calls = 0
    const orig = srv.client.getChanges
    srv.client.getChanges = async (...args) => { calls++; return orig(...args) }
    const ck = await generateContainerKey()
    const storage = fakeStorage()
    const sync = createAccountSync({
      client: srv.client, containerKey: ck, registry: createKeyRegistry({ namespace: 'nexusmd' }),
      storage, secure: fakeSecure(storage), devicePrefs: null, deviceId: 'd', metaKey: META, intervalMs: 1000,
    })
    sync.start()
    sync.start() // idempotent
    const p = sync.syncNow() // overlaps the start() sync
    expect(await p).toEqual({ skipped: 'in-flight' })
    await vi.waitFor(() => expect(calls).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(calls).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    docListeners.visibilitychange()
    await vi.waitFor(() => expect(calls).toBe(3))
    await new Promise((r) => setTimeout(r, 20))
    winListeners.online()
    await vi.waitFor(() => expect(calls).toBe(4))
    sync.stop()
    expect(docListeners.visibilitychange).toBeUndefined()
    expect(winListeners.online).toBeUndefined()
    vi.advanceTimersByTime(5000)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(4)
  })

  it('start() is safe without document or window listeners (non-browser)', () => {
    const srv = fakeServer()
    const storage = fakeStorage()
    const sync = createAccountSync({
      client: srv.client, containerKey: {}, registry: createKeyRegistry({ namespace: 'nexusmd' }),
      storage, secure: fakeSecure(storage), devicePrefs: null, deviceId: 'd', metaKey: META,
    })
    expect(() => { sync.start(); sync.stop() }).not.toThrow()
  })
})

describe('createAccountSync data-safety rules', () => {
  it('profiles: an unpushed local rename survives a concurrent remote addition', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const P = 'nexusmd.profiles'
    const a = device({ srv, ck, init: { [P]: JSON.stringify([{ id: '1', name: 'Work' }]) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem(P, JSON.stringify([{ id: '1', name: 'Office' }]))
    b.storage.setItem(P, JSON.stringify([{ id: '1', name: 'Work' }, { id: '2', name: 'Home' }]))
    await b.sync.syncNow()
    await a.sync.syncNow()
    await b.sync.syncNow()
    const norm = (raw) => JSON.parse(raw).map((p) => `${p.id}:${p.name}`).sort()
    expect(norm(a.storage.getItem(P))).toEqual(['1:Office', '2:Home'])
    expect(norm(b.storage.getItem(P))).toEqual(['1:Office', '2:Home'])
    expect(norm((await decryptAll(srv, ck)).profiles.value)).toEqual(['1:Office', '2:Home'])
    // converged: nothing left to push on either side
    expect((await a.sync.syncNow()).pushed).toBe(0)
    expect((await b.sync.syncNow()).pushed).toBe(0)
  })

  it('JSON values that differ only in key order cause no re-push and no onApplied', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.custom.obj': '{"a":1,"b":[1,2]}',
        'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'W' }]),
      },
    })
    await a.sync.seed()
    const b = device({
      srv, ck, deviceId: 'dev-b',
      init: {
        'nexusmd.custom.obj': '{ "b": [1, 2], "a": 1 }',
        'nexusmd.profiles': '[{"name":"W","id":"1"}]',
      },
    })
    const applied = vi.fn()
    b.sync.onApplied(applied)
    const calls = srv.putCalls
    const r = await b.sync.syncNow()
    expect(r.applied).toBe(0)
    expect(r.pushed).toBe(0)
    expect(applied).not.toHaveBeenCalled()
    expect(srv.putCalls).toBe(calls)
    expect(b.storage.getItem('nexusmd.custom.obj')).toBe('{ "b": [1, 2], "a": 1 }')
  })

  it('skips an entry whose local value changes while the pull is running and reconciles it next sync', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const ORG = 'nexusmd.p.1.ado.org'
    const a = device({ srv, ck, init: { [ORG]: 'v1' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem(ORG, 'v2')
    await a.sync.syncNow()
    const orig = b.storage.getItem
    let reads = 0
    // the first read is the snapshot; the user types before the engine gets to write
    b.storage.getItem = (k) => {
      if (k === ORG && ++reads === 2) b.storage.map.set(ORG, 'typed-meanwhile')
      return orig(k)
    }
    const r = await b.sync.pull()
    b.storage.getItem = orig
    expect(r.applied).toBe(0)
    expect(b.storage.getItem(ORG)).toBe('typed-meanwhile')
    await b.sync.syncNow() // the held-back item is seen again; B's edit is newer and is pushed
    expect(b.storage.getItem(ORG)).toBe('typed-meanwhile')
    expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('typed-meanwhile')
  })

  it('skips a secret whose value changes while the pull is running', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 't1' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    await a.secure.set('google.auth', 't2')
    await a.sync.syncNow()
    const orig = b.secure.get.getMockImplementation()
    let reads = 0
    b.secure.get.mockImplementation(async (name) => {
      if (name === 'google.auth' && ++reads === 2) b.secure.vals.set(name, 'refreshed-meanwhile')
      return orig(name)
    })
    await b.sync.pull()
    b.secure.get.mockImplementation(orig)
    expect(await b.secure.get('google.auth')).toBe('refreshed-meanwhile')
  })

  it('stores keyed fingerprints for secrets, never a plain hash of the value', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': '1234' } })
    await a.sync.syncNow()
    const m = metaOf(a).entries['sec:nexusmd:google.auth']
    expect(m).toBeTruthy()
    expect(m.hash).not.toBe(contentHash('1234'))
    expect(m.hash).not.toBe(contentHash(1234))
    expect(m.hash.length).toBeGreaterThanOrEqual(40) // an HMAC-SHA256, not a 32-bit FNV
    expect(a.storage.getItem(META)).not.toContain('1234')
    expect((await a.sync.push()).pushed).toBe(0) // the fingerprint still detects "unchanged"
    await a.secure.set('google.auth', '1235')
    expect((await a.sync.push()).pushed).toBe(1)
  })

  it('never tombstones the tweaks halves when the tweaks key vanishes', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.tweaks': JSON.stringify({ theme: 'dark', widgets: ['x'] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.tweaks': JSON.stringify({ widgets: ['b'] }) } })
    await b.sync.syncNow()
    a.storage.removeItem('nexusmd.tweaks')
    const r = await a.sync.syncNow()
    expect(r.pushed).toBe(0)
    expect((await decryptAll(srv, ck))['tweaks.account'].deleted).toBeFalsy()
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['tweaks.device'].value).toEqual({ widgets: ['x'] })
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('nexusmd.tweaks'))).toEqual({ theme: 'dark', widgets: ['b'] })
  })

  it('never tombstones the tweaks halves when the Android active profile has no tweaks key', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    let active = '1'
    const phone = device({
      srv, ck, ns: 'helm', deviceId: 'phone', getActiveProfileId: () => active,
      init: { 'helm.p.1.tweaks': JSON.stringify({ theme: 'dark', navOrder: ['a'] }), 'helm.p.1.android.org': 'o' },
    })
    await phone.sync.syncNow()
    const rev = srv.prefs.get('phone').revision
    active = '2'
    phone.storage.setItem('helm.p.1.android.org', 'o2') // something else still changes and syncs
    const r = await phone.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(r.pushed).toBe(1)
    const items = await decryptAll(srv, ck)
    expect(items['tweaks.account'].deleted).toBeFalsy()
    expect(items['tweaks.account'].value).toEqual({ theme: 'dark' })
    const blob = await decryptJson(srv.prefs.get('phone').ciphertext, ck, 'nexusmd-device-prefs|phone')
    expect(blob.entries['tweaks.device'].value).toEqual({ navOrder: ['a'] })
    expect(srv.prefs.get('phone').revision).toBe(rev)
  })

  it('a device without a devicePrefs adapter keeps the blob\'s shell prefs when it re-pushes', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const shell = { zoomFactor: 1.2 }
    const one = device({ srv, ck, deviceId: 'dev-a', devicePrefs: { collect: async () => shell, apply: async () => {} }, init: { 'nexusmd.sidebar.width': '300' } })
    await one.sync.syncNow()
    const two = device({ srv, ck, deviceId: 'dev-a', devicePrefs: null })
    await two.sync.syncNow()
    expect(two.storage.getItem('nexusmd.sidebar.width')).toBe('300')
    two.storage.setItem('nexusmd.sidebar.width', '250')
    const r = await two.sync.syncNow()
    expect(r.devicePrefs).toBe(true)
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['nexusmd:sidebar.width'].value).toBe('250')
    expect(blob.prefs).toEqual(shell)
  })

  it('shell device prefs use the observed edit time too', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const clockRef = { t: 100 }
    const now = () => clockRef.t
    const prefsOf = (init) => {
      const state = { value: init }
      return { state, collect: async () => state.value, apply: vi.fn(async (v) => { state.value = v }) }
    }
    const p1 = prefsOf({ zoom: 1 })
    const p2 = prefsOf({ zoom: 1 })
    const one = device({ srv, ck, deviceId: 'dev-a', devicePrefs: p1, now })
    await one.sync.syncNow()
    const two = device({ srv, ck, deviceId: 'dev-a', devicePrefs: p2, now })
    await two.sync.syncNow()
    clockRef.t = 1000
    p1.state.value = { zoom: 1.5 }
    await one.sync.observe()
    clockRef.t = 2000
    p2.state.value = { zoom: 2 }
    await two.sync.syncNow()
    clockRef.t = 3000
    await one.sync.syncNow()
    expect(p1.state.value).toEqual({ zoom: 2 })
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.prefs).toEqual({ zoom: 2 })
  })

  it('a push interrupted after the first batch records meta only for acknowledged items', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const init = {}
    for (let i = 0; i < 120; i++) init[`nexusmd.k${i}`] = `v${i}`
    const a = device({ srv, ck, init })
    const orig = srv.client.putItems
    let batches = 0
    srv.client.putItems = async (list) => {
      batches++
      if (batches === 2) throw new AccountError('offline', 0)
      return orig(list)
    }
    const r = await a.sync.push()
    expect(r.error.code).toBe('offline')
    expect(batches).toBe(2)
    const tracked = Object.values(metaOf(a).entries).filter((e) => e.level === 'account' && e.revision > 0)
    expect(tracked).toHaveLength(50)
    expect(srv.items.size).toBe(50)
    const again = await a.sync.push()
    expect(again.pushed).toBe(70)
    expect(srv.items.size).toBe(120)
  })
})
