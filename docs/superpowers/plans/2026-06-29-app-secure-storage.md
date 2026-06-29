# App Secret Storage (Encryption at Rest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt every `apps/app` cloud secret (OAuth tokens + sync key hex) at rest behind the existing async `secureStorageAdapter`, so nothing is written to localStorage in plaintext.

**Architecture:** Port desktop's WebCrypto+IndexedDB `secureStorageAdapter` (non-extractable AES-GCM master key in IndexedDB, `b64(iv‖ciphertext)` in localStorage) into the app. Route `cloud-auth.js` token storage through it, backed by an in-memory `tokenCache` so the synchronous provider `isConnected()` contract is preserved. Hydrate the cache at startup and on profile switch. `sync.js` is unchanged — its `sync.keyhex` becomes encrypted for free.

**Tech Stack:** Vanilla browser JS, WebCrypto (`crypto.subtle`, AES-GCM), IndexedDB, Vite, Capacitor WebView.

## Global Constraints

- AES-GCM only; master key is **non-extractable** (`crypto.subtle.generateKey(..., false, ...)`).
- **Never** write a secret to storage in plaintext, not even as a fallback.
- NEVER log the passphrase, key hex, master key, or token values.
- App secret keyspace prefix: `helm.sec.` · IndexedDB DB name: `helm-keystore` · store: `keys` · key id: `master`.
- App namespace for profile keys stays `helm` (do not switch to `nexusmd` here).
- **Start fresh:** no dual-read of legacy plaintext `helm.<provider>.auth` keys.
- Provider `isConnected()` must remain **synchronous**.
- Apps have no vitest harness; jsdom lacks `crypto.subtle` and IndexedDB. Verification is `vite build` + manual acceptance, not unit tests.
- The generic cloud-auth event name is `nexusmd:cloud-auth-changed`.

---

### Task 1: Encrypted secure-storage adapter (port from desktop)

**Files:**
- Modify (full rewrite): `apps/app/src/adapters/secureStorage.js`
- Reference (do not edit): `apps/desktop/src/adapters/secureStorage.js`

**Interfaces:**
- Consumes: nothing (leaf module; uses browser `indexedDB`, `crypto.subtle`, `localStorage`).
- Produces: `export const secureStorageAdapter = { async get(key)->string|null, async set(key,value)->void, async remove(key)->void }` — same async contract the current fallback exposes, now encrypting at rest.

- [ ] **Step 1: Rewrite the adapter with WebCrypto + IndexedDB**

Replace the entire file contents:

```js
// secureStorage.js — encrypts app secrets at rest. A non-extractable AES-GCM
// master key lives in IndexedDB (structured-clone keeps it unexportable); only
// b64(iv‖ciphertext) is written to localStorage. Ported from apps/desktop with
// app-scoped constants. get() returns null on any failure (missing/rotated key,
// corrupt or legacy-plaintext entry) — which is the desired "start fresh" behavior.
const ENC_PREFIX = 'helm.sec.'
const DB_NAME    = 'helm-keystore'
const STORE_NAME = 'keys'
const KEY_ID     = 'master'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME)
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function getKey() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const st  = tx.objectStore(STORE_NAME)
    const get = st.get(KEY_ID)
    get.onsuccess = async () => {
      if (get.result) { resolve(get.result); return }
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      )
      const put = st.put(key, KEY_ID)
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

export const secureStorageAdapter = {
  async get(storageKey) {
    try {
      const raw = localStorage.getItem(ENC_PREFIX + storageKey)
      if (!raw) return null
      return await decrypt(await getKey(), raw)
    } catch { return null }
  },
  async set(storageKey, value) {
    try { localStorage.setItem(ENC_PREFIX + storageKey, await encrypt(await getKey(), value)) }
    catch { /* ignore */ }
  },
  async remove(storageKey) {
    try { localStorage.removeItem(ENC_PREFIX + storageKey) } catch { /* ignore */ }
  },
}
```

- [ ] **Step 2: Build-verify the app compiles**

