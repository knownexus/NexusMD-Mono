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
//   - desktop (nexusmd), values the owner edits (`auto` false, account level): see the conflict
//     queue below — two devices' different values are parked for the owner, never overwritten
//   - otherwise, both changed: last writer wins by the time each edit was first OBSERVED (`changedAt`,
//     stamped by observe()/every snapshot; the pushed updatedAt is that stamp); a tie goes to
//     the remote; remote times more than 5 minutes ahead are clamped
//   - lists with a registry merger (profiles) are merged, an unpushed local edit winning
//   - a remote deletion is applied only to a local value still equal to the last synced one; a
//     local removal is pushed only for an entry that was synced; tweaks halves never delete
// Network failures never touch local data: every public method resolves to { error }.
import { singleFlight } from '../sync/single-flight.js'
import { encryptJson, decryptJson } from './crypto.js'
import { AccountError } from './account-client.js'
import { purgeProfileLocal } from './account-clear.js'
import {
  DEVICE_CONTEXT, isPlainObject, hashOf, fingerprint, loadMeta, saveMeta, readSnapshot,
  resolveTarget, validValue, localChanged, stampChanges, unchangedSince, writeLocal, mergeRaw,
  encodeItem, decodeDeviceBlob, decodeChange, fetchFeed, stableJson, readSnapshot as readState, listUnpushed,
} from './account-sync-state.js'

