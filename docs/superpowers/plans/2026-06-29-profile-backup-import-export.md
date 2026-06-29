# Portable Profile Backup / Import / Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable, always-password-encrypted `.nmdprofile` file that carries one or many profiles + their data, with local export/import/backup on web and app (and a desktop follow-up), readable across apps.

**Architecture:** Pure encode/decode in `@nexusmd/core` (reuses core AES-GCM); gather/restore orchestration + a "Backup & Restore" UI card in `@nexusmd/ui` (via the existing `profileStore` seam); thin per-platform file I/O injected into the card; a new `POST /api/profiles/import` upsert on the web backend for restore-by-id.

**Tech Stack:** JS/JSX (ESM), Vitest + @testing-library/react (jsdom), React 18, ASP.NET Core 8 / xUnit, Web Crypto (AES-GCM), Capacitor Filesystem/Share (app), Vite.

## Global Constraints

- File format markers (verbatim): decrypted `format: "nexusmd-profile-bundle"`, on-disk `format: "nexusmd-profile-bundle-enc"`, `version: 1`, extension `.nmdprofile`.
- Always encrypted: every export requires a password; AES-GCM key derived via SHA-256 of `password + " nexusmd-profile-bundle"` (a salt distinct from the planner-confidential salt).
- Import mode is **restore-by-id**: overwrite matching ids, add new ones.
- `data` keys in the bundle are **namespace-stripped** (`planner.week.2026-W26`, not `nexusmd.p.<id>.planner...`); re-prefixed per app on import via `${namespace}.p.${id}.${key}`.
- Core stays headless (no React/DOM/localStorage); it may use Web Crypto globals (`crypto.subtle`, `TextEncoder`, `btoa`/`atob`) which exist in Node + browser.
- TDD, DRY, YAGNI, frequent commits. Run from repo root `C:\repos\NexusMD-Mono`.

---

## File structure

- `packages/core/src/modules/profiles/bundle.js` — **new.** Pure `encodeBundle`/`decodeBundle` + constants.
- `packages/core/src/index.js` — **modify.** Re-export bundle API.
- `packages/core/tests/public-api.test.js` — **modify.** Add new export names to snapshot.
- `packages/core/tests/profile-bundle.test.js` — **new.** Round-trip / failure tests.
- `apps/web/server/Data/ProfileRepository.cs` — **modify.** Add `Upsert`.
- `apps/web/server/Services/ProfileService.cs` — **modify.** Add `Import`.
- `apps/web/server/Controllers/ProfilesController.cs` — **modify.** Add `POST import` + DTOs.
- `apps/web/server-tests/ProfilesControllerTests.cs` — **modify.** Import endpoint tests.
- `packages/ui/src/profile-context.jsx` — **modify.** Add `exportBundle`/`importBundle` to the provider value, `localUpsertProfiles` export, extend the `store` seam doc with `importProfiles`.
- `packages/ui/src/views/view-settings.jsx` — **modify.** Add + export `BackupRestoreCard`.
- `packages/ui/src/index.js` — **modify.** Export `BackupRestoreCard`, `localUpsertProfiles`.
- `packages/ui/tests/profile-backup.test.jsx` — **new.** Provider export/import + card tests.
- `apps/web/src/profile-context.jsx` — **modify.** Add `importProfiles` to `webProfileStore`.
- `apps/web/src/file-io.js` — **new.** Web `fileIO` (download + file input).
- `apps/web/src/view-settings.jsx` — **modify.** Mount `BackupRestoreCard` with web `fileIO`.
- `apps/app/src/profile-context.jsx` — **modify.** Add `importProfiles` (local upsert) to `appProfileStore`.
- `apps/app/src/file-io.js` — **new.** App `fileIO` (Capacitor Filesystem/Share/picker).
- `apps/app/src/views/view-settings.jsx` — **modify.** Mount `BackupRestoreCard` with app `fileIO`.

---

## Task 1: Core profile-bundle (encode / decode)

**Files:**
- Create: `packages/core/src/modules/profiles/bundle.js`
- Modify: `packages/core/src/index.js`
- Modify: `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/profile-bundle.test.js`

**Interfaces:**
- Consumes: `encryptConfidentialForServer`, `decryptConfidentialFromServer` from `packages/core/src/modules/planner/confidential.js` (existing: `encrypt(cfg, passwordHashHex) → {iv, ciphertext}`, `decrypt({iv, ciphertext}, passwordHashHex) → object`).
- Produces: `encodeBundle(payload, password) → Promise<string>`, `decodeBundle(text, password) → Promise<payload>`, `BUNDLE_FORMAT`, `BUNDLE_FORMAT_ENC`, `BUNDLE_VERSION`, `BUNDLE_EXT`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/profile-bundle.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { encodeBundle, decodeBundle, BUNDLE_EXT } from '../src/index.js'

