// account-sync-state.js — local-state helpers for the account sync engine (account-sync.js):
// the per-device meta record, the snapshot of what this device holds, resolving a canonical id
// back to where it lives, writing a remote value locally, and the encrypted item codec.
//
// Meta (JSON at `metaKey`, never synced: the registry rejects `.account.` keys) describes the
// SERVER state this device last saw for every entry:
//   { cursor, entries: { [id]: { hash, updatedAt, revision?, level, deleted } },
//     devicePrefs: { hash, revision, prefsHash, prefsUpdatedAt }, lastSyncAt }
// A local value whose hash differs from `entries[id].hash` has changed since that state.
import { contentHash } from '../sync/hash.js'
import { encryptJson, decryptJson, opaqueId } from './crypto.js'

export const ITEM_CONTEXT = 'nexusmd-item|'
export const DEVICE_CONTEXT = 'nexusmd-device-prefs|'

export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export const parseJson = (raw) => {
  if (typeof raw !== 'string') return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

export const hashOf = (value) => contentHash(value === undefined ? null : value)

export function emptyMeta() {
  return { cursor: 0, entries: {}, devicePrefs: { hash: null, revision: 0 } }
}

export function loadMeta(storage, metaKey) {
  const m = parseJson(storage.getItem(metaKey))
  if (!isPlainObject(m) || !isPlainObject(m.entries)) return emptyMeta()
  const entries = {}
  for (const [id, e] of Object.entries(m.entries)) if (isPlainObject(e)) entries[id] = e
  return {
    cursor: Number.isInteger(m.cursor) && m.cursor > 0 ? m.cursor : 0,
    entries,
    devicePrefs: { hash: null, revision: 0, ...(isPlainObject(m.devicePrefs) ? m.devicePrefs : {}) },
    ...(m.lastSyncAt ? { lastSyncAt: m.lastSyncAt } : {}),
  }
}

export function saveMeta(storage, metaKey, meta) {
  storage.setItem(metaKey, JSON.stringify(meta))
}

/** No cursor and no tracked entries: this device has never synced with the account. */
export const isFirstSync = (meta) => !meta.cursor && Object.keys(meta.entries).length === 0

/**
 * Everything this device would sync, keyed by canonical id. `unreadable` holds ids that exist
 * locally but could not be read (secure entry that does not open, tweaks that do not parse):
 * they are never pushed and never tombstoned.
 */
export async function readSnapshot({ registry, storage, secure, metaKey }) {
  const snap = new Map()
  const unreadable = new Set()
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
      if (typeof value !== 'string') { unreadable.add(id); continue }
      snap.set(id, { level: 'account', value, storageKey: key, secret: true, name })
      continue
    }
    const c = registry.classify(key)
    if (!c) continue
    const raw = storage.getItem(key)
    if (raw == null) continue
    if (c.split) {
      const obj = parseJson(raw)
      if (!isPlainObject(obj)) { unreadable.add(c.accountId); unreadable.add(c.deviceId); continue }
      const { account, device } = registry.splitTweaks(obj)
      snap.set(c.accountId, { level: 'account', value: account, storageKey: key, secret: false, half: 'account' })
      snap.set(c.deviceId, { level: 'device', value: device, storageKey: key, secret: false, half: 'device' })
      continue
    }
    snap.set(c.id, { level: c.level, value: raw, storageKey: key, secret: false })
  }
  return { snap, unreadable }
}

/** Where a canonical id lives on this device, or null (other platform, account secret, not synced). */
export function resolveTarget(registry, id) {
  if (typeof id !== 'string' || !id) return null
  if (registry.isSecretId(id)) {
    const name = registry.secretName(id)
    return name ? { kind: 'secret', name, level: 'account' } : null
  }
  const key = registry.toStorageKey(id)
  if (!key) return null
  const c = registry.classify(key)
  if (!c) return null
  if (c.split) {
    const half = id === c.accountId ? 'account' : id === c.deviceId ? 'device' : null
    return half ? { kind: 'tweaks', key, half, level: half } : null
  }
  return { kind: 'plain', key, level: c.level }
}

/** A remote value has the type its target stores. */
export function validValue(target, value) {
  return target.kind === 'tweaks' ? isPlainObject(value) : typeof value === 'string'
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
  if (target.kind === 'tweaks') {
    if (before == null && deleted) return false
    const local = parseJson(before)
    const halves = registry.splitTweaks(isPlainObject(local) ? local : {})
    const keep = target.half === 'account' ? halves.device : halves.account
    const next = registry.mergeTweaks(keep, { [target.half]: deleted ? {} : value })
    if (before != null && isPlainObject(local) && hashOf(local) === hashOf(next)) return false
    storage.setItem(target.key, JSON.stringify(next))
    return true
  }
  if (deleted) {
    if (before == null) return false
    storage.removeItem(target.key)
    return true
  }
  if (before === value) return false
  storage.setItem(target.key, value)
  return true
}

/**
 * Merge two raw JSON lists with an id-keyed merger (registry.mergers). When the union holds
 * nothing the remote list lacks, the remote string is kept as is, so two devices that list the
 * same profiles in a different order do not keep re-pushing each other's ordering.
 * Returns null when either side does not parse as a list.
 */
export function mergeRaw(merger, localRaw, remoteRaw) {
  const l = parseJson(localRaw)
  const r = parseJson(remoteRaw)
  if (!Array.isArray(l) || !Array.isArray(r)) return null
  const merged = merger(l, r)
  const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
  const norm = (list) => hashOf([...list].sort(byId))
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
