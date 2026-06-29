# Continuous Profile Sync — Phase 2 (sync runtime + planner, web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planner weeks sync through the cloud end-to-end on web: a generic `createSyncRuntime` (in `@nexusmd/ui`) that pushes/pulls/merges items via an encrypted manifest, a planner collection adapter, the object-store cloud methods the runtime needs, and a minimal web "Sync now" wiring.

**Architecture:** The Phase-1 core merge engine (`reconcileItem` + `mergePlannerWeek` + `contentHash`) does the decisions; this phase adds the I/O around it. The existing backup-oriented `cloudProvider` gains a by-name object-store API (`getText`/`listNames`/`remove`; `upload` already creates-or-overwrites by name). Sync files are flat, namespaced names in `/NexusMD` so Drive (flat folder) and OneDrive behave identically. A per-profile encrypted `manifest` enumerates items + tombstones; each device keeps a per-item base snapshot to enable 3-way merge.

**Tech Stack:** JS ESM, React 18 (via `h`), Vitest + @testing-library/react. Reuses `@nexusmd/core` sync engine (Phase 1) + AES-GCM (`hashPassword`/`encryptConfidentialForServer`/`decryptConfidentialFromServer`) and the Phase 1–5 `cloudProvider` factories.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This is **Phase 2**: runtime + planner collection + provider object-store + minimal web wiring. Notes/team/tweaks = Phase 3; auto-triggers + conflict UI + hardened key management = Phase 4; app/desktop = Phase 5.
- The runtime (ui) MAY use `Date.now()` for manifest `modifiedAt` (the clock-free rule is core-only). Conflict tiebreak this phase: `prefer: 'local'`, `from: deviceId`.
- Sync files live flat in `/NexusMD`, named `nmdsync__<profileId>__<collection>__<itemKey>.nmdsync`; the manifest is `nmdsync__<profileId>__manifest.json`. All AES-GCM encrypted with the sync key (the wrapper shape `{ format:'nexusmd-sync', version:1, iv, ciphertext }`).
- Sync key = `await hashPassword(passphrase)` (hex). The runtime receives `getKey(): Promise<string|null>` — null disables sync.
- Base snapshots are stored at `${namespace}.p.${profileId}.sync.base.<collection>.<itemKey>` (the `/` in a full key is written as `.`).
- Item/manifest payloads round-trip via JSON; merges come from the injected collection `merge` fn.
- Tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/ui`. Match ui ESM style (semicolons in `packages/ui/src` — check neighbours).

---

## File Structure

- `packages/ui/src/cloud/providers.js` — **modify.** Add `getText(name)`, `listNames(prefix)`, `remove(name)` to both factories.
- `packages/ui/src/sync/crypto.js` — **new.** `encryptSync(obj, keyHex)`, `decryptSync(text, keyHex)` over core AES-GCM.
- `packages/ui/src/sync/collections.js` — **new.** `plannerCollection({ storage, getProfileKey, namespace })`.
- `packages/ui/src/sync/runtime.js` — **new.** `createSyncRuntime(opts)` → `{ syncNow }`.
- `packages/ui/src/index.js` — **modify.** Export `createSyncRuntime`, `plannerCollection`, `encryptSync`, `decryptSync`.
- `packages/ui/tests/cloud-objectstore.test.jsx` — **new.** Provider object-store methods (mock fetch).
- `packages/ui/tests/sync-runtime.test.jsx` — **new.** Two-device convergence over a fake store.
- `apps/web/src/sync.js` — **new.** Build the runtime from `webCloudProviders` + a passphrase key cache.
- `apps/web/src/view-settings.jsx` — **modify.** Minimal Sync card (passphrase + provider + "Sync now").

---

### Task 1: Provider object-store methods

**Files:**
- Modify: `packages/ui/src/cloud/providers.js`
- Test: `packages/ui/tests/cloud-objectstore.test.jsx`

**Interfaces:**
- Consumes: existing `authedFetch`, `FOLDER`, `authBinding` in `providers.js`.
- Produces (added to BOTH provider objects): `getText(name): Promise<string|null>` (null if not found), `listNames(prefix): Promise<Array<{name, modifiedAt}>>`, `remove(name): Promise<void>`. (`upload(name,text)` already creates-or-overwrites by name and is reused as the "put".)

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/cloud-objectstore.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '../src/index.js'

function authStub() {
  return { isConnected: () => true, connect: vi.fn(), disconnect: vi.fn(), getToken: vi.fn(async () => 'tok') }
}

describe('Google Drive object-store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('listNames returns names+modifiedAt filtered by prefix', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("name%3D'NexusMD'")) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'F' }] }) }
      return { ok: true, status: 200, json: async () => ({ files: [
        { id: '1', name: 'nmdsync__p1__manifest.json', modifiedTime: 'T1' },
        { id: '2', name: 'nmdsync__p1__planner__2026-W26.nmdsync', modifiedTime: 'T2' },
        { id: '3', name: 'other.txt', modifiedTime: 'T3' },
      ] }) }
    })
    const p = makeGoogleDriveProvider(authStub())
    const names = await p.listNames('nmdsync__p1__')
    expect(names.map(n => n.name).sort()).toEqual(['nmdsync__p1__manifest.json', 'nmdsync__p1__planner__2026-W26.nmdsync'])
  })

  it('getText returns null when the named file is absent', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("name%3D'NexusMD'")) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'F' }] }) }
      return { ok: true, status: 200, json: async () => ({ files: [] }) }   // findFileByName → none
    })
    const p = makeGoogleDriveProvider(authStub())
    expect(await p.getText('nmdsync__p1__manifest.json')).toBeNull()
  })
})

describe('OneDrive object-store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('getText returns content for a path-addressed file', async () => {
    global.fetch = vi.fn(async (url) => ({ ok: true, status: 200, text: async () => 'CIPHER', json: async () => ({}) }))
    const p = makeOneDriveProvider(authStub())
    expect(await p.getText('nmdsync__p1__manifest.json')).toBe('CIPHER')
  })

  it('getText returns null on 404', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }))
    const p = makeOneDriveProvider(authStub())
    expect(await p.getText('nope.nmdsync')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/cloud-objectstore.test.jsx`
