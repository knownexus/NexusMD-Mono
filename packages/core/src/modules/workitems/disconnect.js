// disconnect.js — what a provider leaves behind when its connection is removed: the cache of
// its data and its last load status. Without this the PRs, builds and items of a service that is
// no longer connected would linger in storage (and be shown by anything that reads the cache).
import { ADO_CACHE_KEY } from '../ado/loader.js'
import { JIRA_CACHE_KEY } from '../jira/loader.js'
import { GITHUB_CACHE_KEY } from '../github/loader.js'
import { WORK_ITEM_STATUS_KEY, readProviderStatus } from './status.js'

const CACHE_KEYS = { ado: ADO_CACHE_KEY, jira: JIRA_CACHE_KEY, github: GITHUB_CACHE_KEY }

/**
 * @param {{ get(k:string): any, set(k:string, v:any): void, remove(k:string): void }} storage
 *   The one the caches are read from (profile-scoped on desktop).
 * @param {'ado'|'jira'|'github'} id
 */
export function clearProviderData(storage, id) {
  const cacheKey = CACHE_KEYS[id]
  if (!cacheKey) return
  storage.remove(cacheKey)
  const status = readProviderStatus(storage)
  if (!(id in status)) return
  delete status[id]
  storage.set(WORK_ITEM_STATUS_KEY, status)
}
