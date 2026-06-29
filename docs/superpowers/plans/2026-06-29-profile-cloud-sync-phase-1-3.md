# Profile Cloud Sync (Google Drive + OneDrive) — Phases 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual upload/download of the encrypted `.nmdprofile` bundle to/from Google Drive and OneDrive on the **web** platform, with all cloud file-operation logic in shared, unit-tested `@nexusmd/ui` factories and the OAuth token exchange in the web ASP.NET backend.

**Architecture:** A `cloudProvider` seam (sibling of Feature A's `fileIO`) is implemented by two shared factories — `makeGoogleDriveProvider` / `makeOneDriveProvider` — that perform find-or-create `/NexusMD` + list/upload/download via `fetch`, given an injected `authBinding`. The shared `BackupRestoreCard` gains cloud actions driven by injected provider objects. The web backend gains `GoogleAuthController` + `MicrosoftAuthController` (built from scratch — they do not exist today) that broker OAuth so client secrets stay server-side. App + desktop wiring (deep-link / loopback auth) is explicitly **out of scope** for this plan (Phases 4–5 of the spec).

**Tech Stack:** JS ESM, React 18 (via `React.createElement` alias `h`), Vitest + @testing-library/react (jsdom); ASP.NET (net8.0) primary-constructor controllers, xUnit + `WebApplicationFactory`. Reuses Feature A: `encodeBundle`/`decodeBundle` (`@nexusmd/core`), `exportBundle`/`importBundle` (`@nexusmd/ui` profile provider), `BackupRestoreCard`/`BundlePasswordModal`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-profile-cloud-sync-design.md`.
- Bundle format/crypto is **unchanged** — cloud only changes transport. Never re-implement encryption.
- Cloud files live in a **user-visible `/NexusMD` folder** in the account root. Scopes: Google `https://www.googleapis.com/auth/drive.file`; Microsoft Graph `Files.ReadWrite offline_access openid email`.
- Manual push/pull only — no auto-sync, no conflict resolution.
- Client secrets **never** leave the backend and must never appear in any HTTP response or any `/auth/url` string.
- Web is same-origin with the backend: the SPA receives the OAuth `code` on its own redirect and POSTs it to the backend callback (the spec's one-time-code exchange is only for app/desktop — Phases 4–5, not this plan).
- Token storage (web): per-profile localStorage `nexusmd.p.<id>.gdrive.auth` and `nexusmd.p.<id>.onedrive.auth` = `{ accessToken, refreshToken, email? }`, keyed via the existing `getProfileKey` from `apps/web/src/profile-keys.js`.
- `authBinding` contract (consumed by the shared factories):
  ```
  authBinding = {
    isConnected(): boolean,
    connect(): Promise<void>,
    disconnect(): Promise<void>,
    getToken({ force } = {}): Promise<string|null>,  // force:true refreshes first
  }
  ```
- Run all JS tests with `npx vitest run` from the repo root (`C:/repos/NexusMD-Mono`). Run backend tests with `dotnet test apps/web/NexusMDWeb.sln`. If a backend build hits a file lock (MSB3027), the dev API host is running — `tasklist | grep -i NexusMD` then `taskkill //PID <pid> //F` and retry.

---

## File Structure

- `packages/ui/src/cloud/providers.js` — **new.** `makeGoogleDriveProvider(authBinding)` and `makeOneDriveProvider(authBinding)`; shared `/NexusMD` find-or-create + list/upload/download.
- `packages/ui/src/views/view-settings.jsx` — **modify.** Add `CloudPickerModal`; extend `BackupRestoreCard` with a `cloudProviders` prop + cloud actions.
- `packages/ui/src/index.js` — **modify.** Barrel-export the provider factories (and `CloudPickerModal`).
- `packages/ui/tests/cloud-providers.test.jsx` — **new.** Factory unit tests (mock `fetch`).
- `packages/ui/tests/cloud-card.test.jsx` — **new.** Card cloud-action + picker tests (mock providers).
- `apps/web/server/Controllers/GoogleAuthController.cs` — **new.** `/api/google/auth/url|callback|refresh`.
- `apps/web/server/Controllers/MicrosoftAuthController.cs` — **new.** `/api/ms/auth/url|callback|refresh`.
- `apps/web/server/Services/OAuth/ITokenExchanger.cs` + `HttpTokenExchanger.cs` — **new.** Shared, injectable token-endpoint POST (mockable in tests).
- `apps/web/server/Program.cs` — **modify.** `AddHttpClient()` + register `ITokenExchanger`.
- `apps/web/server-tests/GoogleAuthControllerTests.cs` + `MicrosoftAuthControllerTests.cs` — **new.**
- `apps/web/src/cloud-auth.js` — **new.** Web `authBinding`s for both providers + OAuth callback handling; constructs the two providers.
- `apps/web/src/view-settings.jsx` — **modify.** Pass `cloudProviders` into `BackupRestoreCard`.

---

## Phase 1 — Shared provider factories + UI (`@nexusmd/ui`)

### Task 1: Google Drive provider factory

**Files:**
- Create: `packages/ui/src/cloud/providers.js`
- Test: `packages/ui/tests/cloud-providers.test.jsx`

**Interfaces:**
- Consumes: an `authBinding` (see Global Constraints).
- Produces: `makeGoogleDriveProvider(authBinding) → { id:'gdrive', label:'Google Drive', isConnected, connect, disconnect, list(): Promise<Array<{id,name,modifiedAt}>>, upload(name,text): Promise<void>, download(id): Promise<string> }`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/cloud-providers.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeGoogleDriveProvider } from '../src/index.js'

function authStub(token = 'tok') {
  return {
    isConnected: () => true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getToken: vi.fn(async () => token),
  }
}

// Build a fetch mock that matches by URL substring → { status, json|text }.
function fetchRouter(routes) {
  return vi.fn(async (url, opts) => {
    for (const r of routes) {
      if (url.includes(r.match) && (!r.method || (opts?.method || 'GET') === r.method)) {
        return {
          ok: (r.status ?? 200) < 400,
          status: r.status ?? 200,
          json: async () => r.json ?? {},
          text: async () => r.text ?? '',
        }
      }
    }
    throw new Error('unexpected fetch: ' + (opts?.method || 'GET') + ' ' + url)
  })
}

describe('makeGoogleDriveProvider', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lists .nmdprofile files in /NexusMD (creating the folder if missing)', async () => {
    global.fetch = fetchRouter([
      // folder lookup → none found
      { match: "drive/v3/files?q=name%3D'NexusMD'", json: { files: [] } },
      // folder create
      { match: 'drive/v3/files', method: 'POST', json: { id: 'FID' } },
      // children list
      { match: "'FID'%20in%20parents", json: { files: [
        { id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedTime: '2026-06-29T10:00:00Z' },
      ] } },
    ])
    const p = makeGoogleDriveProvider(authStub())
    const list = await p.list()
    expect(list).toEqual([
      { id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedAt: '2026-06-29T10:00:00Z' },
    ])
  })

  it('downloads a file body as text', async () => {
    global.fetch = fetchRouter([{ match: 'files/a?alt=media', text: 'CIPHERTEXT' }])
    const p = makeGoogleDriveProvider(authStub())
    expect(await p.download('a')).toBe('CIPHERTEXT')
  })

  it('refreshes the token once on 401 then retries', async () => {
    const auth = authStub('stale')
    let calls = 0
    global.fetch = vi.fn(async (url) => {
      calls++
      if (calls === 1) return { ok: false, status: 401, json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, text: async () => 'OK', json: async () => ({}) }
    })
    const p = makeGoogleDriveProvider(auth)
    expect(await p.download('a')).toBe('OK')
    expect(auth.getToken).toHaveBeenCalledWith({ force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/cloud-providers.test.jsx`
Expected: FAIL — `makeGoogleDriveProvider is not exported` / not a function.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/ui/src/cloud/providers.js
// Shared cloud-provider factories for profile bundles. Platform-agnostic file
// operations against a user-visible /NexusMD folder; the only injected piece is
// the platform authBinding ({ isConnected, connect, disconnect, getToken }).
const FOLDER = 'NexusMD'

// Run an authorized fetch; on 401 refresh the token once and retry.
async function authedFetch(authBinding, url, opts = {}) {
  const run = async (token) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  let token = await authBinding.getToken()
  let res = await run(token)
  if (res.status === 401) {
    token = await authBinding.getToken({ force: true })
    res = await run(token)
  }
  if (!res.ok) throw new Error(`cloud request failed (${res.status})`)
  return res
}

export function makeGoogleDriveProvider(authBinding) {
  let folderId = null

  async function ensureFolder() {
    if (folderId) return folderId
    const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
    const found = await (await authedFetch(authBinding,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).json()
    if (found.files && found.files.length) { folderId = found.files[0].id; return folderId }
    const created = await (await authedFetch(authBinding,
      'https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      })).json()
    folderId = created.id
    return folderId
  }

  async function findFileByName(name) {
    const fid = await ensureFolder()
    const q = encodeURIComponent(`'${fid}' in parents and name='${name}' and trashed=false`)
    const r = await (await authedFetch(authBinding,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).json()
    return r.files && r.files.length ? r.files[0].id : null
  }

  return {
    id: 'gdrive',
    label: 'Google Drive',
    isConnected: authBinding.isConnected,
    connect: authBinding.connect,
    disconnect: authBinding.disconnect,

    async list() {
      const fid = await ensureFolder()
      const q = encodeURIComponent(`'${fid}' in parents and trashed=false`)
      const r = await (await authedFetch(authBinding,
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`)).json()
      return (r.files || [])
        .filter(f => f.name.endsWith('.nmdprofile'))
        .map(f => ({ id: f.id, name: f.name, modifiedAt: f.modifiedTime }))
    },

    async upload(name, text) {
      const fid = await ensureFolder()
      const existing = await findFileByName(name)
      if (existing) {
        await authedFetch(authBinding,
          `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
          })
        return
      }
      const boundary = 'nmd-' + Math.random().toString(36).slice(2)
      const metadata = JSON.stringify({ name, parents: [fid] })
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`
      await authedFetch(authBinding,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        })
    },

    async download(id) {
      const r = await authedFetch(authBinding,
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
      return r.text()
    },
  }
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/ui/src/index.js`, after the `profile-context.jsx` export block (around line 29), add:

```js
// Cloud-sync provider factories (Google Drive / OneDrive) for profile bundles.
export { makeGoogleDriveProvider, makeOneDriveProvider } from './cloud/providers.js'
```

(`makeOneDriveProvider` is added in Task 2; export both now — the import resolves once Task 2 lands. If running Task 1 in isolation, temporarily export only `makeGoogleDriveProvider` and add `makeOneDriveProvider` in Task 2.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/cloud-providers.test.jsx`
Expected: the three Drive tests PASS. (If `makeOneDriveProvider` import fails, restrict the barrel to `makeGoogleDriveProvider` until Task 2.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/cloud/providers.js packages/ui/src/index.js packages/ui/tests/cloud-providers.test.jsx
git commit -m "feat(ui): Google Drive cloud-provider factory for profile bundles"
```

---

### Task 2: OneDrive (Microsoft Graph) provider factory

**Files:**
- Modify: `packages/ui/src/cloud/providers.js`
- Test: `packages/ui/tests/cloud-providers.test.jsx` (add a describe block)

**Interfaces:**
- Consumes: `authBinding` + the `authedFetch` helper from Task 1.
- Produces: `makeOneDriveProvider(authBinding) → { id:'onedrive', label:'OneDrive', isConnected, connect, disconnect, list, upload, download }` (same shape as Task 1).

- [ ] **Step 1: Write the failing test (append to cloud-providers.test.jsx)**

```jsx
describe('makeOneDriveProvider', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lists .nmdprofile files in /NexusMD', async () => {
    global.fetch = fetchRouter([
      { match: 'root:/NexusMD:/children', json: { value: [
        { id: 'x', name: 'nexusmd-profile-work.nmdprofile', lastModifiedDateTime: '2026-06-28T09:00:00Z' },
        { id: 'y', name: 'notes.txt', lastModifiedDateTime: '2026-06-28T09:00:00Z' },
      ] } },
    ])
    const p = makeOneDriveProvider(authStub())
    expect(await p.list()).toEqual([
      { id: 'x', name: 'nexusmd-profile-work.nmdprofile', modifiedAt: '2026-06-28T09:00:00Z' },
    ])
  })

  it('uploads by path (create-or-overwrite)', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    })
    const p = makeOneDriveProvider(authStub())
    await p.upload('nexusmd-backup-2026-06-29.nmdprofile', 'CIPHER')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toContain("root:/NexusMD/nexusmd-backup-2026-06-29.nmdprofile:/content")
  })

  it('downloads item content as text', async () => {
    global.fetch = fetchRouter([{ match: 'items/x/content', text: 'CIPHER' }])
    const p = makeOneDriveProvider(authStub())
    expect(await p.download('x')).toBe('CIPHER')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/cloud-providers.test.jsx`
Expected: FAIL — `makeOneDriveProvider is not a function`.

- [ ] **Step 3: Write minimal implementation (append to providers.js)**

```js
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive'

export function makeOneDriveProvider(authBinding) {
  return {
    id: 'onedrive',
    label: 'OneDrive',
    isConnected: authBinding.isConnected,
    connect: authBinding.connect,
    disconnect: authBinding.disconnect,

    async list() {
      // Path addressing auto-no-ops if folder is absent → treat 404 as empty.
      let res
      try {
        res = await authedFetch(authBinding,
          `${GRAPH}/root:/${FOLDER}:/children?$select=id,name,lastModifiedDateTime`)
      } catch (e) {
        if (String(e.message).includes('(404)')) return []
        throw e
      }
      const r = await res.json()
      return (r.value || [])
        .filter(f => f.name.endsWith('.nmdprofile'))
        .map(f => ({ id: f.id, name: f.name, modifiedAt: f.lastModifiedDateTime }))
    },

    async upload(name, text) {
      // PUT to a path creates the file and any missing parent folders.
      await authedFetch(authBinding,
        `${GRAPH}/root:/${FOLDER}/${encodeURIComponent(name)}:/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        })
    },

    async download(id) {
      const r = await authedFetch(authBinding, `${GRAPH}/items/${id}/content`)
      return r.text()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/tests/cloud-providers.test.jsx`
Expected: all Drive + OneDrive tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/cloud/providers.js packages/ui/tests/cloud-providers.test.jsx
git commit -m "feat(ui): OneDrive (Graph) cloud-provider factory for profile bundles"
```

---

### Task 3: Cloud actions + picker in `BackupRestoreCard`

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx`
- Modify: `packages/ui/src/index.js` (export `CloudPickerModal`)
- Test: `packages/ui/tests/cloud-card.test.jsx`

**Interfaces:**
- Consumes: `useProfile()` → `exportBundle`/`importBundle` (Feature A); a `cloudProviders` array of provider objects (Tasks 1–2 shape); the existing `BundlePasswordModal`.
- Produces: `BackupRestoreCard({ fileIO, showExportSingle, cloudProviders })`; `CloudPickerModal({ open, files, onClose, onPick })`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/cloud-card.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, BackupRestoreCard } from '../src/index.js'

afterEach(cleanup)

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null,
  }
}

function provStub(over = {}) {
  return {
    id: 'gdrive', label: 'Google Drive',
    isConnected: () => true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    list: vi.fn(async () => [{ id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedAt: '2026-06-29T10:00:00Z' }]),
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => ''),
    ...over,
  }
}

function harness(provider) {
  const storage = makeStorage({
    'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
    'helm.activeProfileId': 'p1',
    'helm.p.p1.tweaks': '{"dark":true}',
  })
  const ui = render(
    <ProfileProvider namespace="helm" storage={storage} store={{ create: () => {} }}>
      <BackupRestoreCard fileIO={{ saveFile: vi.fn(), pickFile: vi.fn() }} cloudProviders={[provider]} />
    </ProfileProvider>,
  )
  return ui
}

describe('BackupRestoreCard cloud actions', () => {
  it('uploads an encrypted bundle to a connected provider after a password', async () => {
    const provider = provStub()
    const { getByText, container } = harness(provider)
    await act(async () => { getByText('Save backup to Google Drive').click() })
    const inputs = container.querySelectorAll('input[type="password"]')
    await act(async () => {
      inputs[0].value = 'pw'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].value = 'pw'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { getByText('Export').click() })
    await vi.waitFor(() => expect(provider.upload).toHaveBeenCalledTimes(1))
    expect(provider.upload.mock.calls[0][0]).toMatch(/\.nmdprofile$/)
    expect(provider.upload.mock.calls[0][1]).toContain('nexusmd-profile-bundle-enc')
  })

  it('lists cloud files when Restore is clicked', async () => {
    const provider = provStub()
    const { getByText } = harness(provider)
    await act(async () => { getByText('Restore from Google Drive').click() })
    await vi.waitFor(() => expect(provider.list).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(getByText('nexusmd-backup-2026-06-29.nmdprofile')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/cloud-card.test.jsx`
Expected: FAIL — no "Save backup to Google Drive" button (card ignores `cloudProviders`).

- [ ] **Step 3: Add `CloudPickerModal` (in view-settings.jsx, just above `BackupRestoreCard`)**

```jsx
// A small list modal for choosing a cloud backup to restore.
function CloudPickerModal({ open, label, files, busy, onClose, onPick }) {
  if (!open) return null;
  return (
    <PlModal open onClose={onClose} icon="inbox"
      title={`Restore from ${label}`}
      sub="Choose a backup file to download and import."
      footer={<button className="btn ghost" onClick={onClose}>Cancel</button>}>
      {busy && <div className="plm-callout">Loading…</div>}
      {!busy && (!files || files.length === 0) && (
        <div className="plm-callout">No backups found in {label}.</div>
      )}
      {!busy && files && files.map(f => (
        <button key={f.id} className="btn sm" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}
          onClick={() => onPick(f)}>
          <span>{f.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(f.modifiedAt || '').slice(0, 10)}</span>
        </button>
      ))}
    </PlModal>
  );
}
```

- [ ] **Step 4: Extend `BackupRestoreCard` to render cloud actions**

Change the `BackupRestoreCard` signature and body. Replace the function declaration line:

```jsx
function BackupRestoreCard({ fileIO, showExportSingle = true }) {
```

with:

```jsx
function BackupRestoreCard({ fileIO, showExportSingle = true, cloudProviders = [] }) {
```

Add cloud state next to the existing `useStateVS` hooks inside the component (after `const [busy, setBusy] = useStateVS(false);`):

```jsx
  const [cloudTarget, setCloudTarget] = useStateVS(null);     // provider for the active password flow
  const [picker, setPicker] = useStateVS(null);               // { provider, files } | { provider, busy }

  const startCloudExport = (provider) => { setMode('export-all'); setPendingText('all'); setCloudTarget(provider); };
  const startCloudRestore = async (provider) => {
    setPicker({ provider, busy: true, files: null });
    try { const files = await provider.list(); setPicker({ provider, busy: false, files }); }
    catch (e) { toast?.(e?.message || `Couldn't reach ${provider.label}.`, 'error'); setPicker(null); }
  };
  const onPickCloudFile = async (file) => {
    const provider = picker.provider;
    setPicker(null);
    try {
      const text = await provider.download(file.id);
      setPendingText(text); setMode('import'); setCloudTarget(null);
    } catch (e) { toast?.(e?.message || 'Download failed.', 'error'); }
  };
```

Then modify the existing `onPassword` handler so an export with a `cloudTarget` uploads instead of saving locally. Replace its `else` branch (the export branch) body with:

```jsx
      } else {
        const scope = mode === 'export-all' ? 'all' : (activeProfile?.id);
        const { filename, text } = await exportBundle({ scope, password });
        if (cloudTarget) { await cloudTarget.upload(filename, text); toast?.(`Backup saved to ${cloudTarget.label}.`, 'success'); }
        else { await fileIO.saveFile(filename, text); toast?.('Profile file saved.', 'success'); }
      }
```

And in that handler's `finally`, also clear the cloud target — change:

```jsx
    } finally { setBusy(false); setMode(null); setPendingText(null); }
```

to:

```jsx
    } finally { setBusy(false); setMode(null); setPendingText(null); setCloudTarget(null); }
```

Add the cloud buttons + modal to the card's returned JSX. Inside the `card-body` div, after the existing local-action button row's closing `</div>`, add:

```jsx
        {cloudProviders.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {p.isConnected() ? (
              <>
                <button className="btn sm" disabled={busy} onClick={() => startCloudExport(p)}>
                  <Icon name="send" size={12} /> Save backup to {p.label}
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => startCloudRestore(p)}>
                  <Icon name="inbox" size={12} /> Restore from {p.label}
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => p.disconnect()}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn sm" disabled={busy} onClick={() => p.connect()}>
                <Icon name="lock" size={12} /> Connect {p.label}
              </button>
            )}
          </div>
        ))}
```

And just before the existing `<BundlePasswordModal .../>` element, add the picker:

```jsx
      <CloudPickerModal
        open={picker != null}
        label={picker?.provider?.label || ''}
        files={picker?.files}
        busy={!!picker?.busy}
        onClose={() => setPicker(null)}
        onPick={onPickCloudFile}
      />
```

- [ ] **Step 5: Export `CloudPickerModal` from the barrel**

In `packages/ui/src/views/view-settings.jsx`, add `CloudPickerModal` to the two export lists that already include `BundlePasswordModal, BackupRestoreCard` (the inline `export {` near the top-of-file group and the bottom `// ── Shared exports ──` block). In `packages/ui/src/index.js`, add `CloudPickerModal` to the `from './views/view-settings.jsx'` export block.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/cloud-card.test.jsx`
Expected: both card tests PASS.

- [ ] **Step 7: Full ui suite regression**

Run: `npx vitest run packages/ui`
Expected: all ui tests PASS (Feature A card tests unaffected — `cloudProviders` defaults to `[]`).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/cloud-card.test.jsx
git commit -m "feat(ui): cloud save/restore actions + picker in BackupRestoreCard"
```

---

## Phase 2 — Web backend OAuth (Google + Microsoft)

### Task 4: Google OAuth controller + shared token exchanger

**Files:**
- Create: `apps/web/server/Services/OAuth/ITokenExchanger.cs`
- Create: `apps/web/server/Services/OAuth/HttpTokenExchanger.cs`
- Create: `apps/web/server/Controllers/GoogleAuthController.cs`
- Modify: `apps/web/server/Program.cs`
- Test: `apps/web/server-tests/GoogleAuthControllerTests.cs`

**Interfaces:**
- Produces (consumed by Task 5 + Phase 3):
  - `ITokenExchanger.ExchangeAsync(string tokenEndpoint, IDictionary<string,string> form) → Task<TokenResponse>` where `TokenResponse(string? AccessToken, string? RefreshToken, int ExpiresIn)`.
  - Routes: `GET /api/google/auth/url?redirectUri=…` → `{ url }`; `POST /api/google/auth/callback` body `{ code, redirectUri }` → `{ accessToken, refreshToken }`; `POST /api/google/auth/refresh` body `{ refreshToken }` → `{ accessToken }`.

- [ ] **Step 1: Write the failing test**

```csharp
// apps/web/server-tests/GoogleAuthControllerTests.cs
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class GoogleAuthControllerTests
{
    // A fake exchanger so tests never hit Google.
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse(
                AccessToken: "at-" + (form.TryGetValue("grant_type", out var g) ? g : "?"),
                RefreshToken: "rt-123",
                ExpiresIn: 3600));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.AddSingleton<ITokenExchanger>(new FakeExchanger());
        }));

    [Fact]
    public async Task Url_contains_client_id_scope_and_redirect_but_no_secret()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/url?redirectUri=" + Uri.EscapeDataString("https://app/?from=google"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("accounts.google.com", url);
        Assert.Contains("drive.file", url);
        Assert.Contains("from%3Dgoogle", url); // redirect uri encoded
        Assert.DoesNotContain("test-google-secret", url);
    }

    [Fact]
    public async Task Callback_exchanges_code_for_tokens()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/google/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=google" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-authorization_code", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-123", j.GetProperty("refreshToken").GetString());
    }

    [Fact]
    public async Task Refresh_returns_a_new_access_token()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/google/auth/refresh", new { refreshToken = "rt-123" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-refresh_token", j.GetProperty("accessToken").GetString());
    }
}
```

- [ ] **Step 2: Add the Google OAuth test config to TestFactory**

In `apps/web/server-tests/Infrastructure/TestFactory.cs`, inside the `AddInMemoryCollection` dictionary, add:

```csharp
                ["Google:ClientId"]      = "test-google-client",
                ["Google:ClientSecret"]  = "test-google-secret",
                ["Microsoft:ClientId"]   = "test-ms-client",
                ["Microsoft:ClientSecret"] = "test-ms-secret",
                ["Microsoft:Tenant"]     = "common",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter GoogleAuthControllerTests`
Expected: FAIL to compile/resolve — `ITokenExchanger`/controller don't exist.

- [ ] **Step 4: Create the token exchanger**

```csharp
// apps/web/server/Services/OAuth/ITokenExchanger.cs
namespace NexusMDWeb.Api.Services.OAuth;

