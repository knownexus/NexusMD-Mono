// Fakes for account-sync tests: storage, secure storage and an in-memory server, plus a device.
import { vi } from 'vitest'
import { createAccountSync } from '../../src/modules/account/account-sync.js'
import { createKeyRegistry } from '../../src/modules/account/key-registry.js'
import { AccountError } from '../../src/modules/account/account-client.js'
import { decryptJson } from '../../src/modules/account/crypto.js'

// ---- fakes -------------------------------------------------------------------------------

export function fakeStorage(init = {}) {
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
export function fakeSecure(storage, ns = 'nexusmd', init = {}) {
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
export function fakeServer({ maxBytes = Infinity, pageBytes = Infinity, legacy = false, quotaBytes = Infinity } = {}) {
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

export async function decryptAll(srv, ck) {
  const out = {}
  for (const it of srv.items.values()) {
    const p = await decryptJson(it.ciphertext, ck, `nexusmd-item|${it.id}`)
    out[p.id] = p
  }
  return out
}

let clock = 1_000_000
export function device({ srv, ck, init = {}, secrets = {}, deviceId = 'dev-a', devicePrefs = null, ns = 'nexusmd', now, getActiveProfileId, pageSize }) {
  const storage = fakeStorage(init)
  const secure = fakeSecure(storage, ns, secrets)
  const registry = createKeyRegistry({ namespace: ns, getActiveProfileId })
  const sync = createAccountSync({
    client: srv.client, containerKey: ck, registry, storage, secure, devicePrefs, deviceId,
    metaKey: `${ns}.account.meta`, now: now || (() => (clock += 1000)), pageSize,
  })
  return { storage, secure, sync, registry }
}

export const META = 'nexusmd.account.meta'
export const metaOf = (d) => JSON.parse(d.storage.getItem(META) || 'null')
