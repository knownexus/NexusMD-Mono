# Profiles That Sync Everything — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, every profile's settings, credentials and content sync through the account, profiles are sealed from each other, deleted profiles are restorable until purged, and concurrent edits on two desktops are never lost silently.

**Architecture:** The M1 engine (`packages/core/src/modules/account/`) keeps its shape: snapshot diff of localStorage + secure storage, one encrypted item per canonical id. Three things change: (1) the key registry learns *collections* — a storage key holding a list of records expands into one item per record (`<id>#<recordId>`) — and *field maps* (tweaks, one item per field); (2) last-writer-wins is replaced, for owner-edited items, by a conflict queue the UI resolves; (3) the profile list carries `updatedAt`/`deletedAt`/`purgedAt`. Desktop code moves every global user-data key into profile scope, with a one-time migration. A server-side sync-format gate refuses M1 clients.

**Tech Stack:** JavaScript (ESM), React 18, vitest + React Testing Library, Electron (desktop), ASP.NET Core 8 + SQLite + xUnit (server).

**Spec:** `docs/superpowers/specs/2026-11-03-profile-sync-everything-design.md` (read it first; "Calls made" 1–17 are binding).

## Global Constraints

- Desktop only (`nexusmd` namespace). The `helm` (Android) namespace keeps its M1 registry rules unchanged; every registry change below is gated on `namespace === 'nexusmd'`, and existing `helm` tests must still pass untouched.
- Sync format version: clients send header `X-Sync-Format: 2`. Server config `Sync:MinFormat` (default `1`); requests below it get HTTP 426 `{ code: "client_outdated" }`.
- Item limits are unchanged: 25 MiB per item, 1 GiB per user.
- End-to-end encryption holds for every new item, record and conflict copy (nothing new is sent in clear text; record ids are hashed like every canonical id via `opaqueId`).
- Record id separator is `#`: canonical id `<base canonical id>#<recordId>`. `recordId` is the record's existing `id` field (for field maps, the field name).
- Conflicted-copy name suffix (exact copy): ` (conflicted copy, <device name>, <YYYY-MM-DD>)`.
- Purge and every destructive action require a confirmation dialog.
- Never use bare `git stash` (shared stash). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Time-log records are **entries** (each already has an `id`), not days — finer than spec call 1's "per time-log day", same intent (plan ruling).
- Verify JS with `npx vitest run --project <name> --maxWorkers=1 <filter>` (this machine is memory-constrained). There is no local .NET 8 runtime: run server tests in a container, `docker run --rm -v "<repo>/apps/web:/repo:ro" mcr.microsoft.com/dotnet/sdk:8.0 sh -c "cp -r /repo /src && cd /src && dotnet test NexusMDWeb.sln -p:SkipFrontend=true"`. Behind the corporate HTTPS proxy, NuGet restore needs the company root CA added to the container (`update-ca-certificates`); CI does not.

## Review Focus

1. **Two desktops never synced content before the upgrade.** Both hold different notes/lists/time logs with the same record ids only by coincidence; the first sync must raise conflicts (or merge distinct records), never let "remote wins on a never-seen id" erase local content. Test in Task 4.
2. **A record deleted on one desktop and edited on the other.** Must become a conflict (owner-edited), not a silent resurrection or loss. Test in Task 4.
3. **Switching profile while a conflict for another profile is open.** Conflicts are per item and survive reloads; resolving one for an inactive profile must write that profile's key, not the active one's. Test in Task 4.
4. **Purging a profile while another desktop is offline with edits to it.** That desktop must show what it will discard and offer an export before discarding (spec call 16). Test in Task 5.
5. **Corrupt or hand-edited JSON in a collection key** (not a list, record without `id`, duplicate ids). Must not crash sync or drop the other records; unreadable collections are "unavailable" like an unreadable secret. Test in Task 3.

---

### Task 1: Sync-format gate (server + client)

