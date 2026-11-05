// account-clear.js — remove everything account sync owns from this device, so a different
// account can sign in without inheriting (and then uploading) the previous account's data.
//
// Removed: every setting and connection the registry maps to a synced id, plaintext tokens
// (registry.isPlainTokenKey), every secure secret found under `<ns>.sec.` (except
// `<ns>.sec.account.*`, which holds the session of the account signing in), and the sync meta.
// Desktop (nexusmd): profile content goes too. The account gate first checks that nothing is
// unsynced (core listUnpushed) and blocks the switch until it is synced or exported.
// Android (helm): content is kept, i.e. record collections (`kind: 'collection'`) and planner
// weeks, even where the registry syncs them. Keys the registry skips (caches, device-local
// state) are left alone on both, except the damaged copies a restore keeps (see isQuarantineKey).

import { isQuarantineKey } from './key-registry.js'

/**
 * Remove one profile from this device: every `<ns>.p.<pid>.*` key and every secret whose name
 * starts with `<ns>.p.<pid>.` (secrets are found by their `<ns>.sec.<name>` keys).
 * @param {{ storage: Storage, secure: { remove(name: string): Promise<void> }, namespace: string, pid: string }} opts
 */
export async function purgeProfileLocal({ storage, secure, namespace, pid }) {
  if (typeof pid !== 'string' || !pid || pid.includes('.')) throw new Error('purgeProfileLocal: a profile id is required')
  const keyPrefix = `${namespace}.p.${pid}.`
  const secPrefix = `${namespace}.sec.`
  const keys = []
  const secrets = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (typeof k !== 'string') continue
    if (k.startsWith(keyPrefix)) keys.push(k)
    else if (k.startsWith(secPrefix + keyPrefix)) secrets.push(k.slice(secPrefix.length))
  }
  for (const name of secrets) {
    try { await secure.remove(name) } catch { /* the stored blob key is removed below */ }
    storage.removeItem(secPrefix + name)
  }
  for (const k of keys) storage.removeItem(k)
}

const isContent = (registry, key, c) => registry.namespace !== 'nexusmd' && (c.kind === 'collection' || /\.planner\.week\./.test(key))

/**
 * @param {{ registry: object, storage: Storage, secure: { remove(name: string): Promise<void> }, metaKey: string }} opts
 */
export async function clearAccountLocalData({ registry, storage, secure, metaKey }) {
  const keys = []
  const secrets = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (typeof k !== 'string') continue
    if (k.startsWith(registry.secPrefix)) {
      const name = k.slice(registry.secPrefix.length)
      if (registry.secretId(name)) secrets.push(name)
    } else if (k !== metaKey) {
      // The damaged copies a restore keeps are skipped by the registry (never synced), but they are profile
      // content: on desktop, where content goes, they go with it.
      if (registry.namespace === 'nexusmd' && isQuarantineKey(k)) { keys.push(k); continue }
      const c = registry.classify(k)
      if ((c && !isContent(registry, k, c)) || registry.isPlainTokenKey?.(k)) keys.push(k)
    }
  }
  for (const name of secrets) {
    try { await secure.remove(name) } catch { /* the stored blob key is removed below */ }
    storage.removeItem(registry.secPrefix + name)
  }
  for (const k of keys) storage.removeItem(k)
  storage.removeItem(metaKey)
}
