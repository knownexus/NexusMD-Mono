import { describe, it, expect } from 'vitest'
import { encryptSync, decryptSync, plannerCollection, createSyncRuntime } from '../src/index.js'

const VERIFIER_TOKEN = 'nexusmd-sync-verifier';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}

describe('sync crypto', () => {
  it('round-trips an object and rejects a wrong key', async () => {
    const keyA = 'a'.repeat(64) // valid 32-byte AES key as hex (SHA-256 shape)
    const keyB = 'b'.repeat(64)
    const text = await encryptSync({ a: 1, b: [2, 3] }, keyA)
    expect(text).toContain('nexusmd-sync')
    expect(await decryptSync(text, keyA)).toEqual({ a: 1, b: [2, 3] })
    await expect(decryptSync(text, keyB)).rejects.toBeTruthy()
  })
})

describe('plannerCollection', () => {
  const opts = () => ({
    storage: memStorage({
      'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { x: 1 }, themes: { mon: 'a' } }),
    }),
    getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'),
    namespace: 'nexusmd',
  })

  it('lists, reads, writes and removes weeks by item key', () => {
    const c = plannerCollection(opts())
    expect(c.id).toBe('planner')
    expect(c.listLocal()).toEqual(['2026-W26'])
    expect(c.readLocal('2026-W26')).toEqual({ data: { x: 1 }, themes: { mon: 'a' } })
    expect(c.readLocal('2026-W30')).toBeNull()
    c.writeLocal('2026-W30', { data: {}, themes: { tue: 'b' } })
    expect(c.listLocal().sort()).toEqual(['2026-W26', '2026-W30'])
    c.removeLocal('2026-W26')
    expect(c.listLocal()).toEqual(['2026-W30'])
  })
})

function fakeCloud(store) {
  return {
    async upload(name, text) { store.set(name, text) },
    async getText(name) { return store.has(name) ? store.get(name) : null },
    async listNames(prefix) { return [...store.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name, modifiedAt: 't' })) },
    async remove(name) { store.delete(name) },
  }
}
function device(storageSeed, cloudStore, deviceId, tick) {
  const storage = memStorage(storageSeed)
  const getProfileKey = k => k.replace('nexusmd.', 'nexusmd.p.p1.')
  const base = { storage, getProfileKey, namespace: 'nexusmd', profileId: 'p1',
    cloud: fakeCloud(cloudStore), getKey: async () => 'a'.repeat(64), deviceId,
    now: tick, collections: [plannerCollection({ storage, getProfileKey, namespace: 'nexusmd' })] }
  return { storage, runtime: createSyncRuntime(base) }
}

describe('createSyncRuntime two-device sync', () => {
  it('propagates a week from device A to device B', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const A = device({ 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'hi' }] }, themes: {} }) }, cloud, 'A', tick)
    const B = device({}, cloud, 'B', tick)

    await A.runtime.syncNow()
    await B.runtime.syncNow()

    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.tasks)
      .toEqual([{ id: 'r1', txt: 'hi' }])
  })

  it('merges independent edits made on both devices', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const seed = { 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'base' }] }, themes: {} }) }
    const A = device({ ...seed }, cloud, 'A', tick)
    const B = device({ ...seed }, cloud, 'B', tick)
    await A.runtime.syncNow(); await B.runtime.syncNow()

    A.storage.setItem('nexusmd.p.p1.planner.week.2026-W26', JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'base' }, { id: 'r2', txt: 'from A' }] }, themes: {} }))
    B.storage.setItem('nexusmd.p.p1.planner.week.2026-W26', JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'base' }, { id: 'r3', txt: 'from B' }] }, themes: {} }))

    await A.runtime.syncNow()
    await B.runtime.syncNow()
    await A.runtime.syncNow()

    const ids = JSON.parse(A.storage.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.tasks.map(r => r.id).sort()
    expect(ids).toEqual(['r1', 'r2', 'r3'])
  })
})