**Files:**
- Modify: `apps/web/server/Program.cs`, `apps/web/server/Controllers/ItemsController.cs`, `apps/web/server/Controllers/DevicesController.cs`
- Create: `apps/web/server/Services/Sync/SyncFormatGate.cs`
- Test: `apps/web/server-tests/SyncFormatGateTests.cs`
- Modify: `packages/core/src/modules/account/account-client.js` (send header; map 426)
- Test: `packages/core/tests/account-client.test.js` (extend)
- Modify: `packages/ui/src/account-gate.jsx` (`MESSAGES['client-outdated']`)
- Modify: `docs/railway-deploy.md` (variable table: `Sync__MinFormat`)

**Interfaces:**
- Produces: `AccountError` code `'client-outdated'` (status 426); `createAccountClient` sends `X-Sync-Format: 2` on every request.

- [ ] **Step 1: Server tests** — `Writes_below_min_format_get_426_client_outdated` (MinFormat=2; `PUT /api/items/x` and `PUT /api/items` batch and `PUT /api/devices/{id}/prefs` without the header → 426, body `code == "client_outdated"`); `Writes_at_min_format_succeed` (header `2` → normal status); `Reads_are_not_gated` (`GET /api/items/changes` without header → 200); `Default_min_format_accepts_old_clients` (no config → writes without header succeed).
- [ ] **Step 2:** Run in the .NET 8 container; expect the four new tests to fail.
- [ ] **Step 3:** Implement `SyncFormatGate.IsOutdated(HttpRequest req, IConfiguration cfg) : bool` (missing/unparsable header = format 1) and call it at the top of the three write actions.
- [ ] **Step 4:** Run the full server suite; expect all pass (≥ 292).
- [ ] **Step 5: Client test** — `sends X-Sync-Format 2 on every request` and `maps 426 to AccountError client-outdated`; implement; gate message: `"This version of NexusMD can no longer sync. Update NexusMD to keep syncing."`
- [ ] **Step 6:** `npx vitest run --project core --maxWorkers=1 account-client` and `--project ui account-gate`; pass. Commit `feat(accounts): sync-format gate refuses outdated clients`.

### Task 2: Key registry v2 (profile scope, field maps, collections, machine-written, neutral secret ids)

**Files:**
- Modify: `packages/core/src/modules/account/key-registry.js`
- Test: `packages/core/tests/account/key-registry.test.js` (extend; keep every `helm` case green)

**Interfaces:**
- Produces, on the registry object (nexusmd only; helm unchanged):
  - `classify(key)` may return `{ id, level, kind: 'collection', collection: { path: string|null } }` for collection keys, `{ id, level, kind: 'fields' }` for the per-profile tweaks key, and every result gains `auto: boolean` (machine-written).
  - `COLLECTIONS` (exported): name patterns after `p.<pid>.` → `path` of the record array: `planner.globalNotes` → `null` (array root), `planner.versions` → `null`, `calendar.events` → `null`, `lists` → `'lists'`, `timelog.v1` → `'entries'`, `md_documents` → `'docs'`, `json_editor_documents` → `null`, `regex_tester_documents` → `null`, `dbManager.savedQueries` → `null`.
  - `MACHINE_WRITTEN` (exported) name patterns: `/\.auth$/`, `/^seenPr$/`, `/collapsed/i`, `/^dbManager\.(openConnections|listHidden|lastType)$/`, `/^apiClient\.collapsedDirs$/`, `/^planner\.(reminderDismissed|landing)$/`, `/^editor\.recent$/`.
  - `profileOf(id) : string|null` — the profile id an item belongs to (`p.<pid>.` anywhere at the start of the canonical id or after `nexusmd:` / `sec:`), else null.
  - `wasDeviceLevelInM1(id) : boolean` — true for ids that M1 kept in the device container (the old `DEVICE_LEVEL` names and `tweaks.device` fields).
