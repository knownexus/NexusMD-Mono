import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAccountSync } from '../src/modules/account/account-sync.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { AccountError } from '../src/modules/account/account-client.js'
import { generateContainerKey, encryptJson, decryptJson, opaqueId } from '../src/modules/account/crypto.js'
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
function fakeServer({ maxBytes = Infinity } = {}) {
  const items = new Map()
  const prefs = new Map()
  let cursor = 0
  const srv = {
    items, prefs, requests: [], fail: null, putCalls: 0,
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
          const next = { id: i.id, revision: rev + 1, cursor: ++cursor, ciphertext: i.ciphertext, deleted: !!i.deleted, updatedAt: new Date().toISOString() }
          items.set(i.id, next)
          return { id: i.id, status: 'ok', revision: next.revision, cursor: next.cursor }
        })
      },
      async getChanges(since = 0, limit = 500) {
        srv.check()
        let list = [...items.values()].filter((i) => i.cursor > since).sort((a, b) => a.cursor - b.cursor).slice(0, limit)
        if (srv.tamper) list = srv.tamper(list)
        return { items: list.map((i) => ({ ...i })), cursor: list.length ? list[list.length - 1].cursor : since }
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
function device({ srv, ck, init = {}, secrets = {}, deviceId = 'dev-a', devicePrefs = null, ns = 'nexusmd', now }) {
  const storage = fakeStorage(init)
  const secure = fakeSecure(storage, ns, secrets)
  const registry = createKeyRegistry({ namespace: ns })
  const sync = createAccountSync({
    client: srv.client, containerKey: ck, registry, storage, secure, devicePrefs, deviceId,
    metaKey: `${ns}.account.meta`, now: now || (() => (clock += 1000)),
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

  it('last writer wins by updatedAt when both sides changed a tracked entry', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    let t = 1000
    const now = () => t
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'base' }, now })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', now })
    await b.sync.syncNow()
    // B edits and pushes at a time later than A's (unpushed) local edit is seen
    t = 5000
    a.storage.setItem('nexusmd.p.1.ado.org', 'a-edit')
    b.storage.setItem('nexusmd.p.1.ado.org', 'b-edit')
    t = 9000
    await b.sync.push()
    t = 3000 // A detects its own change at an earlier time than B's write
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.ado.org')).toBe('b-edit')
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

  it('too_large items are skipped and reported', async () => {
    const srv = fakeServer({ maxBytes: 300 })
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'small', 'nexusmd.big.blob': 'x'.repeat(1000) } })
    const r = await a.sync.push()
    expect(r.pushed).toBe(1)
    expect(r.tooLarge).toEqual(['nexusmd:big.blob'])
    expect((await a.sync.push()).pushed).toBe(0)
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
    srv.items.clear()
    const r = await a.sync.pull()
    expect(r.applied).toBe(0)
    expect(a.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
  })

  it('a failed pull returns { error }, deletes nothing and leaves meta untouched', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' }, secrets: { 'google.auth': 't' } })
    await a.sync.syncNow()
    a.storage.setItem('nexusmd.p.1.ado.org', 'changed-while-offline') // so push needs the network
    const before = new Map(a.storage.map)
    srv.fail = 'offline'
    for (const op of ['pull', 'push', 'syncNow', 'seed']) {
      const r = await a.sync[op]()
      expect(r.error).toBeInstanceOf(AccountError)
      expect(r.error.code).toBe('offline')
    }
    expect(a.storage.map).toEqual(before)
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
