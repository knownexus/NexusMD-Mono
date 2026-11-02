# Accounts M1: handoff (what is done, what remains)

Written 2026-11-02 so the work can be continued later with no prior context.
Branch: `feature/1-login` (worktree `C:\repos\NexusMD-Mono\feature\1-login`).
Read first: the spec `docs/superpowers/specs/2026-11-01-accounts-and-sync-design.md` and the plan
`docs/superpowers/plans/2026-11-01-accounts-m1.md` (14 tasks; Global Constraints, Decisions and Review Focus at the top apply to every task).

## Goal in one paragraph
Invite-only, multi-user accounts on a NexusMD server (ASP.NET + SQLite on Railway). Logging in on a new Windows (Electron) or
Android (Capacitor) install restores all config, secrets (API keys, OAuth tokens) and per-device preferences. Everything is
end-to-end encrypted under the user's password: the server only ever stores ciphertext, and a forgotten password means the data
is unrecoverable. M1 = accounts + config/secrets/device restore (this plan). M2 = sync planners/notes/documents. M3 = sharing.

## State
Tasks 1-10 are DONE, reviewed (with fix rounds) and merged on `feature/1-login` (HEAD at time of writing: `01b48f0`).

| Tasks | What | Where |
|---|---|---|
| 1-6 | Server: JWT auth, legacy-endpoint gate, accounts/sessions/lockout, Account/Admin/Devices/Items controllers, Dockerfile + Railway doc | `apps/web/server`, tests in `apps/web/server-tests` (~282 pass) |
| 7-10 | Client library: crypto, account client, key registry, sync engine | `packages/core/src/modules/account/*`, tests `packages/core/tests/account-*.test.js` (279 pass) |

Not started (nothing uncommitted exists): **Tasks 11, 12, 13, 14**, then the final review. An implementer agent was started on
Task 11 and stopped before it wrote anything; start Task 11 from scratch.

## What remains

### Task 11: shared UI (`packages/ui`)
Full text: plan, "Task 11". Summary:
- Create `packages/ui/src/account-gate.jsx`, `account-card.jsx`, tests `account-gate.test.jsx`, `account-card.test.jsx`.
- Export `AccountGate`, `AccountCard` from `packages/ui/src/index.js`.
- `packages/ui/src/views/view-settings.jsx`: add an optional `accountSlot` prop rendered in the data/sync section (Ruling 2). Android passes it (Task 13); desktop renders `AccountCard` in its own `desktop-settings.jsx` tab (Task 12).
- Props: `<AccountGate account={{ client, sessionStore, deviceStore, createSync, platform, deviceNameDefault, optOutKey }}>`; `deviceStore = { get(), set(id) }`; `createSync(containerKey, deviceId) -> sync`.
- Flow: opted out, or stored session + device id -> render children and start sync in the background. Otherwise `client.status()` -> first-run setup screen (setup token, username, password, confirm) if `needsSetup`, else login with a "Redeem an invite" tab and a "Use without an account" link. After auth: device picker (saved devices + "This is a new device" with a name field defaulting to `deviceNameDefault()`); if the account has no items and the device has local data, offer "Upload this device's settings" (`sync.seed()`), otherwise `sync.pull()`; then `window.location.reload()`. `session-expired` shows the login screen without wiping local data; an offline stored session still renders children.
- Add a `useAccount()` context hook returning `{ sync, session, signOut }` so shells can call `sync.observe()` (needed by Tasks 12/13).
- Map `AccountError.code` (invalid | locked | disabled | forbidden | conflict | offline | session-expired | keys-corrupt | server | not-found) to plain messages. Password inputs are `type=password` and cleared after submit.
- Card: status, last sync time, "Sync now", devices (rename/remove), change password, log out; admins also get invites (show the code once) and users.
- Reuse the `profile-setup__*` CSS classes from `packages/ui/src/profile-gate.jsx`. Test with React Testing Library and a fake `client` (test list is in the plan).
- Run: `npm test --workspace @nexusmd/ui -- account`. Commit: `feat(ui): account gate and account settings card`.