const payload = {
  exportedBy: 'web', activeId: 'p1',
  profiles: [
    { id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual', config: null,
      data: { 'planner.week.2026-W26': '{"x":1}', 'tweaks': '{"dark":true}' } },
    { id: 'p2', name: 'Home', initials: 'HM', color: '#111', type: 'ado', config: '{"org":"o"}', data: {} },
  ],
}

describe('profile bundle encode/decode', () => {
  it('round-trips one or many profiles through a password', async () => {
    const text = await encodeBundle(payload, 'hunter2')
    const out = await decodeBundle(text, 'hunter2')
    expect(out.profiles).toHaveLength(2)
    expect(out.profiles[0].data['planner.week.2026-W26']).toBe('{"x":1}')
    expect(out.activeId).toBe('p1')
    expect(out.format).toBe('nexusmd-profile-bundle')
  })

  it('the on-disk text is the encrypted wrapper (no plaintext leak)', async () => {
    const text = await encodeBundle(payload, 'hunter2')
    expect(text).toContain('nexusmd-profile-bundle-enc')
    expect(text).not.toContain('planner.week')   // payload is inside ciphertext
    expect(text).not.toContain('"Work"')
  })

  it('rejects the wrong password', async () => {
    const text = await encodeBundle(payload, 'right')
    await expect(decodeBundle(text, 'wrong')).rejects.toThrow()
  })

  it('rejects tampered ciphertext and non-bundle text', async () => {
    const text = await encodeBundle(payload, 'pw')
    const w = JSON.parse(text); w.ciphertext = 'AAAA' + w.ciphertext.slice(4)
    await expect(decodeBundle(JSON.stringify(w), 'pw')).rejects.toThrow()
    await expect(decodeBundle('{"not":"a bundle"}', 'pw')).rejects.toThrow()
    await expect(decodeBundle('not json', 'pw')).rejects.toThrow()
  })

  it('exposes the file extension', () => {
    expect(BUNDLE_EXT).toBe('.nmdprofile')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/profile-bundle.test.js`
Expected: FAIL — `encodeBundle` is not exported.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/modules/profiles/bundle.js`:

```js
// bundle.js — portable, password-encrypted profile bundle (one or many profiles).
// Pure + headless: Web Crypto via the shared AES-GCM helpers. The on-disk text is
// always the encrypted wrapper; the decrypted payload is cross-app readable.
import { encryptConfidentialForServer, decryptConfidentialFromServer } from '../planner/confidential.js'

export const BUNDLE_FORMAT     = 'nexusmd-profile-bundle'
export const BUNDLE_FORMAT_ENC = 'nexusmd-profile-bundle-enc'
export const BUNDLE_VERSION    = 1
export const BUNDLE_EXT        = '.nmdprofile'

// SHA-256(password + bundle salt) as lowercase hex → AES-256-GCM key material.
// Distinct salt from the planner-confidential hash so the keyspaces don't overlap.
async function bundleKeyHash(password) {
  const data = new TextEncoder().encode(password + ' nexusmd-profile-bundle')
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function encodeBundle(payload, password) {
  if (!password) throw new Error('A password is required.')
  const body = { ...payload, format: BUNDLE_FORMAT, version: BUNDLE_VERSION }
  const hash = await bundleKeyHash(password)
  const { iv, ciphertext } = await encryptConfidentialForServer(body, hash)
  return JSON.stringify({ format: BUNDLE_FORMAT_ENC, version: BUNDLE_VERSION, iv, ciphertext }, null, 2)
}

export async function decodeBundle(text, password) {
  let wrapper
  try { wrapper = JSON.parse(text) } catch { throw new Error('Not a NexusMD profile file.') }
  if (!wrapper || wrapper.format !== BUNDLE_FORMAT_ENC || !wrapper.iv || !wrapper.ciphertext) {
    throw new Error('Not a NexusMD profile file.')
  }
  const hash = await bundleKeyHash(password)
  let payload
  try { payload = await decryptConfidentialFromServer({ iv: wrapper.iv, ciphertext: wrapper.ciphertext }, hash) }
  catch { throw new Error('Wrong password or corrupted file.') }
  if (!payload || payload.format !== BUNDLE_FORMAT || !Array.isArray(payload.profiles)) {
    throw new Error('Wrong password or corrupted file.')
  }
  return payload
}
```

- [ ] **Step 4: Wire the barrel export**

In `packages/core/src/index.js`, add after the planner confidential export block (the lines re-exporting `hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer`):

```js
export {
  encodeBundle, decodeBundle, BUNDLE_FORMAT, BUNDLE_FORMAT_ENC, BUNDLE_VERSION, BUNDLE_EXT,
} from './modules/profiles/bundle.js'
```

- [ ] **Step 5: Update the public-API snapshot**

In `packages/core/tests/public-api.test.js`, add these names into the `EXPECTED` array (keep it sorted by the existing `.sort()` — exact placement doesn't matter, the test sorts both sides): `'encodeBundle'`, `'decodeBundle'`, `'BUNDLE_FORMAT'`, `'BUNDLE_FORMAT_ENC'`, `'BUNDLE_VERSION'`, `'BUNDLE_EXT'`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/profile-bundle.test.js packages/core/tests/public-api.test.js`
Expected: PASS (5 bundle tests + 2 public-api tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/profiles/bundle.js packages/core/src/index.js packages/core/tests/profile-bundle.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): portable encrypted profile-bundle encode/decode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Web backend — restore-by-id upsert endpoint

**Files:**
- Modify: `apps/web/server/Data/ProfileRepository.cs`
- Modify: `apps/web/server/Services/ProfileService.cs`
- Modify: `apps/web/server/Controllers/ProfilesController.cs`
- Test: `apps/web/server-tests/ProfilesControllerTests.cs`

**Interfaces:**
- Consumes: existing `ProfileRepository` (`Create`, `GetById`, `GetAll`, `SetActiveId`, `GetActiveId`), `ProfileService`, `Profile` record.
- Produces: `ProfileRepository.Upsert(Profile)`, `ProfileService.Import(IEnumerable<Profile>, string?)`, `POST /api/profiles/import` accepting `{ profiles: [...], activeId }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/server-tests/ProfilesControllerTests.cs` (inside the class):

```csharp
    [Fact]
    public async Task Import_upserts_by_id_and_sets_active()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        // Seed one profile that the import will overwrite by id.
        var seeded = await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "Old", initials = "OL", type = "manual" }));
        var existingId = seeded.GetProperty("id").GetString();

        var body = new
        {
            profiles = new[]
            {
                new { id = existingId, name = "Renamed", initials = "RN", color = "#123", type = "manual", config = (string?)null, createdAt = 1L },
                new { id = "imported-2", name = "Brand New", initials = "BN", color = "#456", type = "ado", config = "{\"org\":\"x\"}", createdAt = 2L },
            },
            activeId = "imported-2",
        };
        var res = await client.PostAsJsonAsync("/api/profiles/import", body);
        Assert.Equal(System.Net.HttpStatusCode.OK, res.StatusCode);

        var state = await ReadJson(await client.GetAsync("/api/profiles/active"));
        Assert.Equal("imported-2", state.GetProperty("activeId").GetString());
        var names = state.GetProperty("profiles").EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToList();
        Assert.Contains("Renamed", names);     // overwritten by id
        Assert.Contains("Brand New", names);   // added
        Assert.DoesNotContain("Old", names);   // replaced, not duplicated
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter Import_upserts_by_id_and_sets_active`
Expected: FAIL — 404 (no `/import` route).

- [ ] **Step 3: Add `Upsert` to the repository**

In `apps/web/server/Data/ProfileRepository.cs`, add this method (after `Update`):

```csharp
    public void Upsert(Profile p)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO Profiles (Id,Name,Initials,Color,Type,Config,CreatedAt) VALUES ($id,$na,$in,$co,$ty,$cf,$ca)";
        cmd.Parameters.AddWithValue("$id", p.Id);
        cmd.Parameters.AddWithValue("$na", p.Name);
        cmd.Parameters.AddWithValue("$in", p.Initials);
        cmd.Parameters.AddWithValue("$co", p.Color);
        cmd.Parameters.AddWithValue("$ty", p.Type);
        cmd.Parameters.AddWithValue("$cf", (object?)p.Config ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ca", p.CreatedAt);
        cmd.ExecuteNonQuery();
    }
```

- [ ] **Step 4: Add `Import` to the service**

In `apps/web/server/Services/ProfileService.cs`, add (after `Activate`):

```csharp
    public void Import(IEnumerable<Profile> records, string? activeId)
    {
        foreach (var p in records) repo.Upsert(p);
        if (!string.IsNullOrEmpty(activeId) && repo.GetById(activeId) is not null)
            repo.SetActiveId(activeId);
        else if (repo.GetActiveId() is null)
        {
            var all = repo.GetAll();
            if (all.Count > 0) repo.SetActiveId(all[0].Id);
        }
    }
```

- [ ] **Step 5: Add the endpoint + DTOs**

In `apps/web/server/Controllers/ProfilesController.cs`, add the action (after `Activate`):

```csharp
    // POST /api/profiles/import → upsert by id + set active (restore-by-id)
    [HttpPost("import")]
    public IActionResult Import([FromBody] ImportRequest req)
    {
        if (req?.Profiles is null) return BadRequest(new { error = "profiles required" });
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var records = req.Profiles.Select(d => new NexusMDWeb.Api.Models.Profile(
            Id: d.Id, Name: d.Name, Initials: d.Initials, Color: d.Color, Type: d.Type,
            Config: d.Config, CreatedAt: d.CreatedAt == 0 ? now : d.CreatedAt));
        profiles.Import(records, req.ActiveId);
        return Ok(new { imported = req.Profiles.Count });
    }
```

Add these records at the bottom of the file (next to `CreateProfileRequest`/`UpdateProfileRequest`):

```csharp
public record ImportProfileDto(
    string Id, string Name, string Initials, string Color, string Type,
    string? Config = null, long CreatedAt = 0);

public record ImportRequest(System.Collections.Generic.List<ImportProfileDto> Profiles, string? ActiveId = null);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `dotnet test apps/web/NexusMDWeb.sln`
Expected: PASS — 23 tests (22 + the new import test).

- [ ] **Step 7: Commit**

```bash
git add apps/web/server/Data/ProfileRepository.cs apps/web/server/Services/ProfileService.cs apps/web/server/Controllers/ProfilesController.cs apps/web/server-tests/ProfilesControllerTests.cs
git commit -m "feat(web): POST /api/profiles/import (restore-by-id upsert)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: UI — provider exportBundle/importBundle + local upsert helper

**Files:**
- Modify: `packages/ui/src/profile-context.jsx`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/profile-backup.test.jsx`

**Interfaces:**
- Consumes: `encodeBundle`, `decodeBundle` from `@nexusmd/core`; the provider's existing `profiles`, `activeId`, `namespace`, `storage`, `store`, `scopedPrefix(id)`.
- Produces (added to the `useProfile()` value): `exportBundle({ scope, password }) → Promise<{ filename, text }>` (scope = `'all'` or a profileId), `importBundle({ text, password }) → Promise<{ imported, names }>`. New store op contract: `store.importProfiles(records, activeId) → Promise<void>`. New export: `localUpsertProfiles(storage, namespace, records, activeId)`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/tests/profile-backup.test.jsx`:

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, useProfile, localUpsertProfiles } from '../src/index.js'

afterEach(cleanup)

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null, _map: m,
  }
}
function harness(props) {
  const ref = { api: null }
  function Probe() { ref.api = useProfile(); return null }
  render(<ProfileProvider {...props}>{React.createElement(Probe)}</ProfileProvider>)
  return ref
}

describe('profile backup export/import (provider)', () => {
  it('exportBundle gathers a profile + its namespace-stripped data, encrypted', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
      'helm.activeProfileId': 'p1',
      'helm.p.p1.planner.week.2026-W26': '{"x":1}',
      'helm.p.p1.tweaks': '{"dark":true}',
      'helm.p.OTHER.tweaks': 'leaveme',
    })
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn() } })
    const { filename, text } = await ref.api.exportBundle({ scope: 'all', password: 'pw' })
    expect(filename).toMatch(/^nexusmd-backup-\d{4}-\d{2}-\d{2}\.nmdprofile$/)
    // text is encrypted (no plaintext); decode via importing into a clean store proves round-trip:
    const store2 = makeStorage()
    const importer = vi.fn(async () => {})
    const ref2 = harness({ namespace: 'helm', storage: store2, store: { create: vi.fn(), importProfiles: importer } })
    const res = await ref2.api.importBundle({ text, password: 'pw' })
    expect(res.imported).toBe(1)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(store2.getItem('helm.p.p1.planner.week.2026-W26')).toBe('{"x":1}')
    expect(store2.getItem('helm.p.p1.tweaks')).toBe('{"dark":true}')
    expect(store2.getItem('helm.p.OTHER.tweaks')).toBeNull() // only the exported profile's keys
  })

  it('localUpsertProfiles overwrites by id and adds new', () => {
    const storage = makeStorage({
      'nexusmd.profiles': JSON.stringify([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]),
    })
    localUpsertProfiles(storage, 'nexusmd',
      [{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }], 'c')
    const list = JSON.parse(storage.getItem('nexusmd.profiles'))
    expect(list.map(p => `${p.id}:${p.name}`)).toEqual(['a:A', 'b:B2', 'c:C'])
    expect(storage.getItem('nexusmd.activeProfileId')).toBe('c')
  })
})
```

(Note: `importBundle` calls `window.location.reload()` — see Step 3 — but the card, not the provider, triggers reload. Provider `importBundle` must NOT reload. The test above asserts no reload occurs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/profile-backup.test.jsx`
Expected: FAIL — `localUpsertProfiles` / `exportBundle` not defined.

