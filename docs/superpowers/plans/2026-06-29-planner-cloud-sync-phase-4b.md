# Continuous Profile Sync — Phase 4b (local-folder export/import + deferred minors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save the active profile's synced data (planner + notes + team + tweaks) to an **encrypted local file** and import such a file from another app instance/platform — merging it in (never clobbering) — plus clean up the deferred Phase-4a minors.

**Architecture:** A pure, cross-platform bundle engine lands in `@nexusmd/ui` (`exportBundle`/`importBundle`) that reuses the *same* collection adapters and AES-GCM crypto the sync runtime uses, so export/import is just "read all local items → encrypt" and "decrypt → 3-way-merge into local". Export is encrypted with the **remembered sync passphrase** (no new secret). Import merges via each collection's existing core merge strategy (base = null → keep-both union), so importing from another instance is loss-free and the next cloud sync pushes the union. The web app wires file save/open (reusing Feature A's `webFileIO` pattern) into `CloudSyncCard`. The Phase-4a minors are folded in: a testable `singleFlight` helper replaces the ad-hoc in-flight sentinel, the duplicated bad-passphrase factory is extracted, `CloudSyncCard` reads provider via `getSyncProvider()` and refreshes its connection state on focus, and notes/team/tweaks edits also fire the debounced change trigger.

