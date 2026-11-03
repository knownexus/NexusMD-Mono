# Profiles that sync everything — design

Date: 2026-11-03. Status: draft for owner approval. Builds on Accounts M1
(`docs/superpowers/specs/2026-11-01-accounts-and-sync-design.md`, server live at
`https://nexusmd-api-production.up.railway.app`).

## Intent

Signing in to NexusMD on any desktop should feel like sitting at the same machine: every setting, connection,
credential and piece of content the owner keeps in the app is there, organised by profile. Profiles (e.g. Work,
Personal) are sealed boxes: switching profile shows nothing from another profile. A deleted profile is never lost
until the owner purges it. The owner uses two desktops at once on the same day, so concurrent edits must never be
lost silently.

## Goals

1. **Sync everything per profile** through the existing end-to-end-encrypted account sync: all settings and
   configuration, API keys and credentials, sign-ins (GitHub, Jira, Azure DevOps, Google, Microsoft), database
   connections and saved queries, the repo list, and all content (planner weeks and versions, notes, lists,
   calendar events, time log, documents).
2. **Sealed profiles.** Every piece of user data belongs to exactly one profile. No key that holds user data is
   shared between profiles.
3. **Deleted profiles list.** Deleting a profile moves it to a "Deleted profiles" list in Settings → Profiles,
   on every device. Restore brings it back intact on every device. Purge (confirmed) permanently removes it from
   the server and every device. Nothing purges automatically.
4. **Data & sync tab** shows one row per profile with its last sync time, and a **Sync now** button.
5. **Account card on the Profiles tab** (Settings → Profiles), next to the profile list. It stays on Data & sync
   as well.
6. **Conflicts are always the owner's decision.** When the same record changed on two devices between syncs,
   that record is flagged and the owner chooses, each time: **Keep both** (the other version is saved as a
   conflicted copy) or **Resolve** (a merge view to build the result).
7. **Legacy Cloud sync** (Google Drive / OneDrive, `CloudSyncCard`) stays as an optional backup behind a feature
   flag toggled in Settings. When the flag is off, all of its UI is removed and its auto-sync does not run.

## Non-goals

- **Repo code.** Never uploaded. Only the repo list syncs. On a device where a repo's folder does not exist, the
  repo shows as a **greyed-out, disabled entry**.
- Contents of external databases (the database module is a client for SQL Server / SQLite files; it stores no
  database data itself). Only connections, credentials, saved queries and table preferences sync.