- [ ] **Step 3: Implement in the provider**

In `packages/ui/src/profile-context.jsx`:

(a) Add the core import at the top (next to the existing `import { toast } from './toast.jsx'`):

```js
import { encodeBundle, decodeBundle, BUNDLE_EXT } from '@nexusmd/core'
```

(b) Add this exported helper near the bottom of the file (above `export function useProfile`):

```js
// Local registry upsert for platforms without a server (app/desktop): merge
// records into `${namespace}.profiles` by id (overwrite existing, add new).
export function localUpsertProfiles(storage, namespace, records, activeId) {
  const KEY = `${namespace}.profiles`
  let list
  try { list = JSON.parse(storage.getItem(KEY) || '[]') } catch (_) { list = [] }
  const byId = new Map(list.map(p => [p.id, p]))
  for (const r of records) byId.set(r.id, { ...byId.get(r.id), ...r })
  try { storage.setItem(KEY, JSON.stringify([...byId.values()])) } catch (_) {}
  if (activeId) { try { storage.setItem(`${namespace}.activeProfileId`, activeId) } catch (_) {} }
}
```

(c) Inside `ProfileProvider`, after the existing `importProfile` callback, add `exportBundle` and `importBundle`:

```js
  const collectScoped = (id) => {
    const pfx = scopedPrefix(id)
    const data = {}
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k && k.startsWith(pfx)) data[k.slice(pfx.length)] = storage.getItem(k)
      }
    } catch (_) {}
    return data
  }

  const exportBundle = useCallback(async ({ scope, password }) => {
    const picked = scope === 'all' ? profiles : profiles.filter(p => p.id === scope)
    const out = picked.map(p => ({
      id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type,
      orgLabel: p.orgLabel, createdAt: p.createdAt ?? Date.now(), config: p.config ?? null,
      data: collectScoped(p.id),
    }))
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: namespace === 'helm' ? 'app' : 'web',
      activeId: scope === 'all' ? (activeId || null) : null,
      profiles: out,
    }
    const text = await encodeBundle(payload, password)
    const stamp = new Date().toISOString().slice(0, 10)
    const slug = (picked[0]?.name || 'profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const filename = scope === 'all'
      ? `nexusmd-backup-${stamp}${BUNDLE_EXT}`
      : `nexusmd-profile-${slug}${BUNDLE_EXT}`
    return { filename, text }
  }, [profiles, activeId, namespace, storage])

  const importBundle = useCallback(async ({ text, password }) => {
    const payload = await decodeBundle(text, password)
    const records = payload.profiles.map(p => ({
      id: p.id, name: p.name, initials: p.initials, color: p.color, type: p.type,
      orgLabel: p.orgLabel, createdAt: p.createdAt, config: p.config ?? null,
    }))
    if (store.importProfiles) await store.importProfiles(records, payload.activeId ?? null)
    else localUpsertProfiles(storage, namespace, records, payload.activeId ?? null)
    for (const p of payload.profiles) {
      const pfx = scopedPrefix(p.id)
      for (const [k, v] of Object.entries(p.data || {})) {
        try { storage.setItem(pfx + k, v) } catch (_) {}
      }
    }
    return { imported: records.length, names: records.map(r => r.name) }
  }, [store, storage, namespace])
```

