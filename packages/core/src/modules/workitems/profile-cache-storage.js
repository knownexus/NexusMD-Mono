// profile-cache-storage.js — keeps the ADO, Jira and GitHub data caches and the providers' load
// status under the active profile. They used to be global keys, so one profile's work items (and
// "last loaded" time) showed in another. The wrapper maps just those keys through the platform's
// getProfileKey and passes every other key through, so callers keep using the same constants.
import { ADO_CACHE_KEY } from '../ado/loader.js'
import { JIRA_CACHE_KEY } from '../jira/loader.js'
import { GITHUB_CACHE_KEY } from '../github/loader.js'
import { WORK_ITEM_STATUS_KEY } from './status.js'

const SCOPED = new Set([ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY, WORK_ITEM_STATUS_KEY])

/**
 * @param {{ get, set, remove, keys? }} storage  an IStorageAdapter
 * @param {(key: string) => string} getProfileKey
 */
export function profileCacheStorage(storage, getProfileKey) {
  const k = (key) => (SCOPED.has(key) ? getProfileKey(key) : key)
  return {
    ...storage,
    get: (key) => storage.get(k(key)),
    set: (key, value) => storage.set(k(key), value),
    remove: (key) => storage.remove(k(key)),
    keys: () => (storage.keys ? storage.keys() : []),
  }
}
