# Planner Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic per-week planner sync to a local folder and/or Google Drive, with version-stamp-based conflict detection and a resolution modal.

**Architecture:** `planner-sync.js` is a vanilla JS module (`window.PlannerSync`) that wraps the existing `saveWeekPlanner` call to trigger on-change autosave, drives a periodic sync timer, and emits DOM events for UI. The backend gains new Drive endpoints that store per-week planner JSON files with `appProperties.version` stamps for lightweight metadata-only conflict checks. The Settings page gains a `PlannerSyncCard` component that reads sync events and shows the conflict modal.

**Tech Stack:** ASP.NET Core 8 (C# backend, xUnit tests), React (browser-only JSX via Babel, no bundler), Google Drive API v3 (`appDataFolder` space), Electron `window.electronAPI.saveFile` for local folder writes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `ManagementDashboard.Api/Services/GoogleService.cs` | Modify | Add `ListPlannerFilesAsync`, `UpsertPlannerFileAsync`, `DownloadPlannerFileAsync` |
| `ManagementDashboard.Api/Controllers/GoogleController.cs` | Modify | Add `/api/google/drive/planner/files`, `/api/google/drive/planner/upload`, `/api/google/drive/planner/download/{fileId}` |
| `ManagementDashboard.Tests/Google/GoogleServiceTests.cs` | Modify | Add tests for the three new service methods |
| `ManagementDashboard.Api/wwwroot/planner-sync.js` | Create | Full sync engine (`window.PlannerSync`) |
| `ManagementDashboard.Api/wwwroot/index.html` | Modify | Load `planner-sync.js` before planner JSX files |
| `ManagementDashboard.Api/wwwroot/view-planner.jsx` | Modify | Call `window.PlannerSync?.onWeekSaved(year, week)` inside `saveWeekPlanner` |
| `ManagementDashboard.Api/wwwroot/view-settings.jsx` | Modify | Add `PlannerSyncCard` component + wire into settings page |

---

## Task 1: Add `PlannerDriveFile` DTO and Drive service methods

**Files:**
- Modify: `ManagementDashboard.Api/Services/GoogleService.cs`

Context: `GoogleService.cs` already has `DriveFile` DTO and methods for the existing manual-backup feature. We need three new methods for per-week planner sync files. All planner files live in `appDataFolder` and carry an `appProperties.version` integer stamp so periodic sync can check versions without downloading file content.

- [ ] **Step 1: Add the `PlannerDriveFile` DTO** near the top of `GoogleService.cs` alongside the other DTOs (after the `DriveFile` record, around line 18):

```csharp
public record PlannerDriveFile(string Id, string Name, string ModifiedTime, int Version);
```

- [ ] **Step 2: Add `ListPlannerFilesAsync`** to `GoogleService.cs`, after the `ListDriveBackupsAsync` method:

```csharp
public async Task<IReadOnlyList<PlannerDriveFile>> ListPlannerFilesAsync(string token, string profileId, CancellationToken ct)
{
    var nameFilter = Uri.EscapeDataString($"name contains 'planner-{profileId}-'");
    var fields     = Uri.EscapeDataString("files(id,name,modifiedTime,appProperties)");
    var path = $"drive/v3/files?spaces=appDataFolder&q={nameFilter}&fields={fields}&orderBy=modifiedTime%20desc";

    using var req = BuildRequest(HttpMethod.Get, path, token);
    var res = await http.SendAsync(req, ct);
    if (!res.IsSuccessStatusCode) return [];

    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
    return doc.RootElement.TryGetProperty("files", out var f)
        ? f.EnumerateArray().Select(file =>
        {
            var versionStr = file.TryGetProperty("appProperties", out var ap) &&
                             ap.TryGetProperty("version", out var v) ? v.GetString() ?? "0" : "0";
            return new PlannerDriveFile(
                file.GetProperty("id").GetString() ?? "",
                file.GetProperty("name").GetString() ?? "",
                file.TryGetProperty("modifiedTime", out var mt) ? mt.GetString() ?? "" : "",
                int.TryParse(versionStr, out var ver) ? ver : 0);
        }).ToList()
        : [];
}
```

- [ ] **Step 3: Add `UpsertPlannerFileAsync`** after `ListPlannerFilesAsync`:

```csharp
public async Task<string?> UpsertPlannerFileAsync(
    string token, string fileName, string jsonContent, int version, string? existingFileId, CancellationToken ct)
{
    var metadata  = JsonSerializer.Serialize(new
    {
        name           = fileName,
        parents        = existingFileId is null ? new[] { "appDataFolder" } : Array.Empty<string>(),
        appProperties  = new { version = version.ToString() },
    });
    var boundary  = "planner_sync_boundary";
    var multipart = $"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{jsonContent}\r\n--{boundary}--";

    var method = existingFileId is null ? HttpMethod.Post : HttpMethod.Patch;
    var url    = existingFileId is null
        ? "upload/drive/v3/files?uploadType=multipart"
        : $"upload/drive/v3/files/{existingFileId}?uploadType=multipart";

    using var req = BuildRequest(method, url, token);
    req.Content   = new StringContent(multipart, Encoding.UTF8, $"multipart/related; boundary={boundary}");
    var res = await http.SendAsync(req, ct);
    if (!res.IsSuccessStatusCode) return null;

    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
    return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : existingFileId;
}
```

- [ ] **Step 4: Add `DownloadPlannerFileAsync`** — reuses the same Drive download call as the existing `DownloadDriveBackupAsync` but with a clearer name for callers:

```csharp
public Task<string?> DownloadPlannerFileAsync(string token, string fileId, CancellationToken ct)
    => DownloadDriveBackupAsync(token, fileId, ct);
```

- [ ] **Step 5: Build and verify no compile errors**

```
dotnet build ManagementDashboard.sln
```

Expected: Build succeeded, 0 error(s).

- [ ] **Step 6: Commit**

```
git add ManagementDashboard.Api/Services/GoogleService.cs
git commit -m "feat: add Drive planner sync methods to GoogleService"
```

---

## Task 2: Add planner sync API endpoints to GoogleController

**Files:**
- Modify: `ManagementDashboard.Api/Controllers/GoogleController.cs`

- [ ] **Step 1: Add `ListPlannerFiles` endpoint** after the existing `[HttpGet("drive/files")]` action (around line 115):

```csharp
[HttpGet("drive/planner/files")]
public async Task<IActionResult> ListPlannerFiles([FromQuery] string? token, [FromQuery] string? profileId, CancellationToken ct)
{
    if (string.IsNullOrEmpty(token))     return BadRequest(new { error = "token is required" });
    if (string.IsNullOrEmpty(profileId)) return BadRequest(new { error = "profileId is required" });
    var files = await google.ListPlannerFilesAsync(token, profileId, ct);
    return Ok(files);
}
```

- [ ] **Step 2: Add `UploadPlannerFile` endpoint** after `ListPlannerFiles`:

```csharp
[HttpPost("drive/planner/upload")]
public async Task<IActionResult> UploadPlannerFile([FromBody] JsonElement body, CancellationToken ct)
{
    var token      = body.TryGetProperty("token",      out var t)  ? t.GetString()  ?? "" : "";
    var fileName   = body.TryGetProperty("fileName",   out var fn) ? fn.GetString() ?? "" : "";
    var data       = body.TryGetProperty("data",       out var d)  ? d.GetString()  ?? "" : "";
    var version    = body.TryGetProperty("version",    out var v)  && v.TryGetInt32(out var vi) ? vi : 1;
    var fileId     = body.TryGetProperty("fileId",     out var fi) ? fi.GetString() : null;

    if (string.IsNullOrEmpty(token))    return BadRequest(new { error = "token is required" });
    if (string.IsNullOrEmpty(fileName)) return BadRequest(new { error = "fileName is required" });
    if (string.IsNullOrEmpty(data))     return BadRequest(new { error = "data is required" });

    var resultId = await google.UpsertPlannerFileAsync(token, fileName, data, version, fileId, ct);
    return resultId is not null ? Ok(new { fileId = resultId }) : StatusCode(500, new { error = "Upload failed." });
}
```

- [ ] **Step 3: Add `DownloadPlannerFile` endpoint** after `UploadPlannerFile`:

```csharp
[HttpGet("drive/planner/download/{fileId}")]
public async Task<IActionResult> DownloadPlannerFile(string fileId, [FromQuery] string? token, CancellationToken ct)
{
    if (string.IsNullOrEmpty(token)) return BadRequest(new { error = "token is required" });
    var content = await google.DownloadPlannerFileAsync(token, fileId, ct);
    return content is not null ? Content(content, "application/json") : NotFound();
}
```

- [ ] **Step 4: Build**

```
dotnet build ManagementDashboard.sln
```

Expected: Build succeeded, 0 error(s).

- [ ] **Step 5: Commit**

```
git add ManagementDashboard.Api/Controllers/GoogleController.cs
git commit -m "feat: add Drive planner sync endpoints to GoogleController"
```

---

## Task 3: Tests for new Drive service methods

**Files:**
- Modify: `ManagementDashboard.Tests/Google/GoogleServiceTests.cs`

- [ ] **Step 1: Add `ListPlannerFilesAsync` test** at the end of `GoogleServiceTests`:

```csharp
[Fact]
public async Task ListPlannerFilesAsync_returns_files_with_version_from_appProperties()
{
    var handler = new FakeGoogleHandler();
    // The URL includes URL-encoded q= and fields= params — match what the service builds
    var encodedQ      = Uri.EscapeDataString("name contains 'planner-profile1-'");
    var encodedFields = Uri.EscapeDataString("files(id,name,modifiedTime,appProperties)");
    handler.Responses[$"/drive/v3/files?spaces=appDataFolder&q={encodedQ}&fields={encodedFields}&orderBy=modifiedTime%20desc"] =
        """{"files":[{"id":"p1","name":"planner-profile1-2026-W24.json","modifiedTime":"2026-06-15T09:00:00Z","appProperties":{"version":"7"}}]}""";

    var svc   = MakeService(handler);
    var files = await svc.ListPlannerFilesAsync("my-token", "profile1", default);

    Assert.Single(files);
    Assert.Equal("p1",                              files[0].Id);
    Assert.Equal("planner-profile1-2026-W24.json", files[0].Name);
    Assert.Equal(7,                                files[0].Version);
}
```

- [ ] **Step 2: Add `UpsertPlannerFileAsync` create test**:

```csharp
[Fact]
public async Task UpsertPlannerFileAsync_creates_new_file_and_returns_file_id()
{
    var handler = new FakeGoogleHandler();
    handler.Responses["/upload/drive/v3/files?uploadType=multipart"] =
        """{"id":"new-file-id"}""";

    var svc    = MakeService(handler);
    var fileId = await svc.UpsertPlannerFileAsync(
        "my-token", "planner-abc-2026-W24.json",
        """{"version":1,"data":{}}""", 1, null, default);

    Assert.Equal("new-file-id", fileId);
    Assert.Single(handler.Calls);
    Assert.Equal(HttpMethod.Post, handler.Calls[0].Method);
    Assert.Contains("appDataFolder", handler.Calls[0].Body ?? "");
}
```

- [ ] **Step 3: Add `UpsertPlannerFileAsync` update test**:

```csharp
[Fact]
public async Task UpsertPlannerFileAsync_patches_existing_file_and_returns_same_id()
{
    var handler = new FakeGoogleHandler();
    handler.Responses["/upload/drive/v3/files/existing-id?uploadType=multipart"] =
        """{"id":"existing-id"}""";

    var svc    = MakeService(handler);
    var fileId = await svc.UpsertPlannerFileAsync(
        "my-token", "planner-abc-2026-W24.json",
        """{"version":2,"data":{}}""", 2, "existing-id", default);

    Assert.Equal("existing-id", fileId);
    Assert.Single(handler.Calls);
    Assert.Equal(HttpMethod.Patch, handler.Calls[0].Method);
}
```

- [ ] **Step 4: Add error-path test**:

```csharp
[Fact]
public async Task UpsertPlannerFileAsync_returns_null_on_http_error()
{
    var svc    = MakeService(new ErrorGoogleHandler(System.Net.HttpStatusCode.Unauthorized));
    var fileId = await svc.UpsertPlannerFileAsync("bad-token", "planner-abc-2026-W24.json", "{}", 1, null, default);
    Assert.Null(fileId);
}
```

- [ ] **Step 5: Run tests**

```
dotnet test ManagementDashboard.Tests
```

Expected: All tests pass. The three new tests should pass; existing tests should be unaffected.

- [ ] **Step 6: Commit**

```
git add ManagementDashboard.Tests/Google/GoogleServiceTests.cs
git commit -m "test: add Drive planner sync service tests"
```

---

## Task 4: Create `planner-sync.js` — settings, sync state, and helpers

**Files:**
- Create: `ManagementDashboard.Api/wwwroot/planner-sync.js`

This is the first of four tasks that build up `planner-sync.js`. Start the file here; subsequent tasks append to it. The module uses the `window.PlannerSync` global, set at the bottom.

- [ ] **Step 1: Write the file** (`ManagementDashboard.Api/wwwroot/planner-sync.js`):

```javascript
// planner-sync.js — Planner file sync engine.
// Exposes window.PlannerSync. Load before planner JSX files.
// Requires: google-auth.js (window.GoogleAuth), profile-keys.js (window.getProfileKey).
// Optional: window.electronAPI.saveFile for local folder writes.
(function () {

// ── Constants ─────────────────────────────────────────────────
const SYNC_SETTINGS_KEY  = 'planner.sync';         // profile-namespaced pref key
const SYNC_STATE_KEY     = 'planner.syncState';    // profile-namespaced pref key
const QUEUE_KEY_PREFIX   = 'planner.queue.';       // profile-namespaced offline queue
const DEFAULT_INTERVAL   = 60;                      // minutes

// ── Settings helpers ──────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem(window.getProfileKey?.(SYNC_SETTINGS_KEY));
    return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
  } catch { return defaultSettings(); }
}

function defaultSettings() {
  return { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: DEFAULT_INTERVAL };
}

function saveSettings(s) {
  try { localStorage.setItem(window.getProfileKey?.(SYNC_SETTINGS_KEY), JSON.stringify(s)); } catch {}
}

// ── Sync state helpers ────────────────────────────────────────
// syncState.weeks[weekKey] = { version, driveFileId, syncedAt, pendingLocalChanges }
// version: last version successfully pushed to Drive (0 = never synced)
// pendingLocalChanges: true when local data changed since last Drive push

function loadSyncState() {
  try {
    const raw = localStorage.getItem(window.getProfileKey?.(SYNC_STATE_KEY));
    return raw ? JSON.parse(raw) : { weeks: {} };
  } catch { return { weeks: {} }; }
}

function saveSyncState(state) {
  try { localStorage.setItem(window.getProfileKey?.(SYNC_STATE_KEY), JSON.stringify(state)); } catch {}
}

function getWeekState(state, weekKey) {
  return state.weeks[weekKey] ?? { version: 0, driveFileId: null, syncedAt: null, pendingLocalChanges: false };
}

// ── Week key / filename helpers ───────────────────────────────
function weekKey(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekFileName(profileId, year, week) {
  return `planner-${profileId}-${weekKey(year, week)}.json`;
}

function weekStorageKey(year, week) {
  return `nexusmd.planner.week.${weekKey(year, week)}`;
}

function activeProfileId() {
  return localStorage.getItem('nexusmd.activeProfileId') || '';
}

// ── Status emission ───────────────────────────────────────────
// Listeners: PlannerSyncCard in view-settings.jsx
// detail.state: 'idle' | 'syncing' | 'offline' | 'conflict' | 'error' | 'disconnected'
function emitStatus(state, extra = {}) {
  document.dispatchEvent(new CustomEvent('nexusmd:planner-sync-status', {
    detail: { state, lastSynced: _lastSynced, conflicts: _conflicts, ...extra },
  }));
}

// ── Module state ──────────────────────────────────────────────
let _timer     = null;
let _lastSynced = null;
let _conflicts  = [];   // [{ weekKey, localVersion, driveVersion, driveFileId }]
let _debounce   = {};   // weekKey → setTimeout id

// exported at bottom as window.PlannerSync
```

- [ ] **Step 2: Verify the file exists** — read back the first 10 lines to confirm it saved correctly, then move on.

- [ ] **Step 3: Commit** (partial file — subsequent tasks extend it):

```
git add ManagementDashboard.Api/wwwroot/planner-sync.js
git commit -m "feat: add planner-sync.js scaffold — settings and sync state helpers"
```

---

## Task 5: `planner-sync.js` — week payload builder and Drive API calls

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/planner-sync.js` (append before the closing `}`)

- [ ] **Step 1: Append the week payload builder and Drive helpers** inside the IIFE, before the closing `}`):

```javascript
// ── Week payload builder ──────────────────────────────────────
function buildWeekPayload(profileId, year, week, version) {
  const raw = localStorage.getItem(weekStorageKey(year, week));
  const parsed = raw ? JSON.parse(raw) : {};
  return JSON.stringify({
    version,
    savedAt:   new Date().toISOString(),
    profileId,
    data:      parsed.data   ?? {},
    themes:    parsed.themes ?? {},
  });
}

