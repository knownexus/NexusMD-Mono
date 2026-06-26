import {
  getRegistry, applyEnabledModules, hasRequiredAdapters,
} from './features/module-registry.js'
import { listProfiles } from './profiles/profile-store.js'
import { emit, on, off } from './events.js'

let _adapters = null

export const core = {
  get adapters() { return _adapters },

  isEnabled(moduleId) {
    return getRegistry().some(m => m.id === moduleId && m._enabled === true)
  },

  getEnabledModules() {
    return getRegistry().filter(m => m._enabled === true).map(m => m.id)
  },

  /**
   * Call load() on every enabled module that has its required adapters.
   * Emits 'data:updated' / 'data:error' per module. Modules that require the
   * 'network' adapter are skipped while offline (with a 'network:offline' event).
   * Returns the array of successful { moduleId, data } results.
   */
  async load() {
    const adapters = _adapters || {}
    const online = adapters.network ? (adapters.network.isOnline?.() ?? true) : true
    const results = []
    let emittedOffline = false
    for (const m of getRegistry()) {
      if (!m._enabled || !hasRequiredAdapters(m, adapters)) continue
      const needsNetwork = (m.requiredAdapters || []).includes('network')
      if (needsNetwork && !online) {
        if (!emittedOffline) { emit('network:offline'); emittedOffline = true }
        continue
      }
      try {
        const data = await m.load?.(adapters)
        emit('data:updated', { moduleId: m.id, data })
        results.push({ moduleId: m.id, data })
      } catch (error) {
        emit('data:error', { moduleId: m.id, error })
      }
    }
    return results
  },

  on,
  off,

  // Internal — used within packages/core only. Not part of the public contract for apps.
  _emit: emit,
}

/** Resolve the active profile from the file/storage adapters, or null. */
async function loadActiveProfile(adapters) {
  const file = adapters?.file
  const storage = adapters?.storage
  if (!file || !storage) return null
  const all = await listProfiles(file, storage)
  if (!all.length) return null
  const activeId = storage.get('nexusmd.activeProfileId')
  return all.find(p => p.id === activeId) || all[0]
}

/**
 * Wire adapters, load the active profile, enable its modules, and init each
 * enabled module that has its required adapters. With no resolvable profile
 * (first run, or adapters that can't read storage), every module falls back to
 * its own `defaultEnabled` and 'profiles:none' is emitted.
 */
export async function initCore(adapters) {
  _adapters = adapters

  let profile = null
  try { profile = await loadActiveProfile(adapters) } catch { profile = null }

  applyEnabledModules(profile)

  for (const m of getRegistry()) {
    if (m._enabled && hasRequiredAdapters(m, adapters)) {
      try { await m.init?.(adapters, profile?.modules?.[m.id]) }
      catch (e) { console.error('[core] module init failed', m.id, e) }
    }
  }

  if (profile) emit('profile:activated', { profile })
  else emit('profiles:none')
}
