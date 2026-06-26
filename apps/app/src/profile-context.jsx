import React from 'react';
import { toast } from './toast.jsx';
// profile-context.jsx — ProfileContext: active profile, CRUD, export/import.
// Reads/writes helm.profiles and helm.activeProfileId.
// getProfileKey (from profile-keys.js) handles per-profile storage namespacing.

const { useState: useSt, useCallback: useCb, useMemo: useMm, createContext, useContext, createElement: h } = React;

const PROFILES_KEY = 'helm.profiles';
const ACTIVE_KEY   = 'helm.activeProfileId';

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function readProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch (_) { return []; }
}

function writeProfiles(list) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

const ProfileCtx = createContext(null);

function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useSt(readProfiles);
  const [activeId, setActiveId] = useSt(() => localStorage.getItem(ACTIVE_KEY) || '');

  const activeProfile = profiles.find(p => p.id === activeId) || profiles[0] || null;

  const switchProfile = useCb((id) => {
    localStorage.setItem(ACTIVE_KEY, id);
    // Full reload so all useState initialisers re-run with the new profile's keys
    window.location.reload();
  }, []);

  const createProfile = useCb((opts) => {
    const p = {
      id: newId(),
      name:     opts.name     || 'New Profile',
      initials: opts.initials || (opts.name || 'NP').slice(0, 2).toUpperCase(),
      color:    opts.color    || '#9a7e22',
      type:     opts.type     || 'ado',
      createdAt: Date.now(),
    };
    const next = [...profiles, p];
    writeProfiles(next);
    setProfiles(next);
    return p;
  }, [profiles]);

  const updateProfile = useCb((id, changes) => {
    const next = profiles.map(p => p.id === id ? { ...p, ...changes } : p);
    writeProfiles(next);
    setProfiles(next);
  }, [profiles]);

  const deleteProfile = useCb((id) => {
    if (profiles.length <= 1) {
      toast?.('Cannot delete the only profile.', 'error');
      return;
    }
    // Remove all profile-scoped keys
    const pfx = `helm.p.${id}.`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));

    const next = profiles.filter(p => p.id !== id);
    writeProfiles(next);
    setProfiles(next);

    // If we deleted the active profile, switch to the first remaining one
    if (id === activeId && next.length > 0) {
      localStorage.setItem(ACTIVE_KEY, next[0].id);
      window.location.reload();
    }
  }, [profiles, activeId]);

  const exportProfile = useCb((id) => {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    const pfx = `helm.p.${id}.`;
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) data[k.slice(pfx.length)] = localStorage.getItem(k);
    }
    const { name, initials, color, type } = profile;
    const blob = JSON.stringify({ version: 1, profile: { name, initials, color, type }, data }, null, 2);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `helm-profile-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [profiles]);

  const importProfile = useCb((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj.version !== 1 || !obj.profile || typeof obj.data !== 'object') {
          toast?.('Not a valid Helm profile file.', 'error');
          return;
        }
        const p = createProfile(obj.profile);
        const pfx = `helm.p.${p.id}.`;
        Object.entries(obj.data).forEach(([k, v]) => localStorage.setItem(pfx + k, v));
        toast?.(`Profile "${p.name}" imported.`, 'success');
      } catch (_) {
        toast?.('Not a valid Helm profile file.', 'error');
      }
    };
    reader.readAsText(file);
  }, [createProfile]);

  const value = useMm(() => ({
    profiles, activeProfile, activeId,
    switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile,
  }), [profiles, activeProfile, activeId, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile]);

  return h(ProfileCtx.Provider, { value }, children);
}

function useProfile() {
  return useContext(ProfileCtx);
}

export { ProfileProvider };
export { useProfile };