// ── Local folder write ────────────────────────────────────────
async function writeWeekLocal(profileId, year, week, version, folder) {
  if (!window.electronAPI?.saveFile || !folder) return;
  const filename = weekFileName(profileId, year, week);
  const content  = buildWeekPayload(profileId, year, week, version);
  try {
    await window.electronAPI.saveFile(filename, content, folder);
  } catch (err) {
    emitStatus('error', { message: `Local save failed: ${err?.message ?? err}` });
    window.toast?.(`Planner sync: local save failed — check the folder in Settings.`, 'error');
  }
}

// ── Offline queue (localStorage-based) ───────────────────────
function queueKey(profileId, weekKey_) {
  return window.getProfileKey?.(QUEUE_KEY_PREFIX + weekKey_) ?? '';
}

function enqueueWeek(profileId, year, week, version) {
  const wk  = weekKey(year, week);
  const key = queueKey(profileId, wk);
  if (!key) return;
  try {
    localStorage.setItem(key, buildWeekPayload(profileId, year, week, version));
  } catch {}
}

function listQueuedWeeks(profileId) {
  const prefix = window.getProfileKey?.(QUEUE_KEY_PREFIX) ?? '';
  if (!prefix) return [];
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

// ── Drive API calls ───────────────────────────────────────────
// Low-level: upload pre-built JSON content string (used by both on-change save and offline queue flush).
async function _driveUploadRaw(token, fileName, jsonContent, version, existingFileId) {
  const body = JSON.stringify({ token, fileName, data: jsonContent, version, fileId: existingFileId ?? undefined });
  const res  = await fetch('/api/google/drive/planner/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.fileId;
}

// High-level: build payload from localStorage then upload (×2 retry).
async function driveUploadWithRetry(token, profileId, year, week, version, existingFileId) {
  const fileName = weekFileName(profileId, year, week);
  const content  = buildWeekPayload(profileId, year, week, version);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await _driveUploadRaw(token, fileName, content, version, existingFileId);
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
}

async function driveListFiles(token, profileId) {
  const res = await fetch(
    `/api/google/drive/planner/files?token=${encodeURIComponent(token)}&profileId=${encodeURIComponent(profileId)}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // [{ id, name, modifiedTime, version }]
}

async function driveDownloadFile(token, fileId) {
  const res = await fetch(
    `/api/google/drive/planner/download/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(20_000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { version, savedAt, profileId, data, themes }
}
```

- [ ] **Step 2: Build check** — open the browser console (or just verify no obvious syntax errors by reading the file). Since there's no bundler, syntax errors will show at runtime. Do a quick scan of the file for matching braces.

- [ ] **Step 3: Commit**

```
git add ManagementDashboard.Api/wwwroot/planner-sync.js
git commit -m "feat: planner-sync.js — week payload builder and Drive API helpers"
```

---

## Task 6: `planner-sync.js` — `onWeekSaved` (on-change autosave)

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/planner-sync.js` (append inside IIFE before closing `}`)

- [ ] **Step 1: Append `onWeekSaved`**:

```javascript
// ── On-change autosave ────────────────────────────────────────
// Called by view-planner.jsx's saveWeekPlanner wrapper.
// Debounced 5 s per week so rapid edits don't spam the API.
async function onWeekSaved(year, week) {
  const wk = weekKey(year, week);
  clearTimeout(_debounce[wk]);
  _debounce[wk] = setTimeout(() => _doSave(year, week, wk), 5_000);
}

async function _doSave(year, week, wk) {
  const settings  = loadSettings();
  if (!settings.localEnabled && !settings.driveEnabled) return;

  const state     = loadSyncState();
  const ws        = getWeekState(state, wk);
  const newVersion = ws.version + 1;
  const profileId  = activeProfileId();

  // Update sync state immediately (marks local as ahead)
  state.weeks[wk] = { ...ws, version: newVersion, pendingLocalChanges: true };
  saveSyncState(state);

  // Local folder write
  if (settings.localEnabled && settings.localFolder) {
    await writeWeekLocal(profileId, year, week, newVersion, settings.localFolder);
  }

  // Drive upload (or queue if offline)
  if (settings.driveEnabled) {
    const token = window.GoogleAuth?.getAuth?.()?.accessToken;
    if (!token) { emitStatus('disconnected'); return; }
    if (!navigator.onLine) {
      enqueueWeek(profileId, year, week, newVersion);
      emitStatus('offline');
      return;
    }
    emitStatus('syncing');
    try {
      const fileId = await driveUploadWithRetry(token, profileId, year, week, newVersion, ws.driveFileId ?? null);
      const now = new Date().toISOString();
      state.weeks[wk] = { version: newVersion, driveFileId: fileId, syncedAt: now, pendingLocalChanges: false };
      saveSyncState(state);
      _lastSynced = now;
      emitStatus('idle');
    } catch (err) {
      emitStatus('error', { message: String(err) });
    }
  }
}
```

- [ ] **Step 2: Commit**

```
git add ManagementDashboard.Api/wwwroot/planner-sync.js
git commit -m "feat: planner-sync.js — onWeekSaved debounced autosave"
```

---

## Task 7: `planner-sync.js` — periodic sync tick and offline queue flush

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/planner-sync.js` (append inside IIFE before closing `}`)

- [ ] **Step 1: Append `flushOfflineQueue` and `syncTick`**:

```javascript
// ── Offline queue flush ───────────────────────────────────────
async function flushOfflineQueue(token, profileId, settings) {
  const queuedKeys = listQueuedWeeks(profileId);
  if (!queuedKeys.length) return;

  for (const lsKey of queuedKeys) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      const { version, data, themes } = payload;
      // Derive year/week from key suffix (lsKey ends with "YYYY-WNN")
      const suffix = lsKey.split(QUEUE_KEY_PREFIX).pop() ?? '';
      const [yearStr, weekStr] = suffix.split('-W');
      const year = parseInt(yearStr, 10);
      const week = parseInt(weekStr, 10);
      if (!year || !week) continue;

      const state   = loadSyncState();
      const wk      = weekKey(year, week);
      const ws      = getWeekState(state, wk);
      // Use _driveUploadRaw with the stored payload — driveUploadWithRetry re-reads
      // localStorage and may pick up newer data than what was originally queued.
      const fileName_ = weekFileName(profileId, year, week);
      let fileId;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { fileId = await _driveUploadRaw(token, fileName_, raw, version, ws.driveFileId ?? null); break; }
        catch (err) { if (attempt === 1) throw err; }
      }
      const now     = new Date().toISOString();
      state.weeks[wk] = { version, driveFileId: fileId, syncedAt: now, pendingLocalChanges: false };
      saveSyncState(state);
      _lastSynced = now;
      localStorage.removeItem(lsKey);

      // If local folder also enabled, write the stored payload there too
      if (settings.localEnabled && settings.localFolder) {
        await window.electronAPI?.saveFile?.(fileName_, raw, settings.localFolder);
      }
    } catch (err) {
      // Leave queued — will retry next tick
      console.warn('[PlannerSync] offline queue flush failed for', lsKey, err);
    }
  }
}

