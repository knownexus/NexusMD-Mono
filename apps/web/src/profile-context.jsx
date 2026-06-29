import React from 'react';
import { ProfileProvider as UiProfileProvider, useProfile } from '@nexusmd/ui';

// Web profiles are server-authoritative (ASP.NET host). The shared ProfileProvider
// owns the React state + localStorage cache + per-profile key handling; this store
// supplies only the REST persistence. namespace 'nexusmd' (keys are already bare).
const webProfileStore = {
  load: async () => {
    const r = await fetch('/api/profiles/active');
    const d = await r.json();
    return { profiles: d.profiles || [], activeId: d.activeId || '' };
  },
  create: async (opts) => {
    const res = await fetch('/api/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(await res.text());
    const p = await res.json();
    // The cached list entry is the display subset (the server owns the full record).
    return { profile: p, entry: { id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type } };
  },
  update: async (id, changes) => (await fetch(`/api/profiles/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
  })).ok,
  activate: async (id) => (await fetch(`/api/profiles/${id}/activate`, { method: 'POST' })).ok,
  remove: async (id) => (await fetch(`/api/profiles/${id}`, { method: 'DELETE' })).ok,
  activateOnImport: true,
};

export function ProfileProvider({ children }) {
  return <UiProfileProvider namespace="nexusmd" store={webProfileStore}>{children}</UiProfileProvider>;
}
export { useProfile };