(d) Add both to the `value` memo object and its dependency array:

```js
  const value = useMemo(() => ({
    profiles, activeProfile, activeId, loading,
    switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile,
    exportBundle, importBundle,
  }), [profiles, activeProfile, activeId, loading, switchProfile, createProfile, updateProfile, deleteProfile, exportProfile, importProfile, exportBundle, importBundle])
```

- [ ] **Step 4: Export the helper from the barrel**

In `packages/ui/src/index.js`, change the profile-context re-export line to include `localUpsertProfiles`:

```js
export { ProfileProvider, useProfile, localUpsertProfiles } from './profile-context.jsx'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/profile-backup.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/profile-context.jsx packages/ui/src/index.js packages/ui/tests/profile-backup.test.jsx
git commit -m "feat(ui): profile bundle export/import + localUpsertProfiles seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: UI — Backup & Restore card

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx`
- Modify: `packages/ui/src/index.js`
- Test: add to `packages/ui/tests/profile-backup.test.jsx`

**Interfaces:**
- Consumes: `useProfile()` (`exportBundle`/`importBundle`/`profiles`/`activeProfile`), `PlModal`/`PlFld` (already imported in this file), `Icon`, `toast`.
- Produces: `BackupRestoreCard({ fileIO, showExportSingle })` where `fileIO = { saveFile(name, text) → Promise, pickFile() → Promise<string|null> }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/tests/profile-backup.test.jsx`:

