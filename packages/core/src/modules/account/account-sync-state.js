// account-sync-state.js — local-state helpers for the account sync engine (account-sync.js):
// the per-device meta record, the snapshot of what this device holds (with fingerprints and
// change stamps), resolving a canonical id back to where it lives, writing a remote value
// locally, the profiles merge and the encrypted item codec.
//
// Meta (JSON at `metaKey`, never synced: the registry rejects `.account.` keys):
//   { cursor,
//     entries: { [id]: { hash, updatedAt, revision?, level, deleted, changedAt?, changedHash? } },
//     rejected: { [id]: { hash, status: 'too_large' | 'quota' } },  (not re-sent until hash changes)
//     devicePrefs: { revision, prefsHash, prefsUpdatedAt, prefsChangedAt?, prefsChangedHash? },
//     lastSyncAt }
// An entry describes the SERVER state last seen for that id. No entry means the server value
// (if any) was never seen. `changedAt` is when this device first observed its local value
// differ from `hash` (`changedHash` is the local fingerprint observed then).
import { contentHash } from '../sync/hash.js'
import { encryptJson, decryptJson, opaqueId } from './crypto.js'
import { AccountError } from './account-client.js'
import { MACHINE_WRITTEN } from './key-registry.js'

export const ITEM_CONTEXT = 'nexusmd-item|'
export const DEVICE_CONTEXT = 'nexusmd-device-prefs|'

export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const parseJson = (raw) => {
  if (typeof raw !== 'string') return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

/**
 * Structural fingerprint. Strings holding a JSON object or array are hashed by their parsed
 * value, so two serialisations of the same data (key order, whitespace) compare equal.
 */
export function hashOf(value) {
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    if (parsed && typeof parsed === 'object') return contentHash(parsed)
  }
  return contentHash(value === undefined ? null : value)
}

/** Keyed fingerprint for secrets: meta in localStorage must not confirm an offline guess. */
export const secretFingerprint = (value, ck) => opaqueId(`fp|${value}`, ck)

/** The fingerprint of `value` as stored at `target` (secrets keyed, everything else structural). */
export const fingerprint = (target, value, ck) => (target.kind === 'secret' ? secretFingerprint(value, ck) : hashOf(value))

export function emptyMeta() {
  return { cursor: 0, entries: {}, rejected: {}, conflicts: {}, devicePrefs: { revision: 0 } }
}

export function loadMeta(storage, metaKey) {
  const m = parseJson(storage.getItem(metaKey))
  if (!isPlainObject(m) || !isPlainObject(m.entries)) return emptyMeta()
  const entries = {}
  for (const [id, e] of Object.entries(m.entries)) if (isPlainObject(e)) entries[id] = e
  return {
    cursor: Number.isInteger(m.cursor) && m.cursor > 0 ? m.cursor : 0,
    entries,
    rejected: isPlainObject(m.rejected) ? { ...m.rejected } : {},
    conflicts: isPlainObject(m.conflicts) ? Object.fromEntries(Object.entries(m.conflicts).filter(([, c]) => isPlainObject(c))) : {},
    devicePrefs: { revision: 0, ...(isPlainObject(m.devicePrefs) ? m.devicePrefs : {}) },
    ...(m.lastSyncAt ? { lastSyncAt: m.lastSyncAt } : {}),
  }
}

export function saveMeta(storage, metaKey, meta) {
  storage.setItem(metaKey, JSON.stringify(meta))
}

// ---- records and fields (registry v2) ------------------------------------------------
// A collection key (`kind: 'collection'`) holds a list of records, each synced as its own item
// `<base id>#<record id>`; a field map (`kind: 'fields'`, the per-profile tweaks) syncs one item
// per property, `<base id>#<field>`. An item's value is the record (or field value) as JSON with
// object keys sorted recursively, so the same record hashes the same on every device.

// Property names never read from or written to a field map (they could reach Object.prototype).
const UNSAFE_FIELDS = new Set(['__proto__', 'constructor', 'prototype'])

/** JSON with object keys sorted at every depth. */
export function stableJson(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm)
    if (isPlainObject(v)) {
      const out = {}
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = norm(v[k])
      return out
    }
    return v
  }
  return JSON.stringify(norm(value === undefined ? null : value))
}

