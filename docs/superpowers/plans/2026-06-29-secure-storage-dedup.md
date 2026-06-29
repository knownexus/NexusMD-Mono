# Secure-Storage Adapter Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three byte-identical `secureStorageAdapter` copies with a single `createSecureStorageAdapter` factory in `@nexusmd/web-adapters`, parameterized by the two namespace constants that differ.

**Architecture:** A factory closes over `{ encPrefix, dbName, storeName, keyId }` and returns the same `{ get, set, remove }` adapter. Each app's `adapters/secureStorage.js` becomes a one-line wrapper that still exports `secureStorageAdapter`, so all downstream imports are untouched and existing encrypted data keeps decrypting (constants unchanged).

**Tech Stack:** Vanilla browser JS, WebCrypto (AES-GCM), IndexedDB, vitest + jsdom (web-adapters), Vite.

## Global Constraints

- Same crypto: AES-GCM, **non-extractable** master key, `b64(iv‖ciphertext)` format.
- Zero behavior change: web/desktop keep `nexusmd.sec.` / `nexusmd-keystore`; app keeps `helm.sec.` / `helm-keystore`; `storeName='keys'`, `keyId='master'` everywhere.
- Each app still exports `secureStorageAdapter` from `apps/<app>/src/adapters/secureStorage.js` (downstream imports unchanged).
- No plaintext fallback. NEVER log key/secret values.
- No new runtime/dev dependencies (no `fake-indexeddb`).
- DO NOT run `npm -w apps/desktop run build` in this workspace — it prunes dev deps.

---

### Task 1: `createSecureStorageAdapter` factory + namespace-wiring test

