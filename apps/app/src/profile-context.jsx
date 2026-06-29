import React from 'react';
import { ProfileProvider as UiProfileProvider, useProfile, localUpsertProfiles } from '@nexusmd/ui';

// The app is local-only (no server): the shared ProfileProvider's localStorage
// cache IS the source of truth, so this store only mints new profiles locally.
// getProfileKey (profile-keys.js) handles per-profile storage namespacing; the
// shared provider purges/exports `helm.p.<id>.*` keys on delete/export.
function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const appProfileStore = {
  create: async (opts) => {
    const p = {
      id: newId(),
      name:     opts.name     || 'New Profile',
      initials: opts.initials || (opts.name || 'NP').slice(0, 2).toUpperCase(),
      color:    opts.color    || '#9a7e22',
      type:     opts.type     || 'ado',
      createdAt: Date.now(),
    };
    return { profile: p, entry: p };
  },
  importProfiles: async (records, activeId) => {
    localUpsertProfiles(window.localStorage, 'helm', records, activeId);
  },
  activateOnImport: false,
};

export function ProfileProvider({ children }) {
  return <UiProfileProvider namespace="helm" store={appProfileStore}>{children}</UiProfileProvider>;
}
export { useProfile };
