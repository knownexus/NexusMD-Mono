# Continuous Profile Sync — Phase 4a (web: live sync, key management, triggers, legacy cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make continuous cloud sync a real, user-visible feature on **web**: a remembered passphrase that derives the AES key (with a verifier so a wrong passphrase fails loudly, not silently corrupting), automatic sync triggers (on-change, on-open, interval), a Settings card to connect/configure it, and removal of the dead legacy `planner-sync.js` subsystem it replaces.

**Architecture:** Two reusable pieces land in `@nexusmd/ui` — a passphrase **verifier** baked into the manifest (`createSyncRuntime`) and a platform-agnostic **`startAutoSync`** trigger driver. The web app then wires them: `apps/web/src/sync.js` builds a 5-collection runtime (planner + notes + team-custom + team-removed + tweaks) over the existing `webCloudProviders`, manages the cached key, and starts auto-sync; `CloudSyncCard` in Settings is the UI. The legacy web-only `planner-sync.js` (dead: Drive backend 404s, local-folder is Electron-gated) is deleted and its single live seam (`plannerOnWeekSaved`) is repointed at a DOM event the new auto-sync listens for.

**Tech Stack:** JS ESM, Vitest + @testing-library/react (jsdom) for ui; React + Vite for web. Reuses Phase 1–3 core merge engine, `createSyncRuntime`, the five collection adapters, `encryptSync`/`decryptSync`, and the `makeGoogleDriveProvider`/`makeOneDriveProvider` object-store API (`getText`/`listNames`/`remove`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This is **Phase 4a** (web cross-device cloud sync). Local-folder export + removal of any remaining legacy remnant is **Phase 4b**; desktop + app wiring is **Phase 5**.
- **Security (non-negotiable):** the derived AES key is a 64-hex-char (32-byte AES-256) string — the SHA-256 shape `hashPassword` already produces. Cloud files stay AES-GCM encrypted via `encryptSync`. The cached key lives in `localStorage` under `nexusmd.sync.keyhex` on web (OS secure store is a Phase 5 concern for desktop/app). Never log the passphrase or the key. The verifier token is a fixed public string — it proves *the key matches an existing vault*, it is not a secret.
- **Verifier contract:** the manifest carries `verifier: encryptSync(VERIFIER_TOKEN, key)`. On a manifest that already has a verifier, `syncNow` decrypts it and compares to `VERIFIER_TOKEN`; mismatch throws `Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' })` **before** any push/pull, so a wrong passphrase can never overwrite cloud data. A brand-new manifest gets a verifier minted from the current key.
- No core changes. `createSyncRuntime` change is additive (verifier) and must keep all existing Phase 2/3 tests green (their manifests have no verifier → treated as new vault, verifier minted on first commit).
- Tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/ui` and `npx vitest run` for the full JS suite. Web build: `npm -w apps/web run build`. Match ui ESM style (semicolons in `packages/ui/src`); match web style (no semicolons in `apps/web/src`).
- Legacy removal must lose **zero working features**: investigation confirmed `apps/web/src/planner-sync.js` is dead on web — its Drive endpoints (`/api/google/drive/planner/*`) return 404 (never implemented in the migrated backend) and its local-folder path is gated on `window.electronAPI.saveFile` (absent in the browser). Only its `onWeekSaved` seam is live, and it only feeds the dead Drive push.

---

## File Structure

- `packages/ui/src/sync/runtime.js` — **modify.** Add the verifier check/mint to `createSyncRuntime`.
- `packages/ui/src/sync/auto.js` — **new.** `startAutoSync({ syncNow, intervalMs, subscribeForeground, subscribeChange, debounceMs }) → stop()`.
- `packages/ui/src/index.js` — **modify.** Export `startAutoSync`.
- `packages/ui/tests/sync-runtime.test.jsx` — **modify.** Add verifier accept/reject tests.
- `packages/ui/tests/sync-auto.test.jsx` — **new.** Fake-timer tests for interval / change-debounce / foreground.
- `apps/web/src/planner-sync.js` — **delete** (`git rm`).
- `apps/web/src/main.jsx` — **modify.** Drop the `PlannerSync` import; repoint `plannerOnWeekSaved` at a `nexusmd:planner-changed` DOM event; start web auto-sync.
- `apps/web/src/view-settings.jsx` — **modify.** Remove legacy `DriveSyncCard`, `PlannerSyncCard`, `FREQ_PRESETS`, and the `planner-sync.js` import; add `CloudSyncCard`.
- `apps/web/src/sync.js` — **new.** Web sync wiring: build the runtime, manage the key, expose `syncOnce` + `startWebAutoSync`/`stopWebAutoSync`.

---

### Task 1: Verifier + `startAutoSync` (ui)

**Files:**
- Modify: `packages/ui/src/sync/runtime.js`, `packages/ui/src/index.js`
- New: `packages/ui/src/sync/auto.js`
- Test: `packages/ui/tests/sync-runtime.test.jsx` (modify), `packages/ui/tests/sync-auto.test.jsx` (new)

**Interfaces:**

`createSyncRuntime` — unchanged signature. Inside `syncNow`, after the manifest is loaded and the key obtained:
```js
const VERIFIER_TOKEN = 'nexusmd-sync-verifier';
// ...after `manifest` is parsed from cloud, before reconciling:
if (manifest.verifier) {
  let ok = false;
  try { ok = (await decryptSync(manifest.verifier, key)) === VERIFIER_TOKEN; } catch { ok = false; }
  if (!ok) throw Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' });
}
// ...when building `next` (the manifest to commit):
next.verifier = manifest.verifier || await encryptSync(VERIFIER_TOKEN, key);
```
Notes: the throw happens before the collection loop, so nothing is written/uploaded on a bad key. `next.verifier` is set unconditionally so the first-ever commit (no prior manifest) mints one and it persists. Keep `inFlight`/early-return behavior intact (an in-flight throw still clears `inFlight` in `finally`).

`startAutoSync({ syncNow, intervalMs = 300000, subscribeForeground, subscribeChange, debounceMs = 5000 }) → stop()`:
- Calls `syncNow()` on a setInterval every `intervalMs`.
- `subscribeChange(cb)` (optional): registers a listener; each change schedules a debounced (`debounceMs`) `syncNow()`.
- `subscribeForeground(cb)` (optional): registers a listener (e.g. tab focus / visibility); each fire triggers `syncNow()` (no debounce — on-open should be prompt).
- Each subscribe* returns its own unsubscribe fn; `stop()` clears the interval, the pending debounce timer, and calls all unsubscribes.
- Swallow/aggregate `syncNow` rejections (auto-sync must never throw into a timer); surface nothing here — callers own error reporting. Use injected timers implicitly via global `setInterval`/`setTimeout` so vitest fake timers drive them.

**Step 1: Write the tests**
- [ ] In `sync-runtime.test.jsx`, add a `describe('manifest verifier')`: build one device, `syncNow()` once (mints verifier), assert the cloud manifest text decrypts and contains `verifier`. Then a second runtime with a **wrong** key (`'b'.repeat(64)`) over the same cloud store: `await expect(rt.syncNow()).rejects.toMatchObject({ code: 'bad-passphrase' })`, and assert no item files were added/changed by the failed call. A third runtime with the **correct** key syncs clean (no throw).
- [ ] New `sync-auto.test.jsx` using `vi.useFakeTimers()`: (a) interval — advance `intervalMs` N times → `syncNow` called N times; (b) change-debounce — fire `subscribeChange` cb 3× within `debounceMs` → exactly 1 `syncNow` after the window; (c) foreground — fire the foreground cb → immediate `syncNow`; (d) `stop()` — after stop, advancing timers and firing cbs triggers no further `syncNow`, and unsubscribes were called. Use a manual subscribe stub that captures the cb and returns a spy unsubscribe.

**Step 2: Run the tests - expect them to FAIL**
- [ ] `npx vitest run packages/ui/tests/sync-runtime.test.jsx packages/ui/tests/sync-auto.test.jsx` — verifier + auto tests red (auto.js missing / verifier absent).

**Step 3: Implement**
- [ ] Add the verifier check + mint to `runtime.js` as above.
- [ ] Create `packages/ui/src/sync/auto.js` with `startAutoSync`.
- [ ] Export `startAutoSync` from `packages/ui/src/index.js` (alongside the other `./sync/*` exports).

**Step 4: Verify**
- [ ] `npx vitest run packages/ui` — all ui tests green (new verifier/auto tests pass; **Phase 2/3 convergence tests still pass** — their verifier-less manifests mint a verifier on first commit and converge unchanged).
- [ ] Commit: `feat(ui): manifest passphrase verifier + startAutoSync trigger driver`.

---

### Task 2: Remove the dead legacy web planner-sync

**Files:**
- Delete: `apps/web/src/planner-sync.js`
- Modify: `apps/web/src/main.jsx`, `apps/web/src/view-settings.jsx`

**Context:** `view-settings.jsx` imports `{ activeProfileId, updateSettings, weekKey, PlannerSync }` from `./planner-sync.js` (line 14) and renders `<DriveSyncCard />` (def line 215) + `<PlannerSyncCard />` (def line 378, uses `FREQ_PRESETS` line 328) at lines 914–915. `main.jsx` imports `{ PlannerSync }` (line 19) and calls `PlannerSync?.onWeekSaved(year, week)` in the `plannerOnWeekSaved` seam (line 52).

**Step 1: Repoint the live seam (main.jsx)**
- [ ] Remove `import { PlannerSync } from './planner-sync.js'` (line 19).
- [ ] Change the seam to dispatch a DOM event instead of calling the dead Drive push:
```js
plannerOnWeekSaved: (year, week) =>
  document.dispatchEvent(new CustomEvent('nexusmd:planner-changed', { detail: { year, week } })),
```
(Task 3 makes the new auto-sync subscribe to `nexusmd:planner-changed`.)

**Step 2: Remove the legacy cards (view-settings.jsx)**
- [ ] Delete the `DriveSyncCard` function (≈215–326), the `FREQ_PRESETS` const (≈328–376), and the `PlannerSyncCard` function (≈378–~560 — delete through its closing, verify the next top-level token).
- [ ] Remove `<DriveSyncCard />` and `<PlannerSyncCard />` (lines 914–915).
- [ ] Fix the import on line 14: it currently pulls `activeProfileId, updateSettings, weekKey, PlannerSync` from `./planner-sync.js`. Grep the remaining file for `activeProfileId`/`updateSettings`/`weekKey` — if any are still used elsewhere in `view-settings.jsx`, source them from the surviving module (`profile-context`/`planner-storage`) or inline; if none remain used, delete the import line entirely. **Do not** leave an import of the to-be-deleted file.

**Step 3: Delete the file**
- [ ] `git rm apps/web/src/planner-sync.js`.
- [ ] Grep the whole `apps/web/src` tree for any other `planner-sync` importer; there should be none (it was web-only). If found, repoint/remove.

**Step 4: Verify**
- [ ] `npm -w apps/web run build` — green (no dangling import, no unresolved `PlannerSync`/`DriveSyncCard`/`PlannerSyncCard`/`FREQ_PRESETS` reference).
- [ ] `npx vitest run` — full JS suite still green.
- [ ] Commit: `refactor(web): remove dead legacy planner-sync subsystem`.

---

### Task 3: Web sync wiring + CloudSyncCard

**Files:**
- New: `apps/web/src/sync.js`
- Modify: `apps/web/src/view-settings.jsx` (add + mount `CloudSyncCard`), `apps/web/src/main.jsx` (start auto-sync)

**`apps/web/src/sync.js`** — web glue (no semicolons, match web style):
- Imports: `createSyncRuntime`, `startAutoSync`, the five collections (`plannerCollection`, `notesCollection`, `teamCustomCollection`, `teamRemovedCollection`, `tweaksCollection`) from `@nexusmd/ui`; `hashPassword` from `@nexusmd/ui` (the planner-confidential SHA-256, already exported); `webCloudProviders` from `./cloud-auth.js`; `getProfileKey`/active-profile id from the profile layer.
- Key cache: `const KEY_CACHE = 'nexusmd.sync.keyhex'`.
  - `setSyncPassphrase(pw)` → `const hex = await hashPassword(pw); localStorage.setItem(KEY_CACHE, hex)`.
  - `hasSyncKey()` → `!!localStorage.getItem(KEY_CACHE)`.
  - `clearSyncKey()` → `localStorage.removeItem(KEY_CACHE)`.
  - `getKey` passed to the runtime → `async () => localStorage.getItem(KEY_CACHE)` (returns `null` when unset → runtime no-ops, matching its existing `if (!key) return` guard).
- Provider selection: `getSyncProvider()`/`setSyncProvider(id)` persisted under `nexusmd.sync.provider` (`'gdrive'`/`'onedrive'`); resolve the matching object from `webCloudProviders`. Provider must be connected (`isConnected()`) before syncing — `syncOnce` returns a `{ skipped: 'no-provider' | 'not-connected' | 'no-key' }` shape instead of throwing for these expected states.
- `deviceId`: stable per browser — `localStorage` `nexusmd.sync.deviceId`, minted (`'web-' + Math.random().toString(36).slice(2)`) on first read.
- `buildSyncRuntime()` → `createSyncRuntime({ storage: localStorage, getProfileKey, namespace: 'nexusmd', profileId: <activeProfileId>, cloud: <selected provider>, getKey, deviceId, collections: [all five], onChanged })`. `onChanged` dispatches `nexusmd:sync-applied` so views can refresh.
- `syncOnce()` → guards (key? provider? connected?), builds the runtime, `await rt.syncNow()`, returns stats; catches `bad-passphrase` and rethrows/returns a typed result so the card can prompt to re-enter.
- `startWebAutoSync()` → `startAutoSync({ syncNow: syncOnce, intervalMs: 300000, debounceMs: 5000, subscribeForeground: cb => { window.addEventListener('focus', cb); return () => window.removeEventListener('focus', cb) }, subscribeChange: cb => { const h = () => cb(); document.addEventListener('nexusmd:planner-changed', h); return () => document.removeEventListener('nexusmd:planner-changed', h) } })`. Keep the returned `stop` in a module var; `stopWebAutoSync()` calls it.

**`CloudSyncCard`** (in `view-settings.jsx`, styled with the existing `VsCard`/`VsRow` primitives):
- Shows current provider (Google Drive / OneDrive radio), connect/disconnect via the provider's `connect`/`disconnect`/`isConnected`.
- A "Sync passphrase" field → `setSyncPassphrase`; a remembered-state indicator (`hasSyncKey`) + "Forget passphrase" → `clearSyncKey`.
- "Sync now" button → `syncOnce()`, toasts the stats (`pushed/pulled/merged`) or a `bad-passphrase` prompt; surfaces `skipped` states as guidance ("connect a provider first" / "set a passphrase first").
- Mount it in the settings view near where `BackupRestoreCard` is (line ≈868), replacing the removed legacy cards' slot.

**`main.jsx`:** after the app mounts and a profile is active, call `startWebAutoSync()` (guarded so it's a no-op until a key+provider exist — the trigger driver still runs but `syncOnce` returns `skipped`, which is fine).

**Step 1: Implement `apps/web/src/sync.js`** (web glue; no separate unit test — covered by the ui-level tests in Task 1 + the web build + a manual smoke). 
- [ ] Write `sync.js` per the interface above.

**Step 2: Add `CloudSyncCard` + mount**
- [ ] Add `CloudSyncCard` to `view-settings.jsx`, import the `sync.js` helpers, mount the card.
- [ ] Start `startWebAutoSync()` from `main.jsx`.

**Step 3: Verify**
- [ ] `npm -w apps/web run build` — green.
- [ ] `npx vitest run` — full JS suite green.
- [ ] Manual smoke (document in progress ledger, not automated here): with no key/provider the card shows "not configured" and auto-sync no-ops; setting a passphrase + connecting a provider enables "Sync now".
- [ ] Commit: `feat(web): continuous cloud sync wiring + CloudSyncCard`.

---

## Definition of Done

- `startAutoSync` + manifest verifier live in `@nexusmd/ui` with green fake-timer + accept/reject tests; all Phase 2/3 ui tests still pass.
- Legacy `apps/web/src/planner-sync.js` is gone; no dangling imports; web build green.
- Web Settings has a working `CloudSyncCard`; a remembered passphrase derives the AES key; on-change/on-open/interval triggers drive `syncOnce`; cloud files stay AES-GCM encrypted; a wrong passphrase fails with `bad-passphrase` before any write.
- Full JS suite (`npx vitest run`) and `npm -w apps/web run build` green.

## Deferred to later phases

- **Phase 4b:** local-folder export/import on web/desktop; remove any residual legacy local-folder code; offline queue if needed.
- **Phase 5:** desktop + app `sync.js` wiring (OS secure-store key cache, capacitor/electron foreground + change events) and the cloud-auth glue tests.
