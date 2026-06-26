import React from 'react'
import { toast } from './toast.jsx'

const { useState, useCallback, useMemo, createContext, useContext, useEffect, createElement: h } = React;

const PROFILES_KEY  = 'nexusmd.profiles';
const ACTIVE_KEY    = 'nexusmd.activeProfileId';

const ProfileCtx = createContext(null);

function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch (_) { return []; }
  });
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) || '');
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch('/api/profiles/active')
      .then(r => r.json())
      .then(data => {
        const list = data.profiles || [];
        const aid  = data.activeId  || '';
        localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
        localStorage.setItem(ACTIVE_KEY, aid);
        setProfiles(list);
        setActiveId(aid);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const activeProfile = profiles.find(p => p.id === activeId) || profiles[0] || null;

  const switchProfile = useCallback(async (id) => {
    const res = await fetch(`/api/profiles/${id}/activate`, { method: 'POST' });
    if (!res.ok) return;
    localStorage.setItem(ACTIVE_KEY, id);
    window.location.reload();
  }, []);

  const createProfile = useCallback(async (opts) => {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(await res.text());
    const p = await res.json();
    const entry = { id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type };
    const next = [...profiles, entry];
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
    setProfiles(next);
    return p;
  }, [profiles]);

  const updateProfile = useCallback(async (id, changes) => {
    const res = await fetch(`/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!res.ok) return;
    const next = profiles.map(p => p.id === id ? { ...p, ...changes } : p);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
    setProfiles(next);
  }, [profiles]);

  const deleteProfile = useCallback(async (id) => {
    if (profiles.length <= 1) { toast?.('Cannot delete the only profile.', 'error'); return; }
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast?.('Failed to delete profile.', 'error'); return; }
    const pfx = `nexusmd.p.${id}.`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
    const next = profiles.filter(p => p.id !== id);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
    setProfiles(next);
    if (id === activeId && next.length > 0) {
      localStorage.setItem(ACTIVE_KEY, next[0].id);
      window.location.reload();
    }
  }, [profiles, activeId]);

  const exportProfile = useCallback(async (id) => {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    const pfx = `nexusmd.p.${id}.`;
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) data[k.slice(pfx.length)] = localStorage.getItem(k);
    }
    const { name, initials, color, type, orgLabel } = profile;
    const content  = JSON.stringify({ version: 1, profile: { name, initials, color, type, orgLabel }, data }, null, 2);
    const filename = `nexusmd-profile-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    await (window.nexusMDDownload
      ? window.nexusMDDownload(filename, content)
      : (() => {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        })());
  }, [profiles]);

  const importProfile = useCallback(async (file) => {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); } catch (_) { toast?.('Not a valid profile file.', 'error'); return; }
    if (obj.version !== 1 || !obj.profile || typeof obj.data !== 'object') {
      toast?.('Not a valid profile file.', 'error'); return;
    }
    const p = await createProfile(obj.profile);
    await fetch(`/api/profiles/${p.id}/activate`, { method: 'POST' });
    const pfx = `nexusmd.p.${p.id}.`;
    Object.entries(obj.data).forEach(([k, v]) => localStorage.setItem(pfx + k, v));
    toast?.(`Profile "${p.name}" imported.`, 'success');
    window.location.reload();
  }, [createProfile]);

  const value = useMemo(() => ({
    profiles, activeProfile, activeId, loading,
    switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile,
  }), [profiles, activeProfile, activeId, loading, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile]);

  return h(ProfileCtx.Provider, { value }, children);
}

function useProfile() { return useContext(ProfileCtx); }

export { ProfileProvider, useProfile }