describe('manifest verifier', () => {
  it('mints a verifier on first syncNow and the cloud manifest contains it encrypted', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++;
    const A = device({ 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'hi' }] }, themes: {} }) }, cloud, 'A', tick);
    await A.runtime.syncNow();
    const manifestText = cloud.get('nmdsync__p1__manifest.json');
    expect(manifestText).toBeTruthy();
    const manifest = await decryptSync(manifestText, 'a'.repeat(64));
    expect(manifest.verifier).toBeTruthy();
    expect(await decryptSync(manifest.verifier, 'a'.repeat(64))).toBe(VERIFIER_TOKEN);
  });

  it('rejects a wrong passphrase with code=bad-passphrase and uploads nothing', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++;
    const A = device({ 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'hi' }] }, themes: {} }) }, cloud, 'A', tick);
    await A.runtime.syncNow();
    const cloudSnapshot = new Map(cloud);

    const badStorage = memStorage({});
    const badCloud = fakeCloud(cloud);
    const badRuntime = createSyncRuntime({
      storage: badStorage,
      getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'),
      namespace: 'nexusmd', profileId: 'p1',
      cloud: badCloud,
      getKey: async () => 'b'.repeat(64),
      deviceId: 'BAD',
      now: tick,
      collections: [plannerCollection({ storage: badStorage, getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'), namespace: 'nexusmd' })],
    });

    await expect(badRuntime.syncNow()).rejects.toMatchObject({ code: 'bad-passphrase' });

    // Cloud store must be unchanged — no item files uploaded
    expect([...cloud.keys()].sort()).toEqual([...cloudSnapshot.keys()].sort());
    for (const [k, v] of cloudSnapshot) {
      expect(cloud.get(k)).toBe(v);
    }
  });

  it('correct key after verifier is minted syncs cleanly', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++;
    const A = device({ 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'hi' }] }, themes: {} }) }, cloud, 'A', tick);
    await A.runtime.syncNow();

    const B = device({}, cloud, 'B', tick);
    await expect(B.runtime.syncNow()).resolves.not.toThrow();
    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.tasks)
      .toEqual([{ id: 'r1', txt: 'hi' }]);
  });
});

import { notesCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection } from '../src/index.js'

function multiDevice(storageSeed, cloudStore, deviceId, tick) {
  const storage = memStorage(storageSeed)
  const getProfileKey = k => k.replace('nexusmd.', 'nexusmd.p.p1.')
  const ns = 'nexusmd'
  const runtime = createSyncRuntime({
    storage, getProfileKey, namespace: ns, profileId: 'p1',
    cloud: fakeCloud(cloudStore), getKey: async () => 'a'.repeat(64), deviceId, now: tick,
    collections: [
      notesCollection({ storage, getProfileKey, namespace: ns }),
      teamCustomCollection({ storage, getProfileKey, namespace: ns }),
      teamRemovedCollection({ storage, getProfileKey, namespace: ns }),
      tweaksCollection({ storage, getProfileKey, namespace: ns }),
    ],
  })
  return { storage, runtime }
}

describe('multi-collection two-device sync', () => {
  it('converges notes, team and tweaks across devices', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const A = multiDevice({
      'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'from A' }]),
      'nexusmd.p.p1.team.custom': JSON.stringify([{ id: 'm1', name: 'Mem A' }]),
      'nexusmd.p.p1.tweaks': JSON.stringify({ theme: 'dark' }),
    }, cloud, 'A', tick)
    const B = multiDevice({}, cloud, 'B', tick)

    await A.runtime.syncNow()   // push notes/team/tweaks + manifest
    await B.runtime.syncNow()   // pull all

    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.planner.globalNotes'))).toEqual([{ id: 'n1', body: 'from A' }])
    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.tweaks'))).toEqual({ theme: 'dark' })

    // B adds a note + a removed-team id; A changes a different tweak key.
    B.storage.setItem('nexusmd.p.p1.planner.globalNotes', JSON.stringify([{ id: 'n1', body: 'from A' }, { id: 'n2', body: 'from B' }]))
    B.storage.setItem('nexusmd.p.p1.team.removed', JSON.stringify(['gone1']))
    A.storage.setItem('nexusmd.p.p1.tweaks', JSON.stringify({ theme: 'dark', density: 'compact' }))

    await B.runtime.syncNow()   // push B's note + removed
    await A.runtime.syncNow()   // pull B's, push A's tweak
    await B.runtime.syncNow()   // pull A's tweak

    expect(JSON.parse(A.storage.getItem('nexusmd.p.p1.planner.globalNotes')).map(n => n.id).sort()).toEqual(['n1', 'n2'])
    expect(JSON.parse(A.storage.getItem('nexusmd.p.p1.team.removed'))).toEqual(['gone1'])
    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.tweaks'))).toEqual({ theme: 'dark', density: 'compact' })
  })
})
