// runtime.js — generic sync orchestrator. Pulls an encrypted per-profile manifest,
// reconciles each collection item (push/pull/merge/delete) via the core engine,
// maintains per-item base snapshots, and re-uploads the manifest as the commit.
import { reconcileItem } from './reconcile.js';
import { contentHash } from './hash.js';
import { encryptSync, decryptSync } from './crypto.js';
import { badPassphrase } from './errors.js';
import { CorruptLocalError } from './collections.js';
import { rendererLog, ignore } from '../../log.js';

const log = rendererLog('sync', 'restore');

const VERIFIER_TOKEN = 'nexusmd-sync-verifier';

export function createSyncRuntime({
  storage, getProfileKey, namespace, profileId, cloud, getKey, deviceId,
  collections, now = () => Date.now(), onChanged,
}) {
  let inFlight = false;
  const fileName = (coll, key) => `nmdsync__${profileId}__${coll}__${key}.nmdsync`;
  const manifestName = `nmdsync__${profileId}__manifest.json`;
  const baseKey = (full) => getProfileKey(`${namespace}.sync.base.${full.replace('/', '.')}`);

  const readBase = (full) => {
    try { const raw = storage.getItem(baseKey(full)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const writeBase = (full, value) => {
    try { if (value == null) storage.removeItem(baseKey(full)); else storage.setItem(baseKey(full), JSON.stringify(value)); } catch (err) { ignore(log, 'the merge base for an item could not be saved (storage full or blocked); the next sync merges without it', err, 'warn'); }
  };

  async function syncNow() {
    if (inFlight) return { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    const key = await getKey();
    if (!key) return { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    inFlight = true;
    const stats = { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    try {
      let manifest = { items: {}, tombstones: [] };
      const mText = await cloud.getText(manifestName);
      if (mText) {
        try { manifest = await decryptSync(mText, key); }
        catch { throw badPassphrase(); }
      }
      manifest.items = manifest.items || {};
      manifest.tombstones = manifest.tombstones || [];
      if (manifest.verifier) {
        let ok = false;
        try { ok = (await decryptSync(manifest.verifier, key)) === VERIFIER_TOKEN; } catch { ok = false; }
        if (!ok) throw badPassphrase();
      }
      const next = { items: { ...manifest.items }, tombstones: [...manifest.tombstones], version: 1, format: 'nexusmd-sync-manifest' };
      next.verifier = manifest.verifier || await encryptSync(VERIFIER_TOKEN, key);
      const tomb = new Set(manifest.tombstones);
      let dirty = false;

      for (const coll of collections) {
        const localKeys = coll.listLocal();
        const fullKeys = new Set([
          ...localKeys.map(k => `${coll.id}/${k}`),
          ...Object.keys(manifest.items).filter(fk => fk.startsWith(coll.id + '/')),
        ]);
        for (const full of fullKeys) {
          const itemKey = full.slice(coll.id.length + 1);
          // An item whose stored value is unreadable is neither pushed, pulled nor deleted: reading it as
          // "absent" would be taken for a deletion on this device and wipe it from the cloud and every other
          // device. Leave it (and its manifest entry) exactly as it is, and say so in the result.
          let local;
          try { local = coll.readLocal(itemKey); }
          catch (err) {
            if (!(err instanceof CorruptLocalError)) throw err;
            (stats.unreadable ??= []).push(full);
            continue;
          }
          const base = readBase(full);
          const entry = manifest.items[full];
          const isTomb = tomb.has(full);

          let remote = null;
          if (entry && !isTomb && entry.hash !== contentHash(local)) {
            const rText = await cloud.getText(fileName(coll.id, itemKey));
            if (rText) { try { remote = await decryptSync(rText, key); } catch { remote = null; } }
          } else if (entry && !isTomb) {
            remote = local; // hashes equal → treat as same, avoids a download
          }

          const { action, value, conflicts } = reconcileItem({
            base, local, remote,
            merge: (b, l, r) => coll.merge(b, l, r, { from: deviceId, prefer: 'local' }),
          });

          if (action === 'push' || action === 'merge') {
            if (action === 'merge') { coll.writeLocal(itemKey, value); onChanged?.(coll.id); stats.merged++; stats.conflicts.push(...conflicts); }
            await cloud.upload(fileName(coll.id, itemKey), await encryptSync(value, key));
            writeBase(full, value);
            next.items[full] = { hash: contentHash(value), modifiedAt: now(), deviceId };
            if (action === 'push') stats.pushed++;
            tomb.delete(full);
            next.tombstones = next.tombstones.filter(t => t !== full);
            dirty = true;
          } else if (action === 'pull') {
            coll.writeLocal(itemKey, value);
            writeBase(full, value);
            next.items[full] = entry || { hash: contentHash(value), modifiedAt: now(), deviceId };
            onChanged?.(coll.id);
            stats.pulled++;
          } else if (action === 'delete-local') {
            coll.removeLocal(itemKey);
            writeBase(full, null);
            delete next.items[full];
            onChanged?.(coll.id);
          } else if (action === 'tombstone') {
            await cloud.remove(fileName(coll.id, itemKey));
            writeBase(full, null);
            delete next.items[full];
            if (!tomb.has(full)) { next.tombstones.push(full); tomb.add(full); }
            dirty = true;
          } else {
            if (entry && !isTomb) next.items[full] = entry;
          }
        }
      }

      if (dirty || mText == null) {
        await cloud.upload(manifestName, await encryptSync(next, key));
      }
      return stats;
    } finally {
      inFlight = false;
    }
  }

  /**
   * Replaces items this device cannot read (see syncNow's `unreadable`) with the copy the cloud holds. A user
   * action, since it overwrites: the damaged text is kept first (and nothing is replaced if that fails), a
   * readable item or one the cloud does not have is left alone, and each item stands on its own.
   * @param {string[]} items  "<collection>/<item>", as listed in `unreadable`
   * @returns {{ restored: { item: string, backup: string }[], failed: { item: string, reason: string }[] }}
   *   reasons: unknown, readable, not-in-cloud, cloud-copy-unreadable, could-not-back-up, could-not-write
   */
  async function restore(items) {
    const key = await getKey();
    if (!key) throw new Error('no sync key');
    const mText = await cloud.getText(manifestName);
    let manifest = { items: {}, tombstones: [] };
    if (mText) {
      try { manifest = await decryptSync(mText, key); }
      catch { throw badPassphrase(); }
    }
    const tomb = new Set(manifest.tombstones || []);
    const result = { restored: [], failed: [] };
    const fail = (item, reason) => { result.failed.push({ item, reason }); };

    for (const full of items) {
      const slash = full.indexOf('/');
      const coll = slash > 0 ? collections.find(c => c.id === full.slice(0, slash)) : null;
      if (!coll) { fail(full, 'unknown'); continue; }
      const itemKey = full.slice(slash + 1);

      // only an item that cannot be read right now
      try { coll.readLocal(itemKey); fail(full, 'readable'); continue; }
      catch (err) { if (!(err instanceof CorruptLocalError)) throw err; }

      if (!manifest.items?.[full] || tomb.has(full)) { fail(full, 'not-in-cloud'); continue; }
      const rText = await cloud.getText(fileName(coll.id, itemKey));
      if (!rText) { fail(full, 'not-in-cloud'); continue; }
      let remote;
      try { remote = await decryptSync(rText, key); }
      catch (err) { log.warn('the cloud copy of an item could not be read, so it was not restored', { item: full }); fail(full, 'cloud-copy-unreadable'); continue; }
      if (remote === null || remote === undefined) { fail(full, 'not-in-cloud'); continue; }

      let backup;
      try { backup = coll.quarantineLocal(itemKey); }
      catch (err) { log.error('the damaged copy of an item could not be kept, so nothing was replaced', err, { item: full }); fail(full, 'could-not-back-up'); continue; }

      coll.writeLocal(itemKey, remote);
      try { coll.readLocal(itemKey); }
      catch (err) { if (!(err instanceof CorruptLocalError)) throw err; fail(full, 'could-not-write'); continue; }
      writeBase(full, remote);
      onChanged?.(coll.id);
      log.warn('restored an unreadable item from the cloud; the damaged copy was kept', { item: full, backup });
      result.restored.push({ item: full, backup });
    }
    return result;
  }

  return { syncNow, restore };
}