Expected: FAIL — `getText`/`listNames` not functions.

- [ ] **Step 3: Implement in the Google Drive factory**

In `packages/ui/src/cloud/providers.js`, inside `makeGoogleDriveProvider`'s returned object (after `download`), add:

```js
    async getText(name) {
      const id = await findFileByName(name)
      if (!id) return null
      const r = await authedFetch(authBinding, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
      return r.text()
    },
    async listNames(prefix) {
      const fid = await ensureFolder()
      const q = encodeURIComponent(`'${fid}' in parents and trashed=false`)
      const r = await (await authedFetch(authBinding,
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`)).json()
      return (r.files || [])
        .filter(f => f.name.startsWith(prefix))
        .map(f => ({ name: f.name, modifiedAt: f.modifiedTime }))
    },
    async remove(name) {
      const id = await findFileByName(name)
      if (!id) return
      await authedFetch(authBinding, `https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' })
    },
```

- [ ] **Step 4: Implement in the OneDrive factory**

Inside `makeOneDriveProvider`'s returned object (after `download`), add:

```js
    async getText(name) {
      try {
        const r = await authedFetch(authBinding, `${GRAPH}/root:/${FOLDER}/${encodeURIComponent(name)}:/content`)
        return r.text()
      } catch (e) {
        if (String(e.message).includes('(404)')) return null
        throw e
      }
    },
    async listNames(prefix) {
      let res
      try {
        res = await authedFetch(authBinding, `${GRAPH}/root:/${FOLDER}:/children?$select=name,lastModifiedDateTime&$top=999`)
      } catch (e) {
        if (String(e.message).includes('(404)')) return []
        throw e
      }
      const r = await res.json()
      return (r.value || [])
        .filter(f => f.name.startsWith(prefix))
        .map(f => ({ name: f.name, modifiedAt: f.lastModifiedDateTime }))
    },
    async remove(name) {
      try {
        await authedFetch(authBinding, `${GRAPH}/root:/${FOLDER}/${encodeURIComponent(name)}:`, { method: 'DELETE' })
      } catch (e) {
        if (!String(e.message).includes('(404)')) throw e
      }
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/cloud-objectstore.test.jsx`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/cloud/providers.js packages/ui/tests/cloud-objectstore.test.jsx
git commit -m "feat(ui): by-name object-store methods on cloud providers (getText/listNames/remove)"
```

---

### Task 2: Sync crypto helpers

**Files:**
- Create: `packages/ui/src/sync/crypto.js`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/sync-runtime.test.jsx` (a focused `describe` for crypto)

**Interfaces:**
- Consumes: `encryptConfidentialForServer`, `decryptConfidentialFromServer` from `@nexusmd/core`.
- Produces: `encryptSync(obj, keyHex): Promise<string>` (wrapper JSON `{format:'nexusmd-sync',version:1,iv,ciphertext}`); `decryptSync(text, keyHex): Promise<any>` (throws on wrong key/format).

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/sync-runtime.test.jsx
import { describe, it, expect } from 'vitest'
import { encryptSync, decryptSync } from '../src/index.js'

describe('sync crypto', () => {
  it('round-trips an object and rejects a wrong key', async () => {
    const text = await encryptSync({ a: 1, b: [2, 3] }, 'key-hex-aaa')
    expect(text).toContain('nexusmd-sync')
    expect(await decryptSync(text, 'key-hex-aaa')).toEqual({ a: 1, b: [2, 3] })
    await expect(decryptSync(text, 'key-hex-bbb')).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: FAIL — `encryptSync` not found.

- [ ] **Step 3: Write the implementation**

```js
// packages/ui/src/sync/crypto.js
// Encrypt/decrypt sync payloads with a pre-derived key (hex), reusing core AES-GCM.
import { encryptConfidentialForServer, decryptConfidentialFromServer } from '@nexusmd/core';

const FORMAT = 'nexusmd-sync';
const VERSION = 1;

export async function encryptSync(obj, keyHex) {
  const { iv, ciphertext } = await encryptConfidentialForServer(obj, keyHex);
  return JSON.stringify({ format: FORMAT, version: VERSION, iv, ciphertext });
}

export async function decryptSync(text, keyHex) {
  const w = JSON.parse(text);
  if (!w || w.format !== FORMAT || !w.iv || !w.ciphertext) throw new Error('not a sync payload');
  return decryptConfidentialFromServer({ iv: w.iv, ciphertext: w.ciphertext }, keyHex);
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/ui/src/index.js`, add (near the cloud-providers export):

```js
export { encryptSync, decryptSync } from './sync/crypto.js'
export { plannerCollection } from './sync/collections.js'
export { createSyncRuntime } from './sync/runtime.js'
```

(`collections.js`/`runtime.js` arrive in Tasks 3–4; include all three lines now or add incrementally and complete by Task 4.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: the crypto test PASSES (restrict the barrel to the crypto line if running before Tasks 3–4 exist).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/sync/crypto.js packages/ui/src/index.js packages/ui/tests/sync-runtime.test.jsx
git commit -m "feat(ui): sync payload crypto (encryptSync/decryptSync over core AES-GCM)"
```

---

### Task 3: Planner collection adapter

**Files:**
- Create: `packages/ui/src/sync/collections.js`
- Test: `packages/ui/tests/sync-runtime.test.jsx` (append a `describe`)

**Interfaces:**
- Consumes: `mergePlannerWeek` from `@nexusmd/core`.
- Produces: `plannerCollection({ storage, getProfileKey, namespace }) → { id:'planner', listLocal(): string[], readLocal(key): any|null, writeLocal(key, value): void, removeLocal(key): void, merge }`. Item key is the week suffix `YYYY-Www`; payload is `{ data, themes }`. Storage key is `getProfileKey(`${namespace}.planner.week.${key}`)` (same shape as `planner-storage.js`). `merge` is `(b,l,r,ctx) => mergePlannerWeek(b,l,r,ctx)`.

- [ ] **Step 1: Write the failing test (append)**

```jsx
import { plannerCollection } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: FAIL — `plannerCollection` not found.

- [ ] **Step 3: Write the implementation**

```js
// collections.js — sync collection adapters. Each adapter enumerates/reads/writes
// a localStorage-backed data type and names its core merge strategy.
import { mergePlannerWeek } from '@nexusmd/core';

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: crypto + plannerCollection tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/sync/collections.js packages/ui/tests/sync-runtime.test.jsx
git commit -m "feat(ui): planner sync collection adapter"
```

---

### Task 4: createSyncRuntime (the sync pass)

**Files:**
- Create: `packages/ui/src/sync/runtime.js`
- Test: `packages/ui/tests/sync-runtime.test.jsx` (append the two-device test)

**Interfaces:**
- Consumes: `reconcileItem`, `contentHash` from `@nexusmd/core`; `encryptSync`/`decryptSync` (Task 2); collection adapters (Task 3).
- Produces: `createSyncRuntime({ storage, getProfileKey, namespace, profileId, cloud, getKey, deviceId, collections, now, onChanged }) → { syncNow(): Promise<{ pushed, pulled, merged, conflicts }> }`. `cloud` exposes `upload(name,text)`, `getText(name)`, `listNames(prefix)`, `remove(name)`. `getKey()` → hex or null. `now()` defaults to `() => Date.now()`. `onChanged(collectionId)` is optional.

- [ ] **Step 1: Write the failing test (append) — two devices converge**

```jsx
import { createSyncRuntime, plannerCollection } from '../src/index.js'

// One shared in-memory cloud (name -> text).
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
    cloud: fakeCloud(cloudStore), getKey: async () => 'shared-key', deviceId,
    now: tick, collections: [plannerCollection({ storage, getProfileKey, namespace: 'nexusmd' })] }
  return { storage, runtime: createSyncRuntime(base) }
}

describe('createSyncRuntime two-device sync', () => {
  it('propagates a week from device A to device B', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const A = device({ 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { items: [{ id: 'r1', txt: 'hi' }] }, themes: {} }) }, cloud, 'A', tick)
    const B = device({}, cloud, 'B', tick)

    await A.runtime.syncNow()           // push W26 + manifest
    await B.runtime.syncNow()           // pull W26

    expect(JSON.parse(B.storage.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.items)
      .toEqual([{ id: 'r1', txt: 'hi' }])
  })

  it('merges independent edits made on both devices', async () => {
    const cloud = new Map(); let t = 1; const tick = () => t++
    const seed = { 'nexusmd.p.p1.planner.week.2026-W26': JSON.stringify({ data: { items: [{ id: 'r1', txt: 'base' }] }, themes: {} }) }
    const A = device({ ...seed }, cloud, 'A', tick)
    const B = device({ ...seed }, cloud, 'B', tick)
    await A.runtime.syncNow(); await B.runtime.syncNow()   // both share base W26

    // A adds r2, B adds r3 — independent edits to the same week
    A.storage.setItem('nexusmd.p.p1.planner.week.2026-W26', JSON.stringify({ data: { items: [{ id: 'r1', txt: 'base' }, { id: 'r2', txt: 'from A' }] }, themes: {} }))
    B.storage.setItem('nexusmd.p.p1.planner.week.2026-W26', JSON.stringify({ data: { items: [{ id: 'r1', txt: 'base' }, { id: 'r3', txt: 'from B' }] }, themes: {} }))

    await A.runtime.syncNow()   // A pushes r1+r2
    await B.runtime.syncNow()   // B merges → r1+r3 (local) + r2 (remote)
    await A.runtime.syncNow()   // A pulls B's merged result

    const ids = JSON.parse(A.storage.getItem('nexusmd.p.p1.planner.week.2026-W26')).data.items.map(r => r.id).sort()
    expect(ids).toEqual(['r1', 'r2', 'r3'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: FAIL — `createSyncRuntime` not found.

- [ ] **Step 3: Write the implementation**

```js
// runtime.js — generic sync orchestrator. Pulls an encrypted per-profile manifest,
// reconciles each collection item (push/pull/merge/delete) via the core engine,
// maintains per-item base snapshots, and re-uploads the manifest as the commit.
import { reconcileItem, contentHash } from '@nexusmd/core';
import { encryptSync, decryptSync } from './crypto.js';

export function createSyncRuntime({
  storage, getProfileKey, namespace, profileId, cloud, getKey, deviceId,
  collections, now = () => Date.now(), onChanged,
}) {
  let inFlight = false;
  const fileName = (coll, key) => `nmdsync__${profileId}__${coll}__${key}.nmdsync`;
  const manifestName = `nmdsync__${profileId}__manifest.json`;
  const baseKey = (full) => getProfileKey(`${namespace}.sync.base.${full.replace('/', '.')}`);

  const readBase = (full) => {
    try { const raw = storage.getItem(baseKey(full)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const writeBase = (full, value) => {
    try { if (value == null) storage.removeItem(baseKey(full)); else storage.setItem(baseKey(full), JSON.stringify(value)); } catch {}
  };

  async function syncNow() {
    if (inFlight) return { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    const key = await getKey();
    if (!key) return { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    inFlight = true;
    const stats = { pushed: 0, pulled: 0, merged: 0, conflicts: [] };
    try {
      // 1. Manifest
      let manifest = { items: {}, tombstones: [] };
      const mText = await cloud.getText(manifestName);
      if (mText) { try { manifest = await decryptSync(mText, key); } catch { manifest = { items: {}, tombstones: [] }; } }
      manifest.items = manifest.items || {};
      manifest.tombstones = manifest.tombstones || [];
      const next = { items: { ...manifest.items }, tombstones: [...manifest.tombstones], version: 1, format: 'nexusmd-sync-manifest' };
      const tomb = new Set(manifest.tombstones);
      let dirty = false;

      for (const coll of collections) {
        const localKeys = coll.listLocal();
        const fullKeys = new Set([
          ...localKeys.map(k => `${coll.id}/${k}`),
          ...Object.keys(manifest.items).filter(fk => fk.startsWith(coll.id + '/')),
        ]);
        for (const full of fullKeys) {
          const itemKey = full.slice(coll.id.length + 1);
          const local = coll.readLocal(itemKey);
          const base = readBase(full);
          const entry = manifest.items[full];
          const isTomb = tomb.has(full);

          let remote = null;
          if (entry && !isTomb && entry.hash !== contentHash(local)) {
            const rText = await cloud.getText(fileName(coll.id, itemKey));
            if (rText) { try { remote = await decryptSync(rText, key); } catch { remote = null; } }
          } else if (entry && !isTomb) {
            remote = local; // hashes equal → treat as same, avoids a download
          }

          const { action, value, conflicts } = reconcileItem({
            base, local, remote,
            merge: (b, l, r) => coll.merge(b, l, r, { from: deviceId, prefer: 'local' }),
          });

          if (action === 'push' || action === 'merge') {
            if (action === 'merge') { coll.writeLocal(itemKey, value); onChanged?.(coll.id); stats.merged++; stats.conflicts.push(...conflicts); }
            await cloud.upload(fileName(coll.id, itemKey), await encryptSync(value, key));
            writeBase(full, value);
            next.items[full] = { hash: contentHash(value), modifiedAt: now(), deviceId };
            if (action === 'push') stats.pushed++;
            tomb.delete(full);
            dirty = true;
          } else if (action === 'pull') {
            coll.writeLocal(itemKey, value);
            writeBase(full, value);
            next.items[full] = entry || { hash: contentHash(value), modifiedAt: now(), deviceId };
            onChanged?.(coll.id);
            stats.pulled++;
          } else if (action === 'delete-local') {
            coll.removeLocal(itemKey);
            writeBase(full, null);
            delete next.items[full];
            onChanged?.(coll.id);
          } else if (action === 'tombstone') {
            await cloud.remove(fileName(coll.id, itemKey));
            writeBase(full, null);
            delete next.items[full];
            if (!tomb.has(full)) { next.tombstones.push(full); tomb.add(full); }
            dirty = true;
          } else {
            // noop: keep existing manifest entry as-is
            if (entry && !isTomb) next.items[full] = entry;
          }
        }
      }

      if (dirty || mText == null) {
        await cloud.upload(manifestName, await encryptSync(next, key));
      }
      return stats;
    } finally {
      inFlight = false;
    }
  }

  return { syncNow };
}
```

- [ ] **Step 4: Complete the barrel**

Ensure `packages/ui/src/index.js` exports `createSyncRuntime`, `plannerCollection`, `encryptSync`, `decryptSync` (added in Task 2 Step 4).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/sync-runtime.test.jsx`
Expected: crypto + plannerCollection + two-device tests PASS.

- [ ] **Step 6: Full ui regression**

Run: `npx vitest run packages/ui`
Expected: all ui tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/sync/runtime.js packages/ui/src/index.js packages/ui/tests/sync-runtime.test.jsx
git commit -m "feat(ui): createSyncRuntime — manifest-based push/pull/merge sync pass"
```

---

### Task 5: Web wiring — minimal Sync card  — ⚠️ DEFERRED TO PHASE 4

> **Deferred (decided during execution):** the web app already ships a legacy planner-sync subsystem (`apps/web/src/planner-sync.js` + `PlannerSyncCard`/`DriveSyncCard`, wired via `plannerOnWeekSaved`). Mounting a second sync card would run two sync systems at once. The web UI wiring is therefore folded into the **Phase-4 legacy cutover** (which also ports local-folder export + the offline queue into the new engine). Phase 2 ends at Task 4. The `apps/web/src/sync.js` helper below remains a useful reference for the Phase-4 wiring but is **not** mounted in Phase 2. Do not implement this task as part of Phase 2.

**Files:**
- Create: `apps/web/src/sync.js`
- Modify: `apps/web/src/view-settings.jsx`

**Interfaces:**
- Consumes: `webCloudProviders` (`apps/web/src/cloud-auth.js`), `createSyncRuntime` + `plannerCollection` (`@nexusmd/ui`), `hashPassword` (`@nexusmd/core`), `getProfileKey` (`apps/web/src/profile-keys.js`), `getActiveProfileId` (from profile-keys), `toast`.
- Produces: `buildPlannerSync(profileId, providerId)` → a runtime; `setSyncPassphrase(pass)`/`getSyncKey()` (minimal localStorage key cache for this phase).

- [ ] **Step 1: Create `apps/web/src/sync.js`**

```js
// sync.js — web wiring for continuous planner sync (Phase 2: manual Sync now).
// Minimal key handling (localStorage-cached derived key); Phase 4 hardens this
// with a verifier + secure storage.
import { createSyncRuntime, plannerCollection } from '@nexusmd/ui'
import { hashPassword } from '@nexusmd/core'
import { getProfileKey, getActiveProfileId } from './profile-keys.js'
import { webCloudProviders } from './cloud-auth.js'

const KEY_CACHE = 'nexusmd.sync.keyhex'   // per device (not per profile); the shared sync key

export async function setSyncPassphrase(pass) {
  const hex = await hashPassword(pass)
  try { localStorage.setItem(KEY_CACHE, hex) } catch {}
}
export function clearSyncPassphrase() { try { localStorage.removeItem(KEY_CACHE) } catch {} }
export function hasSyncKey() { try { return Boolean(localStorage.getItem(KEY_CACHE)) } catch { return false } }

export function buildPlannerSync(providerId) {
  const cloud = webCloudProviders.find(p => p.id === providerId)
  if (!cloud) return null
  const profileId = getActiveProfileId()
  return createSyncRuntime({
    storage: window.localStorage, getProfileKey, namespace: 'nexusmd', profileId,
    cloud, getKey: async () => { try { return localStorage.getItem(KEY_CACHE) } catch { return null } },
    deviceId: getDeviceId(),
    collections: [plannerCollection({ storage: window.localStorage, getProfileKey, namespace: 'nexusmd' })],
    onChanged: () => document.dispatchEvent(new CustomEvent('nexusmd:data-updated')),
  })
}

function getDeviceId() {
  try {
    let id = localStorage.getItem('nexusmd.sync.deviceId')
    if (!id) { id = 'web-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('nexusmd.sync.deviceId', id) }
    return id
  } catch { return 'web' }
}
```

- [ ] **Step 2: Add a minimal Sync card to web Settings**

In `apps/web/src/view-settings.jsx`, add the import next to the cloud-auth import:

```js
import { buildPlannerSync, setSyncPassphrase, hasSyncKey } from './sync.js'
import { webCloudProviders } from './cloud-auth.js'
```

Add a small component near the other settings components (above `SettingsView`):

```jsx
function PlannerSyncCard() {
  const [pass, setPass] = usePrefVS ? [null] : [null] // placeholder guard; use local React state below
  const [pw, setPw] = React.useState('')
  const [provider, setProvider] = React.useState(webCloudProviders[0]?.id || 'gdrive')
  const [busy, setBusy] = React.useState(false)
  const connected = webCloudProviders.find(p => p.id === provider)?.isConnected?.()
  const run = async () => {
    setBusy(true)
    try {
      if (pw) await setSyncPassphrase(pw)
      if (!hasSyncKey()) { toast?.('Enter a sync passphrase first.', 'error'); return }
      const rt = buildPlannerSync(provider)
      if (!rt) { toast?.('Connect the provider first.', 'error'); return }
      const s = await rt.syncNow()
      toast?.(`Synced. ↑${s.pushed} ↓${s.pulled} ⨝${s.merged}${s.conflicts.length ? ` (${s.conflicts.length} conflicts)` : ''}`, 'success')
    } catch (e) { toast?.(e?.message || 'Sync failed.', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="card set-card">
      <div className="card-head"><h3>&nbsp;Planner cloud sync</h3></div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Sync planner weeks across devices via your connected cloud. Use the same sync passphrase on every device.
        </div>
        <select value={provider} onChange={e => setProvider(e.target.value)}>
          {webCloudProviders.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <input type="password" placeholder="Sync passphrase (set/enter)" value={pw} onChange={e => setPw(e.target.value)} />
        <button className="btn sm" disabled={busy || !connected} onClick={run}>Sync now</button>
        {!connected && <div className="plm-callout">Connect {webCloudProviders.find(p => p.id === provider)?.label} above first.</div>}
      </div>
    </div>
  )
}
```

(Remove the stray `usePrefVS` placeholder line — it is illustrative; use only the `React.useState` hooks shown.)

Mount it under the profiles subpage, after the BackupRestoreCard:

```jsx
              <BackupRestoreCard fileIO={webFileIO} cloudProviders={webCloudProviders} />
              <PlannerSyncCard />
```

- [ ] **Step 3: Build + full JS suite**

Run: `npm -w apps/web run build`
Expected: SUCCESS.

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Manual smoke (documented)**

With two browsers/profiles pointed at the same connected cloud + same passphrase: edit a planner week in one, **Sync now**; in the other, **Sync now** → the week appears. Edit different rows of one week in both, sync both → both rows present.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sync.js apps/web/src/view-settings.jsx
git commit -m "feat(web): minimal planner Sync now card (manual cloud sync)"
```

---

## Self-Review Notes

- **Spec coverage (Phase 2):** `createSyncRuntime` with manifest + base snapshots + push/pull/merge/tombstone ✓; planner collection ✓; provider object-store for programmatic by-name sync ✓; sync payload encryption with the derived key ✓; minimal web manual `syncNow` wiring ✓. Deferred to later phases: notes/team/tweaks collections (Phase 3); auto-triggers, conflict UI, hardened key management with verifier + secure storage (Phase 4); app/desktop wiring (Phase 5).
- **Type consistency:** runtime `cloud` uses `upload/getText/listNames/remove`; collection adapters use `id/listLocal/readLocal/writeLocal/removeLocal/merge`; `reconcileItem` actions match Phase 1; manifest shape `{ items: { "<coll>/<key>": {hash,modifiedAt,deviceId} }, tombstones: [] }`. `encryptSync`/`decryptSync` wrapper format `nexusmd-sync`.
- **Clock use:** confined to the ui runtime (`now()` injectable, defaulted to `Date.now()`), keeping core pure; tests inject a deterministic `tick`.
- **No placeholders:** every code step has complete code (the one illustrative `usePrefVS` line in Task 5 is explicitly flagged for removal).
- **Known Phase-2 limitation (documented):** the key cache is plain `localStorage` and has no verifier yet — Phase 4 adds the secure-storage `keyStore` + manifest verifier so a wrong passphrase is detected. `listNames` is available for Phase 4 orphan-cleanup but unused here (the manifest drives enumeration).