- Files the app only points at: editor files, devenv profile files, API client collection folders (see "Calls
  made"), downloaded artifacts.
- Android. It follows in a later release; this design must not change the sync format in a way Android cannot
  adopt later.
- Machine-level state: window zoom, close-to-tray, open-at-login, which apps are installed/disabled
  (`prefs.json`), logs, downloaded app versions.

## Anti-goals (a failure even if it technically works)

- Any edit lost without the owner seeing it.
- Any data from one profile visible, or used, while another profile is active.
- The server able to read any synced value (end-to-end encryption must hold for all new data).
- A deleted profile reappearing on its own, or a purged one surviving on any device.

## What exists today (research, 2026-11-03)

- **Already syncing per profile** (key `nexusmd.p.<pid>.*`): repo list (`git.config`), database connections
  (`dbManager.connections`) and their secrets, ADO/GitHub/Jira settings and tokens, Google/Microsoft sign-ins,
  devenv config, editor recent list, JSON and regex documents, planner confidential settings and prefs. The
  profile list syncs as an id union.
- **Per profile but deliberately not synced** (M1 `NEVER_SYNC` in
  `packages/core/src/modules/account/key-registry.js`): `planner.week.*`, `planner.globalNotes`,
  `planner.versions`, `calendar.events`, `lists`, `timelog.v1`.
- **Global keys that bleed between profiles** (raw `nexusmd.*` or un-namespaced keys):
  - `nexusmd.tweaks` (dashboard layouts, home widgets, nav order/placement/hidden, theme, quick links, …),
    written raw by `apps/desktop/src/main.jsx`.
  - Database module: `nx-db:saved-queries`, `nx-db:tables:*`, `nx-db:starred:*`, `nx-db:min-cols:*`,
    `nx-db:open-connections`, `nx-db:list-hidden`, `nx-db:last-type` (`packages/ui/src/views/ViewDbManager.jsx`).
  - Markdown documents `md_documents` and its prefs `md_learning_progress`, `md_learn_mode`,
    `md_cheatsheet_open` (`packages/ui/src/views/MarkdownViewer.jsx`).
  - API client secret variables `nexusmd.apiClient.secret.<dir>.<env>.<var>`.
  - `nexusmd.team.notes`, and `nexusmd.team.custom` which is read raw in `view-team.jsx` but profile-scoped in
    `modules/work/src/renderer/work-views.jsx` (two screens read different keys — a bug).
  - `nexusmd.refreshInterval`, `nexusmd.projectAreas.v3`, `nexusmd.confidential.autoRelock`,
    `nexusmd.settings.collapsed`, `nexusmd.markdown.textSize`, `nexusmd.outputPath`, `nexusmd_seen_pr`,
    `nx-gw-branch-commits-collapsed`.
- **Delete today** hard-purges `nexusmd.p.<id>.*` with no undo; its secrets (`nexusmd.sec.nexusmd.p.<id>.*`) are
  left orphaned; with account sync on, the deleted profile returns on the next pull because the profile list
  merge is a union.
- **Security gap:** on desktop, `ado.pat`, `github.pat`, `jira.apiToken` and the `<provider>.auth` OAuth tokens
  are stored in plain localStorage, not secure storage (Android encrypts them).
- **Sync engine:** snapshot diff, last-writer-wins per item, one item per localStorage key. Sync meta records,
  per item, the last synced `hash` and server `revision`. The server's `PUT /api/items/{id}` already takes
  `If-Match: <revision>` and answers 409 on a stale revision. Item limits: 25 MiB per item, 1 GiB per user.
- **Repo records** hold only `{name, path}`; remotes are read live from git.

## Decided with the owner

- Sync everything per profile, "as if on the same device"; repo code excluded; repos keep only their
  configuration and the GitHub/Jira/Azure DevOps sign-ins.
- Missing repo folder → greyed-out, disabled entry.
- Deleted profiles list in Settings, kept until the owner purges.
- Data & sync: last sync time per profile and a Sync now button.
- Both desktops are used on the same day, so content must merge record by record.
- On every conflict the owner chooses between a conflicted copy and merge-conflict resolution.
- Desktop first, Android after.
- Legacy Cloud sync kept as a backup behind a Settings feature flag; its UI disappears when the flag is off.
- **View settings follow the profile across desktops.** Dashboard layouts (already saved per screen size), nav
  order/placement/hidden, home widgets, refresh interval, work-item and build view settings (`wi.*`,
  `builds.*`, `fields.*`, `notif.*`) and markdown text size become profile-scoped and synced, shared by every
  desktop in the profile. The tweaks account/device split goes away for these.
- **Migration of today's global data:** settings are copied into **every** profile; content and credentials
  (markdown documents, saved queries, table preferences, team notes/custom, API client secret variables) go into
  **one** profile only — the one active at upgrade — so the owner can move anything that belongs elsewhere.

## Calls made (the designer's, not the owner's — check these)

1. **Record-level items for content.** Content that is one big value today is split so each record is its own
   sync item: one item per note, per list, per calendar event, per time-log day, per planner week (already one
   key per week), per planner version snapshot, per markdown document, per JSON/regex document. Different
   records edited on two devices then merge without conflict.
2. **Conflict detection** uses the existing revision tracking: an item is in conflict when its local value
   changed since the last sync **and** the server holds a newer revision than the one last synced. The engine
   does not overwrite either side; it parks the item as a conflict and keeps syncing everything else.
3. **Conflict UI.** A notice appears when a conflict is found; unresolved conflicts are listed in Data & sync.
   "Resolve" on text content (notes, documents) is a line-by-line merge view reusing the git module's conflict
   tooling where it fits; on structured records (time-log day, list, calendar event, connection) it shows the
   two versions field by field and the owner picks per field. "Keep both" stores the remote version as a
   conflicted copy alongside the local one ("<name> (conflicted copy, <device>, <date>)").
4. **Settings conflicts** (single-value keys such as a theme or a connection field) use the same flow, so
   nothing is ever overwritten silently.
5. **Every global key above moves into profile scope**, following the owner's migration rule (settings to every
   profile, content and credentials to the profile active at upgrade); the global key is then removed. The
   `team.custom` raw/scoped mismatch is fixed by keeping the profile-scoped key and merging any raw value into it.
