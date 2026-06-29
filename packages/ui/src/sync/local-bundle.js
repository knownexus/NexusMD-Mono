// local-bundle.js — export/import the active profile's synced collections as a
// single AES-GCM-encrypted file. Reuses the same collection adapters and crypto
// as createSyncRuntime, so a file written by one instance imports (and merges)
// cleanly into any other. Import is loss-free: each item is 3-way-merged into
// local with base=null (keep-both union; keyval prefers local).
import { contentHash } from '@nexusmd/core';
import { encryptSync, decryptSync } from './crypto.js';
import { badPassphrase } from './errors.js';

const FORMAT = 'nexusmd-planner-bundle';

export async function exportBundle({ collections, getKey, profileId }) {
  const key = await getKey();
  if (!key) throw new Error('no sync key');
  const out = {};
  for (const coll of collections) {
    const items = {};
    for (const itemKey of coll.listLocal()) {
      const v = coll.readLocal(itemKey);
      if (v != null) items[itemKey] = v;
    }
    if (Object.keys(items).length) out[coll.id] = items;
  }
  return encryptSync({ format: FORMAT, version: 1, profileId: profileId || null, collections: out }, key);
}

export async function importBundle({ collections, getKey, text, onChanged }) {
  const key = await getKey();
  if (!key) throw new Error('no sync key');
  let bundle;
  try { bundle = await decryptSync(text, key); }
  catch { throw badPassphrase(); }
  if (!bundle || bundle.format !== FORMAT) throw new Error('not a planner bundle');

  const byId = Object.fromEntries(collections.map(c => [c.id, c]));
  const touched = [];
  for (const [collId, items] of Object.entries(bundle.collections || {})) {
    const coll = byId[collId];
    if (!coll || !items) continue;
    let changed = false;
    for (const [itemKey, importedValue] of Object.entries(items)) {
      const local = coll.readLocal(itemKey);
      const { merged } = coll.merge(null, local, importedValue, { from: 'import', prefer: 'local' });
      if (contentHash(merged) === contentHash(local)) continue; // no-op merge — skip the rewrite
      coll.writeLocal(itemKey, merged);
      changed = true;
    }
    if (changed) { touched.push(collId); onChanged?.(collId); }
  }
  return { collections: touched };
}
