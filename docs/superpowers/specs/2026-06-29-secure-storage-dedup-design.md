# Secure-storage adapter dedup → @nexusmd/web-adapters (design)

Status: **approved (design)** · 2026-06-29 · surfaces: `apps/{web,desktop,app}`, `packages/web-adapters`

## Problem

Three byte-identical copies of the WebCrypto+IndexedDB `secureStorageAdapter` exist:

- `apps/web/src/adapters/secureStorage.js` — `nexusmd.sec.` / `nexusmd-keystore`
- `apps/desktop/src/adapters/secureStorage.js` — `nexusmd.sec.` / `nexusmd-keystore`
- `apps/app/src/adapters/secureStorage.js` — `helm.sec.` / `helm-keystore`

They differ **only** in two constants (`ENC_PREFIX`, `DB_NAME`); `STORE_NAME` (`keys`) and
`KEY_ID` (`master`) are identical in all three. Three copies of the same crypto means a fix or
audit has to be applied three times and the copies can silently drift.

## Decision (from brainstorming)

**Scope = all three apps** (web included). Web's adapter is identical to desktop's; folding it in
makes `@nexusmd/web-adapters` the true single source. Web's constants are unchanged values, so its
edit is zero-behavior-change.

## Goal

One `createSecureStorageAdapter({ encPrefix, dbName, storeName?, keyId? })` factory in
`@nexusmd/web-adapters`. Each app's `adapters/secureStorage.js` becomes a one-line wrapper that
still exports `secureStorageAdapter`, so every downstream import (`main.jsx`, `sync.js`,
`cloud-auth.js`) is untouched. **Zero behavior change**: same prefixes, DB names, store/key ids,
and IndexedDB key material — existing encrypted entries keep decrypting.

## Non-goals

- No change to the crypto (same AES-GCM, non-extractable key, `b64(iv‖ciphertext)` format).
- No change to which namespace each app uses (web/desktop stay `nexusmd.*`, app stays `helm.*`).
- No native Keystore backend (still a separate deferred follow-up).
- No new runtime/dev dependencies (e.g. `fake-indexeddb`).

## Architecture

```
apps/web/src/adapters/secureStorage.js     ─┐
apps/desktop/src/adapters/secureStorage.js  ├─→ createSecureStorageAdapter(cfg)  (web-adapters)
apps/app/src/adapters/secureStorage.js     ─┘        ↓ closes over cfg
                                              openDb · getKey · encrypt · decrypt
                                              IndexedDB(cfg.dbName) · localStorage(cfg.encPrefix)
```

The factory is the only place crypto lives. Its config is captured in a closure, so the returned
`{ get, set, remove }` object behaves exactly like today's per-app adapter.

## Components

### 1. `packages/web-adapters/src/secure-storage.js` (new)

```js
export function createSecureStorageAdapter({ encPrefix, dbName, storeName = 'keys', keyId = 'master' }) { … }
```

- `openDb()` → `indexedDB.open(dbName, 1)`, creates object store `storeName` on upgrade.
- `getKey()` → reads `keyId` from the store; if absent, generates a non-extractable
  `AES-GCM` 256-bit key and persists the CryptoKey object.
- `encrypt(key, text)` / `decrypt(key, b64)` → fresh 12-byte IV per write; `b64(iv‖ciphertext)`.
- Returns `{ get, set, remove }`:
  - `get(key)` → `localStorage.getItem(encPrefix + key)`; `null` if absent; decrypt otherwise;
    `null` on any failure.
  - `set(key, value)` → `localStorage.setItem(encPrefix + key, encrypt(...))`; errors swallowed.
  - `remove(key)` → `localStorage.removeItem(encPrefix + key)`; errors swallowed.

Body is the existing proven code with the four constants replaced by the closure params.

### 2. `packages/web-adapters/src/index.js`

- Add `export { createSecureStorageAdapter } from './secure-storage.js'`.
- Update the header comment: remove `secureStorage` from the "stay in each app" list and note the
  crypto is now factory-shared (only the namespace constants differ per app).

### 3. Three app wrappers (each file becomes ~4 lines)

```js
// apps/app/src/adapters/secureStorage.js
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'
export const secureStorageAdapter = createSecureStorageAdapter({ encPrefix: 'helm.sec.', dbName: 'helm-keystore' })
```

web + desktop: identical except `encPrefix: 'nexusmd.sec.'`, `dbName: 'nexusmd-keystore'`.

Keep a one-line comment in each wrapper noting where ciphertext (localStorage) and the master key
(IndexedDB) live, so the security model is visible at the call site.

## Data flow

Unchanged from today. `sync.js` `keyStore.get('sync.keyhex')` and app `cloud-auth.js`
`writeAuth/clearAuth/hydrate` call the same `secureStorageAdapter.get/set/remove` — now backed by
the factory instead of a local copy.

## Error handling

Unchanged. `get` returns `null` on any failure (missing/rotated key, corrupt entry); `set`/`remove`
swallow errors. No plaintext fallback anywhere.

## Testing

`@nexusmd/web-adapters` already has a vitest project. The encrypt/decrypt round-trip cannot be
unit-tested in jsdom (no `crypto.subtle`, no IndexedDB) and we are not adding `fake-indexeddb`, so
that path stays **build-verified + manual** as it is today.

What we **can** and will test — the factory's actual responsibility, **namespace wiring**, via the
no-crypto code paths with a stubbed `localStorage`:

1. `get(key)` returns `null` when nothing is stored (reads localStorage, sees `null`, returns
   before touching crypto).
2. Two adapters built with different `encPrefix` operate on **different** prefixed localStorage
   keys: `remove('x')` on the `helm.sec.` adapter targets `helm.sec.x`, and on the `nexusmd.sec.`
   adapter targets `nexusmd.sec.x` — proving prefix isolation (the thing this refactor could
   break).

Plus the existing gate: `npm -w apps/{web,app} run build` green (desktop build not run in this
workspace — it prunes dev deps), and `npx vitest run packages/web-adapters` green.

## Verification (manual, unchanged behavior)

Because constants are byte-identical to the pre-dedup values, a user with existing encrypted
secrets sees no re-auth: the same IndexedDB DB/key and the same localStorage prefix resolve the
same ciphertext. Spot-check one app: secrets still decrypt after the swap.

## Follow-ups (unchanged)

- Native Keystore/Keychain backend (defends in-WebView code execution).
- KDF / per-secret salt for the sync passphrase.
