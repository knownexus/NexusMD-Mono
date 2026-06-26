// Profile dir resolution: user-configured dir takes priority over platform default.
// Key: nexusmd.profileDir in IStorageAdapter; falls back to IFileAdapter.defaultProfileDir().
// All profile operations use the resolved dir — never hard-code a path here.

import { validateProfile, buildProfile, generateProfileId } from './profile-schema.js'
import { applyEnabledModules, hasRequiredAdapters, getRegistry } from '../features/module-registry.js'
import { emit } from '../events.js'

const ACTIVE_ID_KEY = 'nexusmd.activeProfileId'

async function resolveProfileDir(fileAdapter, storageAdapter) {
  return storageAdapter.get('nexusmd.profileDir') ?? await fileAdapter.defaultProfileDir()
}

function profilePath(dir, id) {
  return `${dir}/${id}.json`
}

export async function listProfiles(fileAdapter, storageAdapter) {
  const dir = await resolveProfileDir(fileAdapter, storageAdapter)
  let filenames
  try {
    filenames = await fileAdapter.list(dir)
  } catch {
    return []
  }

  const profiles = []
  for (const filename of filenames.filter(f => f.endsWith('.json'))) {
    try {
      const text = await fileAdapter.read(`${dir}/${filename}`)
      const data = JSON.parse(text)
      if (data && typeof data.id === 'string') profiles.push(data)
    } catch { /* skip corrupt or unreadable files silently */ }
  }
  return profiles
}

/**
 * Create a new profile: build a schema-valid object from `opts`, validate it,
 * and write `{id}.json` to the profile dir. Returns the created profile.
 * Emits 'profile:created'.
 */
export async function createProfile(fileAdapter, storageAdapter, opts = {}) {
  const dir = await resolveProfileDir(fileAdapter, storageAdapter)
  const profile = buildProfile(opts)
  const check = validateProfile(profile)
  if (!check.valid) throw new Error(`createProfile: ${check.error}`)
  if (typeof fileAdapter.mkdir === 'function') { try { await fileAdapter.mkdir(dir) } catch { /* dir may exist */ } }
  await fileAdapter.write(profilePath(dir, profile.id), JSON.stringify(profile, null, 2))
  emit('profile:created', { profile })
  return profile
}

/**
 * Make `id` the active profile: persist the active id, dispose currently-enabled
 * modules, re-derive enabled modules from the new profile, and init each enabled
 * module that has its required adapters (when `adapters` is provided).
 * Returns the activated profile (or null if its file couldn't be read).
 * Emits 'profile:activated'.
 */
export async function activateProfile(id, fileAdapter, storageAdapter, adapters = null) {
  storageAdapter.set(ACTIVE_ID_KEY, id)

  const dir = await resolveProfileDir(fileAdapter, storageAdapter)
  let profile = null
  try { profile = JSON.parse(await fileAdapter.read(profilePath(dir, id))) } catch { /* missing/corrupt */ }

  for (const m of getRegistry()) {
    if (m._enabled) { try { await m.dispose?.() } catch { /* ignore dispose errors */ } }
  }

  applyEnabledModules(profile)

  if (adapters) {
    for (const m of getRegistry()) {
      if (m._enabled && hasRequiredAdapters(m, adapters)) {
        try { await m.init?.(adapters, profile?.modules?.[m.id]) } catch { /* ignore init errors */ }
      }
    }
  }

  emit('profile:activated', { profile })
  return profile
}

/**
 * Delete a profile file and clear its secrets. If it was the active profile,
 * the active id is cleared. Emits 'profile:deleted'.
 */
export async function deleteProfile(id, fileAdapter, storageAdapter, secureStorageAdapter = null) {
  const dir = await resolveProfileDir(fileAdapter, storageAdapter)
  await fileAdapter.delete(profilePath(dir, id))

  if (secureStorageAdapter) {
    for (const key of [`nexusmd.ado.pat.${id}`, `nexusmd.github.pat.${id}`]) {
      try { await secureStorageAdapter.remove(key) } catch { /* ignore */ }
    }
  }

  try {
    if (storageAdapter.get(ACTIVE_ID_KEY) === id) storageAdapter.remove(ACTIVE_ID_KEY)
  } catch { /* ignore */ }

  emit('profile:deleted', { profileId: id })
}

/**
 * Import a profile via the picker. Validates the picked JSON; if its id already
 * exists on disk a fresh id is assigned (never overwrites silently). Writes the
 * profile and returns it, or null if the user cancelled. Emits 'profile:created'.
 */
export async function importProfile(fileAdapter, storageAdapter, pickerAdapter) {
  const picked = await pickerAdapter.pickFile({ ext: '.json' })
  if (!picked) return null
  const text = typeof picked === 'string' ? picked : (picked.text ?? picked.content ?? picked.data)
  const data = JSON.parse(text)

  const check = validateProfile(data)
  if (!check.valid) throw new Error(`importProfile: ${check.error}`)

  const existing = await listProfiles(fileAdapter, storageAdapter)
  if (existing.some(p => p.id === data.id)) data.id = generateProfileId()

  const dir = await resolveProfileDir(fileAdapter, storageAdapter)
  await fileAdapter.write(profilePath(dir, data.id), JSON.stringify(data, null, 2))
  emit('profile:created', { profile: data })
  return data
}

/**
 * Export a profile to a user-chosen location via the picker.
 * Returns the suggested filename used.
 */
export async function exportProfile(profile, pickerAdapter) {
  const safe = String(profile?.name || 'profile').replace(/[^a-z0-9._-]+/gi, '_')
  const name = `${safe}.json`
  await pickerAdapter.saveFile(name, JSON.stringify(profile, null, 2))
  return name
}
