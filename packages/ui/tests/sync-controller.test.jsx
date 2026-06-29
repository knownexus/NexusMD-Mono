import { describe, it, expect } from 'vitest';
import { createSyncController } from '../src/index.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
  };
}
function memKeyStore() {
  let v = null;
  return { get: async () => v, set: async (x) => { v = x; }, remove: async () => { v = null; } };
}
function ctrl(overrides = {}) {
  const storage = memStorage();
  return createSyncController({
    storage, namespace: 'nexusmd', getProfileKey: k => k, getActiveProfileId: () => 'p1',
    providers: [{ id: 'gdrive', label: 'Drive', isConnected: () => false }],
    keyStore: memKeyStore(), deviceIdPrefix: 'test',
    dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
    ...overrides,
  });
}

describe('createSyncController', () => {
  it('manages the key store', async () => {
    const c = ctrl();
    expect(await c.hasSyncKey()).toBe(false);
    await c.setSyncPassphrase('hunter2');
    expect(await c.hasSyncKey()).toBe(true);
    await c.clearSyncKey();
    expect(await c.hasSyncKey()).toBe(false);
  });

  it('selects providers and reports skip states', async () => {
    const c = ctrl();
    expect(await c.syncOnce()).toEqual({ skipped: 'no-key' });
    await c.setSyncPassphrase('pw');
    expect(await c.syncOnce()).toEqual({ skipped: 'no-provider' });
    c.setSyncProvider('gdrive');
    expect(c.getSyncProvider().id).toBe('gdrive');
    expect(await c.syncOnce()).toEqual({ skipped: 'not-connected' });
  });

  it('reads the key store only once per sync (no double secure-store decrypt)', async () => {
    let gets = 0;
    const keyStore = { get: async () => { gets++; return 'a'.repeat(64); }, set: async () => {}, remove: async () => {} };
    const cloud = new Map();
    const provider = {
      id: 'gdrive', label: 'Drive', isConnected: () => true,
      async getText(name) { return cloud.has(name) ? cloud.get(name) : null; },
      async upload(name, text) { cloud.set(name, text); },
      async listNames() { return []; },
      async remove(name) { cloud.delete(name); },
    };
    const storage = memStorage();
    const c = createSyncController({
      storage, namespace: 'nexusmd', getProfileKey: k => k, getActiveProfileId: () => 'p1',
      providers: [provider], keyStore, deviceIdPrefix: 'test',
      dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
    });
    c.setSyncProvider('gdrive');
    gets = 0; // reset after setup
    const r = await c.syncOnce(); // empty cloud + no local data → runs a minimal pass
    expect(r.skipped).toBeUndefined();
    expect(gets).toBe(1);
  });

  it('importLocalBundle merges then swallows a failing follow-up syncOnce', async () => {
    const keyStore = { get: async () => 'a'.repeat(64), set: async () => {}, remove: async () => {} };
    const provider = {
      id: 'gdrive', label: 'Drive', isConnected: () => true,
      async getText() { return null; },
      async upload() { throw new Error('network'); }, // the follow-up push fails
      async listNames() { return []; }, async remove() {},
    };
    const mk = (storage) => createSyncController({
      storage, namespace: 'nexusmd', getProfileKey: k => k, getActiveProfileId: () => 'p1',
      providers: [provider], keyStore, deviceIdPrefix: 'test',
      dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
    });
    const src = memStorage({ 'nexusmd.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'x' }]) });
    const text = await mk(src).exportLocalBundle();

    const dst = memStorage();
    const cDst = mk(dst);
    cDst.setSyncProvider('gdrive');
    const r = await cDst.importLocalBundle(text); // must resolve despite upload throwing in the fire-and-forget syncOnce
    expect(r.collections).toContain('notes');
    expect(JSON.parse(dst.getItem('nexusmd.planner.globalNotes'))).toEqual([{ id: 'n1', body: 'x' }]);
  });

  it('coalesces overlapping syncOnce calls (controller-level singleFlight)', async () => {
    const c = ctrl({ providers: [{ id: 'gdrive', label: 'Drive', isConnected: () => true }] });
    await c.setSyncPassphrase('pw');
    c.setSyncProvider('gdrive');
    const p1 = c.syncOnce().catch(() => {}); // handler attached synchronously (no real cloud → first call rejects)
    const r2 = await c.syncOnce();    // overlapping → coalesced
    expect(r2).toEqual({ skipped: 'in-flight' });
    await p1;                         // let the first call settle
  });
});