```jsx
import { BackupRestoreCard } from '../src/index.js'

describe('BackupRestoreCard', () => {
  it('exports all profiles to fileIO.saveFile after a password is entered', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
      'helm.activeProfileId': 'p1',
      'helm.p.p1.tweaks': '{"dark":true}',
    })
    const saveFile = vi.fn(async () => {})
    const fileIO = { saveFile, pickFile: vi.fn() }

    function Tree() {
      return (
        <ProfileProvider namespace="helm" storage={storage} store={{ create: () => {} }}>
          <BackupRestoreCard fileIO={fileIO} />
        </ProfileProvider>
      )
    }
    const { getByText, container } = render(<Tree />)
    await act(async () => { getByText('Back up all profiles').click() })
    // password modal appears; type + confirm + submit
    const inputs = container.querySelectorAll('input[type="password"]')
    await act(async () => {
      inputs[0].value = 'pw'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].value = 'pw'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { getByText('Export').click() })
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFile.mock.calls[0][0]).toMatch(/\.nmdprofile$/)
    expect(saveFile.mock.calls[0][1]).toContain('nexusmd-profile-bundle-enc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/tests/profile-backup.test.jsx -t BackupRestoreCard`
Expected: FAIL — `BackupRestoreCard` not exported.

- [ ] **Step 3: Implement the card**

