import React from 'react'
import { ProfileProvider as UiProfileProvider, useProfile, localUpsertProfiles } from '@nexusmd/ui'
import { planProfileScopeMigration, migrateToProfileScopeV2, profileTokenNames } from '@nexusmd/core'
import { secureStorageAdapter } from './adapters/secureStorage.js'

// Desktop is local-only (no server), like the app: the shared ProfileProvider's
// localStorage cache IS the source of truth. We use the canonical `nexusmd.`
// namespace; profile-keys.js scopes per-profile storage to `nexusmd.p.<id>.*`.
const NS = 'nexusmd'

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Desktop historically stored everything flat under `nexusmd.*` with no profile
// registry; a registry makes getProfileKey scope by active id, which would orphan
// that data. So the first profile created (by the first-run gate) adopts the flat
// keys, before the reload that activates it and so before initCore reads them.
function adoptFlatKeys(id, storage = window.localStorage) {
  const keys = []
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k) keys.push(k) }
  for (const { from, to } of planProfileScopeMigration(keys, NS, id)) {
    const v = storage.getItem(from)
    if (v !== null) { storage.setItem(to, v); storage.removeItem(from) }
  }
}

function profileIds(storage) {
  try {
    const list = JSON.parse(storage.getItem(`${NS}.profiles`) || '[]')
    return Array.isArray(list) ? list.map(p => p && p.id).filter(id => typeof id === 'string' && id) : []
  } catch { return [] }
}

// At every start, before anything under the provider mounts (the account gate, so its sync never
// sees half-moved data, and the screens): the one-time move of the remaining shared data into
// profiles and of plain tokens into secure storage (core migrate-v2.js; adoptFlatKeys above has
// already run when the first profile was made), then the profiles' tokens are loaded into the
// secret cache the clients read synchronously. A failed move is logged and changes nothing (no
// marker either, so the next start tries again); the app starts regardless.
async function prepareProfileData({ storage = window.localStorage, secure = secureStorageAdapter } = {}) {
  const profiles = profileIds(storage)
  const activeProfileId = storage.getItem(`${NS}.activeProfileId`) || ''
  try {
    const { moved } = await migrateToProfileScopeV2({ storage, secure, namespace: NS, profiles, activeProfileId })
    if (moved.length) console.info(`[profiles] moved ${moved.length} shared item(s) into profiles`)
  } catch (err) {
    console.error('[profiles] moving shared data into profiles failed; nothing was changed, the next start tries again:', err)
  }
  // Without an active profile, getProfileKey names a token without the `p.<pid>.` part.
  const bare = profileTokenNames(NS, '_').map(n => n.replace(`${NS}.p._.`, `${NS}.`))
  try { await secure.load?.([...profiles.flatMap(id => profileTokenNames(NS, id)), ...bare]) }
  catch (err) { console.warn('[profiles] could not load the saved tokens:', err?.message || err) }
}

let booting = null
/** The start-up work above, once per window; resolves when it is done (it never rejects). */
export function bootProfileData() {
  if (!booting) booting = prepareProfileData()
  return booting
}

const desktopProfileStore = {
  create: async (opts) => {
    const p = {
      id: newId(),
      name:     opts.name     || 'New Profile',
      initials: opts.initials || (opts.name || 'NP').slice(0, 2).toUpperCase(),
      color:    opts.color    || '#9a7e22',
      type:     opts.type     || 'ado',
      createdAt: Date.now(),
    }
    let list
    try { list = JSON.parse(window.localStorage.getItem(`${NS}.profiles`) || '[]') } catch { list = [] }
    if (!Array.isArray(list) || list.length === 0) adoptFlatKeys(p.id)
    return { profile: p, entry: p }
  },
  importProfiles: async (records, activeId) => {
    localUpsertProfiles(window.localStorage, NS, records, activeId)
  },
  activateOnImport: false,
}

// What profile bundles (.nmdprofile) use to carry a profile's secrets: the encrypted store keeps
// each secret's ciphertext at `nexusmd.sec.<name>`, so its names are listed from localStorage.
const SECRET_PREFIX = `${NS}.sec.`
export const bundleSecureStorage = {
  names: () => {
    const out = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(SECRET_PREFIX)) out.push(k.slice(SECRET_PREFIX.length))
      }
    } catch { /* storage unavailable: no secrets listed */ }
    return out
  },
  get: (name) => secureStorageAdapter.get(name),
  set: (name, value) => secureStorageAdapter.set(name, value),
}

export function ProfileProvider({ children }) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let live = true
    bootProfileData().finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])
  if (!ready) return null
  return <UiProfileProvider namespace={NS} store={desktopProfileStore} secure={bundleSecureStorage}>{children}</UiProfileProvider>
}
export { useProfile }
