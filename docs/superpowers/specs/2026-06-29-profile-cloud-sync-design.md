# Profile cloud sync — Google Drive & OneDrive (Feature B)

**Date:** 2026-06-29
**Status:** Approved design (Feature B of 2)
**Scope:** Manual upload/download of the encrypted `.nmdprofile` bundle to/from Google Drive **and** OneDrive, on **web, app (Capacitor), and desktop (Electron)**. Builds directly on Feature A (portable encrypted profile backup/import/export), reusing its bundle format and import/export logic unchanged.

## Context

Feature A (`docs/superpowers/specs/2026-06-29-profile-backup-import-export-design.md`, shipped) gave NexusMD a portable, always-AES-GCM-encrypted profile bundle (`.nmdprofile`) plus local file I/O behind a small injected `fileIO = { saveFile, pickFile }` seam, wired into a shared `BackupRestoreCard` in Settings on all three platforms. Feature A's non-goals explicitly deferred cloud sync to this spec, noting it "will reuse this file format unchanged" and "feed `fileIO`-style save/load through cloud APIs."

The user wants to upload/download backups to/from Google Drive and OneDrive so profiles move between devices and apps via their own cloud storage.

Existing building blocks to reuse:
- **Bundle format + logic (core/ui):** `encodeBundle`/`decodeBundle` (`@nexusmd/core`), `exportBundle`/`importBundle` (`@nexusmd/ui` profile provider). Cloud changes only the transport; encryption and the on-disk format are identical.
- **Server-mediated Google OAuth (web):** `apps/web/src/google-auth.js` + backend `/api/google/auth/url|callback|refresh`, tokens stored per-profile at `nexusmd.p.<id>.google.auth`. Used today for Calendar.
- **`BackupRestoreCard` + `BundlePasswordModal` (`@nexusmd/ui`):** the Settings surface cloud actions extend.
- **Per-platform deep-link/redirect plumbing:** app deep links, desktop custom-protocol/loopback (Electron).

App and desktop have **no** OAuth infrastructure today (the app's `auth` adapter is biometric-only; neither does Google/Microsoft sign-in), so their cloud auth is net-new.

## Decisions (from brainstorming)

1. **Providers:** Google Drive **and** OneDrive in v1, behind one provider abstraction.
2. **Platforms:** all three (web, app, desktop).
3. **Auth model:** **backend-mediated** — the web ASP.NET backend holds both client secrets and performs all token exchanges (Google + Microsoft) for every platform. App/desktop open the system browser to the backend and receive tokens back via their own redirect (deep link / loopback). Consequence, stated honestly: app/desktop now require a reachable deployed backend URL for sign-in.
4. **Cloud file location:** a normal, **user-visible `/NexusMD` folder** in the account root, with narrow per-file scopes (Google `drive.file`, Microsoft Graph `Files.ReadWrite`). Users can see, move, and share the (still-encrypted) files.
5. **Sync model:** **manual push/pull only** — "Save backup to {provider}" and "Restore from {provider}". No automatic/scheduled sync, no two-way merge, no conflict resolution (consistent with Feature A non-goals).

## Architecture

Dependency order core → ui → apps. The bundle/crypto layer (core) is **unchanged**; cloud is a new transport.

### The `cloudProvider` seam (sibling of Feature A's `fileIO`)

```jsonc
cloudProvider = {
  id: 'gdrive' | 'onedrive',
  label: 'Google Drive' | 'OneDrive',
  isConnected(): boolean,
  connect(): Promise<void>,             // platform-specific OAuth (see Auth)
  disconnect(): Promise<void>,
  list(): Promise<Array<{ id, name, modifiedAt }>>,  // .nmdprofile files in /NexusMD
  upload(name, text): Promise<void>,                 // create or overwrite in /NexusMD
  download(id): Promise<string>,                     // returns bundle ciphertext text
}
```

### Shared provider factories (`@nexusmd/ui`)

The Drive/Graph REST calls are platform-agnostic *given a valid access token*, so the file operations live in shared factories — `makeGoogleDriveProvider({ getToken })` and `makeOneDriveProvider({ getToken })` — each implementing `list/upload/download` via `fetch`:
- **find-or-create `/NexusMD`** (cached folder id per session),
- **list** `.nmdprofile` children (name, id, modified time),
- **upload** = create new, or overwrite if a same-name file exists (multipart for Drive; PUT content for Graph),
- **download** = fetch file media → text.

The only injected dependency is `getToken()` (returns a valid access token, refreshing as needed) plus `connect/isConnected/disconnect`. This keeps one implementation of the cloud file-ops shared across all three platforms.

### Auth — backend-mediated (the platform-specific part)

The web backend is the single OAuth broker (client secrets server-side only):
- **Web backend endpoints:** existing `/api/google/auth/url|callback|refresh` gains the `drive.file` scope; a new `MicrosoftAuthController` mirrors it at `/api/ms/auth/url|callback|refresh` (Microsoft Graph, `Files.ReadWrite` + `offline_access`).
- **Authorize → return-to-platform:** `/api/{prov}/auth/url?redirectUri=X` builds the provider authorize URL using the **backend's own** callback as the OAuth `redirect_uri`. After the backend exchanges the code for tokens, it redirects the browser to `X` (the calling platform's target) with a **short-lived one-time code**; the platform exchanges that code with the backend for the actual tokens (keeps tokens out of raw redirect URLs). `redirectUri` values are validated against a server allow-list.
- **Per-platform `authBinding`** (one per provider) supplies `connect`, `getToken`, `isConnected`, `disconnect`:
  - **Web:** `X = window.location.origin + '/?from={prov}'` (existing redirect pattern); `getToken` reads the stored token and refreshes via the backend.
  - **App (Capacitor):** `X = nexusmd://oauth/{prov}`; the existing deep-link handler captures the one-time code and exchanges it; `getToken` refreshes via the backend.
  - **Desktop (Electron):** `X =` a registered custom protocol or `http://127.0.0.1:<port>` loopback; the main process captures the code and exchanges it; `getToken` refreshes via the backend.