// ── Periodic sync tick ────────────────────────────────────────
async function syncTick() {
  const settings  = loadSettings();
  if (!settings.driveEnabled) return;

  const token = window.GoogleAuth?.getAuth?.()?.accessToken;
  if (!token) { emitStatus('disconnected'); return; }
  if (!navigator.onLine) { emitStatus('offline'); return; }

  emitStatus('syncing');
  const profileId = activeProfileId();

  // Flush offline queue first
  await flushOfflineQueue(token, profileId, settings);

  // Fetch Drive file list (metadata only — no content download yet)
  let driveFiles;
  try {
    driveFiles = await driveListFiles(token, profileId);
  } catch (err) {
    emitStatus('error', { message: String(err) });
    return;
  }

  const state = loadSyncState();
  let stateChanged = false;

  for (const df of driveFiles) {
    // df = { id, name, modifiedTime, version }
    // Derive weekKey from filename: planner-{profileId}-{year}-W{week}.json
    const match = df.name.match(/planner-[^-]+-(\d{4}-W\d{2})\.json/);
    if (!match) continue;
    const wk = match[1];
    const [yearStr, weekStr] = wk.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const ws   = getWeekState(state, wk);

    const driveVersion = df.version;
    const localPending = ws.pendingLocalChanges;
    const knownVersion = ws.version;

    if (driveVersion > knownVersion && localPending) {
      // Conflict — both sides have changed
      _conflicts = _conflicts.filter(c => c.weekKey !== wk);
      _conflicts.push({ weekKey: wk, year, week, localVersion: knownVersion + 1, driveVersion, driveFileId: df.id });
      emitStatus('conflict');
    } else if (driveVersion > knownVersion && !localPending) {
      // Drive is ahead — pull
      try {
        const remote = await driveDownloadFile(token, df.id);
        // Write to localStorage
        const lsKey = weekStorageKey(year, week);
        localStorage.setItem(lsKey, JSON.stringify({ data: remote.data, themes: remote.themes }));
        // Write to local folder if enabled
        if (settings.localEnabled && settings.localFolder) {
          await writeWeekLocal(profileId, year, week, driveVersion, settings.localFolder);
        }
        const now = new Date().toISOString();
        state.weeks[wk] = { version: driveVersion, driveFileId: df.id, syncedAt: now, pendingLocalChanges: false };
        stateChanged = true;
        _lastSynced = now;
      } catch (err) {
        console.warn('[PlannerSync] pull failed for', wk, err);
      }
    } else if (driveVersion === knownVersion && localPending) {
      // Local is ahead — push
      try {
        const newVersion = knownVersion + 1;
        const fileId = await driveUploadWithRetry(token, profileId, year, week, newVersion, df.id);
        const now = new Date().toISOString();
        state.weeks[wk] = { version: newVersion, driveFileId: fileId, syncedAt: now, pendingLocalChanges: false };
        stateChanged = true;
        _lastSynced = now;
      } catch (err) {
        console.warn('[PlannerSync] push failed for', wk, err);
      }
    }
    // else: driveVersion === knownVersion && !localPending → up to date, no action
  }

  if (stateChanged) saveSyncState(state);
  const hasConflicts = _conflicts.length > 0;
  emitStatus(hasConflicts ? 'conflict' : 'idle');
}
```

- [ ] **Step 2: Commit**

```
git add ManagementDashboard.Api/wwwroot/planner-sync.js
git commit -m "feat: planner-sync.js — periodic sync tick and offline queue flush"
```

---

## Task 8: `planner-sync.js` — bootstrap, conflict resolution, timer, and init

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/planner-sync.js` (append inside IIFE before closing `}`, then close the IIFE and add `window.PlannerSync`)

