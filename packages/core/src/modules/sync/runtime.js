// runtime.js — generic sync orchestrator. Pulls an encrypted per-profile manifest,
// reconciles each collection item (push/pull/merge/delete) via the core engine,
// maintains per-item base snapshots, and re-uploads the manifest as the commit.
import { reconcileItem } from './reconcile.js';
import { contentHash } from './hash.js';
import { encryptSync, decryptSync } from './crypto.js';
import { badPassphrase } from './errors.js';

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
    try { if (value == null) storage.removeItem(baseKey(full)); else storage.setItem(baseKey(full), JSON.stringify(value)); } catch {}
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
          const local = coll.readLocal(itemKey);
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

  return { syncNow };
}
