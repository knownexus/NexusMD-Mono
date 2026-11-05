// profile-context.jsx — shared profile registry (active profile, CRUD, export/
// import). Shared web + app. The persistence backend is injected as `store`
// because it diverges fundamentally: web is server-authoritative (REST
// /api/profiles/*), the app is local-only (localStorage). The shared provider
// owns everything common — the React context + state, the namespaced
// localStorage cache (profiles list + activeId), the per-profile scoped-key
// purge/export/import (`${namespace}.p.${id}.*`), and switch/delete reload —
// while `store` supplies only the platform-specific create/update/activate/
// remove/load. Missing store ops are treated as local-only no-ops (ok=true).
//
// `secure` (optional, desktop) is the platform's secure storage: { names(): string[], get(name),
// set(name, value) }. With it, a .nmdprofile bundle (password-encrypted) also carries each exported
// profile's secrets (tokens, OAuth sign-ins, connection secrets: every secure name under
// `<ns>.p.<id>.`) decrypted, and an import writes them back into secure storage, never as plain
// keys. Without it, bundles carry no secrets and any in a file are skipped.
//
// `lifecycle` (desktop) turns on deleted profiles, synced through the account (core Task 5):
// records carry updatedAt / deletedAt / purgedAt; `deleteProfile` only marks a profile deleted
// (its data stays), `restoreProfile` brings it back, `purgeProfile(id, { sync })` removes it
// everywhere (signed in: through the account sync; signed out: here, leaving a tombstone).
// `profiles` lists live profiles only, `deletedProfiles` the deleted ones; edits bump updatedAt.
import React from 'react';
import { encodeBundle, decodeBundle, BUNDLE_EXT, purgeProfileLocal, rendererLog, ignore } from '@nexusmd/core';
import { toast } from './toast.jsx';

const log = rendererLog('profiles', 'context');

const { useState, useCallback, useMemo, useEffect, createContext, useContext, createElement: h } = React;

const ProfileCtx = createContext(null);

const defaultStorage = () => {
  try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (err) { ignore(log, 'browser storage is not available here (sandboxed)', err); }
  return null;
};

// A profile's keys (`<ns>.p.<id>.*`) by name without that prefix.
function collectScopedFrom(storage, namespace, id) {
  const pfx = `${namespace}.p.${id}.`;
  const data = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(pfx)) data[k.slice(pfx.length)] = storage.getItem(k);
    }
  } catch (err) { ignore(log, 'a profile\'s keys could not be read from browser storage, so its export is incomplete', err, 'warn'); }
  return data;
}

// A profile's secrets, decrypted, by name without the `<ns>.p.<id>.` part.
async function collectSecretsFrom(secure, namespace, id) {
  const pfx = `${namespace}.p.${id}.`;
  const out = {};
  for (const name of secure.names()) {
    if (!name.startsWith(pfx) || name.length === pfx.length) continue;
    const v = await secure.get(name);
    if (typeof v === 'string') out[name.slice(pfx.length)] = v;
  }
  return out;
}

/**
 * Build an encrypted .nmdprofile bundle: `scope` 'all' (every record in `profiles`) or one id.
 * `secure` (optional, see ProfileProvider) adds each profile's secrets. Resolves { filename, text }.
 */
