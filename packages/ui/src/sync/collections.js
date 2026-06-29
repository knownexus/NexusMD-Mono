// collections.js — sync collection adapters. Each adapter enumerates/reads/writes
// a localStorage-backed data type and names its core merge strategy.
import { mergePlannerWeek, mergeRows, mergeSet, mergeKeyVal } from '@nexusmd/core';

export function plannerCollection({ storage, getProfileKey, namespace }) {
  const bare = (key) => `${namespace}.planner.week.${key}`;
  const full = (key) => getProfileKey(bare(key));
  const listPrefix = getProfileKey(`${namespace}.planner.week.`);
  return {
    id: 'planner',
    listLocal() {
      const out = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(listPrefix)) out.push(k.slice(listPrefix.length));
      }
      return out;
    },
    readLocal(key) {
      try { const raw = storage.getItem(full(key)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    writeLocal(key, value) {
      try { storage.setItem(full(key), JSON.stringify(value)); } catch {}
    },
    removeLocal(key) {
      try { storage.removeItem(full(key)); } catch {}
    },
    merge: (b, l, r, ctx) => mergePlannerWeek(b, l, r, ctx),
  };
}

// A single-item collection backed by one fixed storage key (notes/team/tweaks).
// The item key is always the literal 'data'.
export function singletonCollection({ id, bareKey, merge, storage, getProfileKey }) {
  const full = getProfileKey(bareKey);
  return {
    id,
    listLocal() { return storage.getItem(full) != null ? ['data'] : []; },
    readLocal() {
      try { const raw = storage.getItem(full); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    writeLocal(_key, value) {
      try { storage.setItem(full, JSON.stringify(value)); } catch {}
    },
    removeLocal() {
      try { storage.removeItem(full); } catch {}
    },
    merge,
  };
}

export function notesCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'notes', bareKey: `${namespace}.planner.globalNotes`,
    merge: (b, l, r) => mergeRows(b, l, r, 'id'), storage, getProfileKey,
  });
}

export function teamCustomCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'team-custom', bareKey: `${namespace}.team.custom`,
    merge: (b, l, r) => mergeRows(b, l, r, 'id'), storage, getProfileKey,
  });
}

export function teamRemovedCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'team-removed', bareKey: `${namespace}.team.removed`,
    merge: (b, l, r) => mergeSet(b, l, r), storage, getProfileKey,
  });
}

export function tweaksCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'tweaks', bareKey: `${namespace}.tweaks`,
    merge: (b, l, r, ctx) => mergeKeyVal(b, l, r, ctx), storage, getProfileKey,
  });
}
