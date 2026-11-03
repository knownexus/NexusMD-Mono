// account-sync.js — converges a device's settings, secrets and per-device preferences with an
// end-to-end encrypted account (Milestone 1).
//
//   account-level entries  one encrypted item each, wire id = opaqueId(canonical id); payload
//                          { id, value, updatedAt, deleted? } bound to 'nexusmd-item|<wire id>'
//   device-level entries   plus the shell's device prefs, one encrypted blob per device bound to
//   (and tweaks.device)    'nexusmd-device-prefs|<deviceId>': { v, entries, prefs, prefsUpdatedAt }
//
// Rules, per entry:
//   - never seen from the server (no meta entry): the remote value wins on any conflict, so a
//     joining device (push, seed or pull alike) never overwrites account values
//   - local unchanged since the last sync: the remote change is applied
//   - both changed: last writer wins by the time each edit was first OBSERVED (`changedAt`,
//     stamped by observe()/every snapshot; the pushed updatedAt is that stamp); a tie goes to
//     the remote; remote times more than 5 minutes ahead are clamped
//   - lists with a registry merger (profiles) are merged, an unpushed local edit winning
//   - a remote deletion is applied only to a local value still equal to the last synced one; a
//     local removal is pushed only for an entry that was synced; tweaks halves never delete
// Network failures never touch local data: every public method resolves to { error }.
import { singleFlight } from '../sync/single-flight.js'
import { encryptJson } from './crypto.js'
import { AccountError } from './account-client.js'
import {
  DEVICE_CONTEXT, isPlainObject, hashOf, fingerprint, loadMeta, saveMeta, readSnapshot,
  resolveTarget, validValue, localChanged, stampChanges, unchangedSince, writeLocal, mergeRaw,
  encodeItem, decodeDeviceBlob, decodeChange, fetchFeed,
} from './account-sync-state.js'

const BATCH = 50
const MAX_SKEW_MS = 5 * 60 * 1000

const num = (v) => (Number.isFinite(v) ? v : 0)