export async function buildProfileBundle({ storage, secure = null, namespace = 'nexusmd', profiles, scope, activeId = null, password }) {
  const picked = scope === 'all' ? profiles : profiles.filter(p => p.id === scope);
  const out = [];
  for (const p of picked) {
    const rec = {
      id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type,
      orgLabel: p.orgLabel, createdAt: p.createdAt ?? Date.now(), config: p.config ?? null,
      data: collectScopedFrom(storage, namespace, p.id),
    };
    if (secure) rec.secrets = await collectSecretsFrom(secure, namespace, p.id);
    out.push(rec);
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: namespace === 'helm' ? 'app' : 'web',
    activeId: scope === 'all' ? (activeId || null) : null,
    profiles: out,
  };
  const text = await encodeBundle(payload, password);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (picked[0]?.name || 'profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = scope === 'all'
    ? `nexusmd-backup-${stamp}${BUNDLE_EXT}`
    : `nexusmd-profile-${slug}${BUNDLE_EXT}`;
  return { filename, text };
}

const isLive = (p) => p && !p.deletedAt && !p.purgedAt;

export function ProfileProvider({ namespace = 'nexusmd', store = {}, storage = defaultStorage(), secure = null, lifecycle = false, children }) {
  const PROFILES_KEY = `${namespace}.profiles`;
  const ACTIVE_KEY   = `${namespace}.activeProfileId`;
  const scopedPrefix = (id) => `${namespace}.p.${id}.`;

  const readList = () => {
    try { const l = JSON.parse(storage?.getItem(PROFILES_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; }
  };
  // Every record (with lifecycle: deleted ones and purged tombstones too).
  const [all, setProfiles] = useState(readList);
  const profiles = useMemo(() => (lifecycle ? all.filter(isLive) : all), [all, lifecycle]);
  const deletedProfiles = useMemo(() => (lifecycle ? all.filter(p => p && p.deletedAt && !p.purgedAt) : []), [all, lifecycle]);
  const stamp = (rec) => (lifecycle ? { ...rec, updatedAt: Math.max(Date.now(), (Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0) + 1) } : rec);
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
          try { storage.setItem(PROFILES_KEY, JSON.stringify(list)); storage.setItem(ACTIVE_KEY, aid); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
          setProfiles(list); setActiveId(aid);
        }
        setLoading(false);
      })
      .catch((err) => { ignore(log, 'the profile store could not be loaded, so the cached profiles are used', err, 'warn'); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const cacheList = (next) => { try { storage.setItem(PROFILES_KEY, JSON.stringify(next)); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); } };

  const activeProfile = profiles.find(p => p.id === activeId) || profiles[0] || null;

  const switchProfile = useCallback(async (id) => {
    const ok = store.activate ? await store.activate(id) : true;
    if (!ok) return;
    try { storage.setItem(ACTIVE_KEY, id); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
    window.location.reload();
  }, [store]);

  const createProfile = useCallback(async (opts) => {
    const { profile, entry } = await store.create(opts);
    const next = [...all, lifecycle ? stamp({ deletedAt: null, purgedAt: null, ...entry }) : entry];
    cacheList(next);
    setProfiles(next);
    return profile;
  }, [all, store, lifecycle]);

  const updateProfile = useCallback(async (id, changes) => {
    const ok = store.update ? await store.update(id, changes) : true;
    if (!ok) return;
    const next = all.map(p => p.id === id ? stamp({ ...p, ...changes }) : p);
    cacheList(next);
    setProfiles(next);
  }, [all, store, lifecycle]);

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
    if (lifecycle) {
      // Soft delete: the data stays (and keeps syncing) until the profile is purged.
      const now = Date.now();
      const next = all.map(p => (p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p));
      cacheList(next);
      setProfiles(next);
      if (id === activeId) {
        const other = next.find(p => p.id !== id && isLive(p));
        try { storage.setItem(ACTIVE_KEY, other.id); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
        window.location.reload();
      }
      return;
    }
    const ok = store.remove ? await store.remove(id) : true;
    if (!ok) { toast?.('Failed to delete profile.', 'error'); return; }
    purgeScoped(id);
    const next = profiles.filter(p => p.id !== id);
    cacheList(next);
    setProfiles(next);
    if (id === activeId && next.length > 0) {
      try { storage.setItem(ACTIVE_KEY, next[0].id); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
      window.location.reload();
    }
  }, [profiles, all, activeId, store, lifecycle]);

  const restoreProfile = useCallback(async (id) => {
    const next = all.map(p => (p.id === id && !p.purgedAt ? stamp({ ...p, deletedAt: null }) : p));
    cacheList(next);
    setProfiles(next);
  }, [all, lifecycle]);

  // Purge (the caller has confirmed): signed in, the account sync tombstones every item and removes
  // the data here; signed out, the data is removed here and the record kept as a tombstone, so the
  // purge reaches the account on the next sign-in.
  const purgeProfile = useCallback(async (id, { sync = null } = {}) => {
    if (sync && typeof sync.purgeProfile === 'function') {
      const r = await sync.purgeProfile(id);
      if (r && r.error && r.purgedLocally) {
        toast?.('Purged on this computer. It reaches your other computers on the next sync.', 'info');
      } else if (r && r.error) { toast?.(r.error.message || 'The profile could not be purged.', 'error'); return false; }
      setProfiles(readList());
      return true;
    }
    if (secure && typeof secure.remove === 'function') await purgeProfileLocal({ storage, secure, namespace, pid: id });
    else purgeScoped(id);
    const now = Date.now();
    const next = all.map(p => (p.id === id
      ? { id: p.id, name: p.name, updatedAt: Math.max(now, (Number.isFinite(p.updatedAt) ? p.updatedAt : 0) + 1), deletedAt: p.deletedAt ?? now, purgedAt: now }
      : p));
    cacheList(next);
    setProfiles(next);
    return true;
  }, [all, storage, secure, namespace]);

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
    Object.entries(obj.data).forEach(([k, v]) => { try { storage.setItem(pfx + k, v); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); } });
    toast?.(`Profile "${p.name}" imported.`, 'success');
    if (store.activateOnImport) {
      if (store.activate) await store.activate(p.id);
      try { storage.setItem(ACTIVE_KEY, p.id); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
      window.location.reload();
    }
  }, [createProfile, store, namespace]);

  // 'all' backs up live and deleted profiles; one id exports that profile even when deleted or
  // purged (a pending purge still has its data here until the owner discards it).
  const exportBundle = useCallback(
    ({ scope, password }) => buildProfileBundle({
      storage, secure, namespace, scope, activeId, password,
      profiles: scope === 'all' ? all.filter(p => p && !p.purgedAt) : all,
    }),
    [all, activeId, namespace, storage, secure]);

  const importBundle = useCallback(async ({ text, password }) => {
    const payload = await decodeBundle(text, password);
    const records = payload.profiles.map(p => ({
      id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type,
      orgLabel: p.orgLabel, createdAt: p.createdAt, config: p.config ?? null,
    }));
    if (store.importProfiles) await store.importProfiles(records, payload.activeId ?? null);
    else localUpsertProfiles(storage, namespace, records, payload.activeId ?? null);
    let secrets = 0;
    const secretsFailed = [];
    for (const p of payload.profiles) {
      const pfx = scopedPrefix(p.id);
      for (const [k, v] of Object.entries(p.data || {})) {
        try { storage.setItem(pfx + k, v); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
      }
      if (!secure || !p.secrets || typeof p.secrets !== 'object') continue;
      for (const [k, v] of Object.entries(p.secrets)) {
        if (typeof v !== 'string' || !k) continue;
        try { await secure.set(pfx + k, v); secrets++; } catch (_) { secretsFailed.push(k); }
      }
    }
    return { imported: records.length, names: records.map(r => r.name), secrets, secretsFailed };
  }, [store, storage, namespace, secure]);

  const value = useMemo(() => ({
    profiles, deletedProfiles, activeProfile, activeId, loading,
    switchProfile, createProfile, updateProfile, deleteProfile, restoreProfile, purgeProfile, exportProfile, importProfile,
    exportBundle, importBundle, bundlesCarrySecrets: !!secure, lifecycle,
  }), [profiles, deletedProfiles, activeProfile, activeId, loading, switchProfile, createProfile, updateProfile, deleteProfile, restoreProfile, purgeProfile, exportProfile, importProfile, exportBundle, importBundle, secure, lifecycle]);

  return h(ProfileCtx.Provider, { value }, children);
}

// Local registry upsert for platforms without a server (app/desktop): merge
// records into `${namespace}.profiles` by id (overwrite existing, add new).
export function localUpsertProfiles(storage, namespace, records, activeId) {
  const KEY = `${namespace}.profiles`;
  let list;
  try { list = JSON.parse(storage.getItem(KEY) || '[]'); } catch (err) { ignore(log, 'the saved profile list is not valid JSON, so the imported profiles replace it', err, 'warn'); list = []; }
  const byId = new Map(list.map(p => [p.id, p]));
  for (const r of records) byId.set(r.id, { ...byId.get(r.id), ...r });
  try { storage.setItem(KEY, JSON.stringify([...byId.values()])); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); }
  if (activeId) { try { storage.setItem(`${namespace}.activeProfileId`, activeId); } catch (err) { ignore(log, 'browser storage could not be written (full or blocked)', err, 'warn'); } }
}

export function useProfile() { return useContext(ProfileCtx); }
