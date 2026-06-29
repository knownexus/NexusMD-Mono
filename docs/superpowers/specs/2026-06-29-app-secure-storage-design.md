# App secret storage — encryption at rest (design)

Status: **implemented (build-verified); on-device acceptance pending** · 2026-06-29 · surface: `apps/app` (Capacitor / Android WebView)

## Implementation status (2026-06-29)

Delivered across commits `f3fdc9b` (adapter), `f48e3a0` (cloud-auth cache), `8797021`
(startup hydration), `6351fcd` (CloudSyncCard listener). Verified: `npm -w apps/app run build`
green after every task; `npx vitest run packages/ui` → 21 files / 106 tests pass (incl.
`cloud-sync-card.test.jsx`). Note: profile switch reloads the page (ui `ProfileProvider` calls
`window.location.reload()`), so the startup hydrate alone covers re-hydration — no separate
in-app switch handler was needed.

**Pending — on-device manual acceptance (not yet run; needs an emulator/device build):**
1. Connect Drive → localStorage holds only `helm.sec.*` base64 blobs, no plaintext token, no
   legacy `helm.gdrive.auth`.
2. Restart → still connected (cache hydrated from ciphertext).
3. Set sync passphrase → `helm.sec.<…sync.keyhex>` is ciphertext; sync succeeds.
4. Switch profile → connection state reflects the new profile, no leak.
5. Disconnect → entry removed; card flips without reload.


## Problem

The app stores cloud-sync secrets in **plaintext localStorage**:

- OAuth tokens (`accessToken` / `refreshToken`) for Google Drive and OneDrive, written by
  `apps/app/src/cloud-auth.js` at `getProfileKey('helm.<provider>.auth')`.
- The sync passphrase-derived key hex (`sync.keyhex`), routed through
  `apps/app/src/adapters/secureStorage.js`, which is **currently a plaintext localStorage
  fallback** (the file even says so).

Desktop already solved this: `apps/desktop/src/adapters/secureStorage.js` keeps a
**non-extractable AES-GCM master key in IndexedDB** and stores only ciphertext in
localStorage. The app has the same WebCrypto + IndexedDB surface available in its WebView, so
it can use the same defense. Today it does not, so anything that can read the WebView's
localStorage (another local actor, a backup, a debugging bridge) reads the user's cloud tokens
and sync key in the clear.

## Decisions (from brainstorming)

1. **Scope = all app secrets**, not just the sync key. Both the sync key hex *and* the OAuth
   tokens go through the encrypted adapter. (Chosen over "sync key only".)
