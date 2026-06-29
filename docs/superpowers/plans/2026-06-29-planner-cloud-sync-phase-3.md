# Continuous Profile Sync — Phase 3 (notes / team / tweaks collections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase-2 sync runtime to also sync global notes, custom team members, removed-team tombstones, and tweaks — by adding four collection adapters that reuse the existing core merge strategies and `createSyncRuntime`.

**Architecture:** Each data type becomes a single-item "singleton" collection (one fixed storage key) plugged into the unchanged `createSyncRuntime`. Notes (array of note rows with ids) and team-custom (array of member rows with ids) use `mergeRows`; team-removed (id array) uses `mergeSet`; tweaks (settings map) uses `mergeKeyVal`. No runtime or core changes — pure additive adapters + tests.

**Tech Stack:** JS ESM, Vitest. Reuses `@nexusmd/core` (`mergeRows`/`mergeSet`/`mergeKeyVal`) and the Phase-2 `createSyncRuntime` + `plannerCollection`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This is **Phase 3** (notes/team/tweaks collections). Auto-triggers, conflict UI, key management, and the web legacy cutover are Phase 4; app/desktop wiring is Phase 5.
- Storage keys (namespace-parameterised; `nexusmd` on web/desktop, `helm` on app), scoped via `getProfileKey`:
  - notes → `${namespace}.planner.globalNotes` (JSON **array** of note rows, each with `id`).
  - team custom → `${namespace}.team.custom` (JSON **array** of member rows, each with `id`).
  - team removed → `${namespace}.team.removed` (JSON **array** of id strings).
  - tweaks → `${namespace}.tweaks` (JSON **object**, settings map).
- Merge strategy per collection: notes + team-custom → `mergeRows(b,l,r,'id')` (keep-both); team-removed → `mergeSet` (union); tweaks → `mergeKeyVal` (per-key newest-wins via `prefer`).
- Collections are single-item: `listLocal()` returns `['data']` when the storage key exists, else `[]`; read/write/remove operate on the one fixed key.
- No changes to `createSyncRuntime` or core. Tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/ui`. Match ui ESM style (semicolons in `packages/ui/src`).

---

## File Structure

- `packages/ui/src/sync/collections.js` — **modify.** Add a `singletonCollection` helper + `notesCollection`, `teamCustomCollection`, `teamRemovedCollection`, `tweaksCollection`.
- `packages/ui/src/index.js` — **modify.** Export the four new collections.
- `packages/ui/tests/sync-collections.test.jsx` — **new.** Adapter unit tests.
- `packages/ui/tests/sync-runtime.test.jsx` — **modify.** Add a multi-collection two-device convergence test.

---

### Task 1: Singleton collections (notes, team, tweaks)

**Files:**
- Modify: `packages/ui/src/sync/collections.js`, `packages/ui/src/index.js`
- Test: `packages/ui/tests/sync-collections.test.jsx`

**Interfaces:**
- Consumes: `mergeRows`, `mergeSet`, `mergeKeyVal` from `@nexusmd/core`.
- Produces: `singletonCollection({ id, bareKey, merge, storage, getProfileKey }) → collection`; and `notesCollection`, `teamCustomCollection`, `teamRemovedCollection`, `tweaksCollection`, each `({ storage, getProfileKey, namespace }) → collection` with the same shape as `plannerCollection` (`{ id, listLocal, readLocal, writeLocal, removeLocal, merge }`). Single-item key is the literal `'data'`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/sync-collections.test.jsx
import { describe, it, expect } from 'vitest'
import { notesCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}
const opts = (seed) => ({ storage: memStorage(seed), getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'), namespace: 'nexusmd' })

describe('notesCollection', () => {
  it('reads/writes the globalNotes array and merges by id (keep-both)', () => {
    const c = notesCollection(opts({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'a' }]) }))
    expect(c.id).toBe('notes')
    expect(c.listLocal()).toEqual(['data'])
    expect(c.readLocal('data')).toEqual([{ id: 'n1', body: 'a' }])
    // keep-both: same note edited on both sides
    const base = [{ id: 'n1', body: 'a' }]
    const local = [{ id: 'n1', body: 'mine' }]
    const remote = [{ id: 'n1', body: 'theirs' }]
    const { conflicts } = c.merge(base, local, remote, { from: 'B', prefer: 'local' })
    expect(conflicts).toEqual([{ kind: 'row', id: 'n1', from: 'remote' }])
  })

  it('listLocal is empty when the key is absent', () => {
    expect(notesCollection(opts({})).listLocal()).toEqual([])
  })
})

describe('teamCustomCollection', () => {
  it('merges custom members by id', () => {
    const c = teamCustomCollection(opts({ 'nexusmd.p.p1.team.custom': JSON.stringify([{ id: 'm1', name: 'A' }]) }))
    expect(c.id).toBe('team-custom')
    expect(c.readLocal('data')).toEqual([{ id: 'm1', name: 'A' }])
    const { merged } = c.merge([], [{ id: 'm1', name: 'A' }], [{ id: 'm2', name: 'B' }])
    expect(merged.map(m => m.id).sort()).toEqual(['m1', 'm2'])
  })
})

describe('teamRemovedCollection', () => {
  it('unions removed ids', () => {
    const c = teamRemovedCollection(opts({ 'nexusmd.p.p1.team.removed': JSON.stringify(['x']) }))
    expect(c.id).toBe('team-removed')
    const { merged } = c.merge(['x'], ['x', 'y'], ['x', 'z'])
    expect(merged.sort()).toEqual(['x', 'y', 'z'])
  })
})

describe('tweaksCollection', () => {
  it('merges settings per key (newest-wins via prefer)', () => {
    const c = tweaksCollection(opts({ 'nexusmd.p.p1.tweaks': JSON.stringify({ theme: 'dark' }) }))
    expect(c.id).toBe('tweaks')
    expect(c.readLocal('data')).toEqual({ theme: 'dark' })
    const { merged } = c.merge({ theme: 'light' }, { theme: 'dark' }, { theme: 'light', density: 'compact' }, { prefer: 'local' })
    expect(merged).toEqual({ theme: 'dark', density: 'compact' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/sync-collections.test.jsx`