/** A record's id as a string, or null when the record has none that can be synced. */
const recordIdOf = (r) => {
  if (!isPlainObject(r)) return null
  if (typeof r.id === 'string') return r.id ? r.id : null
  return Number.isFinite(r.id) ? String(r.id) : null
}

/** The record array in a parsed collection: [] when an object lacks it yet, null on a wrong shape. */
function recordsOf(parsed, path) {
  if (path == null) return Array.isArray(parsed) ? parsed : null
  if (!isPlainObject(parsed)) return null
  if (parsed[path] === undefined) return []
  return Array.isArray(parsed[path]) ? parsed[path] : null
}

/** Index of the first record with `recordId` (later duplicates are never synced), or -1. */
const findRecord = (list, recordId) => list.findIndex((r) => recordIdOf(r) === recordId)

const isAutoField = (field) => MACHINE_WRITTEN.some((re) => re.test(field))

/** `<base>#<sub>` split at the first `#`, or null. */
function splitSubId(id) {
  const i = id.indexOf('#')
  if (i <= 0 || i === id.length - 1) return null
  return { base: id.slice(0, i), sub: id.slice(i + 1) }
}

/** Where a canonical id lives on this device, or null (other platform, account secret, not synced). */
export function resolveTarget(registry, id) {
  if (typeof id !== 'string' || !id) return null
  if (registry.isSecretId(id)) {
    const name = registry.secretName(id)
    return name ? { kind: 'secret', name, level: 'account', auto: MACHINE_WRITTEN.some((re) => re.test(name)) } : null
  }
  const parts = id.includes('#') ? splitSubId(id) : null
  if (parts) {
    const baseKey = registry.toStorageKey(parts.base)
    const bc = baseKey ? registry.classify(baseKey) : null
    if (bc && bc.kind === 'collection') {
      return { kind: 'record', key: baseKey, path: bc.collection.path, recordId: parts.sub, level: bc.level, auto: !!bc.auto }
    }
    if (bc && bc.kind === 'fields') {
      if (UNSAFE_FIELDS.has(parts.sub)) return null
      return { kind: 'field', key: baseKey, field: parts.sub, level: bc.level, auto: !!bc.auto || isAutoField(parts.sub) }
    }
  }
  const key = registry.toStorageKey(id)
  if (!key) return null
  const c = registry.classify(key)
  if (!c) return null
  if (c.kind === 'collection' || c.kind === 'fields') return null // synced as its records / fields
  if (c.split) {
    const half = id === c.accountId ? 'account' : id === c.deviceId ? 'device' : null
    return half ? { kind: 'tweaks', key, half, level: half } : null
  }
  return { kind: 'plain', key, level: c.level, auto: !!c.auto }
}

/**
 * Everything this device would sync, keyed by canonical id, each with its fingerprint `hash`
 * and the `raw` local value used to detect a write race. `isUnavailable(id)` is true for an id
 * that cannot be judged this round: a secure entry that does not open, tweaks that do not
 * parse, or a tweaks half whose key is absent (removed, or another Android profile is active).
 * Unavailable ids are never pushed, never tombstoned and never stamped.
 * `isUnreadable(id)` narrows that to a local value that exists but cannot be read right now
 * (it may still hold an unpushed edit). `rawOf(id)` is the raw local value the snapshot saw
 * (null when absent, or for a secret that does not open), for the write-race check.
 */