public record TokenResponse(string? AccessToken, string? RefreshToken, int ExpiresIn);

public interface ITokenExchanger
{
    Task<TokenResponse> ExchangeAsync(string tokenEndpoint, IDictionary<string, string> form);
}
```

```csharp
// apps/web/server/Services/OAuth/HttpTokenExchanger.cs
using System.Text.Json;

namespace NexusMDWeb.Api.Services.OAuth;

/// <summary>Posts an x-www-form-urlencoded body to an OAuth token endpoint.</summary>
public sealed class HttpTokenExchanger(IHttpClientFactory http) : ITokenExchanger
{
    public async Task<TokenResponse> ExchangeAsync(string tokenEndpoint, IDictionary<string, string> form)
    {
        using var client = http.CreateClient();
        using var res = await client.PostAsync(tokenEndpoint, new FormUrlEncodedContent(form));
        var body = await res.Content.ReadAsStringAsync();
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        return new TokenResponse(
            AccessToken:  root.TryGetProperty("access_token",  out var a) ? a.GetString() : null,
            RefreshToken: root.TryGetProperty("refresh_token", out var r) ? r.GetString() : null,
            ExpiresIn:    root.TryGetProperty("expires_in",    out var e) ? e.GetInt32()  : 3600);
    }
}
```

- [ ] **Step 5: Create the Google controller**

```csharp
// apps/web/server/Controllers/GoogleAuthController.cs
using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Services.OAuth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Brokers Google OAuth so the client secret stays server-side. Drive scope
/// (drive.file) is requested for profile cloud sync. Web is same-origin: the SPA
/// receives the code on its own redirect and POSTs it to /callback.
/// </summary>
[ApiController]
[Route("api/google/auth")]
public class GoogleAuthController(IConfiguration config, ITokenExchanger exchanger) : ControllerBase
{
    private const string AuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string Scope = "openid email https://www.googleapis.com/auth/drive.file";