In `packages/ui/src/views/view-settings.jsx`, add this component above the final `export { ... }` block, and add `BackupRestoreCard` to that export list. It uses `useProfile` — add `import { useProfile } from '../profile-context.jsx'` at the top of the file (alongside the other imports):

```jsx
// A password prompt — `confirm` shows a second field (export); single field for import.
function BundlePasswordModal({ open, confirm, onClose, onSubmit }) {
  const [pw, setPw] = useStateVS('')
  const [pw2, setPw2] = useStateVS('')
  const [err, setErr] = useStateVS('')
  if (!open) return null
  const submit = () => {
    if (!pw) { setErr('Enter a password.'); return }
    if (confirm && pw !== pw2) { setErr('Passwords do not match.'); return }
    onSubmit(pw); setPw(''); setPw2(''); setErr('')
  }
  const close = () => { setPw(''); setPw2(''); setErr(''); onClose() }
  return (
    <PlModal open onClose={close} icon="lock"
      title={confirm ? 'Set a password for this file' : 'Enter the file password'}
      sub="The file is encrypted with this password; you'll need it to import."
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={submit}>{confirm ? 'Export' : 'Import'}</button>
        </React.Fragment>
      )}>
      <PlFld label="Password">
        <input type="password" value={pw} autoFocus onChange={e => { setPw(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter' && !confirm) submit() }} />
      </PlFld>
      {confirm && (
        <PlFld label="Confirm password">
          <input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setErr('') }}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        </PlFld>
      )}
      {err && <div className="plm-callout err">{err}</div>}
    </PlModal>
  )
}

// fileIO: { saveFile(name, text) → Promise, pickFile() → Promise<string|null> }
function BackupRestoreCard({ fileIO, showExportSingle = true }) {
  const { profiles, activeProfile, exportBundle, importBundle } = useProfile()
  const [mode, setMode] = useStateVS(null)     // 'export-all' | 'export-one' | 'import'
  const [pendingText, setPendingText] = useStateVS(null)
  const [busy, setBusy] = useStateVS(false)

  const startExport = (scope) => { setMode(scope === 'all' ? 'export-all' : 'export-one'); setPendingText(scope) }
  const startImport = async () => {
    const text = await fileIO.pickFile()
    if (!text) return
    setPendingText(text); setMode('import')
  }
  const onPassword = async (password) => {
    setBusy(true)
    try {
      if (mode === 'import') {
        const res = await importBundle({ text: pendingText, password })
        toast?.(`Imported ${res.imported} profile${res.imported !== 1 ? 's' : ''}. Reloading…`, 'success')
        setTimeout(() => window.location.reload(), 700)
      } else {
        const scope = mode === 'export-all' ? 'all' : (activeProfile?.id)
        const { filename, text } = await exportBundle({ scope, password })
        await fileIO.saveFile(filename, text)
        toast?.('Profile file saved.', 'success')
      }
    } catch (e) {
      toast?.(e?.message || 'Something went wrong.', 'error')
    } finally { setBusy(false); setMode(null); setPendingText(null) }
  }

  return (
    <div className="card set-card">
      <div className="card-head">
        <h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name="send" size={14} /></span>&nbsp;Backup &amp; Restore</h3>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Export a password-encrypted <code>.nmdprofile</code> file you can keep as a backup or open in the other apps.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {showExportSingle && activeProfile && (
            <button className="btn sm" disabled={busy} onClick={() => startExport(activeProfile.id)}>
              <Icon name="send" size={12} /> Export this profile
            </button>
          )}
          <button className="btn sm" disabled={busy || profiles.length === 0} onClick={() => startExport('all')}>
            <Icon name="send" size={12} /> Back up all profiles
          </button>
          <button className="btn sm ghost" disabled={busy} onClick={startImport}>
            <Icon name="inbox" size={12} /> Import / Restore from file
          </button>
        </div>
      </div>
      <BundlePasswordModal
        open={mode != null}
        confirm={mode === 'export-all' || mode === 'export-one'}
        onClose={() => { setMode(null); setPendingText(null) }}
        onSubmit={onPassword}
      />
    </div>
  )
}
```