export async function readSnapshot({ registry, storage, secure, metaKey }, ck) {
  const snap = new Map()
  const unreadable = new Map() // id -> raw value seen (null for a secret that does not open)
  // Collection / field-map containers by base id: the storage key and its raw value (the
  // write-race baseline of every record or field in it), and the ones that do not parse.
  const containers = new Map() // base id -> { key, raw }
  const unreadableBases = new Set()
  const keys = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (typeof k === 'string') keys.push(k)
  }
  for (const key of keys) {
    if (key === metaKey) continue
    if (key.startsWith(registry.secPrefix)) {
      const name = key.slice(registry.secPrefix.length)
      const id = registry.secretId(name)
      if (!id || registry.secretName(id) !== name) continue // account secrets never leave
      let value = null
      try { value = await secure.get(name) } catch { value = null }
      if (typeof value !== 'string') { unreadable.set(id, null); continue }
      snap.set(id, { level: 'account', value, raw: value, storageKey: key, secret: true, name, hash: await secretFingerprint(value, ck) })
      continue
    }
    const c = registry.classify(key)
    if (!c) continue
    const raw = storage.getItem(key)
    if (raw == null) continue
    if (c.split) {
      const obj = parseJson(raw)
      if (!isPlainObject(obj)) { unreadable.set(c.accountId, raw); unreadable.set(c.deviceId, raw); continue }
      const { account, device } = registry.splitTweaks(obj)
      snap.set(c.accountId, { level: 'account', value: account, raw, storageKey: key, secret: false, half: 'account', hash: hashOf(account) })
      snap.set(c.deviceId, { level: 'device', value: device, raw, storageKey: key, secret: false, half: 'device', hash: hashOf(device) })
      continue
    }
    if (c.kind === 'collection' || c.kind === 'fields') {
      containers.set(c.id, { key, raw })
      const parsed = parseJson(raw)
      const auto = !!c.auto
      if (c.kind === 'collection') {
        const list = recordsOf(parsed, c.collection.path)
        if (!list) { unreadableBases.add(c.id); continue }
        for (const r of list) {
          const recordId = recordIdOf(r)
          const id = recordId == null ? null : `${c.id}#${recordId}`
          if (!id || snap.has(id)) continue // no id, or a later duplicate: kept locally, never synced
          const value = stableJson(r)
          snap.set(id, { level: c.level, value, raw, storageKey: key, secret: false, kind: 'record', recordId, auto, hash: hashOf(value) })
        }
      } else {
        if (!isPlainObject(parsed)) { unreadableBases.add(c.id); continue }
        for (const field of Object.keys(parsed)) {
          if (UNSAFE_FIELDS.has(field)) continue
          const value = stableJson(parsed[field])
          snap.set(`${c.id}#${field}`, {
            level: c.level, value, raw, storageKey: key, secret: false, kind: 'field', field, auto: auto || isAutoField(field), hash: hashOf(value),
          })
        }
      }
      continue
    }
    snap.set(c.id, { level: c.level, value: raw, raw, storageKey: key, secret: false, hash: hashOf(raw) })
  }
  const baseOf = (id) => (typeof id === 'string' && id.includes('#') ? splitSubId(id)?.base : undefined)
  const isUnreadable = (id) => unreadable.has(id) || unreadableBases.has(baseOf(id))
  const isUnavailable = (id) => isUnreadable(id)
    || (!snap.has(id) && resolveTarget(registry, id)?.kind === 'tweaks')
  const rawOf = (id) => {
    const cont = containers.get(baseOf(id))
    if (cont) return cont.raw // a record or field: the race check looks at the whole container
    return snap.has(id) ? snap.get(id).raw : unreadable.has(id) ? unreadable.get(id) : null
  }
  /**
   * After this device wrote a record or field, the container's new raw value is the baseline,
   * so the next record of the same key in this round is not mistaken for a race.
   */
  const noteWritten = (target) => {
    if (!target || (target.kind !== 'record' && target.kind !== 'field')) return
    const c = registry.classify(target.key)
    if (c && c.id) containers.set(c.id, { key: target.key, raw: storage.getItem(target.key) })
  }
  return { snap, isUnavailable, isUnreadable, rawOf, noteWritten }
}

/** True when the local fingerprint differs from the server state recorded in `m`. */
export function localChanged(m, local) {
  const localHash = local ? local.hash : null
  const synced = m.deleted ? null : m.hash
  return localHash !== synced
}

/**
 * Stamp `changedAt` on every tracked entry whose local value now differs from the server state.
 * The stamp is kept while the local value stays the same, renewed when it changes again, and
 * cleared once local matches the server again. Returns true when meta changed.
 */
