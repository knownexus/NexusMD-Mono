# Continuous Profile Sync — Phase 5 (desktop + app wiring via a shared controller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring continuous cloud sync + encrypted local export/import to **desktop (Electron)** and **app (Capacitor/Android)** at parity with web, by promoting the web glue into a shared, adapter-parameterized `@nexusmd/ui` controller + `CloudSyncCard` that all three platforms instantiate.

**Architecture:** A new pure `createSyncController({ storage, namespace, getProfileKey, getActiveProfileId, providers, keyStore, dispatch, subscribeForeground, subscribeChange })` in `@nexusmd/ui` wraps the Phase 1–4 engine (runtime, collections, `startAutoSync`, `singleFlight`, `exportBundle`/`importBundle`) and returns the full sync API. The card becomes a shared `CloudSyncCard({ controller, providers, fileIO })`. Web is refactored to consume them (proving the seam), then desktop and app each instantiate the controller with their own providers, namespace, **OS-secure-store key cache** (`secureStorageAdapter`), file I/O (`pickerAdapter`), and platform triggers. The key cache moves from plain localStorage (web) to the encrypted `secureStorageAdapter` on desktop/app.

**Tech Stack:** JS ESM, Vitest + @testing-library/react (jsdom) for ui; Vite for all three apps; Electron (desktop) + Capacitor (app). Reuses everything from Phases 1–4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This is **Phase 5** (desktop + app wiring + shared-controller refactor). All engine/merge/crypto/bundle logic already exists and is unchanged here.
- **Security:** the AES key is the 64-hex-char `hashPassword` output. On desktop/app the cached key is stored via each platform's `secureStorageAdapter` (encrypted-at-rest IndexedDB on desktop; Capacitor secure storage / localStorage fallback on app) under the storage key `sync.keyhex`. On web it stays in `localStorage` at `nexusmd.sync.keyhex`. Cloud + local-bundle files stay AES-GCM encrypted. Never log the passphrase or key. Client secrets never leave the backend; OAuth uses the existing one-time-code native flow.
- **Key-match (the crux):** the controller's collection keys MUST resolve to each platform's REAL storage keys. Web uses **identity** `getProfileKey` + namespace `nexusmd` (bare keys). **Desktop and app use their SCOPED `getProfileKey`** (per active profile) — desktop namespace `nexusmd` (→ `nexusmd.p.<id>.*`), app namespace `helm` (→ `helm.p.<id>.*`). Each platform passes the SAME `getProfileKey` its `NexusDataProvider` passes, so the synced collections target the same keys the shared views read/write. Verify per platform before committing.
- **Bundle/file:** export filename `nexusmd-planner-<profileId>-<YYYYMMDD-HHmmss>.nmdplanner`; each platform's `pickFile` must accept `.nmdplanner`.
- Tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/ui` and `npx vitest run`. Builds: `npm -w apps/web run build`, `npm -w apps/desktop run build`, `npm -w apps/app run build`. **Vitest workspace covers only `packages/*`** — platform glue is build-verified; all unit-testable logic lives in `@nexusmd/ui`.
- Style per file: `packages/ui/src` semicolons; `apps/web/src/sync.js` no semicolons; `apps/desktop/src` and `apps/app/src` — match each file's local style (check the file).

---

## File Structure

- `packages/ui/src/sync/controller.js` — **new.** `createSyncController(...)` + DOM trigger helpers (`domDispatch`, `domSubscribeForeground`, `domSubscribeChange`).
- `packages/ui/src/views/view-settings.jsx` — **modify.** Add the shared `CloudSyncCard({ controller, providers, fileIO })` next to `VsCard`.
- `packages/ui/src/index.js` — **modify.** Export `createSyncController`, the DOM helpers, and `CloudSyncCard`.
- `packages/ui/tests/sync-controller.test.jsx` — **new.**
- `apps/web/src/sync.js` — **modify (slim down).** Instantiate `createSyncController` with web bits; re-export `webSync` + `startWebAutoSync`/`stopWebAutoSync`.
- `apps/web/src/view-settings.jsx` — **modify.** Delete the local `CloudSyncCard`; render the shared one. Drop now-unused `./sync.js` named imports.
- `apps/desktop/src/sync.js` — **new.** `desktopSync` controller instance + `startDesktopAutoSync`.
- `apps/desktop/src/file-io.js` — **modify.** Accept `.nmdplanner`.
- `apps/desktop/src/main.jsx` — **modify.** Mount `CloudSyncCard` in `DesktopSettings`; start auto-sync.
- `apps/app/src/sync.js` — **new.** `appSync` controller instance + `startAppAutoSync` (Capacitor foreground trigger).
- `apps/app/src/file-io.js` — **modify.** Accept `.nmdplanner`.
- `apps/app/src/app.jsx` / `apps/app/src/main.jsx` — **modify.** Mount `CloudSyncCard` in Settings; start auto-sync.

---

### Task 1: Shared `createSyncController` (ui)

**Files:**
- Create: `packages/ui/src/sync/controller.js`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/sync-controller.test.jsx`

**Interfaces:**
- Consumes: `createSyncRuntime`, `startAutoSync`, `singleFlight`, `exportBundle`/`importBundle`, the five collection factories, `hashPassword`.
- Produces:
  - `createSyncController({ storage, namespace, getProfileKey, getActiveProfileId, providers, keyStore, deviceIdPrefix='dev', dispatch, subscribeForeground, subscribeChange, intervalMs=300000, debounceMs=5000 }) → { setSyncPassphrase(pw):Promise, hasSyncKey():Promise<boolean>, clearSyncKey():Promise, getSyncProvider():provider|null, setSyncProvider(id), syncOnce():Promise<result>, exportLocalBundle():Promise<string>, importLocalBundle(text):Promise<{collections}>, getActiveProfileId():string, startAuto():void, stopAuto():void }`.
    - `keyStore` is `{ get():Promise<string|null>, set(hex):Promise<void>, remove():Promise<void> }`.
    - `dispatch(eventName, detail)` is how the controller signals `nexusmd:sync-applied` (platform injects DOM dispatch).
    - `syncOnce` is `singleFlight`-wrapped; returns `{ skipped: 'no-key'|'no-provider'|'not-connected'|'bad-passphrase'|'in-flight' }` or `{ pushed, pulled, merged, conflicts }`.
  - `domDispatch(name, detail)` → `document.dispatchEvent(new CustomEvent(name, { detail }))`.
  - `domSubscribeForeground(cb)` → registers `window 'focus'`; returns an unsubscribe.
  - `domSubscribeChange(cb)` → registers `document 'nexusmd:planner-changed'` + `'nexusmd:data-changed'`; returns an unsubscribe.

- [ ] **Step 1: Write the failing test** — `packages/ui/tests/sync-controller.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { createSyncController } from '../src/index.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
  };
}
function memKeyStore() {
  let v = null;
  return { get: async () => v, set: async (x) => { v = x; }, remove: async () => { v = null; } };
}
function ctrl(overrides = {}) {
  const storage = memStorage();
  return createSyncController({
    storage, namespace: 'nexusmd', getProfileKey: k => k, getActiveProfileId: () => 'p1',
    providers: [{ id: 'gdrive', label: 'Drive', isConnected: () => false }],
    keyStore: memKeyStore(), deviceIdPrefix: 'test',
    dispatch: () => {}, subscribeForeground: () => () => {}, subscribeChange: () => () => {},
    ...overrides,
  });
}

describe('createSyncController', () => {
  it('manages the key store', async () => {
    const c = ctrl();
    expect(await c.hasSyncKey()).toBe(false);
    await c.setSyncPassphrase('hunter2');
    expect(await c.hasSyncKey()).toBe(true);
    await c.clearSyncKey();
    expect(await c.hasSyncKey()).toBe(false);
  });

  it('selects providers and reports skip states', async () => {
    const c = ctrl();
    expect(await c.syncOnce()).toEqual({ skipped: 'no-key' });
    await c.setSyncPassphrase('pw');
    expect(await c.syncOnce()).toEqual({ skipped: 'no-provider' });
    c.setSyncProvider('gdrive');
    expect(c.getSyncProvider().id).toBe('gdrive');
    expect(await c.syncOnce()).toEqual({ skipped: 'not-connected' });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run packages/ui/tests/sync-controller.test.jsx` → FAIL (`createSyncController is not a function`).

- [ ] **Step 3: Implement** — `packages/ui/src/sync/controller.js`:

```js
// controller.js — platform-agnostic sync controller. Wraps the Phase 1–4 engine
// (runtime, collections, startAutoSync, singleFlight, local-bundle) behind one
// object each platform instantiates with its own storage, namespace,
// getProfileKey, cloud providers, key store, dispatch and triggers.
import { createSyncRuntime } from './runtime.js';
import { startAutoSync } from './auto.js';
import { singleFlight } from './single-flight.js';
import { exportBundle, importBundle } from './local-bundle.js';
import {
  plannerCollection, notesCollection, teamCustomCollection,
  teamRemovedCollection, tweaksCollection,
} from './collections.js';
import { hashPassword } from '../planner/planner-confidential.js';

export function createSyncController({
  storage, namespace, getProfileKey, getActiveProfileId,
  providers, keyStore, deviceIdPrefix = 'dev',
  dispatch, subscribeForeground, subscribeChange,
  intervalMs = 300000, debounceMs = 5000,
}) {
  const PROVIDER_KEY = `${namespace}.sync.provider`;
  const DEVICE_KEY = `${namespace}.sync.deviceId`;

  const setSyncPassphrase = async (pw) => { await keyStore.set(await hashPassword(pw)); };
  const hasSyncKey = async () => !!(await keyStore.get());
  const clearSyncKey = async () => { await keyStore.remove(); };
  const getKey = async () => keyStore.get();

  const getSyncProvider = () => {
    const id = storage.getItem(PROVIDER_KEY);
    return id ? (providers.find(p => p.id === id) || null) : null;
  };
  const setSyncProvider = (id) => {
    if (id) storage.setItem(PROVIDER_KEY, id); else storage.removeItem(PROVIDER_KEY);
  };

  const getDeviceId = () => {
    let id = storage.getItem(DEVICE_KEY);
    if (!id) { id = `${deviceIdPrefix}-` + Math.random().toString(36).slice(2); storage.setItem(DEVICE_KEY, id); }
    return id;
  };

  const buildCollections = () => {
    const opts = { storage, getProfileKey, namespace };
    return [
      plannerCollection(opts), notesCollection(opts),
      teamCustomCollection(opts), teamRemovedCollection(opts), tweaksCollection(opts),
    ];
  };

  const buildRuntime = () => createSyncRuntime({
    storage, getProfileKey, namespace,
    profileId: getActiveProfileId() || 'default',
    cloud: getSyncProvider(), getKey, deviceId: getDeviceId(),
    collections: buildCollections(),
    onChanged: (collId) => dispatch('nexusmd:sync-applied', { collId }),
  });

  const syncOnce = singleFlight(async () => {
    if (!(await hasSyncKey())) return { skipped: 'no-key' };
    const provider = getSyncProvider();
    if (!provider) return { skipped: 'no-provider' };
    if (!provider.isConnected()) return { skipped: 'not-connected' };
    try { return await buildRuntime().syncNow(); }
    catch (err) { if (err && err.code === 'bad-passphrase') return { skipped: 'bad-passphrase' }; throw err; }
  });

  const exportLocalBundle = () => exportBundle({
    collections: buildCollections(), getKey, profileId: getActiveProfileId() || 'default',
  });
  const importLocalBundle = async (text) => {
    const r = await importBundle({
      collections: buildCollections(), getKey, text,
      onChanged: (collId) => dispatch('nexusmd:sync-applied', { collId }),
    });
    syncOnce().catch(() => {});
    return r;
  };

  let _stop = null;
  const startAuto = () => {
    if (_stop) return;
    _stop = startAutoSync({ syncNow: syncOnce, intervalMs, debounceMs, subscribeForeground, subscribeChange });
  };
  const stopAuto = () => { if (_stop) { _stop(); _stop = null; } };

  return {
    setSyncPassphrase, hasSyncKey, clearSyncKey,
    getSyncProvider, setSyncProvider,
    syncOnce, exportLocalBundle, importLocalBundle,
    getActiveProfileId, startAuto, stopAuto,
  };
}

// DOM trigger helpers for webview platforms (web/desktop/app all run in a DOM).
export const domDispatch = (name, detail) =>
  document.dispatchEvent(new CustomEvent(name, { detail }));
export const domSubscribeForeground = (cb) => {
  window.addEventListener('focus', cb);
  return () => window.removeEventListener('focus', cb);
};
export const domSubscribeChange = (cb) => {
  const h = () => cb();
  document.addEventListener('nexusmd:planner-changed', h);
  document.addEventListener('nexusmd:data-changed', h);
  return () => {
    document.removeEventListener('nexusmd:planner-changed', h);
    document.removeEventListener('nexusmd:data-changed', h);
  };
};
```

- [ ] **Step 4: Export** — in `packages/ui/src/index.js`, add to the Continuous-sync group:
```js
export { createSyncController, domDispatch, domSubscribeForeground, domSubscribeChange } from './sync/controller.js'
```

- [ ] **Step 5: Run to verify PASS** — `npx vitest run packages/ui` → all green (controller tests + existing 99).

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/sync/controller.js packages/ui/src/index.js packages/ui/tests/sync-controller.test.jsx
git commit -m "feat(ui): platform-agnostic createSyncController + DOM triggers"
```

---

### Task 2: Shared `CloudSyncCard` (ui)

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx`, `packages/ui/src/index.js`
- Test: `packages/ui/tests/cloud-sync-card.test.jsx` (new)

**Interfaces:**
- Consumes: a `controller` (from Task 1), `providers` (array with `{ id, label, isConnected, connect, disconnect }`), `fileIO` (`{ saveFile(name,text), pickFile()→text|null }`), plus the existing `VsCard`/`VsRow`/`VsFullRow` and `toast` already in this file/package.
- Produces: `export function CloudSyncCard({ controller, providers, fileIO })`.

- [ ] **Step 1: Write the failing test** — `packages/ui/tests/cloud-sync-card.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { CloudSyncCard } from '../src/index.js';

const noKeyController = {
  hasSyncKey: async () => false,
  getSyncProvider: () => null, setSyncProvider: () => {},
  setSyncPassphrase: async () => {}, clearSyncKey: async () => {},
  syncOnce: async () => ({ skipped: 'no-key' }),
  exportLocalBundle: async () => '', importLocalBundle: async () => ({ collections: [] }),
  getActiveProfileId: () => 'p1',
};
const providers = [{ id: 'gdrive', label: 'Google Drive', isConnected: () => false, connect: async () => {}, disconnect: async () => {} }];

describe('CloudSyncCard', () => {
  it('disables local export/import until a passphrase is set', async () => {
    render(<CloudSyncCard controller={noKeyController} providers={providers} fileIO={{ saveFile: async () => {}, pickFile: async () => null }} />);
    await waitFor(() => expect(screen.getByText('Export to file')).toBeTruthy());
    expect(screen.getByText('Export to file').disabled).toBe(true);
    expect(screen.getByText('Import from file').disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run packages/ui/tests/cloud-sync-card.test.jsx` → FAIL (`CloudSyncCard` not exported).

- [ ] **Step 3: Implement** — add to `packages/ui/src/views/view-settings.jsx` (near `VsCard`). Uses the file's existing React import alias; if the file imports React hooks under aliases, match them — the snippet below uses plain `React.useState`/`React.useEffect` to avoid alias mismatch:

```jsx
export function CloudSyncCard({ controller, providers, fileIO }) {
  const [selectedId, setSelectedId] = React.useState(() => controller.getSyncProvider()?.id || '');
  const [hasKey, setHasKey] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState('');
  const [syncing, setSyncing] = React.useState(false);
  const [lastResult, setLastResult] = React.useState(null);

  const provider = providers.find(p => p.id === selectedId) || null;
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => { controller.hasSyncKey().then(setHasKey); }, []);
  React.useEffect(() => {
    const p = providers.find(p => p.id === selectedId) || null;
    setConnected(p ? p.isConnected() : false);
  }, [selectedId]);
  React.useEffect(() => {
    const refresh = () => {
      const p = providers.find(p => p.id === selectedId) || null;
      setConnected(p ? p.isConnected() : false);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [selectedId]);

  const handleProviderChange = (id) => {
    setSelectedId(id); controller.setSyncProvider(id);
    const p = providers.find(pr => pr.id === id) || null;
    setConnected(p ? p.isConnected() : false);
  };
  const handleConnect = async () => { if (!provider) return; await provider.connect(); setConnected(provider.isConnected()); };
  const handleDisconnect = async () => { if (!provider) return; await provider.disconnect(); setConnected(false); toast?.(`${provider.label} disconnected.`, 'success'); };
  const handleSavePassphrase = async () => { if (!passphrase) return; await controller.setSyncPassphrase(passphrase); setPassphrase(''); setHasKey(true); toast?.('Sync passphrase saved.', 'success'); };
  const handleForgetPassphrase = async () => { await controller.clearSyncKey(); setHasKey(false); toast?.('Sync passphrase forgotten.', 'success'); };

  const handleSyncNow = async () => {
    setSyncing(true); setLastResult(null);
    try {
      const result = await controller.syncOnce();
      setLastResult(result);
      if (result.skipped === 'no-key') toast?.('Set a sync passphrase first.', 'info');
      else if (result.skipped === 'no-provider') toast?.('Select a cloud provider first.', 'info');
      else if (result.skipped === 'not-connected') toast?.('Connect your cloud provider first.', 'info');
      else if (result.skipped === 'bad-passphrase') toast?.('Wrong passphrase — enter the correct passphrase and try again.', 'error');
      else if (!result.skipped) toast?.(`Synced — pushed ${result.pushed}, pulled ${result.pulled}, merged ${result.merged}.`, 'success');
    } catch (err) { toast?.('Sync failed: ' + (err?.message || 'unknown error'), 'error'); }
    finally { setSyncing(false); }
  };

  const stamp = () => {
    const d = new Date(); const p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  };
  const handleExport = async () => {
    try {
      const text = await controller.exportLocalBundle();
      await fileIO.saveFile(`nexusmd-planner-${controller.getActiveProfileId() || 'default'}-${stamp()}.nmdplanner`, text);
      toast?.('Exported encrypted planner bundle.', 'success');
    } catch (err) { toast?.('Export failed: ' + (err?.message || 'unknown error'), 'error'); }
  };
  const handleImport = async () => {
    try {
      const text = await fileIO.pickFile();
      if (!text) return;
      const r = await controller.importLocalBundle(text);
      toast?.(r.collections.length ? `Imported ${r.collections.join(', ')}.` : 'Nothing to import.', 'success');
    } catch (err) { toast?.(err?.code === 'bad-passphrase' ? 'Wrong passphrase for this file.' : 'Import failed: ' + (err?.message || 'unknown error'), 'error'); }
  };

  const lastDesc = lastResult && !lastResult.skipped
    ? `Last: pushed ${lastResult.pushed}, pulled ${lastResult.pulled}, merged ${lastResult.merged}`
    : 'Push and pull encrypted changes with your cloud';

  return (
    <VsCard title="Cloud Sync" icon="inbox">
      <VsFullRow title="Cloud provider" desc="Where encrypted sync files are stored">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" name="sync-provider" value={p.id} checked={selectedId === p.id} onChange={() => handleProviderChange(p.id)} style={{ accentColor: 'var(--accent)' }} />
              {p.label}
            </label>
          ))}
        </div>
      </VsFullRow>
      {provider && (
        <VsRow title={provider.label} desc={connected ? `Connected to ${provider.label}` : `Not connected to ${provider.label}`}>
          {connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill success"><span className="dot"></span>Connected</span>
              <button className="btn sm ghost danger" onClick={handleDisconnect}>Disconnect</button>
            </div>
          ) : (
            <button className="btn sm ghost" onClick={handleConnect}>Connect {provider.label}</button>
          )}
        </VsRow>
      )}
      <VsRow title="Sync passphrase" desc="AES-256 key for all synced data — hashed locally, never sent anywhere">
        {hasKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="pill success"><span className="dot"></span>Remembered</span>
            <button className="btn sm ghost danger" onClick={handleForgetPassphrase}>Forget</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSavePassphrase(); }} placeholder="Enter passphrase…" style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }} />
            <button className="btn sm" onClick={handleSavePassphrase} disabled={!passphrase}>Save</button>
          </div>
        )}
      </VsRow>
      <VsRow title="Sync now" desc={lastDesc}>
        <button className="btn sm" onClick={handleSyncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
      </VsRow>
      <VsRow title="Local file" desc={hasKey ? 'Export or import an encrypted planner bundle (.nmdplanner)' : 'Set a sync passphrase to encrypt local exports'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn sm ghost" onClick={handleExport} disabled={!hasKey}>Export to file</button>
          <button className="btn sm ghost" onClick={handleImport} disabled={!hasKey}>Import from file</button>
        </div>
      </VsRow>
    </VsCard>
  );
}
```

Note: confirm `toast`, `VsCard`, `VsRow`, `VsFullRow`, and `React` are in scope in this file (they are — `VsCard`/`VsRow`/`VsFullRow` are defined here; `toast` and `React` are imported at the top). If the file imports specific hooks rather than the `React` namespace, either add `import React from 'react'` or switch the snippet to the file's hook aliases.

- [ ] **Step 4: Export** — in `packages/ui/src/index.js`, add `CloudSyncCard` to the existing `view-settings.jsx` export group (the one already exporting `BundlePasswordModal, BackupRestoreCard, CloudPickerModal`).

- [ ] **Step 5: Run to verify PASS** — `npx vitest run packages/ui` → green.

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/cloud-sync-card.test.jsx
git commit -m "feat(ui): shared CloudSyncCard (controller/providers/fileIO props)"
```

---

### Task 3: Refactor web onto the shared controller + card

**Files:**
- Modify: `apps/web/src/sync.js`, `apps/web/src/view-settings.jsx`, `apps/web/src/main.jsx`

**Interfaces:**
- Produces: `apps/web/src/sync.js` exports `webSync` (the controller instance) + `startWebAutoSync()`/`stopWebAutoSync()`.

- [ ] **Step 1: Slim `apps/web/src/sync.js`** to instantiate the controller (no semicolons):

```js
// sync.js — web cloud-sync glue. Instantiates the shared @nexusmd/ui controller
// with web's localStorage key cache (bare keys via identity getProfileKey),
// OAuth providers, and DOM triggers. See the controller for the engine.
import { createSyncController, domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/ui'
import { webCloudProviders } from './cloud-auth.js'
import { getActiveProfileId } from './profile-keys.js'

const KEY_CACHE = 'nexusmd.sync.keyhex'
const keyStore = {
  get: async () => localStorage.getItem(KEY_CACHE),
  set: async (hex) => localStorage.setItem(KEY_CACHE, hex),
  remove: async () => localStorage.removeItem(KEY_CACHE),
}

export const webSync = createSyncController({
  storage: localStorage,
  namespace: 'nexusmd',
  getProfileKey: (k) => k, // identity — matches web's NexusDataProvider (bare keys)
  getActiveProfileId,
  providers: webCloudProviders,
  keyStore,
  deviceIdPrefix: 'web',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
})

export function startWebAutoSync() { webSync.startAuto() }
export function stopWebAutoSync() { webSync.stopAuto() }
```

- [ ] **Step 2: `apps/web/src/view-settings.jsx`** — delete the local `CloudSyncCard` function entirely; import the shared one + `webSync`:
  - Replace the line `import { setSyncPassphrase, hasSyncKey, clearSyncKey, getSyncProvider, setSyncProvider, syncOnce, exportLocalBundle, importLocalBundle } from './sync.js'` with `import { webSync } from './sync.js'`.
  - Add `CloudSyncCard` to the existing `@nexusmd/ui` import (the one bringing in `VsCard`/`BackupRestoreCard`).
  - Drop the now-unused `import { getActiveProfileId } from './profile-keys.js'` if nothing else uses it (grep the file first).
  - Replace the `<CloudSyncCard />` render site with `<CloudSyncCard controller={webSync} providers={webCloudProviders} fileIO={webFileIO} />` (`webCloudProviders` and `webFileIO` are already imported).

- [ ] **Step 3: `apps/web/src/main.jsx`** — unchanged if it already calls `startWebAutoSync()` (it does). Confirm the import still resolves.

- [ ] **Step 4: Verify** — `npm -w apps/web run build` green; `npx vitest run` green (421). Manually confirm no remaining references to the deleted web `syncOnce`/`setSyncPassphrase`/etc. (grep `apps/web/src` — they should now only exist as `webSync.*`).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/sync.js apps/web/src/view-settings.jsx apps/web/src/main.jsx
git commit -m "refactor(web): consume shared sync controller + CloudSyncCard"
```

---

### Task 4: Desktop wiring

**Files:**
- Create: `apps/desktop/src/sync.js`
- Modify: `apps/desktop/src/file-io.js`, `apps/desktop/src/main.jsx`

**Context:** Desktop's `NexusDataProvider` passes the SCOPED `getProfileKey` (from `./profile-keys.js`, namespace `nexusmd`), so shared views write `nexusmd.p.<id>.*`. `desktopCloudProviders` (from `./cloud-auth.js`) are full providers. `secureStorageAdapter` (from `./adapters/secureStorage.js`) is `{ async get(k), async set(k,v), async remove(k) }`, encrypted-at-rest. `DesktopSettings()` in `main.jsx` renders `<BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />` — mount the card right after it.

- [ ] **Step 1: Verify key-match** — confirm by reading `apps/desktop/src/main.jsx` that `nexusDataValue.getProfileKey` is the imported scoped `getProfileKey` and the shared planner/notes/team/tweaks views consume it (so storage keys are `nexusmd.p.<id>.planner.week.*`, `…planner.globalNotes`, `…team.custom`, `…team.removed`, `…tweaks`). If desktop instead writes bare keys anywhere, STOP and report — the controller's `getProfileKey` must match what the views actually use.

- [ ] **Step 2: Create `apps/desktop/src/sync.js`** (match the file's local style — check `cloud-auth.js`):

```js
// Desktop cloud-sync glue: shared controller with the encrypted secureStorage
// key cache + scoped getProfileKey (nexusmd.p.<id>.* keys) + DOM triggers.
import { createSyncController, domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/ui'
import { desktopCloudProviders } from './cloud-auth.js'
import { getProfileKey, getActiveProfileId } from './profile-keys.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'

const KEY_ID = 'sync.keyhex'
const keyStore = {
  get: () => secureStorageAdapter.get(KEY_ID),
  set: (hex) => secureStorageAdapter.set(KEY_ID, hex),
  remove: () => secureStorageAdapter.remove(KEY_ID),
}

export const desktopSync = createSyncController({
  storage: localStorage,
  namespace: 'nexusmd',
  getProfileKey,
  getActiveProfileId,
  providers: desktopCloudProviders,
  keyStore,
  deviceIdPrefix: 'desktop',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
})

export function startDesktopAutoSync() { desktopSync.startAuto() }
```

- [ ] **Step 3: `apps/desktop/src/file-io.js`** — in `pickFile`, change `pickerAdapter.pickFile({ ext: '.nmdprofile' })` to `pickerAdapter.pickFile({ ext: '.nmdprofile,.nmdplanner' })`.

- [ ] **Step 4: `apps/desktop/src/main.jsx`:**
  - Add `CloudSyncCard` to the `@nexusmd/ui` import (alongside `VsProfiles, BackupRestoreCard`).
  - Add `import { desktopSync, startDesktopAutoSync } from './sync.js'`.
  - In `DesktopSettings()`, after `<BackupRestoreCard … />`, add `<CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />`.
  - After the root render call, add `startDesktopAutoSync()` (no-op until a key+provider exist).

- [ ] **Step 5: Verify** — `npm -w apps/desktop run build` green; `npx vitest run` still green (no platform tests, but ensures the ui changes didn't regress).

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/src/sync.js apps/desktop/src/file-io.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): continuous cloud sync + CloudSyncCard (secure key cache)"
```

---

### Task 5: App wiring

**Files:**
- Create: `apps/app/src/sync.js`
- Modify: `apps/app/src/file-io.js`, `apps/app/src/app.jsx` (mount card), `apps/app/src/main.jsx` (start)

**Context:** App's `NexusDataProvider` passes the SCOPED `getProfileKey` (namespace `helm`), so shared views write `helm.p.<id>.*`. `appCloudProviders` (from `./cloud-auth.js`) are full providers. `secureStorageAdapter` (from `./adapters/secureStorage.js`) is `{ async get, async set, async remove }`. The app's Settings UI is bespoke mobile (not VsCard-based); mounting the shared VsCard-based `CloudSyncCard` there is functional — visual polish for the mobile layout is acceptable to defer.

- [ ] **Step 1: Verify key-match** — confirm `apps/app/src/app.jsx`'s `nexusDataValue.getProfileKey` is the imported scoped `getProfileKey` (it is referenced as `getProfileKey` in that object, namespace `helm`) and that planner/notes/team/tweaks resolve to `helm.p.<id>.planner.week.*`, `helm.p.<id>.planner.globalNotes`, `helm.p.<id>.team.custom`, `helm.p.<id>.team.removed`, `helm.p.<id>.tweaks`. The app already reads team/tweaks via `getProfileKey('helm.team.custom')` etc., confirming scoped keys. If any of the five diverges, STOP and report.

- [ ] **Step 2: Create `apps/app/src/sync.js`** (match the file's local style):

```js
// App cloud-sync glue: shared controller with the secureStorage key cache +
// scoped getProfileKey (helm.p.<id>.* keys). Foreground trigger uses window
// focus (Android WebView fires it on resume); change triggers via DOM events.
import { createSyncController, domDispatch, domSubscribeForeground, domSubscribeChange } from '@nexusmd/ui';
import { appCloudProviders } from './cloud-auth.js';
import { getProfileKey, getActiveProfileId } from './profile-keys.js';
import { secureStorageAdapter } from './adapters/secureStorage.js';

const KEY_ID = 'sync.keyhex';
const keyStore = {
  get: () => secureStorageAdapter.get(KEY_ID),
  set: (hex) => secureStorageAdapter.set(KEY_ID, hex),
  remove: () => secureStorageAdapter.remove(KEY_ID),
};

export const appSync = createSyncController({
  storage: localStorage,
  namespace: 'helm',
  getProfileKey,
  getActiveProfileId,
  providers: appCloudProviders,
  keyStore,
  deviceIdPrefix: 'app',
  dispatch: domDispatch,
  subscribeForeground: domSubscribeForeground,
  subscribeChange: domSubscribeChange,
});

export function startAppAutoSync() { appSync.startAuto(); }
```

- [ ] **Step 3: `apps/app/src/file-io.js`** — in `pickFile`, change `{ ext: '.nmdprofile,application/json' }` to `{ ext: '.nmdprofile,.nmdplanner,application/json' }`.

- [ ] **Step 4: Mount the card** — in `apps/app/src/app.jsx`, in the Settings render (the bespoke settings section), import `CloudSyncCard` from `@nexusmd/ui` and `appSync` + `appFileIO` + `appCloudProviders`, and render `<CloudSyncCard controller={appSync} providers={appCloudProviders} fileIO={appFileIO} />` within the settings view (place it near the profile/connection settings group). Read the settings render region first to choose a sensible insertion point; the card uses `@nexusmd/ui` CSS which the app already imports.

- [ ] **Step 5: Start auto-sync** — in `apps/app/src/main.jsx`, add `import { startAppAutoSync } from './sync.js';` and call `startAppAutoSync();` after the root render (alongside the existing `registerCloudDeepLink()`-style init).

- [ ] **Step 6: Verify** — `npm -w apps/app run build` green; `npx vitest run` green.

- [ ] **Step 7: Commit**
```bash
git add apps/app/src/sync.js apps/app/src/file-io.js apps/app/src/app.jsx apps/app/src/main.jsx
git commit -m "feat(app): continuous cloud sync + CloudSyncCard (helm namespace)"
```

---

## Definition of Done

- `@nexusmd/ui` exports a tested `createSyncController` + DOM trigger helpers + a shared `CloudSyncCard`.
- Web consumes the shared controller + card (its bespoke `sync.js`/card collapsed to a thin instantiation); full suite + web build green.
- Desktop and app each have a `sync.js` controller instance, a mounted `CloudSyncCard`, auto-sync started, `.nmdplanner` export/import, and an OS-secure-store key cache; both builds green.
- Key-match verified on all three platforms (web identity/bare; desktop+app scoped).

## Deferred / follow-on

- App mobile-native styling of the shared card (functional parity shipped; visual polish later).
- Capacitor-native foreground trigger via `@capacitor/app` `appStateChange` (window-focus is the portable default used here).
- Desktop/app e2e coverage of a real sync round-trip (the cloud-auth e2e from the other track already exercises connect).
- Security revisit: salted KDF (PBKDF2/scrypt) instead of unsalted `SHA-256(passphrase)`; team custom/removed fast change trigger.

## Self-Review

- **Spec coverage:** spec §109 "ui + apps — automatic triggers + Sync settings card + passphrase key management (keyStore, verifier)" and Phase-5 "desktop + app cloud sync" → Tasks 1–5; **keyStore** seam = the controller's `keyStore` backed by `secureStorageAdapter` (desktop/app) / localStorage (web); **verifier** already in the runtime (Phase 4a). Cross-platform compatibility (save on phone → see on desktop) → identical engine + collections across platforms, differing only in namespace/getProfileKey (each verified key-matched).
- **Placeholder scan:** none — controller + card shown in full; platform `sync.js` shown in full; mount edits specified against the exact files/symbols gathered from the codebase.
- **Type consistency:** `createSyncController({...})` return shape, `keyStore {get,set,remove}`, `CloudSyncCard({controller,providers,fileIO})`, `dispatch(name,detail)`, DOM helper names — all consistent across Tasks 1–5.
