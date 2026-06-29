// profile-context.jsx — shared profile registry (active profile, CRUD, export/
// import). Shared web + app. The persistence backend is injected as `store`
// because it diverges fundamentally: web is server-authoritative (REST
// /api/profiles/*), the app is local-only (localStorage). The shared provider
// owns everything common — the React context + state, the namespaced
// localStorage cache (profiles list + activeId), the per-profile scoped-key
// purge/export/import (`${namespace}.p.${id}.*`), and switch/delete reload —
// while `store` supplies only the platform-specific create/update/activate/
// remove/load. Missing store ops are treated as local-only no-ops (ok=true).
import React from 'react';
import { toast } from './toast.jsx';

const { useState, useCallback, useMemo, useEffect, createContext, useContext, createElement: h } = React;

const ProfileCtx = createContext(null);

const defaultStorage = () => {
  try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (_) { /* sandboxed */ }
  return null;
};

export function ProfileProvider({ namespace = 'nexusmd', store = {}, storage = defaultStorage(), children }) {
  const PROFILES_KEY = `${namespace}.profiles`;
  const ACTIVE_KEY   = `${namespace}.activeProfileId`;
  const scopedPrefix = (id) => `${namespace}.p.${id}.`;

  const [profiles, setProfiles] = useState(() => {
    try { return JSON.parse(storage?.getItem(PROFILES_KEY) || '[]'); } catch (_) { return []; }
  });
  const [activeId, setActiveId] = useState(() => storage?.getItem(ACTIVE_KEY) || '');
  const [loading, setLoading]   = useState(!!store.load);

  // Optional async refresh — web hits the server; the app has no `load` and keeps
  // the localStorage cache as the source of truth.
  useEffect(() => {
    if (!store.load) return;
    let cancelled = false;
    store.load()
      .then((res) => {
        if (cancelled) return;
        if (res) {
          const list = res.profiles || [];
          const aid  = res.activeId || '';
          try { storage.setItem(PROFILES_KEY, JSON.stringify(list)); storage.setItem(ACTIVE_KEY, aid); } catch (_) {}
          setProfiles(list); setActiveId(aid);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const cacheList = (next) => { try { storage.setItem(PROFILES_KEY, JSON.stringify(next)); } catch (_) {} };

  const activeProfile = profiles.find(p => p.id === activeId) || profiles[0] || null;

  const switchProfile = useCallback(async (id) => {
    const ok = store.activate ? await store.activate(id) : true;
    if (!ok) return;
    try { storage.setItem(ACTIVE_KEY, id); } catch (_) {}
    window.location.reload();
  }, [store]);

  const createProfile = useCallback(async (opts) => {
    const { profile, entry } = await store.create(opts);
    const next = [...profiles, entry];
    cacheList(next);
    setProfiles(next);
    return profile;
  }, [profiles, store]);

  const updateProfile = useCallback(async (id, changes) => {
    const ok = store.update ? await store.update(id, changes) : true;
    if (!ok) return;
    const next = profiles.map(p => p.id === id ? { ...p, ...changes } : p);
    cacheList(next);
    setProfiles(next);
  }, [profiles, store]);

  const purgeScoped = (id) => {
    const pfx = scopedPrefix(id);
    const doomed = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(pfx)) doomed.push(k);
    }
    doomed.forEach(k => storage.removeItem(k));
  };

  const deleteProfile = useCallback(async (id) => {
    if (profiles.length <= 1) { toast?.('Cannot delete the only profile.', 'error'); return; }
    const ok = store.remove ? await store.remove(id) : true;
    if (!ok) { toast?.('Failed to delete profile.', 'error'); return; }
    purgeScoped(id);
    const next = profiles.filter(p => p.id !== id);
    cacheList(next);
    setProfiles(next);
    if (id === activeId && next.length > 0) {
      try { storage.setItem(ACTIVE_KEY, next[0].id); } catch (_) {}
      window.location.reload();
    }
  }, [profiles, activeId, store]);

  const exportProfile = useCallback(async (id) => {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    const pfx = scopedPrefix(id);
    const data = {};
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(pfx)) data[k.slice(pfx.length)] = storage.getItem(k);
    }
    const { name, initials, color, type, orgLabel } = profile;
    const content  = JSON.stringify({ version: 1, profile: { name, initials, color, type, orgLabel }, data }, null, 2);
    const filename = `${namespace}-profile-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    await (window.nexusMDDownload
      ? window.nexusMDDownload(filename, content)
      : (() => {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        })());
  }, [profiles, namespace]);

  const importProfile = useCallback(async (file) => {
    let text;
    try { text = await file.text(); } catch (_) { toast?.('Could not read the file.', 'error'); return; }
    let obj;
    try { obj = JSON.parse(text); } catch (_) { toast?.('Not a valid profile file.', 'error'); return; }
    if (obj.version !== 1 || !obj.profile || typeof obj.data !== 'object') {
      toast?.('Not a valid profile file.', 'error'); return;
    }
    const p = await createProfile(obj.profile);
    const pfx = scopedPrefix(p.id);
    Object.entries(obj.data).forEach(([k, v]) => { try { storage.setItem(pfx + k, v); } catch (_) {} });
    toast?.(`Profile "${p.name}" imported.`, 'success');
    if (store.activateOnImport) {
      if (store.activate) await store.activate(p.id);
      try { storage.setItem(ACTIVE_KEY, p.id); } catch (_) {}
      window.location.reload();
    }
  }, [createProfile, store, namespace]);

  const value = useMemo(() => ({
    profiles, activeProfile, activeId, loading,
    switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile,
  }), [profiles, activeProfile, activeId, loading, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile]);

  return h(ProfileCtx.Provider, { value }, children);
}

export function useProfile() { return useContext(ProfileCtx); }