- [ ] **Step 1: Append bootstrap, conflict resolution, timer management, and init**:

```javascript
// ── First-run bootstrap ───────────────────────────────────────
async function bootstrapFromDrive() {
  const token = window.GoogleAuth?.getAuth?.()?.accessToken;
  if (!token || !navigator.onLine) return;
  const profileId = activeProfileId();
  emitStatus('syncing', { bootstrapping: true });
  try {
    const driveFiles = await driveListFiles(token, profileId);
    const state      = loadSyncState();
    for (const df of driveFiles) {
      const match = df.name.match(/planner-[^-]+-(\d{4}-W\d{2})\.json/);
      if (!match) continue;
      const wk = match[1];
      const ws = getWeekState(state, wk);
      if (df.version > ws.version) {
        const [yearStr, weekStr] = wk.split('-W');
        const year = parseInt(yearStr, 10);
        const week = parseInt(weekStr, 10);
        try {
          const remote = await driveDownloadFile(token, df.id);
          localStorage.setItem(weekStorageKey(year, week), JSON.stringify({ data: remote.data, themes: remote.themes }));
          state.weeks[wk] = { version: df.version, driveFileId: df.id, syncedAt: new Date().toISOString(), pendingLocalChanges: false };
        } catch {}
      }
    }
    saveSyncState(state);
    emitStatus('idle', { bootstrapping: false });
  } catch (err) {
    emitStatus('error', { message: String(err), bootstrapping: false });
  }
}

// ── Conflict resolution ───────────────────────────────────────
// Called by PlannerSyncCard when user picks "Keep mine" or "Use Drive version"
async function resolveConflict(wk, choice) {
  const conflict = _conflicts.find(c => c.weekKey === wk);
  if (!conflict) return;
  const token = window.GoogleAuth?.getAuth?.()?.accessToken;
  if (!token) return;
  const profileId = activeProfileId();
  const state     = loadSyncState();
  const ws        = getWeekState(state, wk);
  const [yearStr, weekStr] = wk.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  try {
    if (choice === 'mine') {
      const newVersion = conflict.driveVersion + 1;
      const fileId = await driveUploadWithRetry(token, profileId, year, week, newVersion, conflict.driveFileId);
      state.weeks[wk] = { version: newVersion, driveFileId: fileId, syncedAt: new Date().toISOString(), pendingLocalChanges: false };
    } else {
      // choice === 'drive'
      const remote = await driveDownloadFile(token, conflict.driveFileId);
      localStorage.setItem(weekStorageKey(year, week), JSON.stringify({ data: remote.data, themes: remote.themes }));
      const settings = loadSettings();
      if (settings.localEnabled && settings.localFolder) {
        await writeWeekLocal(profileId, year, week, conflict.driveVersion, settings.localFolder);
      }
      state.weeks[wk] = { version: conflict.driveVersion, driveFileId: conflict.driveFileId, syncedAt: new Date().toISOString(), pendingLocalChanges: false };
    }
    saveSyncState(state);
    _conflicts = _conflicts.filter(c => c.weekKey !== wk);
    _lastSynced = new Date().toISOString();
    emitStatus(_conflicts.length ? 'conflict' : 'idle');
    if (choice === 'drive') window.location.reload();
  } catch (err) {
    emitStatus('error', { message: String(err) });
  }
}

// ── Timer management ──────────────────────────────────────────
function startTimer(intervalMinutes) {
  clearInterval(_timer);
  if (intervalMinutes <= 0) return;
  _timer = setInterval(syncTick, intervalMinutes * 60_000);
}

// ── Public init + updateSettings ──────────────────────────────
function init() {
  const s = loadSettings();
  if (!s.localEnabled && !s.driveEnabled) return;
  startTimer(s.intervalMinutes);
  // Run first tick shortly after load so conflicts are detected quickly
  setTimeout(syncTick, 8_000);
}

function updateSettings(newSettings) {
  saveSettings(newSettings);
  clearInterval(_timer);
  if (newSettings.localEnabled || newSettings.driveEnabled) {
    startTimer(newSettings.intervalMinutes);
  }
  if (newSettings.driveEnabled) {
    bootstrapFromDrive();
  }
}

// ── Export ────────────────────────────────────────────────────
window.PlannerSync = {
  init,
  onWeekSaved,
  updateSettings,
  resolveConflict,
  get status()    { return { lastSynced: _lastSynced, conflicts: [..._conflicts] }; },
};

// Auto-init on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})(); // end IIFE
```