6. **Machine-level keys stay device-level** and unsynced or device-scoped as today: `prefs.json` values,
   `sidebar.width`, `account.*`, `activeProfileId`, sync bookkeeping, OAuth pending state, caches and snapshots.
   Everything else listed under "View settings follow the profile" is profile-scoped and synced.
7. **API client collection folders** are treated like repos: the list of loaded folders syncs; a missing folder
   shows greyed out. Folder contents are files on disk and do not sync. Secret variables move into profile scope
   and sync.
8. **Desktop tokens move to secure storage** (`ado.pat`, `github.pat`, `jira.apiToken`, `<provider>.auth`), with
   a one-time migration, matching Android.
9. **Profile list becomes deletion-aware.** Each profile gains a `deletedAt` (null when live) and the merge
   honours it, so a deletion syncs instead of being undone by the union merge. Purge writes server tombstones for
   every item of the profile, removes its local keys **and its secrets**, and removes the profile record.
10. **Sync now** syncs every profile, not just the active one. The per-profile last sync time is the latest
    successful sync that included that profile's items; a profile whose last sync failed shows the error on its
    row.
11. **Legacy Cloud sync flag** is off by default for new installs and on for installs where Cloud sync is
    already configured, so nobody loses a backup they set up.
12. **Planner version snapshots sync** even though they are large; if a single snapshot exceeds the 25 MiB item
    limit it stays local and the Data & sync row says so.
13. **Older clients are refused, not accommodated.** The new client format carries a sync-format version; the
    server rejects item and device-prefs writes from clients below a configured minimum format with a distinct
    error code, which old clients surface as a sign-in/sync error. No dual-format period. Today only the owner
    uses the server and no Android build points at it, so the cost is updating both desktops.
14. **Machine-written values never prompt.** Values the app writes on its own — OAuth token refreshes, "seen"
    flags (`nexusmd_seen_pr`), collapsed/expanded panel state, last-used markers, open-connection lists — resolve
    newest-wins without a conflict. Only values the owner edits (settings, connections, credentials typed in,
    content) go through the conflict flow. The registry marks each item as owner-edited or machine-written.
15. **Identical values are never conflicts.** If both sides hold the same value (same hash), the item is simply
    marked synced. After the upgrade, the first device to sync performs the migration and pushes; a device that
    finds migrated data already on the server adopts it rather than pushing its own migration. Record ids for
    content split out of blobs come from the records' existing ids where they have one, so the same record
    migrated on two devices gets the same id.
16. **Deleted vs edited elsewhere.** A soft-deleted profile keeps syncing its items until purged, so restore works
    from any device and edits made elsewhere are kept. Purge wins over offline edits: a device that comes back
    with changes to a purged profile shows a notice listing what will be discarded and offers to export it (as a
    `.nmdprofile` bundle) before discarding.
17. **Tokens stay shared with Android.** Moving `ado.pat`, `github.pat` and `jira.apiToken` into desktop secure
    storage keeps their platform-neutral sync ids (today's aliases), so Android can adopt them later. Secret items
    that are meant to be shared therefore get neutral ids rather than `sec:nexusmd:*`; Android adopts the same ids
    in its follow-up.

## Left to the builder

- How record-level items map onto ids in the key registry, and how existing single-key content
  (`planner.globalNotes`, `lists`, `timelog.v1`, `calendar.events`, `md_documents`, document arrays) is
  migrated into records, as long as the migration is one-time, idempotent and loses nothing.
- Whether the engine stores record items as virtual keys or reads/writes the existing blobs through adapters.
- How the conflict queue is persisted locally, and the exact layout of the merge view.
- How the Android client adopts the new format later (keep the registry and item formats platform-neutral).
- Test strategy, beyond: every anti-goal above has an automated test, including a two-device concurrent edit
  test and a "no key holds user data outside a profile" check.
