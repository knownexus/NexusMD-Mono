// account-clear.js — remove everything account sync owns from this device, so a different
// account can sign in without inheriting (and then uploading) the previous account's data.
//
// Removed: every storage key the registry maps to a synced id, every secure secret found under
// `<ns>.sec.` (except `<ns>.sec.account.*`, which holds the session of the account signing in),
// and the sync meta. Keys the registry skips (planner weeks, notes, calendar, lists, time log,
// caches) are left alone.

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
    } else if (k !== metaKey && registry.classify(k)) {
      keys.push(k)
    }
  }
  for (const name of secrets) {
    try { await secure.remove(name) } catch { /* the stored blob key is removed below */ }
    storage.removeItem(registry.secPrefix + name)
  }
  for (const k of keys) storage.removeItem(k)
  storage.removeItem(metaKey)
}