- [ ] **Step 2: Verify the IIFE is properly closed** — read `planner-sync.js` from the last 10 lines to confirm the file ends with `})();`.

- [ ] **Step 3: Commit**

```
git add ManagementDashboard.Api/wwwroot/planner-sync.js
git commit -m "feat: planner-sync.js — bootstrap, conflict resolution, timer and init"
```

---

## Task 9: `view-planner.jsx` — wrap `saveWeekPlanner`

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/view-planner.jsx`

The existing `saveWeekPlanner` is at line ~216. Add a `PlannerSync.onWeekSaved` call immediately after the `localStorage.setItem` line.

- [ ] **Step 1: Edit `saveWeekPlanner`** — replace the current function body (lines 216–220):

Current:
```javascript
function saveWeekPlanner(year, week, data, themes) {
  const key = weekStorageKey(year, week);
  const s = JSON.stringify({ data, themes });
  try { localStorage.setItem(key, s); } catch {}
  window.nexusMDPushPref?.(key, s);
}
```

Replace with:
```javascript
function saveWeekPlanner(year, week, data, themes) {
  const key = weekStorageKey(year, week);
  const s = JSON.stringify({ data, themes });
  try { localStorage.setItem(key, s); } catch {}
  window.nexusMDPushPref?.(key, s);
  window.PlannerSync?.onWeekSaved(year, week);
}
```

- [ ] **Step 2: Commit**

```
git add ManagementDashboard.Api/wwwroot/view-planner.jsx
git commit -m "feat: trigger PlannerSync.onWeekSaved from saveWeekPlanner"
```

---

## Task 10: `index.html` — load `planner-sync.js`

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/index.html`

