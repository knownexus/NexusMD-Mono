# Multi-user accounts with end-to-end encrypted sync for NexusMD

## Context
Today every NexusMD install is an island: a "profile" is only a local name and colour, with no login. A new install means creating a local profile and re-entering connections, keys and sign-ins by hand, and planners and notes only move between devices through the user's own Google Drive/OneDrive.

Goal: accounts on a NexusMD server (Railway). Log in on a new Windows or Android install and everything is there: configuration, secrets, and data (planners, notes, documents). Users can share content with each other.

### Decisions made with the user
- **Multi-user, invite-only.** An admin creates invite codes; no public sign-up. The first account (admin) is created with a one-time `SETUP_TOKEN` on the fresh deploy.
- **Everything is locked with the user's password (end-to-end).** The server stores ciphertext only, so it cannot read secrets, config, notes, planners or documents, and an admin cannot see anyone's content. A forgotten password means that user's data is unrecoverable.
- **Sharing:** documents, notes and planners, with per-share **view or edit** permission.
- **The server replaces the Google Drive/OneDrive sync.** Drive/OneDrive stay only for manual backup/import (`BackupRestoreCard`, `.nmdprofile`).
- **Config that follows the account to every device:** connections, chosen repos/projects/work-item settings, integrations, API keys, OAuth tokens (sign-in consents), colour theme and similar.
- **Config saved per device on the server:** enabled modules/apps/screens, Home widgets, nav order/placement, and the app's own switches (start at login, close to tray, notifications, zoom, disabled apps). After a reinstall the user picks the device from a list at login.
- **Platforms:** Windows (Electron) and Android (Capacitor) first; web later.
- **Hosting:** server doesn't exist yet; Railway, with `nexusmd.app` as the domain.
- OS-level permission grants can't be carried over (a new Android install shows its notification prompt once); the app's own switches are restored.

### Scope and delivery
This is three projects in one. Deliver as milestones, each shippable, and write a detailed plan for each when it starts. This document details **Milestone 1**; Milestones 2 and 3 are designed at a high level here.
1. **Accounts + config/secrets/device restore** (the "log in on a new install and it just works" feature).
2. **Data sync** (planners, notes, documents) on the server, replacing Drive/OneDrive sync.
3. **Sharing** with view/edit permissions.