Add `BackupRestoreCard` to the file's `export { ... }` list, and add it to the barrel `packages/ui/src/index.js` settings export block (alongside `VsProfiles`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/profile-backup.test.jsx`
Expected: PASS (all profile-backup tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/profile-backup.test.jsx
git commit -m "feat(ui): Backup & Restore card (export/import .nmdprofile)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Web wiring (store.importProfiles + fileIO + mount card)

**Files:**
- Modify: `apps/web/src/profile-context.jsx`
- Create: `apps/web/src/file-io.js`
- Modify: `apps/web/src/view-settings.jsx`

**Interfaces:**
- Consumes: `BackupRestoreCard` from `@nexusmd/ui`; `POST /api/profiles/import` (Task 2).
- Produces: `webProfileStore.importProfiles(records, activeId)`; `webFileIO = { saveFile, pickFile }`.

- [ ] **Step 1: Add `importProfiles` to the web store**

In `apps/web/src/profile-context.jsx`, add to `webProfileStore` (after `remove`):

```js
  importProfiles: async (records, activeId) => {
    await fetch('/api/profiles/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: records, activeId }),
    })
  },
```

- [ ] **Step 2: Create the web fileIO**

Create `apps/web/src/file-io.js`:

```js
// Web file I/O for profile bundles: download to save, hidden <input> to open.
export const webFileIO = {
  async saveFile(filename, text) {
    if (window.nexusMDDownload) { await window.nexusMDDownload(filename, text); return }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
  pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.nmdprofile,application/json'
      input.onchange = () => {
        const f = input.files?.[0]
        if (!f) { resolve(null); return }
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => resolve(null)
        r.readAsText(f)
      }
      input.click()
    })
  },
}
```

- [ ] **Step 3: Mount the card in web Settings**

In `apps/web/src/view-settings.jsx`:
- add `BackupRestoreCard` to the existing `@nexusmd/ui` import list (the one with `VsProfiles`),
- add `import { webFileIO } from './file-io.js'` near the other imports,
- render the card next to `VsProfiles` (line ~863). Change:

```jsx
          {subPage === 'profiles' && <VsProfiles profileApi={useProfile()} />}
```
to:
```jsx
          {subPage === 'profiles' && (
            <>
              <VsProfiles profileApi={useProfile()} />
              <BackupRestoreCard fileIO={webFileIO} />
            </>
          )}
```

- [ ] **Step 4: Build to verify**

Run: `npm -w apps/web run build`
Expected: built, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/profile-context.jsx apps/web/src/file-io.js apps/web/src/view-settings.jsx
git commit -m "feat(web): wire Backup & Restore (import upsert + download/upload fileIO)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: App wiring (local importProfiles + Capacitor fileIO + mount card)

**Files:**
- Modify: `apps/app/src/profile-context.jsx`
- Create: `apps/app/src/file-io.js`
- Modify: `apps/app/src/views/view-settings.jsx`

**Interfaces:**
- Consumes: `localUpsertProfiles` from `@nexusmd/ui`; `BackupRestoreCard`; Capacitor `@capacitor/filesystem`, `@capacitor/share`.
- Produces: `appProfileStore.importProfiles`; `appFileIO = { saveFile, pickFile }`.

- [ ] **Step 1: Add `importProfiles` to the app store**

In `apps/app/src/profile-context.jsx`, add the import and the store op:

```js
import { ProfileProvider as UiProfileProvider, useProfile, localUpsertProfiles } from '@nexusmd/ui';
```
and in `appProfileStore` (after `create`):
```js
  importProfiles: async (records, activeId) => {
    localUpsertProfiles(window.localStorage, 'helm', records, activeId)
  },
```

- [ ] **Step 2: Create the app fileIO**

Create `apps/app/src/file-io.js`:

```js
// App (Capacitor) file I/O for profile bundles: write to Documents + Share to
// save; pick a file via a hidden <input> (the system file UI) to open.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export const appFileIO = {
  async saveFile(filename, text) {
    const { uri } = await Filesystem.writeFile({
      path: filename, data: text, directory: Directory.Documents, encoding: Encoding.UTF8,
    })
    try { await Share.share({ title: filename, url: uri }) } catch (_) { /* user dismissed share */ }
  },
  pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.nmdprofile,application/json,*/*'
      input.onchange = () => {
        const f = input.files?.[0]
        if (!f) { resolve(null); return }
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => resolve(null)
        r.readAsText(f)
      }
      input.click()
    })
  },
}
```

- [ ] **Step 3: Mount the card in app Settings**

In `apps/app/src/views/view-settings.jsx`:
- add `BackupRestoreCard` to the `@nexusmd/ui` import list,
- add `import { appFileIO } from '../file-io.js'`,
- render next to `VsProfiles` (line ~331):

```jsx
          {subPage === 'profiles' && (
            <>
              <VsProfiles profileApi={useProfile()} showOrgLabel={false} />
              <BackupRestoreCard fileIO={appFileIO} showExportSingle={true} />
            </>
          )}
```

- [ ] **Step 4: Verify `@capacitor/share` is installed**

Run: `node -e "require('./apps/app/node_modules/@capacitor/share/package.json')" || npm -w apps/app i @capacitor/share`
Expected: resolves (it's a standard Capacitor plugin; install if missing). `@capacitor/filesystem` is already a dependency.

- [ ] **Step 5: Build to verify**

Run: `npm -w apps/app run build`
Expected: built, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/profile-context.jsx apps/app/src/file-io.js apps/app/src/views/view-settings.jsx apps/app/package.json package-lock.json
git commit -m "feat(app): wire Backup & Restore (local upsert + Capacitor fileIO)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the JS suite**

Run: `npx vitest run`
Expected: all green (existing 351 + new core/ui bundle tests).

- [ ] **Step 2: Run the backend suite**

Run: `dotnet test apps/web/NexusMDWeb.sln`
Expected: 23 green.

- [ ] **Step 3: Build all frontends**

Run: `npm -w apps/web run build && npm -w apps/app run build && npm -w apps/desktop run build:renderer`
Expected: all built.

- [ ] **Step 4: Manual smoke (document results, do not automate)**

Web: `dotnet run --project apps/web/server` → Settings → Profiles → "Back up all profiles" (set password) → file downloads; "Import / Restore" the file (enter password) → toast + reload, profiles intact. App: build + run, same flow via the share sheet / file picker. Wrong password on import → friendly error toast.

- [ ] **Step 5: Commit any doc/status updates** (e.g. memory `project_monorepo_status.md`).

---

## Desktop (deferred — follow-up)

Desktop currently has **no `ProfileProvider` and a placeholder Settings** (`apps/desktop/src/main.jsx`), so it has no profiles UI to host the card. The bundle format is already desktop-ready via `@nexusmd/core`. When desktop gains a Settings/profiles surface, add: a local `ProfileProvider` wrapper (store = `{ create, importProfiles: (r,a)=>localUpsertProfiles(localStorage,'nexusmd',r,a) }`, namespace `'nexusmd'`), a `desktopFileIO` backed by the existing Electron IPC (`window.electronAPI.file.*` + a save/open dialog — extend `electron/preload.js` if a bundle save/open dialog isn't present), and mount `BackupRestoreCard`. Tracked separately; not part of this plan's deliverable.

---

## Self-review notes (addressed)

- **Spec coverage:** file format (Task 1), encrypt-all (Task 1), 1-or-many (Task 3 `exportBundle` scope), restore-by-id (Task 2 upsert + Task 3 `importBundle`), per-platform file I/O (Tasks 5–6), Backup & Restore UI (Task 4), replace old single export (the card supersedes the old buttons; old `exportProfile`/`importProfile` remain harmless but unused — remove only if a later cleanup task is added), testing (every task is TDD), cross-app config limitation (carried as `config` + `data` per spec; no extra work). Desktop: format-ready now, UI deferred (documented above + flagged at handoff — the spec said three platforms; desktop needs a profiles UI first).
- **Type consistency:** `exportBundle`/`importBundle`/`importProfiles`/`localUpsertProfiles`/`BackupRestoreCard`/`webFileIO`/`appFileIO`/`fileIO.{saveFile,pickFile}` names are used identically across tasks. Bundle field names (`format`, `version`, `iv`, `ciphertext`, `profiles[].{id,name,initials,color,type,orgLabel,createdAt,config,data}`, `activeId`) match Task 1 ↔ Task 3 ↔ Task 2 DTO.