Run: `npm -w apps/app run build`
Expected: build succeeds (no import/syntax errors).
DO NOT run `npm -w apps/desktop run build` in this workspace — it prunes dev deps.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/adapters/secureStorage.js
git commit -m "feat(app): encrypt secrets at rest (WebCrypto+IndexedDB adapter)"
```

---

### Task 2: Route cloud-auth tokens through the adapter (cache-backed)

**Files:**
- Modify: `apps/app/src/cloud-auth.js`

**Interfaces:**
- Consumes: `secureStorageAdapter` from Task 1; `getProfileKey` from `./profile-keys.js`.
- Produces:
  - `export async function hydrateCloudTokens(): Promise<void>` — decrypts each provider's stored auth into `tokenCache`, then dispatches `nexusmd:cloud-auth-changed`.
  - `export const appCloudProviders` — unchanged shape; each provider's `isConnected()` stays synchronous (reads `tokenCache`).
  - `export function registerCloudDeepLink(): void` — unchanged signature.

- [ ] **Step 1: Replace sync localStorage read/write/clear with cache + adapter**

Edit `apps/app/src/cloud-auth.js`. Add the adapter import after the existing imports:

```js
import { secureStorageAdapter } from './adapters/secureStorage.js'
```

Replace the `read`/`write`/`clear` block (currently lines ~17–26) with a cache-backed set:

```js
// tokenCache is keyed by the RESOLVED profile key so a profile switch can never
// return another profile's tokens. isConnected() reads the cache synchronously;
// the adapter (async, encrypted) is the durable store.
const tokenCache = new Map()
const resolveKey = (suffix) => getProfileKey('helm.' + suffix)