### Task 12: desktop wiring (`apps/desktop`)
- `apps/desktop/src/main.jsx`: wrap `<ProfileGate>` with `<AccountGate account={account}>`.
- New `apps/desktop/src/account.js` exporting `account = { client, sessionStore, deviceStore, createSync, platform: 'windows', deviceNameDefault, optOutKey }`. `sessionStore` persists in `secureStorageAdapter` under `account.session`; `deviceStore` uses localStorage `nexusmd.account.deviceId` (never synced); `createSync` uses `createKeyRegistry({ namespace: 'nexusmd' })`, `localStorage`, `secureStorageAdapter`, `devicePrefs` from `appPrefsAdapter` (`closeToTray`, `zoomFactor`, `openAtLogin`, `disabledApps`), `metaKey: 'nexusmd.account.meta'`. API base `import.meta.env.VITE_API_BASE || 'https://nexusmd.app'`.
- `apps/desktop/src/settings-file.js`: exclude `nexusmd.sec.account.` from `collectSettings`/`applySettings`; extract and export `collectDesktopPrefs(prefs)` and `applyDesktopPrefs(d, prefs, installedApps)` (keep the "all apps disabled -> none disabled" guard). It already imports the shared skip list from core.
- `apps/desktop/src/desktop-settings.jsx`: render `AccountCard` in the "Data & sync" tab.
- Shell must call `sync.start()` once the gate renders children, `onApplied` -> `window.location.reload()`, and **`sync.observe()` after settings are saved and on `pagehide`** (the sync engine stamps change time at `observe()`; without it last-writer-wins is wrong).
- Tests: see plan Task 12. Run `npm test --workspace @nexusmd/desktop`. Commit: `feat(desktop): log in with an account and sync settings`.

### Task 13: Android wiring (`apps/app`)
- New `apps/app/src/account.js`, same shape as desktop: `namespace: 'helm'`, `platform: 'android'`, `secureStorageAdapter` from `apps/app/src/adapters/secureStorage.js`, `devicePrefs: null`, `metaKey: 'helm.account.meta'`, device id key `helm.account.deviceId`, pass `getActiveProfileId`, device name from the Capacitor Device plugin if installed else "Android device".
- Wrap `AccountGate` outside `ProfileGate` in `apps/app/src/profile-context.jsx`; it must run after `profile-migration.js`. Render `AccountCard` through the new `accountSlot` in the settings screen; call `observe()` on app pause.
- An existing local profile plus a remote profile list must end as the union by id.
- Tests: see plan Task 13. Run `npm test --workspace @nexusmd/app`. Commit: `feat(app): log in with an account and sync settings`.

### Task 14: end-to-end check and docs
- `scripts/account-e2e.mjs`: against a local server (`dotnet run --project apps/web/server` with `Accounts__SetupToken`, `Jwt__SigningKey`, `Accounts__DbPath` to a temp dir, `Web__LegacyEndpoints=false`): set up admin, invite a second user, log in as "desktop A" with seeded ADO config + secret + tweaks and push, then log in as a fresh "desktop B" and pull; assert values arrive and that a dump of the server SQLite file contains none of the plaintext values or setting names. Non-zero exit on failure.
- `docs/accounts.md`: what is synced at which level, invites, forgotten-password consequence, Windows vs Android token behaviour, link to `docs/railway-deploy.md`.
- Manual checks (record in the PR; say clearly if Android could not be run): wipe local app data, log in, pick the device, confirm connections, theme, widgets, nav and app prefs return.
- Run the full suites: `npm test` and `dotnet test apps/web/NexusMDWeb.sln`. Commit: `docs(accounts): end-to-end script and user guide`.

### Final steps
1. Whole-branch review over `c915e92..HEAD` on the most capable model; fix once, scoped re-review.
2. Use `superpowers:finishing-a-development-branch`.
3. In the final message, list the rulings below ("Rulings I made").

## Contracts you will need (already implemented)
- Client: `createAccountClient({ baseUrl, fetch, sessionStore, minIterations })` -> `status`, `setup`, `redeem`, `login`, `logout`, `changePassword`, `getSession`, device methods, admin methods, `getChanges` returning `{ items, cursor, hasMore }`. `minIterations` defaults to 600000; tests may pass lower.
- Sync: `createAccountSync({ client, containerKey, registry, storage, secure, devicePrefs, deviceId, metaKey, now, intervalMs, pageSize })` -> `snapshot`, `observe`, `push`, `pull`, `seed`, `syncNow`, `start`, `stop`, `onApplied`, `lastSyncAt`, `onError`. Batch statuses: ok | conflict | too_large | invalid | quota.
- Registry: `createKeyRegistry({ namespace })`, platform keys `nexusmd.*` (desktop) vs `helm.*` (Android) map to canonical ids and levels (account vs device). Items for OAuth tokens keep their platform namespace, so Windows and Android tokens are separate items.
- Crypto: PBKDF2-HMAC-SHA256 (>= 600000) -> 64 bytes -> HKDF split ("nexusmd-auth" / "nexusmd-vault"); AES-GCM with AAD `'nexusmd-item|' + opaqueId` and `'nexusmd-device-prefs|' + deviceId`; wrap labels `nexusmd-wrap-ck` / `nexusmd-wrap-pk`; passwords NFKC-normalised.
- Server: 15 min JWT, rotating hashed refresh tokens with reuse detection, 30-day sliding sessions, lockout 5 failures / 15 min, per-IP rate limit on anonymous endpoints, legacy endpoints (Ado, Config, Files, Profiles) return 404 unless `Web:LegacyEndpoints=true`.

