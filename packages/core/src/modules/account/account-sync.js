// account-sync.js — converges a device's settings, secrets and per-device preferences with an
// end-to-end encrypted account (Milestone 1).
//
//   account-level entries  one encrypted item each, wire id = opaqueId(canonical id); payload
//                          { id, value, updatedAt, deleted? } bound to 'nexusmd-item|<wire id>'
//   device-level entries   plus the shell's device prefs, one encrypted blob per device bound to
//   (and tweaks.device)    'nexusmd-device-prefs|<deviceId>': { v, entries, prefs, prefsUpdatedAt }
//
// Rules: the first sync of a device takes the remote value for keys both sides hold; after that
// a remote change replaces an unchanged local value, and when both changed the newer updatedAt
// wins (a local change counts as made now). Lists with a registry merger (profiles) are merged.
// A remote deletion is applied only to a local value still equal to the last synced one; a local
// removal is pushed only for an entry that was synced. Network failures never touch local data:
// every public method resolves to { error } instead of throwing.
import { singleFlight } from '../sync/single-flight.js'
import { encryptJson, decryptJson } from './crypto.js'
import {
  DEVICE_CONTEXT, isPlainObject, hashOf, loadMeta, saveMeta, isFirstSync, readSnapshot,
  resolveTarget, validValue, writeLocal, mergeRaw, encodeItem, decodeItem,
} from './account-sync-state.js'

const PAGE = 500
const BATCH = 50
const MAX_PAGES = 10000

const num = (v) => (Number.isFinite(v) ? v : 0)