- Rules for `nexusmd`:
  - Keys outside `p.<pid>.` sync only if they are `profiles`, `activeProfileId` (device) or `feature.*` (device); every other global key returns null (not synced) — global user data must not exist after Task 8.
  - `DEVICE_LEVEL` shrinks to `[/^sidebar\.width$/]`; everything else formerly device-level becomes account-level under the profile.
  - The tweaks key is `nexusmd.p.<pid>.tweaks`, `kind: 'fields'`, one item per field: id `nexusmd:p.<pid>.tweaks#<field>`.
  - Remove from `NEVER_SYNC` (nexusmd only): planner week/globalNotes/versions, calendar.events, lists, timelog.
  - Neutral secret ids: a secret whose name is `nexusmd.p.<pid>.<alias name>` (ADO/GitHub/Jira fields) gets id `p.<pid>.<alias id>` (same as today's plain-key alias id) with `kind: 'secret'`; `toStorageKey`/`secretName` round-trip it. Other secrets keep `sec:nexusmd:<name>`.

- [ ] **Step 1: Failing tests** (nexusmd registry):
  - `classify('nexusmd.p.A.planner.globalNotes')` → `{ id: 'nexusmd:p.A.planner.globalNotes', kind: 'collection', collection: { path: null }, level: 'account', auto: false }`.
  - `classify('nexusmd.p.A.lists').collection.path === 'lists'`; `timelog.v1` → `'entries'`.
  - `classify('nexusmd.p.A.tweaks').kind === 'fields'`.
  - `classify('nexusmd.tweaks') === null`; `classify('nexusmd.refreshInterval') === null`; `classify('nx-db:saved-queries') === null`.
  - `classify('nexusmd.p.A.refreshInterval').level === 'account'`; `classify('nexusmd.p.A.sidebar.width').level === 'device'`.
  - `classify('nexusmd.p.A.github.auth').auto === true`; `classify('nexusmd.p.A.github.repos').auto === false`.
  - `secretId('nexusmd.p.A.ado.pat') === 'p.A.ado.pat'`; `secretName('p.A.ado.pat') === 'nexusmd.p.A.ado.pat'`.
  - `profileOf('nexusmd:p.A.lists#l1') === 'A'`, `profileOf('p.A.ado.pat') === 'A'`, `profileOf('profiles') === null`.
  - Every existing helm test unchanged and green.
- [ ] **Step 2:** Run `npx vitest run --project core --maxWorkers=1 key-registry`; new tests fail.
- [ ] **Step 3:** Implement in `key-registry.js`.
- [ ] **Step 4:** Run; pass. Run the whole `core` project; fix any M1 test that asserted the old nexusmd rules by updating it to the new rule (list each in the commit body).
- [ ] **Step 5:** Commit `feat(accounts): registry v2 — profile scope, records, field maps, machine-written`.

### Task 3: Records and fields in the snapshot and local writes

**Files:**
- Modify: `packages/core/src/modules/account/account-sync-state.js` (`readSnapshot`, `resolveTarget`, `writeLocal`, `unchangedSince`)
- Test: `packages/core/tests/account/account-sync-state.test.js` (create if absent, else extend)

**Interfaces:**
- Consumes: Task 2 `classify` results.
- Produces: `resolveTarget(registry, id)` returns `{ kind: 'record', key, path, recordId, level, auto }` for `<collectionId>#<recordId>` and `{ kind: 'field', key, field, level, auto }` for `<fieldsId>#<field>`. Snapshot entries for records/fields carry `value` = the record/field serialized with stable key order, `raw` = the whole collection key's raw string. `writeLocal` for a record replaces the record with the same id in place (preserving order), appends a new one at the end, or removes it on `deleted`; for a field sets/removes one property.

- [ ] **Step 1: Failing tests:**
  - `expands a collection into one entry per record` (`nexusmd.p.A.lists` = `{lists:[{id:'l1'},{id:'l2'}]}` → snap has `nexusmd:p.A.lists#l1` and `#l2`).
  - `writes a remote record in place and keeps the others and their order`.
  - `appends a new remote record; deleting removes only that record`.
  - `records without an id are left untouched and never pushed` (Review Focus 5).
  - `a collection key that is not valid JSON or has the wrong shape makes its records unavailable, not deleted` (Review Focus 5).
  - `duplicate record ids: the first wins, the duplicate is kept locally but not synced` (Review Focus 5).
  - `tweaks expands to one entry per field; writing a field keeps the other fields`.
- [ ] **Step 2:** Run `--project core account-sync-state`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `--project core account`; pass.
- [ ] **Step 5:** Commit `feat(accounts): sync collections record by record and tweaks field by field`.

### Task 4: Conflict queue instead of last-writer-wins for owner-edited items

**Files:**
- Modify: `packages/core/src/modules/account/account-sync.js`, `account-sync-state.js` (meta schema)
- Test: `packages/core/tests/account/account-sync.test.js` (extend), `packages/core/tests/account/account-sync-conflicts.test.js` (create)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces on the sync object:
  - `conflicts() : Array<{ id, profileId, kind: 'record'|'field'|'plain'|'secret', local: { value, deleted }, remote: { value, deleted, updatedAt, revision }, detectedAt }>`
  - `resolve(id, { take: 'local'|'remote' } | { value: string }) : Promise<{}|{error}>` — writes the chosen value locally, pushes it with `If-Match` = the stored remote revision, clears the conflict.
  - `keepBoth(id, { copyName: (name) => string }) : Promise<{}|{error}>` — records only: keeps local as is, writes the remote record as a new record (new id `<recordId>-c<timestamp>`, its `name`/`title` field passed through `copyName`), clears the conflict.
  - `onConflict(cb) : unsubscribe` — `cb({ count })` whenever the queue grows.
  - meta gains `conflicts: { [id]: {...} }`; conflicted ids are skipped by push until resolved.
- Rules (replacing `remoteWins` for `auto === false`):
  - identical hashes → synced, no conflict (spec call 15);
  - no meta entry and no local value → remote applied;
  - no meta entry, local exists, hashes differ → conflict, **except** `wasDeviceLevelInM1(id)` → remote applied silently (plan ruling: one-time adoption of the server's view settings at upgrade);
  - meta entry, local unchanged → remote applied;
  - meta entry, local changed (incl. local deletion), remote revision newer → conflict;
  - `auto === true` → M1 rule unchanged (newest wins).
  - `profiles` keeps using its merger (Task 5).

- [ ] **Step 1: Failing tests** (two simulated devices sharing a fake client, as existing `account-sync.test.js` does):
  - `different records edited on two devices both survive` (notes n1 on A, n2 on B).
  - `the same record edited on both devices becomes one conflict on the second to sync; neither value is lost`.
  - `first sync after upgrade: local notes the server never saw, with different content under the same id, conflict instead of being overwritten` (Review Focus 1).
  - `first sync: identical values are adopted without a conflict`.
  - `a former device-level tweak field differing at first sync adopts the server value silently`.
  - `record deleted on A and edited on B is a conflict on whichever syncs second` (Review Focus 2).
  - `machine-written values (github.auth) resolve newest-wins without a conflict`.
  - `resolve take remote / take local / value pushes once and clears the conflict`.
  - `keepBoth adds the remote record as a copy named with the suffix and both records sync`.
  - `a conflict for profile B resolves into B's key while profile A is active` (Review Focus 3).
  - `conflicted ids are not pushed until resolved; other items keep syncing`.
- [ ] **Step 2:** Run `--project core account-sync`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `--project core account`; pass.
- [ ] **Step 5:** Commit `feat(accounts): conflicts are queued for the owner instead of overwritten`.

### Task 5: Profile lifecycle in sync (soft delete, restore, purge)

**Files:**
- Modify: `packages/core/src/modules/account/key-registry.js` (`mergeProfiles`), `account-sync.js`
- Modify: `packages/core/src/modules/account/account-clear.js` (export `purgeProfileLocal`)
- Test: `packages/core/tests/account/account-sync-profiles.test.js` (create)

**Interfaces:**
- Profile record fields added: `updatedAt` (ms), `deletedAt` (ms|null), `purgedAt` (ms|null).
- `mergeProfiles(local, remote)`: per id, the record with the larger `updatedAt` wins; a record with `purgedAt` always wins and is kept forever as a tombstone (no data).
- `purgeProfileLocal({ storage, secure, namespace, pid })` removes `<ns>.p.<pid>.*` and every secret whose name starts with `<ns>.p.<pid>.` (fixes the orphaned-secrets bug).
- Sync object gains:
  - `purgeProfile(pid) : Promise<{}|{error}>` — writes the tombstone record, pushes deletions for every synced item whose `registry.profileOf(id) === pid`, then `purgeProfileLocal`.
  - `pendingPurges() : Array<{ pid, name, unpushed: string[] }>` and `confirmPurge(pid)`: when a pull brings a `purgedAt` for a profile that has unpushed local changes, local data is NOT removed until `confirmPurge`; with no unpushed changes it is purged during the pull.
  - `onPendingPurge(cb)`.

- [ ] **Step 1: Failing tests:**
  - `soft delete syncs: deletedAt set on A appears on B and the profile's items keep syncing`.
  - `restore (deletedAt null with a newer updatedAt) syncs back`.
  - `the union merge no longer resurrects a deleted profile`.
  - `purge tombstones every item of the profile on the server and removes local keys and secrets`.
  - `purge on A while B has unpushed edits for that profile: B keeps the data and reports a pending purge until confirmPurge` (Review Focus 4).
  - `a purged profile id is never re-created by an old record`.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Run `--project core account`; pass.
- [ ] **Step 5:** Commit `feat(accounts): deleted profiles sync, restore, and purge everywhere`.

### Task 6: Per-profile sync status

**Files:**
- Modify: `packages/core/src/modules/account/account-sync.js`
- Test: `packages/core/tests/account/account-sync.test.js` (extend)

**Interfaces:**
- Produces `status() : { lastSyncAt: number|null, profiles: { [pid]: { lastSyncAt: number|null, conflicts: number, tooLarge: string[], quota: string[], error: string|null } } }`. A profile's `lastSyncAt` is set at the end of a `syncNow` that completed with no error, for every profile present in the profiles list; `tooLarge`/`quota` list that profile's rejected ids; `error` is the message of a failed sync (all profiles share it — one round covers every profile).
- `syncNow` already covers every profile (desktop registry has no `getActiveProfileId`); keep it that way.

- [ ] **Step 1: Tests:** `status lists every profile with its last sync time after syncNow`; `a too-large planner version shows under its profile only` (spec call 12); `a failed sync sets error and keeps the previous lastSyncAt`.
- [ ] **Step 2–4:** fail → implement → pass (`--project core account-sync`).
- [ ] **Step 5:** Commit `feat(accounts): per-profile sync status`.

### Task 7: Move desktop's global user data into profile scope (code)

**Files (each switches its key to `getProfileKey(...)` / `usePersisted` / `usePersistedState`):**
- `apps/desktop/src/main.jsx` (tweaks: read/write `getProfileKey('nexusmd.tweaks')`; `nexusmd.outputPath` via `desktop-settings.jsx`)
- `modules/git/src/renderer/popout-app.jsx` (tweaks read), `modules/git/src/renderer/branch-commits.jsx` (`branchCommitsCollapsed`)
- `packages/ui/src/views/ViewDbManager.jsx`, `packages/ui/src/views/db-min-cols.js` (`nx-db:*` → `dbManager.savedQueries`, `dbManager.tables.<conn>`, `dbManager.starred.<conn>`, `dbManager.minCols.<conn>.<table>`, `dbManager.openConnections`, `dbManager.listHidden`, `dbManager.lastType`)
- `packages/ui/src/views/MarkdownViewer.jsx` (`md_*` via `usePersisted`), `packages/ui/src/views/markdown-preview.jsx` (`markdown.textSize`)
- `packages/core/src/modules/api-client/var-resolve.js` (secret name gains the profile key)
- `packages/ui/src/views/view-team.jsx`, `modules/work/src/renderer/person-summary.jsx` (`team.notes`, `team.custom` → profile keys; same key as `work-views.jsx`)
- `modules/work/src/renderer/work-provider.jsx`, `work-settings.jsx` (`refreshInterval`), `project-areas-modal.jsx` (`projectAreas.v3`), `packages/ui/src/planner/planner-settings.jsx` (`confidential.autoRelock`), `packages/ui/src/views/view-settings.jsx` (`settings.collapsed`), `packages/ui/src/views/view-dashboard.jsx` (`nexusmd_seen_pr` → `seenPr`)
- Tests: extend each touched file's existing test where one exists; add `apps/desktop/src/no-global-user-keys.test.js`.

**Interfaces:**
- Consumes: `getProfileKey` from `@nexusmd/shell-sdk` (desktop binding) / `usePersisted` from `packages/ui/src/app-components.jsx`.
- Produces: the exact profile-scoped key names listed above (Task 8 migrates into them; Task 2's `COLLECTIONS`/`MACHINE_WRITTEN` name them).

- [ ] **Step 1: Failing test** `no-global-user-keys.test.js`: render the desktop app shell with a profile active (reuse the boot helper from `apps/desktop/src/app-render.test.jsx`), open Settings, Databases, Markdown, Team and Dashboard, then assert every `localStorage` key written is either `nexusmd.p.<active>.*`, `nexusmd.profiles`, `nexusmd.activeProfileId`, `nexusmd.account.*`, `nexusmd.sec.*`, `nexusmd.feature.*` or in an explicit allowlist of machine keys (`nexusmd.sync.*` legacy, `nexusmd.oauth.pending`). Also: `view-team and person-summary read the same team.custom key`.
- [ ] **Step 2:** Run `--project desktop no-global-user-keys`; fail listing the offenders.
- [ ] **Step 3:** Switch each file's keys.
- [ ] **Step 4:** Run `--project desktop`, `--project ui`, `--project work`, `--project git`, `--project core`; all pass.
- [ ] **Step 5:** Commit `fix(desktop): every piece of user data belongs to a profile`.

### Task 8: One-time migration and desktop tokens into secure storage

**Files:**
- Create: `packages/core/src/modules/profiles/migrate-v2.js` (`migrateToProfileScopeV2`)
- Test: `packages/core/tests/profiles/migrate-v2.test.js`
- Modify: `apps/desktop/src/profile-context.jsx` (run once at boot, after `adoptFlatKeys`, before the account gate starts sync)
- Modify: `modules/work/src/renderer/ado-client.js`, `github-client.js`, `jira-client.js`, `packages/core/src/modules/ado/config.js`, `apps/desktop/src/cloud-auth.js` (tokens `ado.pat`, `github.pat`, `jira.apiToken`, `<provider>.auth` read/write through `secureStorageAdapter` under `getProfileKey(...)` names)

**Interfaces:**
- `migrateToProfileScopeV2({ storage, secure, namespace: 'nexusmd', profiles: string[], activeProfileId: string }) : Promise<{ moved: string[] }>`; idempotent via marker `nexusmd.migrated.v2` (device-level, never synced).
- Rule (spec, owner decision): **settings** (`tweaks`, `refreshInterval`, `markdown.textSize`, `projectAreas.v3`, `confidential.autoRelock`, `settings.collapsed`, `outputPath`, `nx-db:list-hidden`, `nx-db:last-type`, `nx-db:tables:*`, `nx-db:starred:*`, `nx-db:min-cols:*`, `md_learn_mode`, `md_cheatsheet_open`, `md_learning_progress`, `nx-gw-branch-commits-collapsed`, `nexusmd_seen_pr`) are copied into **every** profile; **content and credentials** (`md_documents`, `nx-db:saved-queries`, `nexusmd.team.notes`, `nexusmd.team.custom`, `nexusmd.apiClient.secret.*`) go to `activeProfileId` only. An existing profile-scoped value is never overwritten. Raw `team.custom` merges into the scoped list by id. Global keys are removed afterwards. Plain-localStorage tokens move into secure storage under the same profile-scoped name and the plain key is removed.

- [ ] **Step 1: Failing tests:**
  - `settings are copied to every profile; content and credentials only to the active one`.
  - `an existing profile-scoped value wins over the global one`.
  - `team.custom raw list merges into the scoped list by id`.
  - `plain tokens move into secure storage and the plain keys are gone`.
  - `running twice changes nothing the second time`.
  - `afterwards no global user-data key remains` (same allowlist as Task 7).
- [ ] **Step 2:** Run `--project core migrate-v2`; fail. **Step 3:** Implement and wire. **Step 4:** Run `--project core`, `--project desktop`, `--project work`; pass.
- [ ] **Step 5:** Commit `feat(desktop): migrate shared data into profiles; tokens into secure storage`.

### Task 9: Deleted profiles in the UI

**Files:**
- Modify: `packages/ui/src/profile-context.jsx` (`deleteProfile` → soft delete; add `restoreProfile(id)`, `purgeProfile(id)`, `deletedProfiles`; `profiles` returns live ones only; `exportBundle`/`collectScoped` unchanged)
- Modify: the profiles settings view (`VsProfiles`, find with `grep -rn "export function VsProfiles" packages/ui/src`)
- Modify: `packages/ui/src/account-gate.jsx` (pending-purge dialog via `sync.onPendingPurge`)
- Test: `packages/ui/src/profile-context.test.jsx`, the VsProfiles test file, `packages/ui/src/account-gate.test.jsx`

**Interfaces:**
- Consumes: Task 5 `purgeProfile`, `pendingPurges`, `confirmPurge`, `onPendingPurge`, `purgeProfileLocal`; `useAccount()` for `sync` (null when signed out → local purge only).
- Delete sets `deletedAt = now, updatedAt = now`; restore sets `deletedAt = null, updatedAt = now`. The last live profile cannot be deleted (existing toast).

- **Account switch (owner decision 2026-11-03, "protect unsynced"):** when a different account signs in (the gate's existing switch warning), first ask the sync engine for unpushed local changes (`sync.unpushed() : Array<{ id, profileId }>` — add it in this task: ids whose local value differs from the last synced one, plus conflicted ids). If there are none, `clearLocal()` removes everything the registry syncs **including profile content** (drop the interim content-keeping rule `isContent` in `packages/core/src/modules/account/account-clear.js`). If there are some, the switch is blocked: the screen lists the profiles and item counts not yet synced and offers **Sync now** (runs `syncNow`, then re-checks), **Export** (`exportBundle` per affected profile) and **Cancel** (sign out of the new account, nothing cleared). Only when nothing is unpushed, or after an export, can the owner continue to clear. Signed out of the old account (no session): treat every local content key as unsynced.

- [ ] **Step 1: Failing tests:**
  - `account switch with nothing unsynced clears content too`.
  - `account switch with unsynced notes is blocked and lists them; Sync now that succeeds unblocks; Export then Continue clears; Cancel clears nothing`.
  - `deleting moves the profile to Deleted profiles and keeps its data`.
  - `restore brings it back with its data`.
  - `purge asks for confirmation, then removes data and secrets (signed out: local only; signed in: sync.purgeProfile)`.
  - `the profile switcher never lists deleted profiles`.
  - `a pending purge shows the names of discarded items and offers Export first, then Discard` (export uses `exportBundle({ scope: pid, password })`).
- [ ] **Step 2–4:** fail → implement → pass (`--project ui profile`, `--project ui account-gate`).
- [ ] **Step 5:** Commit `feat(ui): deleted profiles list with restore and purge`.

### Task 10: Data & sync and Profiles tab — status, Sync now, conflicts, account card

**Files:**
- Create: `packages/ui/src/sync-status-card.jsx` (`SyncStatusCard`), `packages/ui/src/sync-conflicts.jsx` (`SyncConflictsCard`, `ConflictDialog`)
- Test: `packages/ui/src/sync-status-card.test.jsx`, `packages/ui/src/sync-conflicts.test.jsx`
- Modify: `packages/ui/src/index.js` (exports), `apps/desktop/src/desktop-settings.jsx` (Data & sync: `AccountCard`, `SyncStatusCard`, `SyncConflictsCard`; Profiles tab: `AccountCard` above `VsProfiles`)
- Modify: `packages/ui/src/account-gate.jsx` (toast on `onConflict`: `"N sync conflicts need your decision — Settings › Data & sync"`)

**Interfaces:**
- Consumes: Task 4 `conflicts/resolve/keepBoth/onConflict`, Task 6 `status`, `diffLines(oldText, newText)` from `packages/core/src/modules/markdown/extras.js:116`, the device name from `account.deviceNameDefault()`.
- `SyncStatusCard`: one row per live profile — name, `Last synced <time>` or the error, rejected items count; one **Sync now** button calling `sync.syncNow()`.
- `ConflictDialog`: header names profile and item; buttons **Keep both** (records only) and **Resolve**. Resolve for text values (record with `body`/`content`/`text`, or a plain string) shows a line diff of local vs remote with per-hunk "Use mine / Use theirs" and an editable result; for structured values, a field table with a mine/theirs radio per differing field. Saving calls `resolve(id, { value })`; Keep both calls `keepBoth(id, { copyName: n => \`${n} (conflicted copy, ${device}, ${date})\` })`.

- [ ] **Step 1: Failing tests:** `status card lists each live profile with last sync time and a Sync now button that calls syncNow`; `conflicts card lists open conflicts`; `Keep both is offered for records only`; `resolving a text conflict by taking theirs for one hunk sends the merged text`; `resolving a structured conflict sends the chosen fields`; `the Profiles tab shows the account card`.
- [ ] **Step 2–4:** fail → implement → pass (`--project ui sync-`, `--project desktop desktop-settings`).
- [ ] **Step 5:** Commit `feat(ui): per-profile sync status, Sync now and conflict resolution`.

### Task 11: Missing repos and API client folders show greyed out

**Files:**
- Modify: the git module's repo list renderer (find with `grep -rn "git.config" modules/git/src/renderer`), `packages/ui/src/views/view-api-client.jsx`
- Test: the matching existing test files (extend)

**Interfaces:**
- Consumes: `window.electronAPI.file.exists(path) : Promise<boolean>` (`apps/desktop/electron/preload.cjs:133`).
- A repo or collection folder whose path does not exist renders disabled with `aria-disabled="true"`, greyed (existing muted style), tooltip `"Not on this computer: <path>"`, and cannot be opened; it re-enables on the next check once the folder exists (checked on mount and on window focus).

- [ ] **Step 1: Tests:** `a repo whose folder is missing is shown disabled and cannot be opened`; `it enables once the folder exists`; same pair for API client folders.
- [ ] **Step 2–4:** fail → implement → pass (`--project git`, `--project ui api-client`).
- [ ] **Step 5:** Commit `feat(desktop): repos and API folders missing on this computer show disabled`.

### Task 12: Legacy Cloud sync behind a feature flag

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx` (toggle row in Data & sync: "Google Drive / OneDrive backup"), `apps/desktop/src/main.jsx` (`desktopSync.startAuto()` only when on), the Profiles tab (`CloudSyncCard` and the cloud providers in `BackupRestoreCard` only when on)
- Test: `apps/desktop/src/desktop-settings.test.jsx` (extend)

**Interfaces:**
- Flag key `nexusmd.feature.legacyCloudSync` (`'1'`/`'0'`, device-level). Default when absent: `'1'` if `nexusmd.sync.provider` is set, else `'0'` (spec call 11).

- [ ] **Step 1: Tests:** `with the flag off, no Cloud sync card or Drive/OneDrive buttons render and auto-sync does not start`; `with the flag on, they render`; `default follows whether a provider was configured`.
- [ ] **Step 2–4:** fail → implement → pass (`--project desktop`).
- [ ] **Step 5:** Commit `feat(desktop): Google Drive / OneDrive backup behind a settings switch`.

### Task 13: End-to-end check, docs, release notes

**Files:**
- Modify: `scripts/account-e2e.mjs` (two simulated desktops against a local server)
- Modify: `docs/accounts.md` (profiles, deleted profiles, conflicts, what syncs and what does not, greyed-out repos, legacy backup switch), `docs/railway-deploy.md` (`Sync__MinFormat=2` at release)

- [ ] **Step 1:** Extend the e2e script: device A and B each hold different notes before first sync (both survive or conflict, none lost); same note edited on both → one conflict, `keepBoth` → two notes on both devices; delete profile on A → listed as deleted on B → restore → purge (server holds only tombstones for that profile's ids, both devices empty for it); a format-1 write after setting `Sync__MinFormat=2` gets 426; raw database scan still finds no plaintext.
- [ ] **Step 2:** Run `node scripts/account-e2e.mjs` against a local server (see the script header); PASS.
- [ ] **Step 3:** Run every JS project one at a time with `--maxWorkers=1` and the server suite in the .NET 8 container; all pass.
- [ ] **Step 4:** Update the docs; commit `docs(accounts): profiles that sync everything`.
- [ ] **Step 5 (owner, at release):** set `Sync__MinFormat=2` on Railway in the same window as the desktop release; release desktop; update both desktops.