- **Token storage:** per-profile localStorage, mirroring today's `google.auth`: `nexusmd.p.<id>.gdrive.auth` and `nexusmd.p.<id>.onedrive.auth` = `{ accessToken, refreshToken, email? }`. (Namespace is `helm.` on the app.) These ride inside Feature A backups like any other scoped data.

Each app builds its providers by feeding its `authBinding.getToken` into the shared factory, then passes the resulting provider objects to the UI.

### UI (`@nexusmd/ui`)

`BackupRestoreCard` gains a `cloudProviders` prop (array of wired provider objects). For each provider it shows a **Connect/Disconnect** control, and when connected, **"Save backup to {label}"** and **"Restore from {label}"**. "Restore from" opens a new `CloudPickerModal` listing `/NexusMD` `.nmdprofile` files (name + date) for selection. Local file backup (Feature A) is unchanged and sits alongside. The card remains platform-agnostic — all platform specifics arrive via the injected provider objects (and the existing `fileIO`).

## Data flow (reuses Feature A end-to-end)

- **Upload:** `exportBundle({ scope, password })` → `{ filename, text }` → `provider.upload(filename, text)` → success toast.
- **Restore:** `provider.list()` → user picks in `CloudPickerModal` → `provider.download(id)` → `BundlePasswordModal` (enter) → `importBundle({ text, password })` → reload.

Encryption, the `.nmdprofile` format, restore-by-id, and namespace re-prefixing are all Feature A's, untouched.

## Backend changes (web)

- **`MicrosoftAuthController`** mirroring `GoogleAuthController`: `/api/ms/auth/url`, `/callback`, `/refresh` (Graph OAuth; client id/secret from config; scopes `Files.ReadWrite offline_access openid email`).
- **Google scope:** add `https://www.googleapis.com/auth/drive.file` to the existing authorize URL.
- **One-time-code exchange** endpoint(s) so app/desktop can complete sign-in without tokens in redirect URLs; `redirectUri` allow-list in config.
- **Config:** Microsoft client id/secret + redirect allow-list; Google client already present.
- Tests reuse the `WebApplicationFactory` infrastructure; assert secrets never appear in any response (the `TestFactory` sentinel pattern).

## Error handling

- **Not connected:** cloud actions hidden; the Connect control starts OAuth.
- **Expired/invalid token:** one silent refresh via the backend; on failure, a single "Reconnect {label}" toast; no destructive side effects.
- **Provider / network failure:** single error toast; upload is otherwise side-effect-free; restore aborts cleanly.
- **Empty `/NexusMD`:** friendly "No backups found in {label}." in the picker.
- **Wrong password on a downloaded bundle:** Feature A's existing decode error toast ("wrong password or not a NexusMD profile file").
- **OAuth cancelled / redirect mismatch:** no-op with an optional info toast; never partially writes tokens.

## Testing

- **ui** `tests/cloud-providers.test.jsx`: `makeGoogleDriveProvider` / `makeOneDriveProvider` against mocked `fetch` — find-or-create `/NexusMD`, list parsing, upload create-vs-overwrite, download→text, token-refresh-on-401. Card cloud-action tests with mock providers; `CloudPickerModal` render + select.
- **backend** `MicrosoftAuthControllerTests`: url/callback/refresh against a mocked token endpoint, mirroring Google; assert no secret leakage.
- **Manual e2e** (per platform): connect each provider, save a backup, restore it on a second device/app; wrong password → friendly error; disconnect.

## Verification (end-to-end)

- `npx vitest run` green (new ui cloud-provider + card suites).
- `dotnet test apps/web/NexusMDWeb.sln` green (Microsoft auth controller).
- `npm -w apps/{web,app} run build` + `npm -w apps/desktop run build:renderer` green.
- Manual: web → app → desktop round-trip of a backup through both providers.

## Implementation sequencing (large feature — phase it)

One spec; the implementation plan builds shippable increments:

1. **Shared provider factories + UI** (`@nexusmd/ui`) against **mock auth** — fully unit-testable, no backend needed.
2. **Web backend** — Google `drive.file` scope + `MicrosoftAuthController` + one-time-code exchange.
3. **Web wiring** — construct both providers (web `authBinding`), mount cloud actions in the card. First usable cloud platform.
4. **App wiring** — deep-link `authBinding` (`nexusmd://oauth/{prov}`) + providers.
5. **Desktop wiring** — protocol/loopback `authBinding` + providers.

Each phase is independently verifiable; web is usable after phase 3. Phases may be split into separate implementation plans.

## Non-goals (this spec)

- Automatic/scheduled sync, background upload, versioned history, or two-way merge / conflict resolution (manual push/pull only).
- Provider browsing beyond the `/NexusMD` folder; no arbitrary-path picker.
- Normalising ADO/GitHub connection config for cross-platform transfer (still a Feature A non-goal; cloud doesn't change it).
- Sharing/collaboration features; multi-user cloud profiles.
- Native on-device token exchange (rejected in favour of backend-mediated auth).