## Rulings made so far (carry into the final message)
1. Registry exposes `namespace` and `secPrefix` (`<ns>.sec.`); the sync engine enumerates secure entries from localStorage keys with that prefix.
2. `accountSlot` prop on `view-settings.jsx` for Android; desktop renders `AccountCard` in its own settings tab.
3. The shared skip list in core is namespace-aware (`nexusmd.` and `helm.`).
4. `ResolveJwtKey` moved into `Services/Auth` so token service and JWT options share one key rule.
5. `deriveKeys` validates iteration bounds; the 600000 floor is enforced in the client.
6. AES-GCM additional-data contexts bind items and device prefs to their ids.
7. Invite redemption is atomic and never burns an invite on a failed username; no failed-login recording while locked.
8. Sessions have a sliding 30-day idle expiry.
9. Disabling a user revokes their sessions; rotation also requires a non-disabled user.
10. Change-password revokes all sessions and returns 200 with a fresh session (not 204).
11. Only the login 403 maps to `disabled` in the client.
12. Per-IP rate limiting; 423 lockout enumeration/DoS accepted as a trade-off for a small invite-only server.
13. Login attempt reservation is atomic (no parallel guessing beyond 5).
14. Session creation is conditional on the verified credential still being current.
15. `Proxy:TrustForwardedHeaders` defaults to false; Railway must set `Proxy__TrustForwardedHeaders=true`.
16. `changedAt` is stamped when `observe()` first sees a change (last-writer-wins by observed-change time).
17. No migration of old sync meta (feature unreleased).
18. Changes feed has a byte budget per page, explicit `hasMore`, and a per-user quota (`Items:MaxPageBytes`, `Items:MaxUserBytes`).
19. `Items.Size` migration is atomic and repairable.
20. Quota counts ciphertext + id bytes + 128 bytes row overhead.
21. Ciphertext must be base64/base64url; these controllers use relaxed JSON escaping.
22. Read-only snapshots use `BeginTransaction(deferred: true)` (Microsoft.Data.Sqlite 8.0.11 otherwise issues BEGIN IMMEDIATE even for ReadCommitted).

## Deferred minor items (optional cleanups)
- Invite list lacks revoked/redeemedBy; only self-disable is blocked.
- Chunked oversize request bodies untested under real Kestrel; some weak test assertions (escaping test prefs half, page-budget exact boundary, logging middleware); CS8602 nullable warning near `DevicesItemsTests.cs:833`.
- `PUT prefs` returns `{revision}` only; empty prefs ciphertext now 400.
- Dockerfile: `EXPOSE` cosmetic; no HEALTHCHECK (aspnet image has no curl).

## Known open issue
`Concurrent_writes_to_different_items_get_distinct_cursors` (and once the login concurrency test) failed intermittently under full-suite load. It could not be reproduced in 14 full runs plus 60 stress iterations; the cause is unproven (SQLite busy suspected, BUSY_SNAPSHOT ruled out). Diagnostics and a busy timeout were added and the failure message now prints status/body. If it recurs, capture the message and investigate rather than retrying.

## Owner-only TODOs (cannot be done by an agent here)
- Run `docker build -f apps/web/Dockerfile -t nexusmd-api .` where Docker is available (never built; only a simulated context publish was checked).
- Rotate the leaked Google web client secret (it is in git history; `apps/web/server/appsettings.user.json` is now untracked) and consider the committed desktop client config `apps/desktop/electron/oauth/config.cjs`.
- Create the Railway project, volume and env vars (`docs/railway-deploy.md`); set `Proxy__TrustForwardedHeaders=true` and verify empirically that a spoofed `X-Forwarded-For` cannot dodge the rate limit and that the app is only reachable through the proxy.
- Test on a real Android device (Google/Microsoft one-click re-sign-in across platforms).

## Process notes
This was run with the superpowers subagent-driven-development skill: one implementer per task, a task review (spec + quality) with up to 5 fix rounds and scoped re-reviews, then a final whole-branch review. The working ledger lived in the git-ignored `.superpowers/sdd/2026-11-01-accounts-m1/` directory and does not travel with the branch; this file replaces it. Server tests: `dotnet test apps/web/NexusMDWeb.sln`. Client tests: `npm test --workspace <name>`.