Expected: FAIL — collections not exported.

- [ ] **Step 3: Implement (append to `packages/ui/src/sync/collections.js`)**

First extend the import at the top of the file:

```js
import { mergePlannerWeek, mergeRows, mergeSet, mergeKeyVal } from '@nexusmd/core';
```

Then append:

```js
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
```

- [ ] **Step 4: Export from the barrel**

In `packages/ui/src/index.js`, extend the sync collections export line:

```js
export { plannerCollection, notesCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection } from './sync/collections.js'
```

(Replace the existing `export { plannerCollection } from './sync/collections.js'` line.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/sync-collections.test.jsx`
Expected: all adapter tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/sync/collections.js packages/ui/src/index.js packages/ui/tests/sync-collections.test.jsx
git commit -m "feat(ui): notes/team/tweaks sync collections"
```

---

### Task 2: Multi-collection two-device convergence

**Files:**
- Modify: `packages/ui/tests/sync-runtime.test.jsx`

**Interfaces:**
- Consumes: `createSyncRuntime`, `notesCollection`, `teamCustomCollection`, `teamRemovedCollection`, `tweaksCollection`.

- [ ] **Step 1: Write the failing test (append a describe block)**

```jsx
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
```

- [ ] **Step 2: Run test to verify it fails (or passes immediately)**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: the new test FAILS only if the collections are missing; since Task 1 added them, it should PASS once Task 1 is in. If you are running Task 2 before Task 1, it fails on the missing imports.

- [ ] **Step 3: Make it pass**

No new product code is required — the collections (Task 1) plug into the unchanged runtime. If the test fails, the fault is in a Task-1 adapter (fix there), not the runtime.

- [ ] **Step 4: Full ui regression**

Run: `npx vitest run packages/ui`
Expected: all ui tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/tests/sync-runtime.test.jsx
git commit -m "test(ui): multi-collection two-device sync convergence (notes/team/tweaks)"
```

---

## Self-Review Notes

- **Spec coverage (Phase 3):** notes collection (array-of-note-rows → `mergeRows` by id, keep-both) ✓; team custom (`mergeRows`) ✓; team removed (`mergeSet` union) ✓; tweaks (`mergeKeyVal` newest-wins) ✓; all plug into the unchanged `createSyncRuntime` ✓; two-device convergence proven ✓. Deferred: auto-triggers, conflict UI, key management, web legacy cutover + local-folder (Phase 4); app/desktop wiring (Phase 5).
- **Correction baked in from code reality:** the spec originally modelled notes as a single text doc (`mergeText`); the actual store is a JSON **array of note rows with ids**, so `mergeRows` is correct and gives per-note keep-both (better than whole-doc). team.custom rows carry `id` (confirmed via the app's `m.id` filter), so `mergeRows` is valid there too.
- **Type consistency:** all collections share `plannerCollection`'s shape (`id/listLocal/readLocal/writeLocal/removeLocal/merge`); singleton item key is the literal `'data'`; merge fns match Phase-1 signatures (`mergeRows(b,l,r,'id')`, `mergeSet(b,l,r)`, `mergeKeyVal(b,l,r,ctx)`).
- **No placeholders:** every code step has complete code.
- **Noted for Phase 4 (not a blocker):** `tweaks` includes device-specific layout keys (e.g. `widgetWidths`, `widgetHeights`). Per the brainstorm the user opted to sync all of tweaks; if cross-device layout overwrite proves annoying, Phase 4 can carve a device-local key subset out of the tweaks collection.