2. **Backend = WebCrypto + IndexedDB** — port the proven desktop adapter. (Chosen over a native
   Capacitor secure-storage plugin, which would add a dependency + native build surface and
   isn't needed to close the at-rest gap.)
3. **Migration = start fresh** — no dual-read of legacy plaintext keys. On first run after the
   upgrade, existing plaintext secrets are simply not found; the user re-connects each provider
   and re-enters the sync passphrase once. (Chosen over a one-version dual-read migration: the
   secrets are cheap to re-establish and a migration path would mean *reading* plaintext secrets
   we are trying to stop touching.)

## Goal

Every app secret is **encrypted at rest** with a key the WebView cannot export, behind an
adapter whose async `get/set/remove` contract is unchanged — so `sync.js` (which already routes
the key hex through the adapter) needs **no change**, and `cloud-auth.js` changes only its
storage calls, not its provider contract.

## Non-goals

- **Not** defending against code execution inside the WebView. A non-extractable WebCrypto key
  protects data at rest (localStorage dumps, device backups, another process reading the store);
  it does not protect against an attacker who is already running JS in our origin — they can call
  the adapter's `get` like we do. Closing that requires a native Keystore/Keychain-backed store
  and is **deferred** (follow-up below).
- **Not** changing the OAuth flow, the one-time-code redemption, the provider contract, or the
  sync engine.
- **Not** introducing a KDF / per-secret salt (tracked separately).

## Architecture

```
cloud-auth.js  ──┐                         ┌── IndexedDB  (helm-keystore)
                 ├─ secureStorageAdapter ──┤   non-extractable AES-GCM master key
sync.js  ────────┘  (async get/set/remove) └── localStorage  helm.sec.<key> = b64(iv‖ct)
```

The adapter is the *only* component that touches crypto. Everything above it sees the same
`async get(key) -> string|null`, `async set(key, value)`, `async remove(key)` it sees today.

### Component 1 — rewrite `apps/app/src/adapters/secureStorage.js`

Port `apps/desktop/src/adapters/secureStorage.js` verbatim except for the three app-scoped
constants:

| const         | desktop value          | app value            |
|---------------|------------------------|----------------------|
| `ENC_PREFIX`  | `nexusmd.sec.`         | `helm.sec.`          |
| `DB_NAME`     | `nexusmd-keystore`     | `helm-keystore`      |
| `STORE_NAME`  | `keys`                 | `keys`               |
| `KEY_ID`      | `master`               | `master`             |

Same mechanism: `openDb()` (v1, one object store), `getKey()` generates a non-extractable
`AES-GCM` 256-bit key on first use and persists the **CryptoKey object** in IndexedDB (structured
clone keeps it non-extractable), `encrypt`/`decrypt` use a fresh 12-byte IV per write and store
`btoa(iv‖ciphertext)`. `get/set/remove` swallow errors and `get` returns `null` on any failure
(missing key, corrupt ciphertext, rotated master key) — which, with "start fresh", is exactly the
desired behavior for stale plaintext entries.

The `helm.sec.` prefix means encrypted entries live in a **separate keyspace** from the legacy
plaintext `helm.<provider>.auth` keys, so nothing collides and the old keys are simply abandoned.

### Component 2 — refactor `apps/app/src/cloud-auth.js`

The adapter is async; `makeBinding(...).isConnected()` is called synchronously by the UI/provider
contract and **must stay sync**. Resolve this with an in-memory token cache.

- Add `import { secureStorageAdapter } from './adapters/secureStorage.js'`.
- Replace the sync `read/write/clear` (raw localStorage) with:
  - **async** `writeAuth(suffix, auth)` → `secureStorageAdapter.set(getProfileKey('helm.'+suffix), JSON.stringify(auth))` **and** update `tokenCache`.
  - **async** `clearAuth(suffix)` → `secureStorageAdapter.remove(...)` **and** delete from `tokenCache`.
  - **sync** `readAuth(suffix)` → read from `tokenCache` only (never touches storage).
- `tokenCache` is a `Map` keyed by the **resolved profile key** (`getProfileKey('helm.'+suffix)`),
  so a profile switch can't return another profile's tokens. (Keyed by resolved key, not suffix.)
- New exported **async** `hydrateCloudTokens()` — for each provider, decrypt its entry via the
  adapter and populate `tokenCache`, then `dispatch` a generic
  **`nexusmd:cloud-auth-changed`** event so the shared `CloudSyncCard` re-reads connection state.
  Called at app startup and after a profile switch.
- `makeBinding`:
  - `isConnected()` → `Boolean(readAuth(cfg.keySuffix)?.accessToken)` (sync, cache-backed).
  - `connect()` unchanged (still just opens the browser).
  - `disconnect()` → `await clearAuth(...)` then dispatch `nexusmd:cloud-auth-changed`.
  - `getToken({force})` → reads from cache; on refresh, `await writeAuth(...)` the new access
    token (cache + ciphertext both updated).
- `redeem(url)` (deep-link OTC exchange) → `await writeAuth(...)`, dispatch
  `nexusmd:cloud-auth-changed`, then reload (the reload re-hydrates anyway, but the event makes
  the pre-reload state correct too).

### Component 3 — startup / profile-switch hydration

- `apps/app/src/app.jsx` (or `main.jsx`, wherever `registerCloudDeepLink()` + `startAppAutoSync()`
  are wired near render) → `await hydrateCloudTokens()` once at startup, before the first
  connection-state read.
- On profile switch (the same place the app re-resolves `getActiveProfileId`) → call
  `hydrateCloudTokens()` again so the cache reflects the newly-active profile.

### Component 4 — shared `CloudSyncCard`

`packages/ui/src/views/view-settings.jsx`'s `CloudSyncCard` already listens for sync state; it
must also re-read provider connection state when **`nexusmd:cloud-auth-changed`** fires. This is a
generic event (not app-specific) so web/desktop can emit it later if they adopt async token
storage. The card's provider `isConnected()` calls stay sync (cache-backed), so the listener just
triggers a re-render.

### Unchanged

`apps/app/src/sync.js` — already does
`keyStore: { get: () => secureStorageAdapter.get('sync.keyhex'), ... }`. Once the adapter
encrypts, the sync key hex is encrypted at rest **with no code change here**.

## Data flow

1. **Connect** → browser OAuth → deep link `nexusmd://oauth/<provider>?otc=` → `redeem` exchanges
   the OTC for tokens → `writeAuth` encrypts to `helm.sec.<resolvedKey>` and fills `tokenCache` →
   `nexusmd:cloud-auth-changed` → card shows "connected".
2. **Sync** → `sync.js` `keyStore.get('sync.keyhex')` → adapter decrypts → controller has the key.
3. **Restart** → `hydrateCloudTokens()` decrypts each provider's entry into `tokenCache` →
   `isConnected()` true without ever reading plaintext.
4. **Profile switch** → `hydrateCloudTokens()` rebuilds cache for the new profile's resolved keys.

## Error handling

- Adapter `get` returns `null` on any failure → callers treat it as "not connected / no key",
  which is correct for both corruption and the start-fresh transition.
- A failed `set` (storage full, IndexedDB blocked) is swallowed; the user simply isn't connected
  and can retry. No secret is written in plaintext as a fallback.
- Wrong-passphrase handling is unchanged — it lives in the sync runtime/manifest verifier, not
  here. The adapter only stores the key hex; it doesn't validate it.

## Testing

- **Build-verified only.** `apps/*` have no vitest harness; the root vitest workspace covers only
  `packages/*`. jsdom (what the ui package tests run under) lacks `crypto.subtle` **and**
  IndexedDB, so the adapter cannot be unit-tested in that harness.
- The crypto is a **direct port of desktop's `secureStorageAdapter`**, which ships and works; the
  only deltas are three string constants. Risk is in the wiring (cache keying, hydration timing),
  which is exercised by `vite build` + manual connect/sync/restart/profile-switch on device.
- Manual acceptance: connect Drive → restart app → still connected (cache hydrated from
  ciphertext) → localStorage shows only `helm.sec.*` base64 blobs, no plaintext token; set sync
  passphrase → `helm.sec.<...sync.keyhex>` is ciphertext; switch profile → other profile's
  connection state, not a leak.

## Known limitation

WebCrypto-at-rest defends **data at rest**, not **code execution inside the WebView**. An attacker
running JS in our origin can call the adapter exactly as we do. The non-extractable key still
prevents the *key* from leaving the device, but not in-context use. A native
Keystore/Keychain-backed secure store would raise that bar and is deferred.

## Follow-ups

- **Native Keystore backend** for the adapter (real OS-level secret storage; defends against
  in-WebView execution). Tracked as a separate effort.
- **Dedup** the now-identical desktop/app `secureStorageAdapter` into `@nexusmd/web-adapters`
  parameterized by the three constants, instead of two near-copies.
- **KDF / per-secret salt** for the sync passphrase — tracked separately from this at-rest work.