/** `pageSize` is the change-feed page limit requested from the server (default 500). */
export function createAccountSync({
  client, containerKey: ck, registry, storage, secure, devicePrefs = null, deviceId, metaKey,
  now = Date.now, intervalMs = 60000, pageSize = 500,
}) {
  const ctx = { registry, storage, secure, metaKey }
  const appliedListeners = new Set()
  const errorListeners = new Set()
  const load = () => loadMeta(storage, metaKey)
  const save = (meta) => saveMeta(storage, metaKey, meta)
  const clampAt = (at) => Math.min(num(at), now() + MAX_SKEW_MS)

  const emit = (set, arg) => {
    for (const cb of [...set]) {
      try { cb(arg) } catch { /* a listener must not break sync */ }
    }
  }
  const emitApplied = (applied) => { if (applied) emit(appliedListeners, { applied }) }

  // ---- local observation -------------------------------------------------------------

  /** Snapshot plus change stamps (meta is mutated; the caller saves). */
  async function localState(meta) {
    const s = await readSnapshot(ctx, ck)
    s.dirty = stampChanges(meta, s.snap, s.isUnavailable, now())
    return s
  }

  /** Collect the shell's device prefs and stamp a change. Null without an adapter. */
  async function stampPrefs(meta) {
    if (!devicePrefs) return null
    const raw = await devicePrefs.collect()
    const prefs = isPlainObject(raw) ? raw : null
    const hash = hashOf(prefs)
    const dp = meta.devicePrefs
    if (dp.prefsHash == null || hash === dp.prefsHash) {
      delete dp.prefsChangedAt
      delete dp.prefsChangedHash
    } else if (dp.prefsChangedAt == null || dp.prefsChangedHash !== hash) {
      dp.prefsChangedAt = now()
      dp.prefsChangedHash = hash
    }
    return { prefs, hash }
  }

  async function observeInner() {
    const meta = load()
    const before = JSON.stringify(meta)
    await localState(meta)
    await stampPrefs(meta)
    if (JSON.stringify(meta) !== before) save(meta)
    return {}
  }

  // ---- reconcile one remote entry ----------------------------------------------------

  function remoteWins(local, m, remote, remoteHash, unavailable) {
    // Unavailable without a pending local edit (see reconcile): an absent tweaks key or a
    // broken entry is repaired from the account; deletions wait until it can be read.
    if (unavailable) return !remote.deleted
    if (!m) return remote.deleted ? !local : true
    if (!localChanged(m, local)) return true
    if (remote.deleted) return false
    if (local && local.hash === remoteHash) return true
    return clampAt(remote.updatedAt) >= (m.changedAt ?? now())
  }

  /**
   * Apply one decoded remote entry and record the server state in meta.
   * Returns 'applied' | 'same' | 'kept' | 'held' (nothing recorded; the entry is looked at
   * again next pull): local changed under us, or local exists but cannot be read right now
   * while it holds an unpushed edit.
   */
  async function reconcile(meta, state, target, remote) {
    if (!remote.deleted && !validValue(target, remote.value)) return 'kept'
    const { snap, isUnavailable, isUnreadable, rawOf } = state
    const local = snap.get(remote.id)
    const m = meta.entries[remote.id]
    // A record or field whose container does not parse is never written (that would drop the
    // other records): it waits until the key is readable again.
    const inContainer = target.kind === 'record' || target.kind === 'field'
    if (isUnreadable(remote.id) && (inContainer || (m && m.changedAt != null))) return 'held'
    const remoteHash = remote.deleted ? null : await fingerprint(target, remote.value, ck)
    const merger = target.kind === 'plain' && registry.mergers && registry.mergers[remote.id]
    const merged = !remote.deleted && local && merger
      ? mergeRaw(merger, local.value, remote.value, !!m && localChanged(m, local)) : null
    const write = merged != null || remoteWins(local, m, remote, remoteHash, isUnavailable(remote.id))
    if (write && !(await unchangedSince(ctx, target, rawOf(remote.id)))) return 'held'
    const rec = {
      hash: remoteHash,
      updatedAt: clampAt(remote.updatedAt),
      ...(remote.revision != null ? { revision: remote.revision } : {}),
      level: target.level,
      deleted: !!remote.deleted,
    }
    const keepsLocal = !write || (merged != null && merged !== remote.value)
    if (keepsLocal && m && m.changedAt != null) Object.assign(rec, { changedAt: m.changedAt, changedHash: m.changedHash })
    meta.entries[remote.id] = rec
    if (!write) return 'kept'
    const changed = await writeLocal(ctx, target, merged != null ? merged : remote.value, remote.deleted)
    if (changed && state.noteWritten) state.noteWritten(target) // the next record of this key compares against it
    return changed ? 'applied' : 'same'
  }

  // ---- pull --------------------------------------------------------------------------

  /**
   * The active profile is device-level, so a new device restores the profiles and their scoped
   * settings (`<ns>.p.<pid>.*`) but no active id, and the app would then read unscoped keys.
   * After a pull that wrote the profiles list, when the active id is missing or names no listed
   * profile, make the first profile active (the
   * one the UI already shows). A device blob that carries this device's own choice still wins
   * when pullDevice applies it. Returns true when it wrote.
   */
  function ensureActiveProfile() {
    const listKey = registry.toStorageKey('profiles')
    const activeKey = registry.toStorageKey('activeProfileId')
    if (!listKey || !activeKey) return false
    let list
    try { list = JSON.parse(storage.getItem(listKey) || '[]') } catch { return false }
    const ids = Array.isArray(list) ? list.filter((p) => isPlainObject(p) && typeof p.id === 'string' && p.id).map((p) => p.id) : []
    if (!ids.length) return false
    const cur = storage.getItem(activeKey)
    if (cur && ids.includes(cur)) return false
    storage.setItem(activeKey, ids[0])
    return true
  }

  async function pullItems() {
    const meta = load()
    const feed = await fetchFeed(client, meta.cursor, pageSize)
    const latest = new Map()
    for (const c of feed.items) {
      if (!isPlainObject(c) || typeof c.id !== 'string') continue
      const prev = latest.get(c.id)
      if (!prev || num(c.cursor) >= num(prev.cursor)) latest.set(c.id, c)
    }
    const decoded = []
    for (const c of latest.values()) {
      const remote = await decodeChange(ck, c)
      if (remote) decoded.push({ c, remote })
    }
    // The profiles list goes first, so the active profile is settled before profile-scoped
    // entries resolve their keys (Android keeps its tweaks per profile).
    decoded.sort((x, y) => (y.remote.id === 'profiles') - (x.remote.id === 'profiles'))
    let state = await localState(meta)
    let applied = 0
    let hold = Infinity
    let settled = false
    let profilesApplied = false // this pull wrote the profiles list (a restore)
    const settle = async () => {
      settled = true
      if (!profilesApplied || !ensureActiveProfile()) return
      applied++
      state = await localState(meta) // key names under the new active profile
    }
    for (const { c, remote } of decoded) {
      if (!settled && remote.id !== 'profiles') await settle()
      const target = resolveTarget(registry, remote.id)
      if (!target || target.level !== 'account') continue
      const m = meta.entries[remote.id]
      if (m && m.revision === remote.revision) continue // already seen (often our own write)
      const res = await reconcile(meta, state, target, remote)
      if (res === 'held') hold = Math.min(hold, num(c.cursor) - 1) // seen again next pull
      else if (res === 'applied') {
        applied++
        if (remote.id === 'profiles') profilesApplied = true
      }
    }
    if (!settled) await settle()
    meta.cursor = Math.max(meta.cursor, Math.min(feed.cursor, hold))
    save(meta)
    return applied
  }

  // ---- a removed device --------------------------------------------------------------
  // The server answers 404 for the prefs of a device that was removed from the account. That
  // must not stop this install from syncing account items: the device calls are skipped for the
  // rest of the operation, which then reports AccountError 'not-found' (see reportingRemoved).
  let deviceRemoved = false
  const isGone = (e) => !!e && e.code === 'not-found'

  /** The device blob, or null when the device was removed. */
  async function fetchDevicePrefs() {
    if (deviceRemoved) return null
    try {
      return await client.getDevicePrefs(deviceId)
    } catch (e) {
      if (!isGone(e)) throw e
      deviceRemoved = true
      return null
    }
  }

  async function pullDevice() {
    if (!deviceId) return 0
    const r = await fetchDevicePrefs()
    if (r == null) return 0
    const meta = load()
    const dp = meta.devicePrefs
    if (!isPlainObject(r) || !Number.isInteger(r.revision) || r.revision === dp.revision) return 0
    const blob = await decodeDeviceBlob(ck, deviceId, r.ciphertext)
    if (!blob) {
      // Empty or unreadable: adopt the revision so this device's next push can replace it.
      dp.revision = r.revision
      save(meta)
      return 0
    }
    const state = await localState(meta)
    const entries = isPlainObject(blob.entries) ? blob.entries : {}
    let applied = 0
    let held = false
    const count = (res) => { if (res === 'held') held = true; else if (res === 'applied') applied++ }
    const seen = new Set()
    for (const [id, e] of Object.entries(entries)) {
      const target = resolveTarget(registry, id)
      if (!isPlainObject(e) || !target || target.level !== 'device') continue
      seen.add(id)
      count(await reconcile(meta, state, target, { id, value: e.value, updatedAt: num(e.updatedAt), deleted: false }))
    }
    // A tracked device entry missing from a newer blob was removed by another install of this device.
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level !== 'device' || m.deleted || seen.has(id) || state.isUnavailable(id)) continue
      const target = resolveTarget(registry, id)
      if (!target || target.kind === 'tweaks') continue
      count(await reconcile(meta, state, target, { id, value: null, updatedAt: 0, deleted: true }))
    }
    if (devicePrefs && isPlainObject(blob.prefs)) {
      const cur = await stampPrefs(meta)
      const remoteHash = hashOf(blob.prefs)
      const wins = dp.prefsHash == null || cur.hash === dp.prefsHash || cur.hash === remoteHash
        || clampAt(blob.prefsUpdatedAt) >= (dp.prefsChangedAt ?? now())
      if (wins) {
        if (cur.hash !== remoteHash) {
          await devicePrefs.apply(blob.prefs)
          applied++
        }
        delete dp.prefsChangedAt
        delete dp.prefsChangedHash
      }
      dp.prefsHash = remoteHash
      dp.prefsUpdatedAt = clampAt(blob.prefsUpdatedAt)
    }
    if (!held) dp.revision = r.revision // a held entry is looked at again next pull
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
      emitApplied(applied)
    }
  }

  // ---- push --------------------------------------------------------------------------

  async function pushItemsRound(force) {
    const meta = load()
    const { snap, isUnavailable } = await localState(meta)
    const t = now()
    const out = []
    // Items the server rejected for size or quota wait until their value changes.
    const rejected = { too_large: [], quota: [] }
    for (const id of Object.keys(meta.rejected)) if (!snap.has(id)) delete meta.rejected[id]
    for (const [id, e] of snap) {
      if (e.level !== 'account') continue
      const m = meta.entries[id]
      const changed = !m || localChanged(m, e)
      if (!force && !changed) continue
      const held = meta.rejected[id]
      if (held && held.hash === e.hash && rejected[held.status]) { rejected[held.status].push(id); continue }
      const updatedAt = changed ? (m && m.changedAt != null ? m.changedAt : t) : clampAt(m.updatedAt ?? t)
      out.push({ id, value: e.value, hash: e.hash, deleted: false, ifMatch: (m && m.revision) || 0, updatedAt })
    }
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level !== 'account' || m.deleted || !(m.revision > 0) || snap.has(id) || isUnavailable(id)) continue
      const target = resolveTarget(registry, id)
      if (!target || target.kind === 'tweaks') continue // tweaks halves are never deleted
      out.push({ id, value: null, hash: null, deleted: true, ifMatch: m.revision, updatedAt: m.changedAt ?? t })
    }
    save(meta) // the observation stamps survive a failed upload
    const result = { pushed: 0, conflicts: [], tooLarge: rejected.too_large, quota: rejected.quota }
    for (let i = 0; i < out.length; i += BATCH) {
      const chunk = out.slice(i, i + BATCH)
      const byWid = new Map()
      const wire = []
      for (const c of chunk) {
        const payload = c.deleted
          ? { id: c.id, value: null, updatedAt: c.updatedAt, deleted: true }
          : { id: c.id, value: c.value, updatedAt: c.updatedAt }
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
          meta.entries[c.id] = { hash: c.hash, updatedAt: c.updatedAt, revision: res.revision, level: 'account', deleted: c.deleted }
          delete meta.rejected[c.id]
          result.pushed++
        } else if (res.status === 'too_large' || res.status === 'quota') {
          if (!c.deleted) meta.rejected[c.id] = { hash: c.hash, status: res.status }
          rejected[res.status].push(c.id)
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
    if (!deviceId || deviceRemoved) return { pushed: false }
    const meta = load()
    const dp = meta.devicePrefs
    const { snap, isUnavailable } = await localState(meta)
    const cur = await stampPrefs(meta)
    save(meta)
    const t = now()
    const local = [...snap].filter(([, e]) => e.level === 'device')
    const removed = Object.entries(meta.entries).filter(([id, m]) => m.level === 'device' && !m.deleted
      && !snap.has(id) && !isUnavailable(id) && resolveTarget(registry, id))
    const changed = removed.length > 0
      || local.some(([id, e]) => !meta.entries[id] || localChanged(meta.entries[id], e))
      || (cur != null && cur.hash !== dp.prefsHash)
    if (!force && !changed) return { pushed: false }
    if (!local.length && !removed.length && !cur && !dp.revision) return { pushed: false }

    // Build on the stored blob: it keeps what this install cannot judge (and the shell prefs
    // when this platform has no adapter). A newer blob than ours is a conflict: pull it first.
    const r = await fetchDevicePrefs()
    if (r == null) return { pushed: false }
    if (!isPlainObject(r) || r.revision !== (dp.revision || 0)) return { conflict: true }
    const prev = (await decodeDeviceBlob(ck, deviceId, r.ciphertext)) || {}
    const entries = {}
    for (const [id, e] of Object.entries(isPlainObject(prev.entries) ? prev.entries : {})) {
      if (isPlainObject(e) && (!resolveTarget(registry, id) || isUnavailable(id))) entries[id] = e
    }
    for (const [id, e] of local) {
      const m = meta.entries[id]
      const ch = !m || localChanged(m, e)
      entries[id] = { value: e.value, updatedAt: ch ? (m && m.changedAt != null ? m.changedAt : t) : clampAt(m.updatedAt ?? t) }
    }
    const prefs = cur ? cur.prefs : (isPlainObject(prev.prefs) ? prev.prefs : null)
    const prefsUpdatedAt = cur
      ? (cur.hash === dp.prefsHash ? (dp.prefsUpdatedAt ?? t) : (dp.prefsChangedAt ?? t))
      : num(prev.prefsUpdatedAt)
    const blob = { v: 1, entries, prefs, prefsUpdatedAt }
    let res
    try {
      res = await client.putDevicePrefs(deviceId, await encryptJson(blob, ck, DEVICE_CONTEXT + deviceId), r.revision)
    } catch (e) {
      if (e && e.code === 'conflict') return { conflict: true }
      if (isGone(e)) { deviceRemoved = true; return { pushed: false } }
      throw e
    }
    for (const [id, e] of local) meta.entries[id] = { hash: e.hash, updatedAt: entries[id].updatedAt, level: 'device', deleted: false }
    for (const [id, m] of removed) meta.entries[id] = { hash: null, updatedAt: m.changedAt ?? t, level: 'device', deleted: true }
    meta.devicePrefs = cur
      ? { revision: res.revision, prefsHash: cur.hash, prefsUpdatedAt }
      : { ...dp, revision: res.revision }
    save(meta)
    return { pushed: true }
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
    let d = await pushDeviceRound(force)
    if (d.conflict) {
      emitApplied(await pullDevice())
      d = await pushDeviceRound(false)
      if (d.conflict) conflicts++
    }
    return { pushed, conflicts, tooLarge: r.tooLarge, quota: r.quota, devicePrefs: !!d.pushed }
  }

  // ---- public surface ----------------------------------------------------------------

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

  // Runs fn with the device calls enabled, then reports a removed device as AccountError
  // 'not-found' (onError and { error }) once the account items are done.
  const reportingRemoved = (fn) => async () => {
    deviceRemoved = false
    const r = await fn()
    if (deviceRemoved) throw new AccountError('not-found', 404, 'This device was removed from the account')
    return r
  }

  const observe = () => guarded(observeInner)

  const syncNow = singleFlight(() => guarded(reportingRemoved(async () => {
    await observeInner() // stamps an offline edit even when the network calls below fail
    const pulled = await pullInner()
    const pushed = await pushInner(false)
    if (deviceRemoved) return null // reported by reportingRemoved; not a completed sync
    const meta = load()
    meta.lastSyncAt = now()
    save(meta)
    return { applied: pulled.applied, ...pushed }
  })))

  /** A sync, or (when one is already running) at least an observation of local edits. */
  const kick = () => syncNow().then((r) => (r && r.skipped ? observe() : r))

  let timer = null
  let onVisibility = null
  let onOnline = null

  return {
    async snapshot() {
      return (await readSnapshot(ctx, ck)).snap
    },
    /** Local only: stamp the time of local edits, no network, nothing applied. */
    observe,
    pull: () => guarded(reportingRemoved(pullInner)),
    push: () => guarded(reportingRemoved(() => pushInner(false))),
    seed: () => guarded(reportingRemoved(() => pushInner(true))),
    syncNow,

    start() {
      if (timer) return
      timer = setInterval(kick, intervalMs)
      const doc = globalThis.document
      if (doc && typeof doc.addEventListener === 'function') {
        onVisibility = () => { if (doc.visibilityState === 'visible') kick(); else observe() }
        doc.addEventListener('visibilitychange', onVisibility)
      }
      if (typeof globalThis.addEventListener === 'function') {
        onOnline = kick
        globalThis.addEventListener('online', onOnline)
      }
      kick()
    },

    stop() {
      if (timer) clearInterval(timer)
      timer = null
      const doc = globalThis.document
      if (onVisibility && doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility)
      if (onOnline && typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', onOnline)
      onVisibility = null
      onOnline = null
    },

    /** cb({ applied }) after a pull changed local data; callers reload. Returns an unsubscribe. */
    onApplied(cb) {
      appliedListeners.add(cb)
      return () => appliedListeners.delete(cb)
    },

    /**
     * cb(error) for every failed operation; a 'session-expired' code means sign in again, and
     * 'not-found' means this device was removed from the account (pick a device again).
     */
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
