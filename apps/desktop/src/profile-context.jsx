import React from 'react'
import { ProfileProvider as UiProfileProvider, useProfile, localUpsertProfiles } from '@nexusmd/ui'
import { planProfileScopeMigration } from '@nexusmd/core'

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

export function ProfileProvider({ children }) {
  return <UiProfileProvider namespace={NS} store={desktopProfileStore}>{children}</UiProfileProvider>
}
export { useProfile }
