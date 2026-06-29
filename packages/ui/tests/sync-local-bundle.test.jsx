import { describe, it, expect } from 'vitest';
import { exportBundle, importBundle, plannerCollection, notesCollection } from '../src/index.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
  };
}
const KEY = 'a'.repeat(64);
const gp = k => k.replace('nexusmd.', 'nexusmd.p.p1.');
function cols(storage) {
  return [
    plannerCollection({ storage, getProfileKey: gp, namespace: 'nexusmd' }),
    notesCollection({ storage, getProfileKey: gp, namespace: 'nexusmd' }),
  ];
}

describe('local bundle export/import', () => {
  it('round-trips and merges (union) into another device, loss-free', async () => {
    const aStore = memStorage({
      'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r1', txt: 'A' }] }, themes: {} }),
      'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'A' }]),
    });
    const text = await exportBundle({ collections: cols(aStore), getKey: async () => KEY, profileId: 'p1' });
    expect(text).toContain('nexusmd-sync'); // crypto wrapper marker

    // Device B already has its own distinct rows; import must keep both sides.
    const bStore = memStorage({
      'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { tasks: [{ id: 'r2', txt: 'B' }] }, themes: {} }),
      'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n2', body: 'B' }]),
    });
    const touched = [];
    await importBundle({ collections: cols(bStore), getKey: async () => KEY, text, onChanged: id => touched.push(id) });

    const weekIds = JSON.parse(bStore.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.tasks.map(r => r.id).sort();
    expect(weekIds).toEqual(['r1', 'r2']);
    const noteIds = JSON.parse(bStore.getItem('nexusmd.p.p1.planner.globalNotes')).map(n => n.id).sort();
    expect(noteIds).toEqual(['n1', 'n2']);
    expect(touched.sort()).toEqual(['notes', 'planner']);
  });

  it('is a no-op when imported data equals local (no rewrite, empty touched)', async () => {
    const seed = {
      'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'same' }]),
    };
    const aStore = memStorage({ ...seed });
    const text = await exportBundle({ collections: cols(aStore), getKey: async () => KEY, profileId: 'p1' });
    const bStore = memStorage({ ...seed });
    const touched = [];
    const r = await importBundle({ collections: cols(bStore), getKey: async () => KEY, text, onChanged: id => touched.push(id) });
    expect(r.collections).toEqual([]);
    expect(touched).toEqual([]);
  });

  it('rejects a wrong key and writes nothing', async () => {
    const aStore = memStorage({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'A' }]) });
    const text = await exportBundle({ collections: cols(aStore), getKey: async () => KEY, profileId: 'p1' });
    const bStore = memStorage({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'keep', body: 'B' }]) });
    await expect(importBundle({ collections: cols(bStore), getKey: async () => 'b'.repeat(64), text }))
      .rejects.toMatchObject({ code: 'bad-passphrase' });
    expect(JSON.parse(bStore.getItem('nexusmd.p.p1.planner.globalNotes'))).toEqual([{ id: 'keep', body: 'B' }]);
  });
});