export function stampChanges(meta, snap, isUnavailable, t) {
  let dirty = false
  for (const [id, m] of Object.entries(meta.entries)) {
    if (isUnavailable(id)) continue
    const local = snap.get(id)
    if (!localChanged(m, local)) {
      if (m.changedAt != null) { delete m.changedAt; delete m.changedHash; dirty = true }
      continue
    }
    const localHash = local ? local.hash : null
    if (m.changedAt == null || m.changedHash !== localHash) {
      m.changedAt = t
      m.changedHash = localHash
      dirty = true
    }
  }
  return dirty
}

/** The local value at `target` right now equals `seen`, the raw value the snapshot saw. */
export async function unchangedSince({ storage, secure }, target, seen) {
  if (target.kind === 'secret') {
    let current = null
    try { current = await secure.get(target.name) } catch { return false }
    return current === seen
  }
  return storage.getItem(target.key) === seen
}

/**
 * Write (or delete) a remote value locally. Returns true when local data changed.
 * A tweaks half replaces only its own fields; the other half of the local object is kept.
 */
export async function writeLocal({ registry, storage, secure }, target, value, deleted) {
  if (target.kind === 'secret') {
    let current = null
    try { current = await secure.get(target.name) } catch { current = null }
    if (deleted) {
      if (current == null && storage.getItem(registry.secPrefix + target.name) == null) return false
      await secure.remove(target.name)
      return true
    }
    if (current === value) return false
    await secure.set(target.name, value)
    return true
  }
  const before = storage.getItem(target.key)
  if (target.kind === 'record') return writeRecord(storage, target, before, value, deleted)
  if (target.kind === 'field') return writeField(storage, target, before, value, deleted)
  if (target.kind === 'tweaks') {
    if (deleted) return false // tweaks halves are never deleted, only replaced
    const local = parseJson(before)
    const halves = registry.splitTweaks(isPlainObject(local) ? local : {})
    const keep = target.half === 'account' ? halves.device : halves.account
    const next = registry.mergeTweaks(keep, { [target.half]: value })
    if (before != null && isPlainObject(local) && hashOf(local) === hashOf(next)) return false
    storage.setItem(target.key, JSON.stringify(next))
    return true
  }
  if (deleted) {
    if (before == null) return false
    storage.removeItem(target.key)
    return true
  }
  if (before != null && hashOf(before) === hashOf(value)) return false
  storage.setItem(target.key, value)
  return true
}

/**
 * One record of a collection: replaced in place (the first with its id), appended when new,
 * removed on `deleted`. The key itself is never removed, and a container that does not parse
 * (or has the wrong shape) is never written. An absent key is created around the record.
 */
function writeRecord(storage, target, before, value, deleted) {
  let container
  let list
  if (before == null) {
    if (deleted) return false
    list = []
    container = target.path == null ? list : { [target.path]: list }
  } else {
    container = parseJson(before)
    list = recordsOf(container, target.path)
    if (!list) return false
    if (target.path != null && container[target.path] === undefined) container[target.path] = list
  }
  const i = findRecord(list, target.recordId)
  if (deleted) {
    if (i < 0) return false
    list.splice(i, 1)
  } else {
    const rec = parseJson(value)
    if (!isPlainObject(rec) || recordIdOf(rec) !== target.recordId) return false
    if (i >= 0) {
      if (stableJson(list[i]) === stableJson(rec)) return false
      list[i] = rec
    } else {
      list.push(rec)
    }
  }
  storage.setItem(target.key, JSON.stringify(container))
  return true
}

/** One field of a field map: set or removed; every other field is kept. */
function writeField(storage, target, before, value, deleted) {
  let obj = {}
  if (before != null) {
    obj = parseJson(before)
    if (!isPlainObject(obj)) return false
  }
  const has = Object.prototype.hasOwnProperty.call(obj, target.field)
  if (deleted) {
    if (!has) return false
    delete obj[target.field]
  } else {
    const v = parseJson(value)
    if (v === undefined) return false
    if (has && stableJson(obj[target.field]) === stableJson(v)) return false
    obj[target.field] = v
  }
  storage.setItem(target.key, JSON.stringify(obj))
  return true
}

