# Profile backup / import / export — portable, cross-app, encrypted

**Date:** 2026-06-29
**Status:** Approved design (Feature A of 2)
**Scope:** Portable profile file + local import/export/backup on web, app (Capacitor), desktop (Electron). Cloud sync (Google Drive / OneDrive) is a deliberate follow-up (Feature B) that will reuse this file format unchanged.

## Context

NexusMD ships to three surfaces (web, app, desktop) that share `@nexusmd/core` + `@nexusmd/ui`. A "profile" is a registry record (id, name, initials, color, type, optional org label, ADO/GitHub `config` blob) plus per-profile data stored in `localStorage` under `${namespace}.p.${id}.*` (planner weeks, notes, team, tweaks, calendar/Outlook config, Google/Outlook tokens). The namespace is `nexusmd` on web/desktop and `helm` on the app.

The user wants to back up / export / import profiles to a **dedicated profile file** that the other apps can read, save as local files, and (later) move to Google Drive / OneDrive. Today only a partial, unencrypted single-profile export exists (`exportProfile`/`importProfile` in `packages/ui/src/profile-context.jsx`), it is localStorage-only (misses web's server-side `config`), and it is not used for full backups.

Existing building blocks to reuse:
- AES-GCM crypto in core: `hashPassword`, `encryptConfidentialForServer`, `decryptConfidentialFromServer` (`packages/core/src/modules/planner/confidential.js`) — generic password→key + `{iv, ciphertext}`.
- The `profileStore` seam + shared `ProfileProvider` (`packages/ui/src/profile-context.jsx`) and its per-platform wrappers (`apps/*/src/profile-context.jsx`).
- Web profile registry backend (`apps/web/server/Controllers/ProfilesController.cs` + `ProfileService`/`ProfileRepository`).
- `window.nexusMDDownload` (Electron-aware download, defined in `apps/web/src/app.jsx`).

## Decisions (from brainstorming)

1. **Sequencing:** Feature A (portable file + local I/O) now; cloud is a separate follow-up spec.
2. **File contents:** one format that carries **one OR many** profiles. "Export this profile" → one; "Back up all" → all (+ `activeId`).
3. **Secrets:** **always password-encrypt the whole bundle, including secrets** (PAT, OAuth tokens). Reuses core AES-GCM. Every export requires a password; import requires it.
4. **Import mode:** **restore-by-id** — profiles matching by id are overwritten; others are added.
5. **Platforms:** all three (web, app, desktop). Shared logic in core/ui; thin per-platform file I/O.

## Architecture

Three layers, dependency order core → ui → apps:

- **`@nexusmd/core` — `modules/profiles/bundle.js` (new, pure):**
  - `encodeBundle(payload, password) → Promise<string>` — JSON-stringify the payload, AES-GCM encrypt with a key derived from `password`, return the on-disk wrapper JSON string.
  - `decodeBundle(text, password) → Promise<payload>` — parse wrapper, decrypt, JSON-parse; throws on bad password / tampered / wrong-format.
  - `BUNDLE_FORMAT`, `BUNDLE_VERSION`, `BUNDLE_EXT = '.nmdprofile'` constants.
  - Reuses the existing core AES-GCM (a dedicated salt for bundles, distinct from the planner-confidential salt). No DOM/storage — pure, fully unit-testable, identical across apps (this is what makes files cross-app readable).

- **`@nexusmd/ui` — extend the profile layer:**
  - Extend the `profileStore` seam with `importProfiles(records, activeId)` (platform persistence of the registry: web → backend batch upsert; app/desktop → `localStorage` upsert by id).
  - Add to the shared provider / a `useProfileBackup()` hook:
    - `exportBundle({ scope: 'all' | profileId, password }) → Promise<{ filename, text }>` — gather profile registry records (from `profiles` + each `config`) and their `data` (namespace-stripped `localStorage` scoped keys), build the payload, `encodeBundle`, return a dated filename + ciphertext.
    - `importBundle({ text, password }) → Promise<{ imported, names }>` — `decodeBundle`, then for each profile: `store.importProfiles` (registry) + write each `data` entry to `storage` under `${namespace}.p.${id}.${key}`; set `activeId` if present; then reload.
  - **UI:** a shared **"Backup & Restore" card** in Settings → Profiles (sibling of `VsProfiles`, in `packages/ui/src/views/view-settings.jsx`): **Export this profile**, **Back up all profiles**, **Import / Restore from file**. Password via the existing `VsPasswordModal` pattern (set+confirm on export, enter on import); outcomes via `toast`. This **replaces** the old unencrypted single-profile export/import.

- **Per-platform file I/O** — a small injected `fileIO` adapter, wired where each app constructs its profile context:
  - `saveFile(filename, text) → Promise<void>`
  - `pickFile() → Promise<string | null>` (returns file text, or null if cancelled)
  - web → blob download + hidden `<input type=file>`; desktop → Electron save/open dialogs (reuse `window.nexusMDDownload` for save); app → Capacitor `Filesystem` (Documents) + Share sheet for save, file picker for open.

## File format

Decrypted payload (cross-app):
```jsonc
{
  "format": "nexusmd-profile-bundle", "version": 1,
  "exportedAt": "2026-06-29T12:00:00Z", "exportedBy": "web|app|desktop",
  "activeId": "<id|null>",                 // set for full backups
  "profiles": [{
    "id": "...", "name": "...", "initials": "...", "color": "...",
    "type": "ado|github|manual", "orgLabel": "...?", "createdAt": 0,
    "config": "<ADO/GitHub blob string|null>",   // web registry Config; null on app
    "data": { "planner.week.2026-W26": "...", "tweaks": "...", "google.auth": "..." }
            // namespace-stripped localStorage keys, re-prefixed per app on import
  }]
}
```

On-disk wrapper (always encrypted):
```jsonc
{ "format": "nexusmd-profile-bundle-enc", "version": 1, "iv": "<hex>", "ciphertext": "<base64>" }
```
File extension **`.nmdprofile`** (one recognizable type for 1-or-many). Default filenames: single → `nexusmd-profile-<name>.nmdprofile`; backup → `nexusmd-backup-<YYYY-MM-DD>.nmdprofile`.

**Cross-app data sourcing:** the bulk `data` (planner/notes/team/tweaks/tokens) is `localStorage` on all three platforms and already namespace-stripped, so it is **fully portable as-is** — the core value (move your planner/notes/team/tweaks between web ↔ app ↔ desktop) works cleanly.

The one piece that is **not** uniform is the ADO/GitHub connection **config** (org/PAT/projects), because the platforms store it differently: web keeps it in the registry (`ProfileRepository` SQLite `Config` field, exported as the bundle's `config`), while the app keeps it in `localStorage` (so it rides inside `data` as `android.*` keys, and the app's `config` is null). Consequence, stated honestly:
- **Same-platform** restore (web→web, app→app, desktop→desktop) preserves connection config fully.
- **Cross-platform** transfer carries planner/notes/team/tweaks/tokens, but the ADO/GitHub connection may need to be re-entered on the destination because the source stored it in a place the destination doesn't read. Normalising config into a single cross-platform field is possible but is **out of scope for Feature A** (see Non-goals); on import each platform writes back whatever it natively understands (`config` → web registry; `data.android.*` → app localStorage).

## Backend changes (web)

Restore-by-id requires upsert (current `POST /api/profiles` mints a new id):
- `ProfileRepository.Upsert(Profile)` — `INSERT OR REPLACE`.
- `ProfileService.Import(IEnumerable<Profile>, string? activeId)` — upsert all; set active if provided and present.
- `POST /api/profiles/import` — body `{ profiles: [ …records with ids… ], activeId }` → upsert + set active → `200`.
- Reuses `ProfilesControllerTests` infrastructure (isolated SQLite per `TestFactory`).

The app/desktop perform the equivalent upsert directly in `localStorage` (`${namespace}.profiles` list + `${namespace}.activeProfileId`).

## Error handling

- Wrong password / tampered / non-bundle file → `decodeBundle` throws; UI shows a single toast: "Couldn't read that file — wrong password or not a NexusMD profile file."
- `pickFile()` returns null on cancel → no-op.
- `saveFile` failure → error toast; export is otherwise side-effect-free.
- Import is best-effort per profile but writes the registry record before its data keys so a partial failure still yields a usable (if incomplete) profile; a final toast reports how many imported.

## Testing

- **core** `tests/profile-bundle.test.js`: encode→decode round-trip (1 and many profiles), wrong password rejects, tampered ciphertext rejects, format/version markers present, `data` keys preserved verbatim.
- **ui** `tests/profile-backup.test.jsx`: `exportBundle` gathers profiles + namespace-stripped data from a mock store + enumerable storage; `importBundle` restores (overwrite-by-id **and** add-new), writes `${ns}.p.${id}.*` keys, sets active; mock `fileIO`; round-trips through real `encode/decodeBundle`.
- **backend** `ProfilesControllerTests`: `POST /api/profiles/import` upserts by id (create-or-replace) and sets `activeId`.

## Verification (end-to-end)

- `npx vitest run` green (core bundle + ui backup suites added).
- `dotnet test apps/web/NexusMDWeb.sln` green (import endpoint).
- `npm -w apps/{web,app} run build` + `npm -w apps/desktop run build:renderer` green.
- Manual (post-merge, per platform): export current profile → file written; export all → backup file; import on a second device/app with the password → profiles + planner/notes restored; wrong password → friendly error.

## Non-goals (this spec)

- Google Drive / OneDrive upload/download (Feature B — separate spec; will feed `fileIO`-style save/load through cloud APIs).
- Automatic/scheduled backups, versioned backup history, conflict resolution beyond restore-by-id.
- Migration of the old unencrypted `.json` exports (that path was new/broken; not carried forward).
- Normalising ADO/GitHub connection config into a single cross-platform field (so connections survive web↔app transfer without re-entry). Same-platform restore already preserves it; cross-platform config portability can be a later refinement.
