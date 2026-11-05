// collections.js — sync collection adapters. Each adapter enumerates/reads/writes
// a localStorage-backed data type and names its core merge strategy.
import { mergePlannerWeek, mergeRows, mergeSet, mergeKeyVal, mergeLists } from './merge.js';
import { rendererLog, ignore } from '../../log.js';

const log = rendererLog('sync', 'collections');
const WRITE_FAILED = 'could not write a collection to local storage';
const REMOVE_FAILED = 'could not remove a collection from local storage';

/**
 * Copies the stored text at `storageKey` to a backup key and returns it (null when nothing is stored). Throws
 * when the copy cannot be stored: a caller about to replace a value must stop then, not go on without a backup.
 * The key is not under a profile (`<ns>.sync.quarantine.<the damaged key>.<time>`), so the account sync, which
 * does sync the other keys under a profile, never picks it up, and no collection lists it as an item.
 */
function quarantine(storage, namespace, storageKey) {
  const raw = storage.getItem(storageKey);
  if (raw == null) return null;
  const to = `${namespace}.sync.quarantine.${storageKey}.${Date.now()}`;
  storage.setItem(to, raw);
  return to;
}

/**
 * A stored value that is not valid JSON (a torn write, a bad manual edit). It is not "nothing here": the
 * sync engine takes an absent item for one deleted on this device and would propagate that deletion, so an
 * unreadable item is reported and left alone instead.
 */
export class CorruptLocalError extends Error {
  // No `cause`: the engine's JSON error quotes the start of the stored text, which may be private.
  constructor(collection, key) {
    super(`the stored value for ${collection}/${key} is corrupt (not valid JSON)`);
    this.name = 'CorruptLocalError';
    this.collection = collection;
    this.key = key;
  }
}

// Items already reported as corrupt, so a sync that runs every few minutes says it once (error), then at debug.
const reportedCorrupt = new Set();

/** The parsed value at a storage key: null when absent or empty; throws CorruptLocalError when it is not JSON. */
function readJson(storage, storageKey, collection, key) {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  const id = `${collection}/${key}`;
  try {
    const value = JSON.parse(raw);
    reportedCorrupt.delete(id);
    return value;
  } catch {
    // What is stored may be private: log its size, and not the engine's error (it quotes the text).
    const data = { collection, key, bytes: raw.length };
    const err = new CorruptLocalError(collection, key);
    if (reportedCorrupt.has(id)) log.debug('a stored value is still not valid JSON', err, data);
    else { reportedCorrupt.add(id); log.error('a stored value is not valid JSON and was left alone', err, data); }
    throw err;
  }
}

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
      return readJson(storage, full(key), 'planner', key);
    },
    writeLocal(key, value) {
      try { storage.setItem(full(key), JSON.stringify(value)); } catch (err) { ignore(log, WRITE_FAILED, err, 'warn', { collection: 'planner', key }); }
    },
    removeLocal(key) {
      try { storage.removeItem(full(key)); } catch (err) { ignore(log, REMOVE_FAILED, err, 'warn', { collection: 'planner', key }); }
    },
    quarantineLocal(key) { return quarantine(storage, namespace, full(key)); },
    merge: (b, l, r, ctx) => mergePlannerWeek(b, l, r, ctx),
  };
}

// A single-item collection backed by one fixed storage key (notes/team/tweaks).
// The item key is always the literal 'data'.
export function singletonCollection({ id, bareKey, merge, storage, getProfileKey, namespace }) {
  const full = getProfileKey(bareKey);
  return {
    id,
    listLocal() { return storage.getItem(full) != null ? ['data'] : []; },
    readLocal() {
      return readJson(storage, full, id, 'data');
    },
    writeLocal(_key, value) {
      try { storage.setItem(full, JSON.stringify(value)); } catch (err) { ignore(log, WRITE_FAILED, err, 'warn', { collection: id }); }
    },
    removeLocal() {
      try { storage.removeItem(full); } catch (err) { ignore(log, REMOVE_FAILED, err, 'warn', { collection: id }); }
    },
    quarantineLocal() { return quarantine(storage, namespace, full); },
    merge,
  };
}

export function notesCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'notes', bareKey: `${namespace}.planner.globalNotes`,
    merge: (b, l, r) => mergeRows(b, l, r, 'id'), storage, getProfileKey, namespace,
  });
}

export function teamCustomCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'team-custom', bareKey: `${namespace}.team.custom`,
    merge: (b, l, r) => mergeRows(b, l, r, 'id'), storage, getProfileKey, namespace,
  });
}

export function teamRemovedCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'team-removed', bareKey: `${namespace}.team.removed`,
    merge: (b, l, r) => mergeSet(b, l, r), storage, getProfileKey, namespace,
  });
}

export function tweaksCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'tweaks', bareKey: `${namespace}.tweaks`,
    merge: (b, l, r, ctx) => mergeKeyVal(b, l, r, ctx), storage, getProfileKey, namespace,
  });
}

// Lists ({ lists: [...] }) at `${namespace}.lists`: `helm.lists` on mobile, the
// key mobile already uses, so no migration. Merged per list, then per item.
export function listsCollection({ storage, getProfileKey, namespace }) {
  return singletonCollection({
    id: 'lists', bareKey: `${namespace}.lists`,
    merge: (b, l, r, ctx) => mergeLists(b, l, r, ctx), storage, getProfileKey, namespace,
  });
}