**Files:**
- Create: `packages/web-adapters/src/secure-storage.js`
- Modify: `packages/web-adapters/src/index.js`
- Create: `packages/web-adapters/tests/secure-storage.test.js`
- Reference (don't edit): `apps/web/src/adapters/secureStorage.js` (source of the proven crypto)

**Interfaces:**
- Consumes: browser `indexedDB`, `crypto.subtle`, `localStorage`.
- Produces: `export function createSecureStorageAdapter({ encPrefix, dbName, storeName = 'keys', keyId = 'master' }) -> { async get(key)->string|null, async set(key,value)->void, async remove(key)->void }`.

- [ ] **Step 1: Write the failing test (namespace wiring, no crypto paths)**

Create `packages/web-adapters/tests/secure-storage.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createSecureStorageAdapter } from '../src/index.js'

const helm    = createSecureStorageAdapter({ encPrefix: 'helm.sec.',    dbName: 'helm-keystore' })
const nexusmd = createSecureStorageAdapter({ encPrefix: 'nexusmd.sec.', dbName: 'nexusmd-keystore' })

describe('createSecureStorageAdapter (namespace wiring)', () => {
  beforeEach(() => localStorage.clear())

  it('get returns null when nothing is stored (no crypto touched)', async () => {
    expect(await helm.get('missing')).toBe(null)
  })

  it('remove targets the prefixed key and leaves other namespaces untouched', async () => {
    localStorage.setItem('helm.sec.x', 'cipher-a')
    localStorage.setItem('nexusmd.sec.x', 'cipher-b')
    await helm.remove('x')
    expect(localStorage.getItem('helm.sec.x')).toBe(null)        // removed
    expect(localStorage.getItem('nexusmd.sec.x')).toBe('cipher-b') // untouched
  })

  it('exposes the get/set/remove contract', () => {
    for (const m of ['get', 'set', 'remove']) expect(typeof helm[m]).toBe('function')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web-adapters tests/secure-storage.test.js`
Expected: FAIL — `createSecureStorageAdapter` is not exported from `../src/index.js`.

- [ ] **Step 3: Create the factory**

Create `packages/web-adapters/src/secure-storage.js`:

```js
// secure-storage.js — factory for the WebCrypto+IndexedDB secure adapter shared by
// web, desktop, and app. A non-extractable AES-GCM master key lives in IndexedDB
// (structured-clone keeps it unexportable); only b64(iv‖ciphertext) is written to
// localStorage under `${encPrefix}${key}`. get() returns null on any failure.
export function createSecureStorageAdapter({ encPrefix, dbName, storeName = 'keys', keyId = 'master' }) {
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName)
      req.onsuccess = (e) => resolve(e.target.result)
      req.onerror   = (e) => reject(e.target.error)
    })
  }

  async function getKey() {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite')
      const st  = tx.objectStore(storeName)
      const get = st.get(keyId)
      get.onsuccess = async () => {
        if (get.result) { resolve(get.result); return }
        const key = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        )
        const put = st.put(key, keyId)
        put.onsuccess = () => resolve(key)
        put.onerror   = (e) => reject(e.target.error)
      }
      get.onerror = (e) => reject(e.target.error)
    })
  }

  async function encrypt(key, text) {
    const iv  = crypto.getRandomValues(new Uint8Array(12))
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
    const buf = new Uint8Array(12 + ct.byteLength)
    buf.set(iv)
    buf.set(new Uint8Array(ct), 12)
    return btoa(String.fromCharCode(...buf))
  }

  async function decrypt(key, b64) {
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
    return new TextDecoder().decode(pt)
  }

  return {
    async get(storageKey) {
      try {
        const raw = localStorage.getItem(encPrefix + storageKey)
        if (!raw) return null
        return await decrypt(await getKey(), raw)
      } catch { return null }
    },
    async set(storageKey, value) {
      try { localStorage.setItem(encPrefix + storageKey, await encrypt(await getKey(), value)) }
      catch { /* ignore */ }
    },
    async remove(storageKey) {
      try { localStorage.removeItem(encPrefix + storageKey) } catch { /* ignore */ }
    },
  }
}
```

- [ ] **Step 4: Export it and update the index header comment**

In `packages/web-adapters/src/index.js`, change the header comment line listing per-app adapters and add the export. Replace:

```js
// Platform-specific adapters (file, picker, secureStorage, auth, badge, deepLink,
// tray, navigation, http, update) stay in each app; only the universal browser
// ones live here.
```

with:

```js
// Platform-specific adapters (file, picker, auth, badge, deepLink, tray,
// navigation, http, update) stay in each app; only the universal browser ones
// live here. secureStorage is factory-shared: createSecureStorageAdapter holds
// the crypto; each app passes only its namespace constants.
```

Then add after the `localStorageAdapter` export line:

```js
export { createSecureStorageAdapter } from './secure-storage.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/web-adapters tests/secure-storage.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full web-adapters suite (no regressions)**

Run: `npx vitest run packages/web-adapters`
Expected: PASS (existing storage contract + the 3 new tests).

- [ ] **Step 7: Commit**

```bash
git add packages/web-adapters/src/secure-storage.js packages/web-adapters/src/index.js packages/web-adapters/tests/secure-storage.test.js
git commit -m "feat(web-adapters): createSecureStorageAdapter factory (dedup secure storage)"
```

---

### Task 2: Rewrite the three app adapters as factory wrappers

**Files:**
- Modify (full rewrite): `apps/web/src/adapters/secureStorage.js`
- Modify (full rewrite): `apps/desktop/src/adapters/secureStorage.js`
- Modify (full rewrite): `apps/app/src/adapters/secureStorage.js`

**Interfaces:**
- Consumes: `createSecureStorageAdapter` from `@nexusmd/web-adapters` (Task 1).
- Produces: each file still `export const secureStorageAdapter` — same shape, same downstream imports.

- [ ] **Step 1: Rewrite the web wrapper**

Replace the entire contents of `apps/web/src/adapters/secureStorage.js`:

```js
// Encrypts app secrets at rest: ciphertext in localStorage under `nexusmd.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`nexusmd-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'

export const secureStorageAdapter = createSecureStorageAdapter({
  encPrefix: 'nexusmd.sec.',
  dbName: 'nexusmd-keystore',
})
```

- [ ] **Step 2: Rewrite the desktop wrapper**

Replace the entire contents of `apps/desktop/src/adapters/secureStorage.js`:

```js
// Encrypts app secrets at rest: ciphertext in localStorage under `nexusmd.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`nexusmd-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'

export const secureStorageAdapter = createSecureStorageAdapter({
  encPrefix: 'nexusmd.sec.',
  dbName: 'nexusmd-keystore',
})
```

- [ ] **Step 3: Rewrite the app wrapper**

Replace the entire contents of `apps/app/src/adapters/secureStorage.js`:

```js
// Encrypts app secrets at rest: ciphertext in localStorage under `helm.sec.*`,
// non-extractable AES-GCM master key in IndexedDB (`helm-keystore`). Crypto is
// shared via @nexusmd/web-adapters; only the namespace constants are app-specific.
import { createSecureStorageAdapter } from '@nexusmd/web-adapters'

export const secureStorageAdapter = createSecureStorageAdapter({
  encPrefix: 'helm.sec.',
  dbName: 'helm-keystore',
})
```

- [ ] **Step 4: Build-verify web and app**

Run: `npm -w apps/web run build && npm -w apps/app run build`
Expected: both succeed (factory import resolves through workspaces).
(Desktop is not built here — it prunes dev deps. Its wrapper is identical to web's verified one.)

- [ ] **Step 5: Confirm desktop wrapper is syntactically loadable via the workspace**

Run: `node --input-type=module -e "import('@nexusmd/web-adapters').then(m => console.log(typeof m.createSecureStorageAdapter))"`
Expected: prints `function` (the export desktop's wrapper depends on resolves).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/adapters/secureStorage.js apps/desktop/src/adapters/secureStorage.js apps/app/src/adapters/secureStorage.js
git commit -m "refactor(apps): secureStorage wrappers use shared createSecureStorageAdapter"
```

---

## Self-Review

**Spec coverage:**
- "Factory `createSecureStorageAdapter({ encPrefix, dbName, storeName?, keyId? })`" → Task 1 Step 3. ✔
- "Export from index.js + update header comment" → Task 1 Step 4. ✔
- "Three app wrappers, still export secureStorageAdapter, zero behavior change" → Task 2 Steps 1–3. ✔
- "Namespace-wiring test (empty-get→null, prefix isolation) on no-crypto paths" → Task 1 Step 1. ✔
- "Round-trip stays build-verified+manual; no fake-indexeddb" → no round-trip test added; builds in Task 2 Step 4. ✔
- "Same constants → existing ciphertext keeps decrypting" → constants copied verbatim (nexusmd.* / helm.*). ✔
- "No new deps" → only an intra-repo import added. ✔

**Placeholder scan:** No TBD/TODO; every code step shows full file contents. No "similar to" references — each wrapper is written out in full.

**Type consistency:** `createSecureStorageAdapter` name and its `{ encPrefix, dbName, storeName?, keyId? }` param shape are identical across Task 1 (definition + test) and Task 2 (all three callers). Returned `{ get, set, remove }` matches the existing `secureStorageAdapter` contract consumed by `main.jsx`/`sync.js`/`cloud-auth.js`.