`planner-sync.js` must load before the planner JSX files (line 62 onwards) so `window.PlannerSync` exists when the planner initialises. It must also load after `google-auth.js` (line 44) and `profile-keys.js` (line 41).

- [ ] **Step 1: Add the script tag** — insert after line 44 (`<script src="google-auth.js"></script>`) and before line 62 (`<script type="text/babel" src="planner-ui.jsx"></script>`):

Find this line in `index.html`:
```html
<script src="google-auth.js"></script>
```

Add immediately after it:
```html
<script src="planner-sync.js"></script>
```

- [ ] **Step 2: Commit**

```
git add ManagementDashboard.Api/wwwroot/index.html
git commit -m "feat: load planner-sync.js in index.html"
```

---

## Task 11: `view-settings.jsx` — `PlannerSyncCard` component

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/view-settings.jsx`

Add the `PlannerSyncCard` component before the `// ── Settings page ─────────────────────────────────────────────` comment (line 592).

- [ ] **Step 1: Add `PlannerSyncCard`** — insert the full component before line 592:

```javascript
// ── Planner Sync Card ─────────────────────────────────────────
const FREQ_PRESETS = [
  [15,  'Every 15 min'],
  [60,  'Every hour'],
  [360, 'Every 6 hours'],
  [1440,'Daily'],
];

function PlannerConflictModal({ conflict, onKeepMine, onUseDrive, onCancel }) {
  if (!conflict) return null;
  const wkLabel = (() => {
    const [yearStr, weekStr] = conflict.weekKey.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const monday = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Week ${week} — ${fmt(monday)}–${fmt(sunday)}`;
  })();

  return (
    <PlModal open icon="alert"
      title="Planner sync conflict"
      sub={wkLabel}
      onClose={onCancel}
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn ghost" onClick={onUseDrive}>Use Drive version</button>
          <button className="btn primary" onClick={onKeepMine}>Keep mine</button>
        </React.Fragment>
      )}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '4px 0' }}>
        {[
          { label: 'This device', version: conflict.localVersion },
          { label: 'Google Drive', version: conflict.driveVersion },
        ].map(({ label, version }) => (
          <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-subtle)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 12.5 }}>Version {version}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', padding: '4px 0' }}>
        Both copies have unsynchronised changes. Choose which version to keep. The other will be overwritten.
      </div>
    </PlModal>
  );
}

