# Continuous profile sync — planner, notes, team, tweaks across devices

**Date:** 2026-06-29
**Status:** Approved design
**Scope:** Continuous, near-lossless sync of per-profile content (planner weeks, global notes, team custom/removed, tweaks) between devices through the user's Google Drive / OneDrive, with a 3-way merge engine, keep-both conflict handling, a remembered sync passphrase for unattended sync, and automatic + manual triggers. Builds on the cloud provider layer (cloud sync Phases 1–5) and the encrypted-bundle backup (Feature A/B), which remain as-is alongside.

## Context

NexusMD stores per-profile data in `localStorage` under `${namespace}.p.${id}.*` (namespace `nexusmd` on web/desktop, `helm` on the app):
- **Planner** weeks: `…planner.week.YYYY-Www` → `{ data, themes }`, where `data` is per-section (table sections are arrays of rows with stable `id`s; `textarea`/`keyval`/`eow` sections are free text / small maps). A runtime hook `onWeekSaved(year, week)` already fires on every week save (`packages/ui/src/planner/planner-storage.js`).
- **Notes**: `…globalNotes` → a single document.
- **Team**: `…team.custom` → array of member rows (with `id`s); `…team.removed` → array of removed ids.
- **Tweaks**: `…tweaks` → a settings map (theme, density, widget layout, typeLabels, quickLinks, …).

Manual encrypted backup/restore (`.nmdprofile`, Feature A) and cloud upload/download of those bundles (Feature B / cloud Phases 1–5) exist, with a shared `cloudProvider` seam (`makeGoogleDriveProvider`/`makeOneDriveProvider` in `@nexusmd/ui`, methods `list/upload/download` over a `/NexusMD` folder, fed by a per-platform `authBinding`). Those phases explicitly deferred **automatic/scheduled backups** and **conflict resolution** — this spec takes both on.

**Goal scenario:** edit a planner week on the phone → it syncs to the cloud → opening the desktop later pulls and shows the change. Independent edits on two devices both survive; only the exact same row/field edited on both since the last sync needs reconciliation, and even then nothing is discarded.

## Decisions (from brainstorming)

1. **Sync model:** per-item **3-way merge** against a stored last-synced **base**, **keep-both** on residual conflict (loser preserved, never overwritten).
2. **Encryption key:** a **remembered sync passphrase** (same on every device); its derived AES-GCM key is cached per device (OS secure store where available, else `localStorage`); cloud files stay encrypted. Raw passphrase never stored.
3. **Triggers:** automatic — debounced push on change (`onWeekSaved` and equivalents), full sync on app open/foreground, an interval timer while active — plus a manual **Sync now**. No OS-background sync (deferred).
4. **Scope:** planner **and** notes, team, tweaks, via a generic engine with per-type merge strategies. **Plus local-folder export** — planner can also be saved to a local folder (the "saved both locally and on the cloud" ask), carried over from the legacy web subsystem (see Existing-systems note).
5. **Coexistence:** manual `.nmdprofile` backup (Feature A/B) is unchanged and remains available alongside continuous sync.

## Existing systems & migration (discovered during Phase 2)

The **web app already has a legacy planner-sync** (`apps/web/src/planner-sync.js`, ~474 lines, wired via the `plannerOnWeekSaved` seam in `apps/web/src/main.jsx` and the `PlannerSyncCard`/`DriveSyncCard` in `view-settings.jsx`). It is **web-only, Drive-only, planner-only**, stores per-week **plain-JSON** files `planner-<profileId>-<weekKey>.json` in Drive, uses **version-based, manual whole-week conflict resolution** (pick "mine"/"drive" — lossy), and adds an **offline queue** + **local-folder export** (`localEnabled`/`localFolder`). It auto-inits on load with an interval timer + `nexusmd:planner-sync-status` events.