// A secret's remote value in a conflict is kept sealed under the container key: meta lives in
// plain localStorage.
const CONFLICT_CONTEXT = 'nexusmd-conflict|'

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
  const conflictListeners = new Set()
  const conflictCount = () => Object.keys(load().conflicts).length

  // ---- conflict queue (desktop) ------------------------------------------------------
  // On nexusmd, an account-level value the owner edits (not `auto`, not a merged list) that
  // differs between this device and the server is never overwritten by either side:
  //   - identical fingerprints: synced, no conflict (a parked conflict clears on its own);
  //   - never seen from the server: the remote value is taken when nothing is here, or when
  //     the id was a per-device setting in Milestone 1 (a one-time adoption of the server's view
  //     settings at the upgrade); any other local value conflicts;
  //   - seen before: the remote change is taken when the local value is still the synced one,
  //     otherwise it conflicts (a local or remote deletion included).
  // A conflict is kept in meta.conflicts until resolve()/keepBoth(); its id is never pushed
  // meanwhile, everything else keeps syncing. Android (helm) keeps last-writer-wins.
  const queues = registry.namespace === 'nexusmd'

  // ---- profile lifecycle (desktop) ---------------------------------------------------
  // A profile record with `purgedAt` is a tombstone: the profile's items are never written
  // back here (a pull only records the server state), never pushed, and its local data goes
  // as soon as nothing of it is unpushed. With unpushed edits the data is kept and the purge
  // waits in meta.pendingPurges until confirmPurge(pid) (the owner can export first).
  const pendingListeners = new Set()
  const pendingCount = () => Object.keys(load().pendingPurges).length

  function profilesList() {
    const key = registry.toStorageKey('profiles')
    try {
      const list = JSON.parse((key && storage.getItem(key)) || '[]')
      return Array.isArray(list) ? list.filter((p) => isPlainObject(p) && typeof p.id === 'string' && p.id) : []
    } catch { return [] }
  }
  /** pid -> name of every purged profile (desktop only). */
  function purgedProfiles() {
    const out = new Map()
    if (!queues) return out
    for (const p of profilesList()) if (p.purgedAt) out.set(p.id, typeof p.name === 'string' ? p.name : p.id)
    return out
  }
  const profileOfId = (id) => (registry.profileOf ? registry.profileOf(id) : null)
  const inPurged = (purged, id) => { const pid = profileOfId(id); return !!pid && purged.has(pid) }

  function hasLocalData(pid) {
    const keyPrefix = `${registry.namespace}.p.${pid}.`
    const secPrefix = `${registry.namespace}.sec.${keyPrefix}`
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (typeof k === 'string' && (k.startsWith(keyPrefix) || k.startsWith(secPrefix))) return true
    }
    return false
  }

  /** Remove a profile's local data, its open conflicts and its pending purge (meta is mutated). */
  async function purgeLocal(meta, pid) {
    await purgeProfileLocal({ storage, secure, namespace: registry.namespace, pid })
    for (const [id, c] of Object.entries(meta.conflicts)) if (c.profileId === pid || profileOfId(id) === pid) delete meta.conflicts[id]
    delete meta.pendingPurges[pid]
  }

  /**
   * After the profiles list was settled in a pull: purge here every purged profile that still has
   * local data, or park it as pending when some of it is unpushed. True when data was removed.
   */
  async function applyPurges(meta, state) {
    let removed = false
    for (const [pid, name] of purgedProfiles()) {
      if (meta.pendingPurges[pid] || !hasLocalData(pid)) continue
      const unpushed = []
      for (const [id, e] of state.snap) {
        if (e.level !== 'account' || profileOfId(id) !== pid) continue
        const m = meta.entries[id]
        if (!m || localChanged(m, e) || meta.conflicts[id]) unpushed.push(id)
      }
      if (unpushed.length) meta.pendingPurges[pid] = { pid, name, unpushed: unpushed.sort() }
      else { await purgeLocal(meta, pid); removed = true }
    }
    return removed
  }
  const ownerEdited = (target) => queues && target.level === 'account' && !target.auto && target.kind !== 'tweaks'

  // ---- local observation -------------------------------------------------------------

  /** Snapshot plus change stamps (meta is mutated; the caller saves). */
  async function localState(meta) {
    const s = await readSnapshot(ctx, ck)
    s.dirty = stampChanges(meta, s.snap, s.isUnavailable, now())
    s.purged = purgedProfiles()
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
    if (state.purged && inPurged(state.purged, remote.id)) {
      meta.entries[remote.id] = {
        hash: remote.deleted ? null : await fingerprint(target, remote.value, ck),
        updatedAt: clampAt(remote.updatedAt),
        ...(remote.revision != null ? { revision: remote.revision } : {}),
        level: target.level,
        deleted: !!remote.deleted,
      }
      delete meta.conflicts[remote.id]
      return 'kept' // a purged profile is never written back here
    }
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
    if (!merger && ownerEdited(target) && !isUnavailable(remote.id)) return reconcileOwned(meta, state, target, remote, remoteHash)
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

  async function reconcileOwned(meta, state, target, remote, remoteHash) {
    const id = remote.id
    const local = state.snap.get(id)
    const m = meta.entries[id]
    const record = () => ({
      hash: remoteHash,
      updatedAt: clampAt(remote.updatedAt),
      ...(remote.revision != null ? { revision: remote.revision } : {}),
      level: target.level,
      deleted: !!remote.deleted,
    })
    if ((local ? local.hash : null) === remoteHash) {
      meta.entries[id] = record()
      delete meta.conflicts[id]
      return 'same'
    }
    const take = m ? !localChanged(m, local) : (!local || !!(registry.wasDeviceLevelInM1 && registry.wasDeviceLevelInM1(id)))
    if (take) {
      if (!(await unchangedSince(ctx, target, state.rawOf(id)))) return 'held'
      meta.entries[id] = record()
      delete meta.conflicts[id]
      const changed = await writeLocal(ctx, target, remote.value, remote.deleted)
      if (changed && state.noteWritten) state.noteWritten(target)
      return changed ? 'applied' : 'same'
    }
    const secret = target.kind === 'secret'
    const prev = meta.conflicts[id]
    meta.conflicts[id] = {
      id,
      profileId: registry.profileOf ? registry.profileOf(id) : null,
      kind: target.kind,
      local: { value: secret || !local ? null : local.value, deleted: !local },
      remote: {
        value: secret || remote.deleted ? null : remote.value,
        ...(secret && !remote.deleted ? { sealed: await encryptJson({ v: remote.value }, ck, CONFLICT_CONTEXT + id) } : {}),
        deleted: !!remote.deleted,
        updatedAt: clampAt(remote.updatedAt),
        revision: remote.revision ?? 0,
      },
      detectedAt: prev && prev.detectedAt ? prev.detectedAt : now(),
    }
    return 'kept'
  }

  /** A conflict's remote value (unsealed for a secret), or null for a deletion. */
  async function remoteValueOf(c) {
    if (c.remote.deleted) return null
    if (c.remote.sealed) return (await decryptJson(c.remote.sealed, ck, CONFLICT_CONTEXT + c.id)).v
    return c.remote.value
  }

  /** Write one item over the conflict's remote revision; throws AccountError when refused. */
  async function pushResolved(c, value, deleted) {
    const t = now()
    const payload = deleted ? { id: c.id, value: null, updatedAt: t, deleted: true } : { id: c.id, value, updatedAt: t }
    const { wid, ciphertext } = await encodeItem(ck, c.id, payload)
    const results = await client.putItems([{ id: wid, ifMatch: c.remote.revision || 0, ciphertext, deleted }])
    const res = (Array.isArray(results) ? results : []).find((r) => isPlainObject(r) && r.id === wid)
    if (!res || res.status !== 'ok' || !Number.isInteger(res.revision)) {
      const status = res && res.status
      const full = status === 'too_large' || status === 'quota'
      throw new AccountError(full ? status : 'conflict', 409,
        full ? 'The account cannot hold this value' : 'The item changed again on another device; sync and try again')
    }
    return { revision: res.revision, updatedAt: t }
  }

  function openConflict(meta, id) {
    const c = meta.conflicts[id]
    const target = c && resolveTarget(registry, id)
    if (!c || !target) throw new AccountError('not-found', 0, 'No such conflict')
    return { c, target }
  }

  async function resolveInner(id, choice) {
    const { c, target } = openConflict(load(), id)
    if (choice && choice.take === 'remote') {
      const value = await remoteValueOf(c)
      if (!c.remote.deleted && !validValue(target, value)) throw new AccountError('invalid', 0, 'The stored remote value does not fit this item')
      const changed = await writeLocal(ctx, target, value, c.remote.deleted)
      const after = load()
      after.entries[id] = {
        hash: c.remote.deleted ? null : await fingerprint(target, value, ck),
        updatedAt: c.remote.updatedAt, revision: c.remote.revision, level: target.level, deleted: c.remote.deleted,
      }
      delete after.conflicts[id]
      save(after)
      emitApplied(changed ? 1 : 0)
      return {}
    }
    let value
    let deleted = false
    if (choice && choice.take === 'local') {
      const e = (await readState(ctx, ck)).snap.get(id)
      deleted = !e
      value = e ? e.value : null
    } else if (choice && typeof choice.value === 'string') {
      value = choice.value
      if (target.kind === 'record' || target.kind === 'field') {
        try { value = stableJson(JSON.parse(value)) } catch { value = null }
      }
      if (value == null || !validValue(target, value)) throw new AccountError('invalid', 0, 'The value does not fit this item')
    } else {
      throw new AccountError('invalid', 0, 'Choose take: local, take: remote, or a value')
    }
    const pushed = await pushResolved(c, value, deleted)
    const changed = choice.take === 'local' ? false : await writeLocal(ctx, target, value, false)
    const after = load()
    after.entries[id] = {
      hash: deleted ? null : await fingerprint(target, value, ck),
      updatedAt: pushed.updatedAt, revision: pushed.revision, level: 'account', deleted,
    }
    delete after.conflicts[id]
    save(after)
    emitApplied(changed ? 1 : 0)
    return {}
  }

  async function keepBothInner(id, { copyName = (n) => n } = {}) {
    const { c, target } = openConflict(load(), id)
    if (c.kind !== 'record' || target.kind !== 'record') throw new AccountError('invalid', 0, 'Keep both is only for records')
    const remoteRaw = await remoteValueOf(c)
    await resolveInner(id, { take: 'local' }) // the original id keeps this device's version
    if (remoteRaw == null) return {} // deleted elsewhere: nothing to copy
    const copy = { ...JSON.parse(remoteRaw), id: `${target.recordId}-c${now()}` }
    for (const f of ['name', 'title']) if (typeof copy[f] === 'string') copy[f] = copyName(copy[f])
    if (await writeLocal(ctx, { ...target, recordId: copy.id }, stableJson(copy), false)) emitApplied(1)
    return {} // the copy is a new local record: the next push sends it
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
    const ids = Array.isArray(list) ? list.filter((p) => isPlainObject(p) && typeof p.id === 'string' && p.id && !p.purgedAt).map((p) => p.id) : []
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
      state.purged = purgedProfiles()
      let reread = await applyPurges(meta, state)
      if (profilesApplied && ensureActiveProfile()) { applied++; reread = true }
      if (reread) state = await localState(meta) // key names under the new active profile / purged data gone
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
    const { snap, isUnavailable, purged } = await localState(meta)
    const t = now()
    const out = []
    // Items the server rejected for size or quota wait until their value changes.
    const rejected = { too_large: [], quota: [] }
    for (const id of Object.keys(meta.rejected)) if (!snap.has(id)) delete meta.rejected[id]
    for (const [id, e] of snap) {
      if (e.level !== 'account' || meta.conflicts[id]) continue // a conflict waits for the owner
      if (purged.has(profileOfId(id))) continue // a purged profile is never resurrected
      const m = meta.entries[id]
      const changed = !m || localChanged(m, e)
      if (!force && !changed) continue
      const held = meta.rejected[id]
      if (held && held.hash === e.hash && rejected[held.status]) { rejected[held.status].push(id); continue }
      const updatedAt = changed ? (m && m.changedAt != null ? m.changedAt : t) : clampAt(m.updatedAt ?? t)
      out.push({ id, value: e.value, hash: e.hash, deleted: false, ifMatch: (m && m.revision) || 0, updatedAt })
    }
    for (const [id, m] of Object.entries(meta.entries)) {
      if (m.level !== 'account' || m.deleted || !(m.revision > 0) || snap.has(id) || isUnavailable(id) || meta.conflicts[id]) continue
      if (meta.pendingPurges[profileOfId(id)]) continue // its data is kept until the owner confirms
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
    const before = conflictCount()
    const pendingBefore = pendingCount()
    try {
      return await fn()
    } catch (error) {
      emit(errorListeners, error)
      return { error }
    } finally {
      const count = conflictCount()
      if (count > before) emit(conflictListeners, { count })
      const pending = pendingCount()
      if (pending > pendingBefore) emit(pendingListeners, { count: pending })
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

  // A failed syncNow leaves its message for status(); the next completed one clears it.
  const recordingError = (fn) => async () => {
    try {
      return await fn()
    } catch (e) {
      const meta = load()
      meta.lastError = String((e && (e.message || e.code)) || 'Sync failed')
      save(meta)
      throw e
    }
  }

  const syncNow = singleFlight(() => guarded(recordingError(reportingRemoved(async () => {
    await observeInner() // stamps an offline edit even when the network calls below fail
    const pulled = await pullInner()
    const pushed = await pushInner(false)
    if (deviceRemoved) return null // reported by reportingRemoved; not a completed sync
    const meta = load()
    const t = now()
    meta.lastSyncAt = t
    // one round covers every profile in the list (a purged one has nothing left to sync)
    meta.profileSync = { ...(meta.profileSync || {}) }
    for (const p of profilesList()) if (!p.purgedAt) meta.profileSync[p.id] = t
    delete meta.lastError
    save(meta)
    return { applied: pulled.applied, ...pushed }
  }))))

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

    /**
     * Open conflicts: { id, profileId, kind: 'record'|'field'|'plain'|'secret', local: { value,
     * deleted }, remote: { value, deleted, updatedAt, revision }, detectedAt }. A secret's values
     * are null here (never shown); resolve() still takes either side.
     */
    conflicts() {
      return Object.values(load().conflicts).map((c) => ({
        id: c.id, profileId: c.profileId ?? null, kind: c.kind,
        local: { value: c.local?.value ?? null, deleted: !!c.local?.deleted },
        remote: { value: c.remote?.value ?? null, deleted: !!c.remote?.deleted, updatedAt: c.remote?.updatedAt ?? 0, revision: c.remote?.revision ?? 0 },
        detectedAt: c.detectedAt ?? 0,
      }))
    },

    /**
     * Settle a conflict: { take: 'remote' } writes the server's value here; { take: 'local' } or
     * { value } (a merged result) is pushed over the server's revision, then kept here. Resolves
     * {} or { error } (code 'conflict' when the item changed again: sync, then resolve again).
     */
    resolve: (id, choice) => guarded(() => resolveInner(id, choice)),

    /**
     * Records only: this device's version keeps the id, the server's is added beside it as a new
     * record (id `<record id>-c<time>`, name/title passed through copyName). Resolves {} or { error }.
     */
    keepBoth: (id, opts) => guarded(() => keepBothInner(id, opts)),

    /**
     * Purge a profile everywhere: its record becomes a tombstone, every synced item of it is
     * deleted on the server, and its local keys and secrets go. Resolves {} or { error }.
     */
    purgeProfile: (pid) => guarded(async () => {
      const key = registry.toStorageKey('profiles')
      const list = profilesList()
      const p = list.find((r) => r.id === pid)
      if (!key || !queues || !p) throw new AccountError('not-found', 0, 'No such profile')
      if (!p.purgedAt) {
        const t = now()
        const tomb = { id: p.id, name: p.name, updatedAt: Math.max(t, (Number.isFinite(p.updatedAt) ? p.updatedAt : 0) + 1), deletedAt: p.deletedAt ?? t, purgedAt: t }
        storage.setItem(key, JSON.stringify(list.map((r) => (r.id === pid ? tomb : r))))
      }
      const meta = load()
      await purgeLocal(meta, pid)
      save(meta)
      const r = await pushInner(false)
      return r.conflicts ? { conflicts: r.conflicts } : {}
    }),

    /** Local values not on the server yet, plus open conflicts: [{ id, profileId }] (secrets not judged). */
    unpushed: () => listUnpushed({ registry, storage, metaKey }),

    /** Purges brought by a pull that wait for the owner: [{ pid, name, unpushed: ids }]. */
    pendingPurges() {
      return Object.values(load().pendingPurges).map((p) => ({ pid: p.pid, name: p.name, unpushed: [...(p.unpushed || [])] }))
    },

    /** Discard a pending purge's local data (after the owner exported what they want to keep). */
    confirmPurge: (pid) => guarded(async () => {
      const meta = load()
      if (!meta.pendingPurges[pid]) throw new AccountError('not-found', 0, 'No pending purge for this profile')
      await purgeLocal(meta, pid)
      save(meta)
      return {}
    }),

    /** cb({ count }) whenever the pending-purge list grows. Returns an unsubscribe. */
    onPendingPurge(cb) {
      pendingListeners.add(cb)
      return () => pendingListeners.delete(cb)
    },

    /** cb({ count }) whenever the conflict queue grows. Returns an unsubscribe. */
    onConflict(cb) {
      conflictListeners.add(cb)
      return () => conflictListeners.delete(cb)
    },

    /**
     * { lastSyncAt, profiles: { [pid]: { lastSyncAt, conflicts, tooLarge, quota, error } } } for
     * every profile in the list but purged ones. tooLarge / quota list the profile's ids the server
     * refused; error is the last failed syncNow's message (shared: one round covers all profiles).
     */
    status() {
      const meta = load()
      const profiles = {}
      for (const p of profilesList()) {
        if (p.purgedAt) continue
        profiles[p.id] = { lastSyncAt: (meta.profileSync && meta.profileSync[p.id]) || null, conflicts: 0, tooLarge: [], quota: [], error: meta.lastError || null }
      }
      for (const [id, c] of Object.entries(meta.conflicts)) {
        const row = profiles[c.profileId ?? profileOfId(id)]
        if (row) row.conflicts++
      }
      for (const [id, r] of Object.entries(meta.rejected)) {
        const row = profiles[profileOfId(id)]
        if (!row || !r) continue
        if (r.status === 'too_large') row.tooLarge.push(id)
        else if (r.status === 'quota') row.quota.push(id)
      }
      for (const row of Object.values(profiles)) { row.tooLarge.sort(); row.quota.sort() }
      return { lastSyncAt: meta.lastSyncAt || null, profiles }
    },

    /** Last successful syncNow time (ms), or null. */
    lastSyncAt() {
      return load().lastSyncAt || null
    },
  }
}