/**
 * Merge two raw JSON lists with an id-keyed merger (registry.mergers; the later list wins on a
 * shared id). `localWins` puts the local list last so an unpushed local edit survives; otherwise
 * the remote list wins. When the union holds nothing the remote list lacks, the remote string
 * is returned as is, so two devices listing the same items in another order do not ping-pong.
 * Returns null when either side does not parse as a list.
 */
export function mergeRaw(merger, localRaw, remoteRaw, localWins) {
  const l = parseJson(localRaw)
  const r = parseJson(remoteRaw)
  if (!Array.isArray(l) || !Array.isArray(r)) return null
  const merged = localWins ? merger(r, l) : merger(l, r)
  const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
  const norm = (list) => contentHash([...list].sort(byId))
  return norm(merged) === norm(merger([], r)) ? remoteRaw : JSON.stringify(merged)
}

/** Encrypt one item for the wire; the wire id hides the canonical id. */
export async function encodeItem(ck, id, payload) {
  const wid = await opaqueId(id, ck)
  return { wid, ciphertext: await encryptJson(payload, ck, ITEM_CONTEXT + wid) }
}

/**
 * Decrypt one wire item. Returns null when it does not open under its own wire id or when the
 * payload names a different entry than the wire id it was stored under (a swapped item).
 */
export async function decodeItem(ck, wid, ciphertext) {
  if (typeof wid !== 'string' || typeof ciphertext !== 'string' || !ciphertext) return null
  let p
  try { p = await decryptJson(ciphertext, ck, ITEM_CONTEXT + wid) } catch { return null }
  if (!isPlainObject(p) || typeof p.id !== 'string' || !p.id) return null
  if ((await opaqueId(p.id, ck)) !== wid) return null
  return p
}

const num = (v) => (Number.isFinite(v) ? v : 0)

/**
 * Decode one change-feed entry to { id, value, updatedAt, deleted, revision }, or null.
 * Tombstones carry an encrypted payload too; without one the id cannot be verified.
 */
export async function decodeChange(ck, c) {
  if (!isPlainObject(c) || !Number.isInteger(c.revision)) return null
  const p = await decodeItem(ck, c.id, c.ciphertext)
  if (!p) return null
  return { id: p.id, value: p.value, updatedAt: num(p.updatedAt), deleted: p.deleted === true, revision: c.revision }
}

/**
 * The change feed since `since`, fetched before anything is written locally. Pages while the
 * server says `hasMore: true` (pages are bounded by bytes too, so a short page can have more
 * behind it); a server without `hasMore` is paged while its pages come back full. A page that
 * claims more but does not advance the cursor is a server error, so nothing is applied. At most
 * `maxPages` pages per pull: the rest follows from the stored cursor on the next pull.
 */
export async function fetchFeed(client, since, pageSize = 500, maxPages = 1000) {
  const items = []
  let cursor = since
  for (let i = 0; i < maxPages; i++) {
    const page = await client.getChanges(cursor, pageSize)
    const list = Array.isArray(page && page.items) ? page.items : []
    const next = Number.isInteger(page && page.cursor) ? page.cursor : cursor
    const more = page && typeof page.hasMore === 'boolean' ? page.hasMore : list.length >= pageSize
    items.push(...list)
    if (next > cursor) cursor = next
    else if (more) throw new AccountError('server', 0, 'The change feed did not advance')
    if (!more) break
  }
  return { items, cursor }
}

/** Decrypt a device-prefs blob; null when it does not open or has the wrong shape. */
export async function decodeDeviceBlob(ck, deviceId, ciphertext) {
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  try {
    const b = await decryptJson(ciphertext, ck, DEVICE_CONTEXT + deviceId)
    return isPlainObject(b) ? b : null
  } catch {
    return null
  }
}

/** A remote value fits its target: tweaks halves are objects, records a JSON object carrying the record's id. */
export function validValue(target, value) {
  if (target.kind === 'tweaks') return isPlainObject(value)
  if (typeof value !== 'string') return false
  if (target.kind === 'record') {
    const rec = parseJson(value)
    return isPlainObject(rec) && recordIdOf(rec) === target.recordId
  }
  if (target.kind === 'field') return parseJson(value) !== undefined
  return true
}
