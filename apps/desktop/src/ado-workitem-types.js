// ado-workitem-types.js — fetches, caches, and classifies ADO work item type
// field/layout definitions for the desktop "Create Work Item" drawer.
import { createAdoHttpAdapter } from './ado-client.js'
import { getProfileKey } from './profile-keys.js'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

function cacheKey(project, type) {
  return getProfileKey(`ado.wiTypeDefs.${project}.${type}`)
}

export function getCachedDefs(project, type) {
  try {
    const raw = rawStorage.get(cacheKey(project, type))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setCachedDefs(project, type, defs) {
  rawStorage.set(cacheKey(project, type), JSON.stringify(defs))
}