This new engine is its **cross-platform, multi-provider, true-3-way-merge successor**. **Phase 4 replaces the legacy** subsystem on web with the new engine and **must port** its still-wanted features: **local-folder export** (part of the user's ask) and the **offline queue** (or consciously document dropping the queue, since the new engine retries on the next trigger). Until Phase 4 ships the replacement, the legacy web sync stays in place untouched (Phases 1–3 land the engine + tests without changing web sync UI).

## Architecture

Layered core → ui → apps; reuses the Phases 1–5 `cloudProvider`.

### `@nexusmd/core` — pure sync logic (no DOM/storage/network)

- `mergeRows(base, local, remote, idKey='id') → { merged, conflicts }` — 3-way row merge keyed on `idKey`: rows added on either side are kept; rows deleted on either side are removed (unless also edited on the other side — then kept with a conflict note); rows edited on different ids all kept; the **same row edited on both** keeps the winner and appends the loser as a conflict row (`{ ...loser, _conflict: { from, base } }`). Returns the merged array + a list of conflict descriptors.
- `mergeKeyVal(base, local, remote) → { merged, conflicts }` — per-key 3-way; same-key edited on both → **newest-wins** (tiebreak via the caller-supplied `modifiedAt`/`deviceId`); conflict recorded.
- `mergeText(base, local, remote, { from }) → { merged, conflicts }` — whole-document 3-way; if both changed from base, **keep both** (concatenate with a `--- conflict from <from> ---` marker); conflict recorded.
- `mergeSet(base, local, remote) → { merged }` — union of string arrays (tombstone sets; no conflict).
- `mergePlannerWeek(base, local, remote, ctx) → { merged, conflicts }` — composes the above per section type using `PLANNER_SECTIONS` (table → `mergeRows`, textarea → `mergeText`, keyval/eow → `mergeKeyVal`), plus `themes` via `mergeKeyVal`.
- `reconcileItem({ base, local, remote, merge }) → { action, value, conflicts }` — decides per item: `push` (only local changed), `pull` (only remote changed), `merge` (both changed → run `merge`), `delete-local` (remote tombstoned, local unchanged), `tombstone` (local deleted), or `noop`. "Changed" is determined by content hash vs the base. Pure.
- A `contentHash(value) → string` helper (stable JSON hash) used to detect change and populate the manifest.

All of the above are pure and exhaustively unit-testable.

### `@nexusmd/ui` — sync runtime + collection adapters

- `createSyncRuntime({ storage, getProfileKey, namespace, cloud, getKey, deviceId, onChanged })` → `{ syncNow, start, stop, status$ }`.
  - `cloud` is a `cloudProvider` (Phases 1–5). `getKey()` returns the cached AES-GCM key (or null → sync disabled). `onChanged(collectionId)` lets the host refresh open views.
- **Collection adapters** (each: `id`, `listLocal()`, `readLocal(key)`, `writeLocal(key,value)`, `removeLocal(key)`, `merge`): `plannerCollection`, `notesCollection`, `teamCollection` (custom rows + removed set as two items), `tweaksCollection`.
- **Runtime responsibilities:** download + decrypt the per-profile `manifest.json`; for each collection item compute local `contentHash`, compare with the stored base hash and the manifest's remote hash, call `reconcileItem`; apply the result (write merged locally via the adapter, encrypt + `cloud.upload`, or delete); update the per-item **base snapshot** (`${ns}.p.${id}.sync.base.<collection>.<itemKey>`) and the manifest entry; upload the manifest **last** (commit point); emit conflicts to `status$` and call `onChanged`.
- **Triggers:** `start(intervalMs)` runs `syncNow` on a timer; the host calls `syncNow` on foreground and wires the debounced push (planner `onWeekSaved`, and a generic "mark dirty" for notes/team/tweaks saves). A single in-flight lock prevents overlapping runs.
- **Key management UI helpers:** `deriveSyncKey(passphrase)` (reuse core `hashPassword` → key material) and a manifest `verifier` (an encrypted known token) so a wrong/changed passphrase is detected and surfaced rather than silently failing.

### Per-platform glue

Each app: builds the `cloudProvider` (already done), supplies `storage`/`getProfileKey`/`namespace`, an injected **`keyStore`** (`get/set/clear` — desktop/app back it with secure storage, web with `localStorage`), a **foreground** hook (lifecycle adapter), a stable **`deviceId`** (random, persisted once), and mounts a **Sync settings card** + a **conflict panel**. Planner/notes/team/tweaks views subscribe to `onChanged` to refresh in place.

## Cloud layout

```
/NexusMD/sync/<profileId>/
  manifest.json                      # encrypted: { verifier, deviceVersions, items: { "<coll>/<key>": {hash, modifiedAt, deviceId} }, tombstones: ["<coll>/<key>", …] }
  planner/2026-W26.nmdsync           # encrypted payload
  notes/global.nmdsync
  team/custom.nmdsync
  team/removed.nmdsync
  tweaks/tweaks.nmdsync
```

All payload files and the manifest are AES-GCM encrypted with the sync key (the same wrapper shape as the bundle: `{ format, version, iv, ciphertext }`). The manifest is the source of truth for which items exist and their versions; tombstones propagate deletions.

## Data flow (one sync pass)

1. Guard on the in-flight lock and a present `getKey()`.
2. Download + decrypt `manifest.json` (absent → treat as empty; verify `verifier`, else prompt re-enter passphrase and abort).
3. For each collection, enumerate local items; for each local-or-manifest item compute `reconcileItem({ base, local, remote, merge })` (downloading the remote `.nmdsync` only when needed).
4. Apply each action: write merged/ pulled value locally (adapter), encrypt + upload pushed/merged value, delete local on remote tombstone, write tombstone + remove remote on local delete; update base snapshot + manifest entry.
5. Upload the manifest last (commit). Emit conflicts; call `onChanged` per touched collection so open views refresh (no full reload).

## Error handling

- Offline / provider failure → sync is a no-op and retries on the next trigger; local data is always the working source of truth (never blocked by sync).
- Wrong/changed passphrase (verifier mismatch) → prompt to re-enter; never write with a mismatched key.
- Mid-sync failure → because the manifest is committed last, the cloud stays at the previous consistent manifest; per-item failures are logged and retried next pass.
- Merge conflicts are non-fatal: the merged result (keep-both) is saved immediately; the conflict panel is advisory cleanup.
- Disable sync → clears the cached key; local data and existing cloud files are left intact.

## Testing

- **core** (`packages/core/tests`): exhaustive unit tests for `mergeRows` (add/edit/delete each side, same-row conflict, delete-vs-edit), `mergeKeyVal` (key add/edit/conflict newest-wins), `mergeText` (keep-both), `mergeSet` (union), `mergePlannerWeek` (mixed section types), `reconcileItem` (every action), and `contentHash` stability. Pure, no mocks.
- **ui** (`packages/ui/tests`): `createSyncRuntime` against a **fake `cloud`** (in-memory file map) + in-memory storage; simulate **two "devices"** sharing one fake cloud and assert convergence (edits on both appear on both), tombstone propagation, conflict surfacing, and wrong-passphrase detection. Collection adapters tested for enumerate/read/write/merge wiring.
- **Manual** (per platform, post-merge): enable sync with a passphrase on two platforms; edit a week on one, confirm it appears on the other after a sync; force a same-week same-row edit on both and confirm keep-both + conflict panel; offline edit then reconnect.

## Verification (end-to-end)

- `npx vitest run` green (core merge/reconcile + ui sync-runtime suites).
- `npm -w apps/{web,app} run build` + `npm -w apps/desktop run build:renderer` green.
- Manual two-device round-trip per the goal scenario.

## Phasing (one spec, several implementation plans)

1. **core** — merge strategies (`mergeRows/KeyVal/Text/Set`, `mergePlannerWeek`), `reconcileItem`, `contentHash`. Pure + fully tested. **(done)**
2. **ui** — `createSyncRuntime` + planner collection + provider object-store API + payload crypto, with a two-device convergence test. **(done — Tasks 1–4.)** NOTE: the planned minimal web "Sync now" card (Task 5) was **deferred**: the web app already has a legacy planner-sync subsystem (see Existing-systems note), so web UI wiring moves into the Phase-4 cutover to avoid running two sync systems at once.
3. **ui** — notes, team, tweaks collections.
4. **ui + apps** — automatic triggers (onChanged/debounce, foreground, interval) + Sync settings card + conflict panel + passphrase key management (`keyStore`, verifier), **and the web legacy-cutover**: remove `planner-sync.js` + `PlannerSyncCard`/`DriveSyncCard` + the `planner.sync`/`planner.syncState` model, repoint the `plannerOnWeekSaved` seam at the new engine, and **port local-folder export** (+ offline queue, or document dropping it) into the generic engine.
5. **apps** — desktop + app wiring (secureStorage-backed `keyStore`, lifecycle foreground hook, deviceId), plus the cloud-auth glue tests deferred earlier (now testing the layer in its final shape).

Each phase is independently verifiable; the engine is usable (and tested) after Phase 2, and end-user web sync via the new engine lands with the Phase-4 cutover.

## Non-goals (this spec)

- OS-level background sync when the app is closed (mobile background tasks / desktop scheduler) — a later phase.
- Real-time / push sync (WebSocket/poll-faster-than-interval); sync is trigger/interval-based.
- Sub-second clock precision or vector clocks; newest-wins tiebreaks use manifest `modifiedAt` + `deviceId`, and keep-both avoids needing a precise winner for most cases.
- Merging the ADO/GitHub connection `config` or OAuth tokens across platforms (still per Feature A's cross-platform note).
- Syncing the profile registry itself (which profiles exist) — sync operates within an existing profile id; cross-device profile creation still uses Feature A import.

## Review follow-ups (Phase 4b/5 whole-branch review, deferred)

These are tracked but intentionally not done in Phases 4b/5:

- **App key cache is not yet truly secure.** The app's `secureStorageAdapter` is currently a plaintext `localStorage` fallback, so the cached 64-hex AES sync key (`sync.keyhex`) is stored in clear text in the Android WebView. Until `capacitor-secure-storage-plugin` (or equivalent) is wired, do not describe the app key cache as "secure." Relatedly, consider not persisting the derived key at all (re-prompt) — see the key-management note above.
- **Stronger KDF.** The key is unsalted `SHA-256(passphrase)`. Move to a salted PBKDF2/scrypt KDF (with a versioned bundle/manifest format + migration for existing vaults) when crypto is next revisited.
- ~~**`electronVersion` drift (desktop).**~~ Resolved (commit e02ffe3): the `electron` devDependency is pinned to the exact version `29.4.6` (single source of truth) and `build.electronVersion` removed — electron-builder derives the version from the fixed devDep. Keep it pinned exact on future upgrades.
- **Live refresh on desktop.** `nexusmd:sync-applied` re-hydration is wired on web and now the app (commit 5b62c36 — team/tweaks/planner/notes). Desktop still has no listener, but it currently renders only team views (see below), so the gap there is limited until more desktop views land.
- **Desktop sync scope.** Desktop currently renders no planner/notes/tweaks views, so only the team collections actually have local data to sync there today; broadens automatically as those views land.