    [HttpGet("url")]
    public IActionResult Url([FromQuery] string redirectUri)
    {
        var clientId = config["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(redirectUri))
            return BadRequest(new { error = "google oauth not configured" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = redirectUri,
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["access_type"]   = "offline",
            ["prompt"]        = "consent",
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpPost("callback")]
    public async Task<IActionResult> Callback([FromBody] CallbackRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = req.Code,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["redirect_uri"]  = req.RedirectUri,
            ["grant_type"]    = "authorization_code",
        });
        return Ok(new { accessToken = t.AccessToken, refreshToken = t.RefreshToken });
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["refresh_token"] = req.RefreshToken,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["grant_type"]    = "refresh_token",
        });
        return Ok(new { accessToken = t.AccessToken });
    }
}

public record CallbackRequest(string Code, string RedirectUri);
public record RefreshRequest(string RefreshToken);
```

- [ ] **Step 6: Register the exchanger + HttpClient in Program.cs**

In `apps/web/server/Program.cs`, after `builder.Services.AddMemoryCache();` add:

```csharp
builder.Services.AddHttpClient();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.ITokenExchanger,
                              NexusMDWeb.Api.Services.OAuth.HttpTokenExchanger>();
```

- [ ] **Step 7: Run test to verify it passes**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter GoogleAuthControllerTests`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/server/Services/OAuth apps/web/server/Controllers/GoogleAuthController.cs apps/web/server/Program.cs apps/web/server-tests/GoogleAuthControllerTests.cs apps/web/server-tests/Infrastructure/TestFactory.cs
git commit -m "feat(web): Google OAuth broker (drive.file scope) + token exchanger"
```

---

### Task 5: Microsoft OAuth controller

**Files:**
- Create: `apps/web/server/Controllers/MicrosoftAuthController.cs`
- Test: `apps/web/server-tests/MicrosoftAuthControllerTests.cs`

**Interfaces:**
- Consumes: `ITokenExchanger` (Task 4); `Microsoft:*` config (added to TestFactory in Task 4).
- Produces: `GET /api/ms/auth/url?redirectUri=…` → `{ url }`; `POST /api/ms/auth/callback` `{ code, redirectUri }` → `{ accessToken, refreshToken }`; `POST /api/ms/auth/refresh` `{ refreshToken }` → `{ accessToken }`.

- [ ] **Step 1: Write the failing test**

```csharp
// apps/web/server-tests/MicrosoftAuthControllerTests.cs
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class MicrosoftAuthControllerTests
{
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse("at-ms", "rt-ms", 3600));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<ITokenExchanger>(new FakeExchanger())));

    [Fact]
    public async Task Url_contains_graph_scope_and_no_secret()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/ms/auth/url?redirectUri=" + Uri.EscapeDataString("https://app/?from=onedrive"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("login.microsoftonline.com", url);
        Assert.Contains("Files.ReadWrite", url);
        Assert.DoesNotContain("test-ms-secret", url);
    }

    [Fact]
    public async Task Callback_exchanges_code_for_tokens()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.PostAsJsonAsync("/api/ms/auth/callback",
            new { code = "abc", redirectUri = "https://app/?from=onedrive" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var j = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-ms", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-ms", j.GetProperty("refreshToken").GetString());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter MicrosoftAuthControllerTests`
Expected: FAIL — controller doesn't exist.

- [ ] **Step 3: Create the Microsoft controller**

```csharp
// apps/web/server/Controllers/MicrosoftAuthController.cs
using Microsoft.AspNetCore.Mvc;
using NexusMDWeb.Api.Services.OAuth;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Brokers Microsoft (Graph) OAuth so the client secret stays server-side.
/// Requests Files.ReadWrite for profile cloud sync to OneDrive.
/// </summary>
[ApiController]
[Route("api/ms/auth")]
public class MicrosoftAuthController(IConfiguration config, ITokenExchanger exchanger) : ControllerBase
{
    private const string Scope = "openid email offline_access Files.ReadWrite";

    private string Tenant => string.IsNullOrWhiteSpace(config["Microsoft:Tenant"]) ? "common" : config["Microsoft:Tenant"]!;
    private string AuthEndpoint  => $"https://login.microsoftonline.com/{Tenant}/oauth2/v2.0/authorize";
    private string TokenEndpoint => $"https://login.microsoftonline.com/{Tenant}/oauth2/v2.0/token";

    [HttpGet("url")]
    public IActionResult Url([FromQuery] string redirectUri)
    {
        var clientId = config["Microsoft:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(redirectUri))
            return BadRequest(new { error = "microsoft oauth not configured" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = redirectUri,
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["response_mode"] = "query",
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpPost("callback")]
    public async Task<IActionResult> Callback([FromBody] CallbackRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = req.Code,
            ["client_id"]     = config["Microsoft:ClientId"] ?? "",
            ["client_secret"] = config["Microsoft:ClientSecret"] ?? "",
            ["redirect_uri"]  = req.RedirectUri,
            ["grant_type"]    = "authorization_code",
            ["scope"]         = Scope,
        });
        return Ok(new { accessToken = t.AccessToken, refreshToken = t.RefreshToken });
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest req)
    {
        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["refresh_token"] = req.RefreshToken,
            ["client_id"]     = config["Microsoft:ClientId"] ?? "",
            ["client_secret"] = config["Microsoft:ClientSecret"] ?? "",
            ["grant_type"]    = "refresh_token",
            ["scope"]         = Scope,
        });
        return Ok(new { accessToken = t.AccessToken });
    }
}
```

(`CallbackRequest`/`RefreshRequest` are reused from `GoogleAuthController.cs` — same `NexusMDWeb.Api.Controllers` namespace, so do not redeclare them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter MicrosoftAuthControllerTests`
Expected: 2 tests PASS.