**Tech Stack:** JS ESM, Vitest + @testing-library/react (jsdom) for ui; React + Vite for web. Reuses `@nexusmd/ui` (`encryptSync`/`decryptSync`, the five collection adapters, `createSyncRuntime`, `startAutoSync`) and the core merge engine.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This is **Phase 4b** (web local-folder export/import + Phase-4a minor cleanup). Desktop + app sync/local-folder wiring is **Phase 5**.
- **Security:** the local bundle is **AES-GCM encrypted** with the remembered sync key (the 64-hex-char `hashPassword` output, cached at `nexusmd.sync.keyhex`). Never write plaintext collection data to a file. Never log the passphrase or the key. A wrong-key import must fail loudly with `code:'bad-passphrase'` and write nothing.
- **Loss-free import:** importing merges into local via each collection's existing `merge(base, local, remote, ctx)` with `base = null` (keep-both union; keyval prefers local). Import must never blind-overwrite local data. After import, dispatch `nexusmd:sync-applied` per touched collection so open views re-hydrate (the Phase-4a listeners already handle this), and the next auto-sync pushes the union to the cloud.
- **Bundle format:** `{ format: 'nexusmd-planner-bundle', version: 1, profileId, collections: { <collId>: { <itemKey>: value } } }`, then `encryptSync(bundleObj, keyHex)`. Collection ids and item keys are exactly what the adapters produce: `planner` → one entry per week key; `notes`/`team-custom`/`team-removed`/`tweaks` → a single `data` entry.
- **Web file mechanism:** reuse the existing `apps/web/src/file-io.js` `webFileIO` pattern (download-to-save + hidden `<input type=file>` to open). No File System Access API (none exists in the repo). Export filename: `nexusmd-planner-<profileId>-<YYYYMMDD-HHmmss>.nmdplanner` (runtime may use `Date.now()`/`new Date()`).
- Tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/ui` and `npx vitest run` (full suite, currently 417). Web build: `npm -w apps/web run build`. **The vitest workspace covers only `packages/*` — `apps/web` has no test harness**, so web-glue tasks are build-verified (consistent with Phase 4a); all unit-testable logic lives in `@nexusmd/ui`.
- Style per file: `packages/ui/src` uses **semicolons**; `apps/web/src/sync.js` uses **no semicolons**; `apps/web/src/app.jsx` and `view-planner-2.jsx` and `view-settings.jsx` use **semicolons**. Match each file's local style.

---

## File Structure

- `packages/ui/src/sync/single-flight.js` — **new.** `singleFlight(fn)` → wrapped async fn that coalesces concurrent calls (the tested replacement for sync.js's `_inFlight` sentinel).
- `packages/ui/src/sync/runtime.js` — **modify.** Extract a `badPassphrase()` factory used at both throw sites (dedup minor).
- `packages/ui/src/sync/local-bundle.js` — **new.** `exportBundle`/`importBundle`.
- `packages/ui/src/index.js` — **modify.** Export `singleFlight`, `exportBundle`, `importBundle`.
- `packages/ui/tests/sync-single-flight.test.jsx` — **new.**
- `packages/ui/tests/sync-local-bundle.test.jsx` — **new.**
- `apps/web/src/sync.js` — **modify.** Share a `buildCollections()` helper; add `exportLocalBundle()`/`importLocalBundle(text)`; wrap `syncOnce` with `singleFlight` (replacing `_inFlight`).
- `apps/web/src/file-io.js` — **modify.** Accept `.nmdplanner` in `pickFile`.
- `apps/web/src/view-settings.jsx` — **modify.** `CloudSyncCard`: Export/Import buttons; provider via `getSyncProvider()`; refresh `connected` on focus.
- `apps/web/src/app.jsx` — **modify.** Dispatch `nexusmd:data-changed` from the two tweaks write sites.
- `packages/ui/src/planner/planner-notes.jsx` — **modify.** Dispatch `nexusmd:data-changed` from `saveGlobalNotes`.

---

### Task 1: `singleFlight` helper + dedup bad-passphrase factory (ui)

**Files:**
- Create: `packages/ui/src/sync/single-flight.js`
- Modify: `packages/ui/src/sync/runtime.js`, `packages/ui/src/index.js`
- Test: `packages/ui/tests/sync-single-flight.test.jsx`

**Interfaces:**
- Produces: `singleFlight(fn) → async (...args) => result` — while a call is in flight, concurrent calls return `{ skipped: 'in-flight' }` without invoking `fn`; the guard clears when the in-flight promise settles (resolve **or** reject), so a later call runs normally. (Coalesce-by-skip, matching the Phase-4a behavior.)
- Produces (runtime.js): `badPassphrase()` → `Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' })`, used at both existing throw sites.

- [ ] **Step 1: Write the failing tests** — `packages/ui/tests/sync-single-flight.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { singleFlight } from '../src/index.js';

describe('singleFlight', () => {
  it('coalesces concurrent calls and clears after settle', async () => {
    let resolve; let calls = 0;
    const inner = vi.fn(() => { calls++; return new Promise(r => { resolve = r; }); });
    const wrapped = singleFlight(inner);

    const p1 = wrapped();                 // starts the in-flight call
    const second = await wrapped();        // concurrent → skipped
    expect(second).toEqual({ skipped: 'in-flight' });
    expect(calls).toBe(1);

    resolve('ok');
    expect(await p1).toBe('ok');

    const third = await wrapped();          // guard cleared → runs again
    expect(calls).toBe(2);
    resolve('ok2');                         // settle the third call's promise
  });

  it('clears the guard even when the in-flight call rejects', async () => {
    let reject; let calls = 0;
    const inner = () => { calls++; return new Promise((_, rej) => { reject = rej; }); };
    const wrapped = singleFlight(inner);
    const p = wrapped().catch(() => 'caught');
    reject(new Error('boom'));
    await p;
    const next = wrapped();                 // not wedged
    expect(calls).toBe(2);
    return next.catch(() => {});
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run packages/ui/tests/sync-single-flight.test.jsx`
Expected: FAIL — `singleFlight is not a function`.

- [ ] **Step 3: Implement** — `packages/ui/src/sync/single-flight.js`:

```js
// single-flight.js — wrap an async fn so overlapping calls coalesce. While one
// call is running, concurrent calls return { skipped: 'in-flight' } without
// invoking fn. The guard is set synchronously before the first await and
// cleared when the in-flight promise settles (resolve or reject).
export function singleFlight(fn) {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return { skipped: 'in-flight' };
    inFlight = true;
    try {
      return await fn(...args);
    } finally {
      inFlight = false;
    }
  };
}
```

- [ ] **Step 4: Dedup the runtime factory** — in `packages/ui/src/sync/runtime.js`, add near the top of `createSyncRuntime` (or module scope) `const badPassphrase = () => Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' });` and replace BOTH existing `throw Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' })` sites with `throw badPassphrase();`. No behavior change.

- [ ] **Step 5: Export** — in `packages/ui/src/index.js`, add to the Continuous-sync export group: `export { singleFlight } from './sync/single-flight.js';`

- [ ] **Step 6: Run to verify PASS**

Run: `npx vitest run packages/ui`
Expected: PASS — new single-flight tests green; all existing 95 ui tests still green (the runtime dedup is behavior-preserving).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/sync/single-flight.js packages/ui/src/sync/runtime.js packages/ui/src/index.js packages/ui/tests/sync-single-flight.test.jsx
git commit -m "feat(ui): singleFlight helper + dedup sync bad-passphrase factory"
```

---

### Task 2: Local bundle export/import engine (ui)

**Files:**
- Create: `packages/ui/src/sync/local-bundle.js`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/sync-local-bundle.test.jsx`

**Interfaces:**
- Consumes: collection adapters (same shape `createSyncRuntime` consumes — `{ id, listLocal(), readLocal(key), writeLocal(key, value), merge(base, local, remote, ctx) }`); `encryptSync`/`decryptSync` from `./crypto.js`.
- Produces:
  - `exportBundle({ collections, getKey, profileId }) → Promise<string>` — reads every local item from each collection, assembles `{ format:'nexusmd-planner-bundle', version:1, profileId, collections:{ [id]:{ [itemKey]: value } } }`, returns `encryptSync(bundle, key)`. Throws if `getKey()` returns falsy (caller must guard on a remembered passphrase).
  - `importBundle({ collections, getKey, text, onChanged }) → Promise<{ collections: string[] }>` — `decryptSync(text, key)` (on failure throw `Object.assign(new Error('bad passphrase'), { code:'bad-passphrase' })` and write nothing); validates `bundle.format === 'nexusmd-planner-bundle'`; for each collection present in `bundle.collections`, for each `itemKey`, computes `merged = coll.merge(null, coll.readLocal(itemKey), importedValue, { from:'import', prefer:'local' }).merged`, `coll.writeLocal(itemKey, merged)`, and calls `onChanged?.(coll.id)` once per collection that changed. Returns the list of touched collection ids. Ignores unknown collection ids in the file.

- [ ] **Step 1: Write the failing tests** — `packages/ui/tests/sync-local-bundle.test.jsx`:

```jsx
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

  it('rejects a wrong key and writes nothing', async () => {
    const aStore = memStorage({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'A' }]) });
    const text = await exportBundle({ collections: cols(aStore), getKey: async () => KEY, profileId: 'p1' });
    const bStore = memStorage({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'keep', body: 'B' }]) });
    await expect(importBundle({ collections: cols(bStore), getKey: async () => 'b'.repeat(64), text }))
      .rejects.toMatchObject({ code: 'bad-passphrase' });
    expect(JSON.parse(bStore.getItem('nexusmd.p.p1.planner.globalNotes'))).toEqual([{ id: 'keep', body: 'B' }]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run packages/ui/tests/sync-local-bundle.test.jsx`
Expected: FAIL — `exportBundle is not a function`.

- [ ] **Step 3: Implement** — `packages/ui/src/sync/local-bundle.js`:

```js
// local-bundle.js — export/import the active profile's synced collections as a
// single AES-GCM-encrypted file. Reuses the same collection adapters and crypto
// as createSyncRuntime, so a file written by one instance imports (and merges)
// cleanly into any other. Import is loss-free: each item is 3-way-merged into
// local with base=null (keep-both union; keyval prefers local).
import { encryptSync, decryptSync } from './crypto.js';

const FORMAT = 'nexusmd-planner-bundle';

export async function exportBundle({ collections, getKey, profileId }) {
  const key = await getKey();
  if (!key) throw new Error('no sync key');
  const out = {};
  for (const coll of collections) {
    const items = {};
    for (const itemKey of coll.listLocal()) {
      const v = coll.readLocal(itemKey);
      if (v != null) items[itemKey] = v;
    }
    if (Object.keys(items).length) out[coll.id] = items;
  }
  return encryptSync({ format: FORMAT, version: 1, profileId: profileId || null, collections: out }, key);
}

export async function importBundle({ collections, getKey, text, onChanged }) {
  const key = await getKey();
  if (!key) throw new Error('no sync key');
  let bundle;
  try { bundle = await decryptSync(text, key); }
  catch { throw Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' }); }
  if (!bundle || bundle.format !== FORMAT) throw new Error('not a planner bundle');

  const byId = Object.fromEntries(collections.map(c => [c.id, c]));
  const touched = [];
  for (const [collId, items] of Object.entries(bundle.collections || {})) {
    const coll = byId[collId];
    if (!coll || !items) continue;
    let changed = false;
    for (const [itemKey, importedValue] of Object.entries(items)) {
      const local = coll.readLocal(itemKey);
      const { merged } = coll.merge(null, local, importedValue, { from: 'import', prefer: 'local' });
      coll.writeLocal(itemKey, merged);
      changed = true;
    }
    if (changed) { touched.push(collId); onChanged?.(collId); }
  }
  return { collections: touched };
}
```

- [ ] **Step 4: Export** — in `packages/ui/src/index.js`, add to the Continuous-sync export group: `export { exportBundle, importBundle } from './sync/local-bundle.js';`

- [ ] **Step 5: Run to verify PASS**

Run: `npx vitest run packages/ui`
Expected: PASS — bundle round-trip + wrong-key tests green; existing ui tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/sync/local-bundle.js packages/ui/src/index.js packages/ui/tests/sync-local-bundle.test.jsx
git commit -m "feat(ui): encrypted local planner-bundle export/import engine"
```

---

### Task 3: Wire local export/import on web + provider/connection minors

**Files:**
- Modify: `apps/web/src/sync.js`, `apps/web/src/file-io.js`, `apps/web/src/view-settings.jsx`

**Interfaces:**
- Consumes: `exportBundle`, `importBundle`, `singleFlight` from `@nexusmd/ui`; existing `webFileIO` (`saveFile`, `pickFile`); existing `getKey`, `getSyncProvider`, `getActiveProfileId`, the five collection factories, and `KEY`/provider helpers already in `sync.js`.
- Produces (sync.js):
  - `buildCollections()` — extract the five `*Collection({ storage: st, getProfileKey: gp, namespace: ns })` instances (currently inline in `buildSyncRuntime`) into a shared helper used by both `buildSyncRuntime` and the bundle functions.
  - `exportLocalBundle()` → `Promise<string>` — `exportBundle({ collections: buildCollections(), getKey, profileId: getActiveProfileId() || 'default' })`.
  - `importLocalBundle(text)` → `Promise<{ collections }>` — `importBundle({ collections: buildCollections(), getKey, text, onChanged: collId => document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId } })) })`; on success, fire-and-forget `syncOnce()` so the merged union is pushed.
  - `syncOnce` is wrapped with `singleFlight` (remove the module-level `_inFlight` sentinel + its early-return; keep the no-key/no-provider/not-connected/bad-passphrase skip returns inside the wrapped fn). i.e. `const _syncOnceInner = async () => { ...existing body without the _inFlight lines... }; export const syncOnce = singleFlight(_syncOnceInner);` — concurrent calls now return `{ skipped:'in-flight' }` from `singleFlight`.

- [ ] **Step 1: file-io.js** — broaden `pickFile`'s `input.accept` to `'.nmdprofile,.nmdplanner,application/json'`.

- [ ] **Step 2: sync.js** — extract `buildCollections()`; refactor `buildSyncRuntime` to use it; replace the `_inFlight` sentinel by wrapping `syncOnce` with `singleFlight`; add `exportLocalBundle()` and `importLocalBundle(text)` per the interface. Keep no-semicolon style.

- [ ] **Step 3: view-settings.jsx — `CloudSyncCard`:**
  - Initialize the selected provider from `getSyncProvider()?.id || ''` (remove the direct `localStorage.getItem('nexusmd.sync.provider')` read) — minor #1.
  - Add an effect that refreshes the `connected` flag on `window` `focus` (re-call `provider.isConnected()`), and clean up the listener on unmount — minor #2 (stale-pill).
  - Add two buttons, both disabled unless `hasSyncKey()` (export/import need the passphrase), with helper text "needs a sync passphrase" when disabled:
    - **Export to file:** `const text = await exportLocalBundle(); await webFileIO.saveFile(\`nexusmd-planner-${getActiveProfileId() || 'default'}-${stamp()}.nmdplanner\`, text)` where `stamp()` formats `new Date()` as `YYYYMMDD-HHmmss`. Toast success/failure.
    - **Import from file:** `const text = await webFileIO.pickFile(); if (!text) return; try { const r = await importLocalBundle(text); toast('Imported ' + r.collections.join(', '), 'success') } catch (e) { toast(e?.code === 'bad-passphrase' ? 'Wrong passphrase for this file' : 'Import failed', 'error') }`.
  - Import `webFileIO` (from `./file-io.js`), `exportLocalBundle`/`importLocalBundle`/`getActiveProfileId` (from `./sync.js`), and `getSyncProvider` if not already imported.

- [ ] **Step 4: Verify**

Run: `npm -w apps/web run build` → green.
Run: `npx vitest run` → full suite still green (417).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sync.js apps/web/src/file-io.js apps/web/src/view-settings.jsx
git commit -m "feat(web): local planner-bundle export/import + provider/connection minors"
```

---

### Task 4: Broaden the change trigger to notes/team/tweaks

**Files:**
- Modify: `packages/ui/src/planner/planner-notes.jsx`, `apps/web/src/app.jsx`, `apps/web/src/sync.js`

**Context:** Phase 4a's debounced change trigger only fired on planner-week saves (`nexusmd:planner-changed`). Notes/team/tweaks edits only synced on the 5-min interval / window focus. Add a generic `nexusmd:data-changed` event from the non-planner write sites and have web's auto-sync subscribe to it too, so all five collections get the fast debounced push.

**Interfaces:**
- Produces: a `document` CustomEvent `nexusmd:data-changed` dispatched after a non-planner synced-collection write. `startWebAutoSync`'s `subscribeChange` listens to **both** `nexusmd:planner-changed` and `nexusmd:data-changed`.

- [ ] **Step 1: sync.js** — in `startWebAutoSync`, change `subscribeChange` to register on both events and return a cleanup that removes both:

```js
subscribeChange: (cb) => {
  const h = () => cb()
  document.addEventListener('nexusmd:planner-changed', h)
  document.addEventListener('nexusmd:data-changed', h)
  return () => {
    document.removeEventListener('nexusmd:planner-changed', h)
    document.removeEventListener('nexusmd:data-changed', h)
  }
},
```

- [ ] **Step 2: notes** — in `packages/ui/src/planner/planner-notes.jsx` `saveGlobalNotes` (≈line 224), after the storage write, add a guarded dispatch:

```jsx
try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('nexusmd:data-changed', { detail: { collId: 'notes' } })); } catch (_) {}
```

(`saveGlobalNotes` is shared ui; app/desktop have no `nexusmd:data-changed` listener yet, so the dispatch is a harmless no-op there until Phase 5.)

- [ ] **Step 3: tweaks** — in `apps/web/src/app.jsx`, after BOTH `localStorage.setItem('nexusmd.tweaks', …)` sites (≈lines 273 and 1440), add:

```jsx
try { document.dispatchEvent(new CustomEvent('nexusmd:data-changed', { detail: { collId: 'tweaks' } })); } catch (_) {}
```

(Team custom/removed writes live in the shared TeamView; they already converge via interval/focus and a same-week planner edit commonly co-occurs — leave them to the interval trigger for now and note it. Do **not** restructure TeamView in this task.)

- [ ] **Step 4: Verify**

Run: `npm -w apps/web run build` → green.
Run: `npx vitest run` → full suite green (417) — note the new `saveGlobalNotes` dispatch runs under jsdom in the ui notes tests; confirm those still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/planner/planner-notes.jsx apps/web/src/app.jsx apps/web/src/sync.js
git commit -m "feat(web): debounced sync trigger on notes/tweaks edits"
```

---

## Definition of Done

- `@nexusmd/ui` exports a tested `singleFlight`, `exportBundle`, `importBundle`; the runtime's bad-passphrase factory is deduped; all ui tests green.
- Web `CloudSyncCard` can export the active profile's synced data to an **encrypted** `.nmdplanner` file and import one back, merging loss-free; provider state reads via `getSyncProvider()` and refreshes on focus; `syncOnce` serialization is via the tested `singleFlight`.
- Notes/tweaks edits fire the debounced sync trigger (planner already did).
- Full suite (`npx vitest run`) and `npm -w apps/web run build` green.

## Deferred to Phase 5

- Desktop + app: sync wiring, OS-secure-store key cache, native file pickers for `.nmdplanner` export/import, capacitor/electron foreground + change triggers, and the cloud-auth glue tests.
- Team custom/removed fast change trigger (currently interval/focus only).
- Security revisit: salted KDF (PBKDF2/scrypt) instead of unsalted `SHA-256(passphrase)`; consider not persisting the derived key.

## Self-Review

- **Spec coverage:** local-folder export (spec §4, §31, §109) → Tasks 2–3 (encrypted bundle reusing sync key); the "import from other app instances/platforms, all compatible" ask → `importBundle` reuses identical adapters + merge, loss-free union (Task 2 test asserts cross-device union). Offline-queue: spec permits "consciously document dropping the queue, since the new engine retries on the next trigger" — documented here (Phase 4a auto-sync retries on interval/focus/change; no queue). Phase-4a minors all mapped: #1 provider read (Task 3 Step 3), #2 stale pill (Task 3 Step 3), #3 dup factory (Task 1 Step 4), #4 planner-only trigger (Task 4), #5 guard test (Task 1 `singleFlight` is tested and adopted by `syncOnce` in Task 3 Step 2).
- **Placeholder scan:** none — every code step shows full code; web-glue steps give exact signatures/snippets consistent with the file's style.
- **Type consistency:** `singleFlight(fn)→wrapped`, `exportBundle({collections,getKey,profileId})→string`, `importBundle({collections,getKey,text,onChanged})→{collections}`, bundle shape `{format,version,profileId,collections:{[id]:{[itemKey]:value}}}`, event `nexusmd:data-changed` with `detail.collId` — all referenced consistently across tasks.
