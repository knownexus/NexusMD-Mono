import React from 'react';
import { App as CapApp } from '@capacitor/app';
import { ProfileProvider as UiProfileProvider, ProfileGate, AccountGate, useAccount, useProfile, localUpsertProfiles } from '@nexusmd/ui';
import { account } from './account.js';

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

// Stamps local edits when the app goes to the background, so last-writer-wins sees them even if
// the process is killed before the next sync. The gate has already started the sync.
function AccountObserver({ children }) {
  const { sync } = useAccount();
  React.useEffect(() => {
    if (!sync || !CapApp?.addListener) return undefined;
    let handle = null;
    let cancelled = false;
    Promise.resolve(CapApp.addListener('pause', () => { sync.observe(); }))
      .then((h) => { if (cancelled) h?.remove?.(); else handle = h; })
      .catch(() => {});
    return () => { cancelled = true; handle?.remove?.(); };
  }, [sync]);
  return children;
}

// AccountGate sits outside ProfileGate so account sync can restore profiles before they are
// needed. profile-migration.js has already run (main.jsx imports it before this module loads).
export function ProfileProvider({ children }) {
  return (
    <AccountGate account={account}>
      <AccountObserver>
        <UiProfileProvider namespace="helm" store={appProfileStore}><ProfileGate>{children}</ProfileGate></UiProfileProvider>
      </AccountObserver>
    </AccountGate>
  );
}
export { useProfile };