- [ ] **Step 5: Full backend regression**

Run: `dotnet test apps/web/NexusMDWeb.sln`
Expected: all tests PASS (23 prior + 5 new = 28).

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/Controllers/MicrosoftAuthController.cs apps/web/server-tests/MicrosoftAuthControllerTests.cs
git commit -m "feat(web): Microsoft (Graph) OAuth broker for OneDrive sync"
```

---

## Phase 3 — Web wiring

### Task 6: Web auth bindings + provider construction

**Files:**
- Create: `apps/web/src/cloud-auth.js`

**Interfaces:**
- Consumes: `getProfileKey` (`apps/web/src/profile-keys.js`); `makeGoogleDriveProvider`/`makeOneDriveProvider` (`@nexusmd/ui`); backend `/api/{google|ms}/auth/*` (Tasks 4–5).
- Produces: `webCloudProviders` — an array `[gdriveProvider, onedriveProvider]` ready to pass to `BackupRestoreCard`; runs `handleCloudOAuthCallback()` on load.

- [ ] **Step 1: Create `cloud-auth.js`**

```js
// cloud-auth.js — web OAuth bindings for profile cloud sync (Drive + OneDrive).
// Tokens are stored per-profile, mirroring google-auth.js:
//   nexusmd.p.<id>.gdrive.auth / .onedrive.auth = { accessToken, refreshToken, email }
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'
import { toast } from './toast.jsx'

// provider config: storage key suffix, backend route base, redirect marker.
const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   api: '/api/google/auth', from: 'gdrive' },
  onedrive: { keySuffix: 'onedrive.auth', api: '/api/ms/auth',     from: 'onedrive' },
}

function read(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.removeItem(k) } catch {}
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      const redirectUri = window.location.origin + '/?from=' + cfg.from
      const res = await fetch(`${cfg.api}/url?redirectUri=${encodeURIComponent(redirectUri)}`,
        { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) { toast?.(`${key} sign-in is not configured on the server.`, 'error'); return }
      const { url } = await res.json()
      window.location.href = url
    },
    async disconnect() { clear(cfg.keySuffix) },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      const res = await fetch(`${cfg.api}/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }), signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return null
      const { accessToken } = await res.json()
      write(cfg.keySuffix, { ...auth, accessToken })
      return accessToken
    },
  }
}

// Exchange the ?from=<provider>&code=… redirect for tokens (runs on load).
export async function handleCloudOAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from')
  const cfg = from && PROVIDERS[from]
  if (!cfg) return
  const code = params.get('code')
  if (!code) return
  window.history.replaceState({}, '', window.location.pathname)
  try {
    const redirectUri = window.location.origin + '/?from=' + cfg.from
    const res = await fetch(`${cfg.api}/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }), signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { toast?.(`${from} sign-in failed.`, 'error'); return }
    const { accessToken, refreshToken } = await res.json()
    write(cfg.keySuffix, { accessToken, refreshToken })
    toast?.(`${from === 'gdrive' ? 'Google Drive' : 'OneDrive'} connected.`, 'success')
    document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'settings', tab: 'profiles' } }))
  } catch { toast?.(`${from} sign-in failed.`, 'error') }
}

export const webCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleCloudOAuthCallback)
} else {
  handleCloudOAuthCallback()
}
```

- [ ] **Step 2: Verify the web build resolves the new module**

Run: `npm -w apps/web run build`
Expected: build SUCCESS (module imports resolve; not yet mounted).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/cloud-auth.js
git commit -m "feat(web): cloud OAuth bindings + Drive/OneDrive provider construction"
```

---

### Task 7: Mount cloud providers in web Settings

**Files:**
- Modify: `apps/web/src/view-settings.jsx`

**Interfaces:**
- Consumes: `webCloudProviders` (Task 6); `BackupRestoreCard` `cloudProviders` prop (Task 3).

- [ ] **Step 1: Import the providers**

In `apps/web/src/view-settings.jsx`, next to the existing `import { webFileIO } from './file-io.js'` line, add:

```js
import { webCloudProviders } from './cloud-auth.js'
```

- [ ] **Step 2: Pass providers into the card**

Find the existing mount (from Feature A):

```jsx
              <VsProfiles profileApi={useProfile()} />
              <BackupRestoreCard fileIO={webFileIO} />
```

and change the card to:

```jsx
              <VsProfiles profileApi={useProfile()} />
              <BackupRestoreCard fileIO={webFileIO} cloudProviders={webCloudProviders} />
```

- [ ] **Step 3: Build + full JS suite**

Run: `npm -w apps/web run build`
Expected: SUCCESS.

Run: `npx vitest run`
Expected: all JS tests PASS (Phase 1 + existing).

- [ ] **Step 4: Manual smoke (documented, not automated)**

With Google/Microsoft client id/secret set in `appsettings.user.json` and a running host: Settings → Profiles shows **Connect Google Drive** / **Connect OneDrive**; connecting redirects through the provider and back; **Save backup to …** writes a `.nmdprofile` into `/NexusMD`; **Restore from …** lists it, downloads, prompts for the password, and imports. Wrong password → the Feature A error toast.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/view-settings.jsx
git commit -m "feat(web): mount Drive/OneDrive cloud sync in Settings"
```

---

## Self-Review Notes

- **Spec coverage (Phases 1–3):** `cloudProvider` seam (Tasks 1–2) ✓; shared factories with find-or-create `/NexusMD` + list/upload/download ✓; visible folder + narrow scopes (`drive.file`, `Files.ReadWrite`) ✓; UI cloud actions + picker (Task 3) ✓; backend brokered OAuth, secrets server-side, both providers (Tasks 4–5) ✓; web wiring + per-profile token storage (Tasks 6–7) ✓; manual push/pull only ✓; error handling (toasts, 401-refresh-once, empty list, wrong password) ✓. Out of scope by design: app/desktop wiring + one-time-code exchange (Phases 4–5).
- **Discrepancy from spec handled:** the spec assumed an existing Google OAuth backend; it does not exist (deleted in migration), so Task 4 builds it from scratch with the Drive scope.
- **Type consistency:** `authBinding.getToken({ force })`, provider methods `list/upload/download`, `TokenResponse(AccessToken,RefreshToken,ExpiresIn)`, and routes `/api/google/auth/*` + `/api/ms/auth/*` are used identically across tasks. `CallbackRequest`/`RefreshRequest` declared once (Task 4), reused in Task 5.
- **No placeholders:** every code step contains complete code.