## Findings that shape the design (from exploration)
- No auth anywhere: `apps/web/server` (ASP.NET 8, SQLite) has no `AddAuthentication`/`[Authorize]`; `ProfilesController`, `ConfigController`, `FilesController`, `AdoController` are open, and profiles/active-profile are global, not per user. Patterns to copy: `data/ProfileRepository.cs`, `Services/ProfileService.cs`, tests via `server-tests/Infrastructure/TestFactory.cs`.
- The existing sync engine (`packages/core/src/modules/sync/`: `runtime.js`, `merge.js`, `reconcile.js`, `hash.js`, `collections.js`) does 3-way merge of encrypted data against a flat named-blob store (`modules/cloud/providers.js`: list/upload/download/remove). Its merge functions (`mergePlannerWeek`, `mergeRows`, `mergeSet`, `mergeKeyVal`) and collection adapters are reusable; the server becomes a new store. Currently it syncs only planner weeks, notes (a single row-list blob), team custom/removed, and tweaks. Notes are not individually addressable today, and the documents module (`modules/documents`) looks thin, with no data model yet.
- Existing KDFs are weak (unsalted SHA-256) in `packages/core/src/modules/planner/confidential.js`, `modules/profiles/bundle.js`, `apps/desktop/src/settings-file.js`; don't reuse them.
- Secure storage keys are device-bound and non-extractable (`packages/web-adapters/src/secure-storage.js`); desktop/web OAuth tokens are plaintext in localStorage; Android's are in secure storage (`apps/app/src/cloud-auth.js`). Secrets must be read locally and re-encrypted under the account key. `apps/desktop/src/settings-file.js` (`collectSettings`/`applySettings`, `isExported`/`SKIP`) already does this collect/restore and is the model to generalise.
- Key names differ by app (`nexusmd.*` vs `helm.*`, `nexusmd.ado.*` vs `helm.android.*`); desktop `nexusmd.tweaks` is not profile-scoped but the app's is; the `tweaks` object mixes account-level fields (theme, density) with device-level ones (widgets, nav).
- `pushPref` (`packages/ui/src/app-components.jsx:19`) is already the single hook for pref writes and is a no-op on desktop/app — reuse it to feed sync.
- **Gotcha to verify:** Google refresh tokens are bound to the OAuth client that issued them, and desktop and Android use different Google clients (`apps/desktop/electron/oauth/config.cjs`, `apps/app/src/google-oauth.js`). Store tokens per platform client; where the other platform has none, the first use does a one-click re-sign-in (Google remembers the consent). Check Microsoft the same way.
- `AdoController` proxies using a server-held PAT (`Ado:Pat`); with multiple users it must stop using shared server config (relevant when web is added; desktop/Android call ADO directly with each user's own PAT).
- Committed secrets: `apps/web/server/appsettings.user.json` (Google client secret) and `apps/desktop/electron/oauth/config.cjs`. Move out of git and rotate.

## Design

### Crypto (my call, not yet reviewed by the user)
- **Login key derivation:** client derives 64 bytes from `password + per-user salt` with PBKDF2-HMAC-SHA256 (>= 600k iterations, WebCrypto, available in Electron and Android WebView), HKDF-split into an **auth key** (sent to the server) and a **vault key** (never leaves the device). Server hashes the auth key again with its own salt and stores only that; rate limiting and lockout.
- **Per-user keypair** (ECDH P-256, WebCrypto), generated at invite redemption. The private key is stored on the server wrapped with the vault key; the public key is stored readable. Used for sharing (Milestone 3).
- **Containers:** all content lives in containers. Each container has a random AES-GCM key. A user's **personal container** key is wrapped by their vault key; shared containers' keys are wrapped per member with ECDH (ECIES-style) against each member's public key. Items (config entries, notes, planner weeks, documents) are encrypted with their container's key.
- **Sharing unit = container** (my call): a "shared planner", "shared notes folder", "shared documents folder". Sharing a container grants its key to the recipient. Role (`viewer`/`editor`) is enforced server-side on writes. Removing a member rotates that container's key and re-encrypts its items.
- **Password change** re-wraps the vault key and private key only; content keys don't change, so no bulk re-encryption.
- **Limits to document in the UI:** the server could substitute a public key (show a key fingerprint in the share dialog); a viewer technically holds the key but the server rejects their writes.
- Not in scope for v1 but compatible: a printed recovery key that also wraps the vault key.

### Server (apps/web/server)
- Tables (SQLite, DB path on a Railway volume): `Users` (username, salt, kdf params, auth hash, public key, wrapped private key, role admin/user, disabled), `Invites`, `RefreshTokens`, `Devices` (userId, name, platform, encrypted prefs blob, revision), `Containers`, `Members` (containerId, userId, role, wrapped container key), `Items` (containerId, id, revision, ciphertext, updatedAt, deleted), and a change feed (monotonic cursor) for sync.
- Controllers: `AccountController` (setup, redeem invite, login, refresh, logout, change-password), `AdminController` (create/revoke invites, disable users), `DevicesController`, `VaultController`/`ItemsController` (`GET`/`PUT` with `If-Match` revision, 409 on conflict, `GET /changes?since=cursor`), later `SharingController`.
- Auth: short-lived JWT access token + rotating refresh token (hashed), bound to a device. A global fallback authorization policy; `[AllowAnonymous]` only for login/setup/invite-redeem/refresh and the OAuth redirect callbacks (`/api/google/auth/callback`, `/api/ms/auth/callback`, native-callback, etc. — confirm each). Make existing profile storage per-user.
- Item size cap (e.g. 25 MB, my call) so documents can't exhaust the volume.
- Railway: `Dockerfile` (none exists), persistent volume for SQLite, env vars `SETUP_TOKEN`, JWT signing key, Google/Microsoft client secrets; remove `appsettings.user.json` from git and rotate the leaked secret. Use the `railway:use-railway` skill when implementing.

### Shared client (packages/core/src/modules/account/ — new)
- `kdf.js`, `crypto.js` (container/item encryption, key wrapping), `account-client.js` (HTTP, token refresh, change-feed pull), `vault.js` (per-entry last-writer-wins merge, retry on 409), `device-prefs.js`.
- `key-registry.js`: declares every synced setting once as `{canonical name, level: 'account' | 'device', desktop key, app key}`. This resolves the `nexusmd.`/`helm.` naming, splits the `tweaks` object into account-level and device-level fields, and records which entries are secrets. Rule (my call): credentials, connections, selections (repos/projects/work items) and appearance go to the account; layout, modules and app switches go to the device. Everything is encrypted before upload, including device prefs.
- Generalise `collectSettings`/`applySettings` from `apps/desktop/src/settings-file.js` into core so desktop, app and the existing `.nmdsettings` export share them.
- Profile ids are preserved across devices so `<ns>.p.<profileId>.*` scoping keeps working; the account carries the profile record.

### Client integration (Milestone 1)
- New `packages/ui/src/account-gate.jsx` wraps `ProfileGate` in `apps/desktop/src/main.jsx` and `apps/app/src/main.jsx`: login (or redeem invite) -> device picker / "new device" -> restore account config + secrets + device prefs -> app. `ProfileGate` is skipped once restore creates the profile.
- **First device seeds the account:** if a device already has local data on first login, offer to upload it as the account's starting point (reusing the `.nmdsettings` collect path).
- Ongoing: pull on login, app start, foreground resume and a timer; debounced push on change. Hook points: a synced wrapper around `ISecureStorageAdapter`, `cloud-auth.js` `writeAuth` (token refresh must update the account), and `pushPref`.
- Settings UI: "Account" card (status, devices list/rename/remove, change password, log out; admin: invites and users) in `packages/ui/src/views/view-settings.jsx`.

### Milestones 2 and 3 (high level)
- **M2 Data sync:** implement a server store behind the existing sync runtime/merge code; move planner weeks, notes (split into one item per note), team data and documents into personal-container items; define the documents data model (the module has none yet); documents conflicts create a conflicted copy, planner/notes use the existing merges; retire `CloudSyncCard` in favour of the server (keep Drive/OneDrive for manual backup); migrate existing Drive-synced data on first login.
- **M3 Sharing:** share dialog (pick user, role, fingerprint), shared containers in the planner/notes/documents UIs, role enforcement, member removal with key rotation.

## Non-goals
- Public sign-up, email verification, password recovery of encrypted data (v1), server-side search or content moderation, real-time co-editing (sync is eventual, on change/resume).
- Carrying over OS-level permission grants.
- Web app integration (later; also resolve its dead endpoints `/api/prefs`, `/api/github/auth`, `/api/ado/auth`).

## Critical files
- Server: `apps/web/server/Program.cs`, `Controllers/*`, `data/ProfileRepository.cs` (pattern), `apps/web/server-tests/Infrastructure/TestFactory.cs`
- Core: `packages/core/src/modules/account/*` (new), `packages/core/src/modules/sync/*` (M2), `packages/core/src/adapters/index.js`, `apps/desktop/src/settings-file.js` (to generalise)
- UI/shell: `packages/ui/src/profile-gate.jsx`, `profile-context.jsx`, `app-components.jsx`, `views/view-settings.jsx`, `apps/desktop/src/main.jsx`, `apps/app/src/main.jsx`, `apps/desktop/src/cloud-auth.js`, `apps/app/src/cloud-auth.js`

## Verification (Milestone 1)
- `dotnet test apps/web/NexusMDWeb.sln`: setup works once and needs `SETUP_TOKEN`; invites are single-use and expire; wrong password and lockout; endpoints return 401 without a token; users cannot read each other's devices/items; 409 on stale revision; the server never receives the vault key or plaintext secrets.
- `npm test` / `npm run test:affected`: KDF determinism, wrong-password failure, crypto round trips, key-registry mapping, collect/apply round trip, tweaks split.
- Manual end to end: run the server locally (`apps/web/Start-Dev.ps1`), create the admin with the setup token, invite a second user, log in on desktop and seed, wipe local app data (simulated reinstall), log in again and pick the device; confirm connections, selections, theme, tokens, widgets, nav and app prefs return. Repeat on Android with a second named device and check the Google/Microsoft client-binding behaviour.
- Playwright desktop e2e modelled on `apps/desktop/e2e/settings-file.spec.js`.
- Railway smoke test: deploy, restart, confirm users, devices and data persist on the volume.

## Open items
- Confirm token portability between the desktop and Android OAuth clients.
- Confirm the account/device split of the `tweaks` fields with the user once the key registry is drafted.
- Decide the documents data model and size limits at the start of Milestone 2.