function PlannerSyncCard() {
  const [settings, setSettingsState] = useStateVS(() => {
    try {
      const raw = localStorage.getItem(window.getProfileKey?.('planner.sync'));
      return raw ? { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60, ...JSON.parse(raw) } : { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60 };
    } catch { return { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: 60 }; }
  });
  const [status,     setStatus]     = useStateVS({ state: 'idle', lastSynced: null, conflicts: [] });
  const [conflict,   setConflict]   = useStateVS(null);  // currently-shown conflict
  const [customOpen, setCustomOpen] = useStateVS(settings.intervalMinutes > 0 && !FREQ_PRESETS.find(([m]) => m === settings.intervalMinutes));
  const [customVal,  setCustomVal]  = useStateVS(String(settings.intervalMinutes));
  const [bootstrapping, setBootstrapping] = useStateVS(false);

  useEffectVS(() => {
    const handler = e => {
      setStatus(e.detail);
      if (e.detail.bootstrapping === false) setBootstrapping(false);
      if (e.detail.bootstrapping === true)  setBootstrapping(true);
    };
    document.addEventListener('nexusmd:planner-sync-status', handler);
    return () => document.removeEventListener('nexusmd:planner-sync-status', handler);
  }, []);

  const applySettings = (next) => {
    setSettingsState(next);
    window.PlannerSync?.updateSettings(next);
  };

  const toggle = (field) => {
    const next = { ...settings, [field]: !settings[field] };
    applySettings(next);
  };

  const pickFolder = async () => {
    const picked = await window.electronAPI?.pickOutputFolder();
    if (picked) applySettings({ ...settings, localEnabled: true, localFolder: picked });
  };

  const setFreq = (minutes) => {
    const isCustom = !FREQ_PRESETS.find(([m]) => m === minutes);
    setCustomOpen(isCustom);
    applySettings({ ...settings, intervalMinutes: minutes });
  };

  const applyCustomFreq = () => {
    const v = parseInt(customVal, 10);
    if (v > 0) applySettings({ ...settings, intervalMinutes: v });
  };

  const openConflict = (c) => setConflict(c);

  const resolveConflict = async (choice) => {
    if (!conflict) return;
    setConflict(null);
    await window.PlannerSync?.resolveConflict(conflict.weekKey, choice);
  };

  const statusText = () => {
    const { state, lastSynced, conflicts } = status;
    if (state === 'conflict') {
      const c = (conflicts || [])[0];
      return c ? (
        <button className="btn sm ghost danger" onClick={() => openConflict(c)} style={{ fontWeight: 600 }}>
          Conflict on {c.weekKey} — tap to resolve
        </button>
      ) : 'Conflict detected';
    }
    if (state === 'syncing')      return bootstrapping ? 'Importing from Drive…' : 'Syncing…';
    if (state === 'offline')      return 'Offline — saving locally';
    if (state === 'disconnected') return 'Google disconnected';
    if (state === 'error')        return `Sync error — will retry`;
    if (lastSynced) {
      const d = new Date(lastSynced);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Last synced: ${isToday ? 'Today' : d.toLocaleDateString([], { dateStyle: 'short' })} at ${time}`;
    }
    return 'Never synced';
  };

  const isCustomFreq = !FREQ_PRESETS.find(([m]) => m === settings.intervalMinutes);
  const googleConnected = !!window.GoogleAuth?.isConnected?.();

  return (
    <VsCard title="Planner Sync" icon="send">
      {/* Local folder */}
      <VsRow title="Save to local folder" desc={settings.localFolder || 'No folder selected'}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {window.electronAPI && (
            <button className="btn sm ghost" onClick={pickFolder}>Browse…</button>
          )}
          <PlToggle
            checked={settings.localEnabled}
            onChange={() => {
              if (!settings.localEnabled && !settings.localFolder && window.electronAPI) {
                pickFolder();
              } else {
                toggle('localEnabled');
              }
            }}
          />
        </div>
      </VsRow>

      {/* Google Drive */}
      <VsRow
        title="Save to Google Drive"
        desc={googleConnected ? 'Syncs to your Google Drive app folder' : 'Connect Google to enable'}>
        {googleConnected
          ? <PlToggle checked={settings.driveEnabled} onChange={() => toggle('driveEnabled')} />
          : <span className="pill muted">Not connected</span>
        }
      </VsRow>

      {/* Sync frequency (only shown when either is enabled) */}
      {(settings.localEnabled || settings.driveEnabled) && (
        <VsFullRow title="Sync frequency" desc="How often to check for changes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FREQ_PRESETS.map(([minutes, label]) => (
              <button
                key={minutes}
                className={`btn sm ${settings.intervalMinutes === minutes && !isCustomFreq ? 'primary' : 'ghost'}`}
                onClick={() => setFreq(minutes)}>
                {label}
              </button>
            ))}
            <button
              className={`btn sm ${isCustomFreq ? 'primary' : 'ghost'}`}
              onClick={() => { setCustomOpen(true); }}>
              Custom
            </button>
          </div>
          {(customOpen || isCustomFreq) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <input
                type="number" min="1" className="plf-input" style={{ width: 80 }}
                value={customVal}
                onChange={e => setCustomVal(e.target.value)}
                onBlur={applyCustomFreq}
                onKeyDown={e => { if (e.key === 'Enter') applyCustomFreq(); }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>minutes</span>
            </div>
          )}
        </VsFullRow>
      )}

      {/* Status line */}
      <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' }}>
        {statusText()}
      </div>

      <PlannerConflictModal
        conflict={conflict}
        onKeepMine={() => resolveConflict('mine')}
        onUseDrive={() => resolveConflict('drive')}
        onCancel={() => setConflict(null)}
      />
    </VsCard>
  );
}
```

- [ ] **Step 2: Verify the component is syntactically complete** — read the last 10 lines of `view-settings.jsx` and confirm the file is intact.

- [ ] **Step 3: Commit**

```
git add ManagementDashboard.Api/wwwroot/view-settings.jsx
git commit -m "feat: add PlannerSyncCard component to view-settings.jsx"
```

---

## Task 12: Wire `PlannerSyncCard` into the settings page

**Files:**
- Modify: `ManagementDashboard.Api/wwwroot/view-settings.jsx`

`DriveSyncCard` renders on the `data` sub-page at around line 960. Add `PlannerSyncCard` directly after it.

- [ ] **Step 1: Find and update the render location** — the current code at line 960:

```javascript
            <DriveSyncCard />
          </>)}
```

Replace with:
```javascript
            <DriveSyncCard />
            <PlannerSyncCard />
          </>)}
```

- [ ] **Step 2: Commit**

```
git add ManagementDashboard.Api/wwwroot/view-settings.jsx
git commit -m "feat: add PlannerSyncCard to settings data sub-page"
```

---

## Task 13: Manual verification

No automated UI tests — verify the feature works end-to-end in the running app.

- [ ] **Step 1: Run the app**

```
dotnet run --project ManagementDashboard.Api
```

- [ ] **Step 2: Open Settings → Data** — confirm the new "Planner Sync" card appears after the "Google Drive Backup" card.

- [ ] **Step 3: Enable local folder sync** (Electron only — if testing in browser, skip):
  - Click "Browse…" → pick a temp folder
  - Toggle "Save to local folder" on
  - Open the planner, make a change, wait 5 seconds
  - Confirm a `planner-{profileId}-{year}-W{week}.json` file appears in the picked folder

- [ ] **Step 4: Enable Drive sync** (requires Google connected):
  - Toggle "Save to Google Drive" on
  - Confirm status shows "Importing from Drive…" then "Last synced: Today at …"
  - Make a planner change, wait 5 seconds, confirm status shows "Syncing…" then "Last synced: Today at …"

- [ ] **Step 5: Test offline queue** (requires Drive sync enabled):
  - Disconnect from the internet (or block the API via DevTools Network tab → Offline)
  - Make a planner change
  - Confirm status shows "Offline — saving locally"
  - Reconnect
  - Wait for next sync tick (or temporarily lower interval to 1 min)
  - Confirm status returns to "Last synced: Today at …"

- [ ] **Step 6: Run full test suite**

```
dotnet test ManagementDashboard.Tests
```

Expected: All tests pass.