function readAuth(suffix) {
  const k = resolveKey(suffix)
  return k ? (tokenCache.get(k) || null) : null
}
async function writeAuth(suffix, auth) {
  const k = resolveKey(suffix)
  if (!k) return
  tokenCache.set(k, auth)
  await secureStorageAdapter.set(k, JSON.stringify(auth))
}
async function clearAuth(suffix) {
  const k = resolveKey(suffix)
  if (!k) return
  tokenCache.delete(k)
  await secureStorageAdapter.remove(k)
}
```

- [ ] **Step 2: Update `makeBinding` to use the cache-backed helpers**

Replace the `makeBinding` body so it awaits the async writers/clearers and dispatches the change event:

```js
function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(readAuth(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) return
        const { url } = await res.json()
        openBrowser(url)
      } catch {}
    },
    async disconnect() {
      await clearAuth(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async getToken({ force } = {}) {
      const auth = readAuth(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        await writeAuth(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}
```

- [ ] **Step 3: Update `redeem` to write through the adapter + dispatch**

In `redeem(url)`, replace the `write(cfg.keySuffix, { accessToken, refreshToken })` line and the reload with:

```js
    await writeAuth(cfg.keySuffix, { accessToken, refreshToken })
    window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    window.location.reload()
```

- [ ] **Step 4: Add `hydrateCloudTokens` export**

Add near the bottom, before `appCloudProviders`:

```js
// Decrypt each provider's stored auth into the in-memory cache. Called at startup
// and after a profile switch; dispatches so the settings card re-reads state.
export async function hydrateCloudTokens() {
  for (const cfg of Object.values(PROVIDERS)) {
    const k = resolveKey(cfg.keySuffix)
    if (!k) continue
    try {
      const raw = await secureStorageAdapter.get(k)
      if (raw) tokenCache.set(k, JSON.parse(raw))
      else tokenCache.delete(k)
    } catch { tokenCache.delete(k) }
  }
  window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
}
```

- [ ] **Step 5: Build-verify**

Run: `npm -w apps/app run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/cloud-auth.js
git commit -m "feat(app): cloud tokens through encrypted adapter + in-memory cache"
```

---

### Task 3: Hydrate at startup and on profile switch

**Files:**
- Modify: `apps/app/src/app.jsx` (where `registerCloudDeepLink()` / `startAppAutoSync()` are wired, ~line 2985, and the profile-switch handler)

**Interfaces:**
- Consumes: `hydrateCloudTokens` from Task 2.
- Produces: cache populated before the first connection-state read; re-populated on profile switch.

- [ ] **Step 1: Import and call at startup**

Add `hydrateCloudTokens` to the existing `cloud-auth.js` import in `app.jsx`. Where `registerCloudDeepLink()` is called near render, add a fire-and-forget hydrate:

```js
registerCloudDeepLink()
hydrateCloudTokens()
```

(Fire-and-forget is fine: `isConnected()` reads an empty cache as "not connected" until hydration resolves, then `nexusmd:cloud-auth-changed` re-renders the card.)

- [ ] **Step 2: Re-hydrate on profile switch**

Find the profile-switch handler (where the app re-resolves the active profile id). After the active profile changes, call:

```js
hydrateCloudTokens()
```

If no single switch handler exists, search for where `getActiveProfileId` / active-profile state updates and add it there. Verify the call site with: `grep -n "ActiveProfile\|active.*profile\|switchProfile" apps/app/src/app.jsx`.

- [ ] **Step 3: Build-verify**

Run: `npm -w apps/app run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app.jsx
git commit -m "feat(app): hydrate cloud token cache at startup and on profile switch"
```

---

### Task 4: CloudSyncCard reacts to `nexusmd:cloud-auth-changed`

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx` (the shared `CloudSyncCard`)
- Test: `packages/ui/tests/` (only if a render harness already exercises the card; otherwise build-verify)

**Interfaces:**
- Consumes: window event `nexusmd:cloud-auth-changed` dispatched by Task 2/3.
- Produces: the card re-renders (re-reads each provider's synchronous `isConnected()`) when the event fires.

- [ ] **Step 1: Add a listener that forces a re-read**

In `CloudSyncCard`, locate the existing effect that subscribes to sync state (or add a new `useEffect`). Add a listener that bumps a render tick:

```jsx
useEffect(() => {
  const onAuth = () => setAuthTick(t => t + 1) // force re-read of provider.isConnected()
  window.addEventListener('nexusmd:cloud-auth-changed', onAuth)
  return () => window.removeEventListener('nexusmd:cloud-auth-changed', onAuth)
}, [])
```

Add the `const [authTick, setAuthTick] = useState(0)` declaration alongside the card's other state. If the card already derives connection state inside render from `providers.map(p => p.isConnected())`, the tick bump is sufficient; if it caches connection state in `useState`, recompute it inside the same listener instead of `setAuthTick`.

- [ ] **Step 2: Build-verify ui + app**

Run: `npm -w packages/ui run build && npm -w apps/app run build`
Expected: both succeed.
(If `packages/ui` has no build script, run `npm test -w packages/ui` to confirm the package still loads.)

- [ ] **Step 3: Run the ui test suite**

Run: `npx vitest run packages/ui`
Expected: existing suites pass (no regressions from the new hook).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx
git commit -m "feat(ui): CloudSyncCard re-reads connection on nexusmd:cloud-auth-changed"
```

---

### Task 5: Manual acceptance + spec follow-up note

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-app-secure-storage-design.md` (mark status delivered; note manual-acceptance result)

**Interfaces:**
- Consumes: the built app.
- Produces: a recorded acceptance result.

- [ ] **Step 1: Manual acceptance checklist (record results in the spec)**

On a device/emulator build:
1. Connect Google Drive → inspect localStorage: only `helm.sec.*` base64 blobs, **no** plaintext token, **no** legacy `helm.gdrive.auth`.
2. Restart the app → Drive still shows connected (cache hydrated from ciphertext).
3. Set the sync passphrase → `helm.sec.<resolved sync.keyhex>` is ciphertext; run a sync → succeeds.
4. Switch profile → connection state reflects the new profile, not a leak from the previous one.
5. Disconnect → entry removed; card flips to disconnected without reload.

- [ ] **Step 2: Record outcome and mark the spec delivered**

Update the spec's status line to `delivered` and append a short "Acceptance" note with the observed results (or any deviation found).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-29-app-secure-storage-design.md
git commit -m "docs: app secret storage delivered + acceptance notes"
```

---

## Self-Review

**Spec coverage:**
- "Rewrite adapter (WebCrypto+IndexedDB)" → Task 1. ✔
- "Refactor cloud-auth: writeAuth/clearAuth/readAuth + tokenCache keyed by resolved key" → Task 2. ✔
- "hydrateCloudTokens at startup + profile switch" → Tasks 2 (export) + 3 (call sites). ✔
- "sync.js unchanged" → no task touches it (intentional). ✔
- "CloudSyncCard listens to nexusmd:cloud-auth-changed" → Task 4. ✔
- "Start fresh / no dual-read" → Task 1 separate `helm.sec.` keyspace; no migration task. ✔
- "Build-verified only; manual acceptance" → Task 5. ✔
- Known limitation / follow-ups → documentation only, already in spec.

**Type consistency:** `readAuth`/`writeAuth`/`clearAuth`/`resolveKey`/`tokenCache`/`hydrateCloudTokens` names used identically across Tasks 2 and 3. Event name `nexusmd:cloud-auth-changed` identical across Tasks 2, 3, 4. Adapter contract `get/set/remove` identical between Tasks 1 and 2.

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 3 step 2 and Task 4 step 1 contain a conditional ("if no single handler / if card caches in state") because the exact call site must be confirmed in-file — each gives the exact grep to resolve it, not a vague instruction.