export function createAccountSync({
  client, containerKey: ck, registry, storage, secure, devicePrefs = null, deviceId, metaKey,
  now = Date.now, intervalMs = 60000,
}) {
  const ctx = { registry, storage, secure, metaKey }
  const appliedListeners = new Set()
  const errorListeners = new Set()
  const load = () => loadMeta(storage, metaKey)
  const save = (meta) => saveMeta(storage, metaKey, meta)

  const emit = (set, arg) => {
    for (const cb of [...set]) {
      try { cb(arg) } catch { /* a listener must not break sync */ }
    }
  }

  // ---- reconcile one remote entry ------------------------------------------------------

  /** True when the remote value should replace (or delete) the local one. */
  function remoteWins(local, m, remote, first) {
    const localHash = local ? hashOf(local.value) : null
    const syncedHash = m && !m.deleted ? m.hash : null
    const localChanged = m ? localHash !== syncedHash : local != null
    if (!localChanged) return true
    if (remote.deleted) return false
    if (first) return true
    if (localHash === hashOf(remote.value)) return true
    return remote.updatedAt > now()
  }

  /** Apply one decoded remote entry; record the server state in meta. Returns true if local changed. */
  async function reconcile(meta, snap, target, remote, first) {
    if (!remote.deleted && !validValue(target, remote.value)) return false
    const local = snap.get(remote.id)
    const m = meta.entries[remote.id]
    let value = remote.value
    let write
    const merger = registry.mergers && registry.mergers[remote.id]
    const merged = !remote.deleted && local && merger && target.kind === 'plain'
      ? mergeRaw(merger, local.value, remote.value) : null
    if (merged != null) {
      value = merged
      write = true
    } else {
      write = remoteWins(local, m, remote, first)
    }
    meta.entries[remote.id] = {
      hash: remote.deleted ? null : hashOf(remote.value),
      updatedAt: remote.updatedAt,
      ...(remote.revision != null ? { revision: remote.revision } : {}),
      level: target.level,
      deleted: !!remote.deleted,
    }
    return write ? writeLocal(ctx, target, value, remote.deleted) : false
  }

  // ---- pull ----------------------------------------------------------------------------

  /** The whole feed since `since`, fetched before anything is written locally. */
  async function fetchFeed(since) {
    const items = []
    let cursor = since
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await client.getChanges(cursor, PAGE)
      const list = Array.isArray(page && page.items) ? page.items : []
      const next = Number.isInteger(page && page.cursor) ? page.cursor : cursor
      items.push(...list)
      if (!list.length || next <= cursor) break
      cursor = next
    }
    return { items, cursor }
  }

  async function decodeChange(c) {
    if (!isPlainObject(c) || !Number.isInteger(c.revision)) return null
    // Tombstones carry an encrypted payload too; without one the id cannot be verified.
    const p = await decodeItem(ck, c.id, c.ciphertext)
    if (!p) return null
    return { id: p.id, value: p.value, updatedAt: num(p.updatedAt), deleted: p.deleted === true, revision: c.revision }
  }

  async function pullItems() {
    const meta = load()
    const first = isFirstSync(meta)
    const feed = await fetchFeed(meta.cursor)
    const latest = new Map()
    for (const c of feed.items) {
      if (!isPlainObject(c) || typeof c.id !== 'string') continue
      const prev = latest.get(c.id)
      if (!prev || num(c.cursor) >= num(prev.cursor)) latest.set(c.id, c)
    }
    const { snap } = await readSnapshot(ctx)
    let applied = 0
    for (const c of latest.values()) {
      const remote = await decodeChange(c)
      if (!remote) continue
      const target = resolveTarget(registry, remote.id)
      if (!target || target.level !== 'account') continue
      const m = meta.entries[remote.id]
      if (m && m.revision === remote.revision) continue // already seen (often our own write)
      if (await reconcile(meta, snap, target, remote, first)) applied++
    }
    meta.cursor = Math.max(meta.cursor, feed.cursor)
    save(meta)
    return applied
  }

  async function pullDevice() {
    if (!deviceId) return 0
    const r = await client.getDevicePrefs(deviceId)
    const meta = load()
    const dp = meta.devicePrefs
    if (!r || !Number.isInteger(r.revision) || r.revision === dp.revision || !r.ciphertext) return 0
    let blob
    try { blob = await decryptJson(r.ciphertext, ck, DEVICE_CONTEXT + deviceId) } catch { return 0 }
    if (!isPlainObject(blob)) return 0
    const first = !dp.revision
    const entries = isPlainObject(blob.entries) ? blob.entries : {}
    const { snap } = await readSnapshot(ctx)
    let applied = 0
    const seen = new Set()
    for (const [id, e] of Object.entries(entries)) {
      const target = resolveTarget(registry, id)
      if (!isPlainObject(e) || !target || target.level !== 'device') continue
      seen.add(id)
      const remote = { id, value: e.value, updatedAt: num(e.updatedAt), deleted: false }
      if (await reconcile(meta, snap, target, remote, first)) applied++
    }
    // A tracked device entry missing from the blob was removed on (another install of) this device.
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level !== 'device' || m.deleted || seen.has(id)) continue
      const target = resolveTarget(registry, id)
      if (!target) continue
      if (await reconcile(meta, snap, target, { id, value: null, updatedAt: 0, deleted: true }, first)) applied++
    }
    const remotePrefs = isPlainObject(blob.prefs) ? blob.prefs : null
    if (devicePrefs && remotePrefs) {
      const local = await devicePrefs.collect()
      const localHash = hashOf(local)
      const unchanged = dp.prefsHash == null || localHash === dp.prefsHash
      if ((unchanged || num(blob.prefsUpdatedAt) > now()) && localHash !== hashOf(remotePrefs)) {
        await devicePrefs.apply(remotePrefs)
        applied++
      }
    }
    const values = {}
    for (const [id, e] of Object.entries(entries)) if (isPlainObject(e)) values[id] = e.value
    meta.devicePrefs = {
      hash: hashOf({ entries: values, prefs: remotePrefs }),
      revision: r.revision,
      prefsHash: hashOf(remotePrefs),
      prefsUpdatedAt: num(blob.prefsUpdatedAt),
    }
    save(meta)
    return applied
  }

  async function pullInner() {
    let applied = 0
    try {
      applied += await pullItems()
      applied += await pullDevice()
      return { applied }
    } finally {
      if (applied) emit(appliedListeners, { applied })
    }
  }

  // ---- push ----------------------------------------------------------------------------

  async function pushItemsRound(force) {
    const meta = load()
    const { snap, unreadable } = await readSnapshot(ctx)
    const out = []
    for (const [id, e] of snap) {
      if (e.level !== 'account') continue
      const m = meta.entries[id]
      const hash = hashOf(e.value)
      if (!force && m && !m.deleted && m.hash === hash) continue
      out.push({ id, value: e.value, hash, deleted: false, ifMatch: (m && m.revision) || 0 })
    }
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level !== 'account' || m.deleted || !(m.revision > 0) || snap.has(id) || unreadable.has(id)) continue
      if (!resolveTarget(registry, id)) continue
      out.push({ id, value: null, hash: null, deleted: true, ifMatch: m.revision })
    }
    const result = { pushed: 0, conflicts: [], tooLarge: [] }
    for (let i = 0; i < out.length; i += BATCH) {
      const chunk = out.slice(i, i + BATCH)
      const t = now()
      const byWid = new Map()
      const wire = []
      for (const c of chunk) {
        const payload = c.deleted ? { id: c.id, value: null, updatedAt: t, deleted: true } : { id: c.id, value: c.value, updatedAt: t }
        const { wid, ciphertext } = await encodeItem(ck, c.id, payload)
        byWid.set(wid, c)
        wire.push({ id: wid, ifMatch: c.ifMatch, ciphertext, deleted: c.deleted })
      }
      const results = await client.putItems(wire)
      for (const res of Array.isArray(results) ? results : []) {
        const c = isPlainObject(res) && byWid.get(res.id)
        if (!c) continue
        byWid.delete(res.id)
        if (res.status === 'ok' && Number.isInteger(res.revision)) {
          meta.entries[c.id] = { hash: c.hash, updatedAt: t, revision: res.revision, level: 'account', deleted: c.deleted }
          result.pushed++
        } else if (res.status === 'too_large') {
          result.tooLarge.push(c.id)
        } else {
          result.conflicts.push(c.id)
        }
      }
      for (const c of byWid.values()) result.conflicts.push(c.id) // unanswered: retried like a conflict
      save(meta)
    }
    return result
  }

  async function pushDeviceRound(force) {
    if (!deviceId) return 0
    const meta = load()
    const dp = meta.devicePrefs
    const { snap, unreadable } = await readSnapshot(ctx)
    for (const id of unreadable) if (resolveTarget(registry, id)?.level === 'device') return 0
    const prefs = devicePrefs ? await devicePrefs.collect() : null
    const values = {}
    for (const [id, e] of snap) if (e.level === 'device') values[id] = e.value
    const hash = hashOf({ entries: values, prefs: isPlainObject(prefs) ? prefs : null })
    if (!force && hash === dp.hash) return 0
    if (!dp.revision && !Object.keys(values).length && !isPlainObject(prefs)) return 0 // nothing to keep
    const t = now()
    const entries = {}
    for (const [id, value] of Object.entries(values)) {
      const m = meta.entries[id]
      entries[id] = { value, updatedAt: m && !m.deleted && m.hash === hashOf(value) ? m.updatedAt : t }
    }
    const prefsHash = hashOf(isPlainObject(prefs) ? prefs : null)
    const prefsUpdatedAt = prefsHash === dp.prefsHash && dp.prefsUpdatedAt ? dp.prefsUpdatedAt : t
    const blob = { v: 1, entries, prefs: isPlainObject(prefs) ? prefs : null, prefsUpdatedAt }
    const ciphertext = await encryptJson(blob, ck, DEVICE_CONTEXT + deviceId)
    const res = await client.putDevicePrefs(deviceId, ciphertext, dp.revision || 0)
    meta.devicePrefs = { hash, revision: res.revision, prefsHash, prefsUpdatedAt }
    for (const [id, e] of Object.entries(entries)) {
      meta.entries[id] = { hash: hashOf(e.value), updatedAt: e.updatedAt, level: 'device', deleted: false }
    }
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level === 'device' && !m.deleted && !(id in entries)) meta.entries[id] = { ...m, hash: null, deleted: true }
    }
    save(meta)
    return 1
  }

  async function pushInner(force) {
    let r = await pushItemsRound(force)
    let pushed = r.pushed
    if (r.conflicts.length) {
      // Someone else wrote first: take their changes in, re-merge, and try once more.
      await pullInner()
      r = await pushItemsRound(false)
      pushed += r.pushed
    }
    let conflicts = r.conflicts.length
    let device = 0
    const isConflict = (e) => !!e && e.code === 'conflict'
    try {
      device = await pushDeviceRound(force)
    } catch (e) {
      if (!isConflict(e)) throw e
      await pullDevice()
      try {
        device = await pushDeviceRound(false)
      } catch (e2) {
        if (!isConflict(e2)) throw e2
        conflicts++
      }
    }
    return { pushed, conflicts, tooLarge: r.tooLarge, devicePrefs: device > 0 }
  }

  // ---- public surface ------------------------------------------------------------------

  // Public operations run one at a time so a push never interleaves with a pull.
  let chain = Promise.resolve()
  const serial = (fn) => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
  const guarded = (fn) => serial(async () => {
    try {
      return await fn()
    } catch (error) {
      emit(errorListeners, error)
      return { error }
    }
  })

  const syncNow = singleFlight(() => guarded(async () => {
    const pulled = await pullInner()
    const pushed = await pushInner(false)
    const meta = load()
    meta.lastSyncAt = now()
    save(meta)
    return { applied: pulled.applied, ...pushed }
  }))

  let timer = null
  let onVisible = null
  let onOnline = null

  return {
    async snapshot() {
      return (await readSnapshot(ctx)).snap
    },
    pull: () => guarded(pullInner),
    push: () => guarded(() => pushInner(false)),
    seed: () => guarded(() => pushInner(true)),
    syncNow,

    start() {
      if (timer) return
      timer = setInterval(() => { syncNow() }, intervalMs)
      const doc = globalThis.document
      if (doc && typeof doc.addEventListener === 'function') {
        onVisible = () => { if (doc.visibilityState === 'visible') syncNow() }
        doc.addEventListener('visibilitychange', onVisible)
      }
      if (typeof globalThis.addEventListener === 'function') {
        onOnline = () => { syncNow() }
        globalThis.addEventListener('online', onOnline)
      }
      syncNow()
    },

    stop() {
      if (timer) clearInterval(timer)
      timer = null
      const doc = globalThis.document
      if (onVisible && doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisible)
      if (onOnline && typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', onOnline)
      onVisible = null
      onOnline = null
    },

    /** cb({ applied }) after a pull changed local data; callers reload. Returns an unsubscribe. */
    onApplied(cb) {
      appliedListeners.add(cb)
      return () => appliedListeners.delete(cb)
    },

    /** cb(error) for every failed operation; a 'session-expired' code means sign in again. */
    onError(cb) {
      errorListeners.add(cb)
      return () => errorListeners.delete(cb)
    },

    /** Last successful syncNow time (ms), or null. */
    lastSyncAt() {
      return load().lastSyncAt || null
    },
  }
}
