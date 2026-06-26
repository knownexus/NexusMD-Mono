// planner-sync.js — Planner file sync engine.
// Requires: google-auth.js (GoogleAuth), profile-keys.js (getProfileKey).
// Optional: window.electronAPI.saveFile for local folder writes.

import { getProfileKey } from './profile-keys.js';
import { GoogleAuth } from './google-auth.js';
import { toast } from './toast.jsx';

// ── Constants ─────────────────────────────────────────────────
const SYNC_SETTINGS_KEY  = 'planner.sync';         // profile-namespaced pref key
const SYNC_STATE_KEY     = 'planner.syncState';    // profile-namespaced pref key
const QUEUE_KEY_PREFIX   = 'planner.queue.';       // profile-namespaced offline queue
const DEFAULT_INTERVAL   = 60;                      // minutes

// ── Settings helpers ──────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem(getProfileKey(SYNC_SETTINGS_KEY));
    return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
  } catch { return defaultSettings(); }
}

function defaultSettings() {
  return { localEnabled: false, localFolder: '', driveEnabled: false, intervalMinutes: DEFAULT_INTERVAL };
}

function saveSettings(s) {
  try { localStorage.setItem(getProfileKey(SYNC_SETTINGS_KEY), JSON.stringify(s)); } catch {}
}

// ── Sync state helpers ────────────────────────────────────────
// syncState.weeks[weekKey] = { version, driveFileId, syncedAt, pendingLocalChanges }
// version: last version successfully pushed to Drive (0 = never synced)
// pendingLocalChanges: true when local data changed since last Drive push

function loadSyncState() {
  try {
    const raw = localStorage.getItem(getProfileKey(SYNC_STATE_KEY));
    return raw ? JSON.parse(raw) : { weeks: {} };
  } catch { return { weeks: {} }; }
}

function saveSyncState(state) {
  try { localStorage.setItem(getProfileKey(SYNC_STATE_KEY), JSON.stringify(state)); } catch {}
}

function getWeekState(state, wk) {
  return state.weeks[wk] ?? { version: 0, driveFileId: null, syncedAt: null, pendingLocalChanges: false };
}

// ── Week key / filename helpers ───────────────────────────────
export function weekKey(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weekFileName(profileId, year, week) {
  return `planner-${profileId}-${weekKey(year, week)}.json`;
}

function weekStorageKey(year, week) {
  return `nexusmd.planner.week.${weekKey(year, week)}`;
}

export function activeProfileId() {
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
    toast?.(`Planner sync: local save failed — check the folder in Settings.`, 'error');
  }
}

// ── Offline queue (localStorage-based) ───────────────────────
function queueKey(profileId, weekKey_) {
  return getProfileKey(QUEUE_KEY_PREFIX + weekKey_) ?? '';
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
  const prefix = getProfileKey(QUEUE_KEY_PREFIX) ?? '';
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
    // Forward reference: GoogleAuth is imported by google-auth.js consumers; used inside function body
    const token = GoogleAuth?.getAuth?.()?.accessToken;
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

// ── Offline queue flush ───────────────────────────────────────
async function flushOfflineQueue(token, profileId, settings) {
  const queuedKeys = listQueuedWeeks(profileId);
  if (!queuedKeys.length) return;

  for (const lsKey of queuedKeys) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      const { version } = payload;
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

  const token = GoogleAuth?.getAuth?.()?.accessToken;
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

// ── First-run bootstrap ───────────────────────────────────────
async function bootstrapFromDrive() {
  const token = GoogleAuth?.getAuth?.()?.accessToken;
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
  const token = GoogleAuth?.getAuth?.()?.accessToken;
  if (!token) return;
  const profileId = activeProfileId();
  const state     = loadSyncState();
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
export function init() {
  const s = loadSettings();
  if (!s.localEnabled && !s.driveEnabled) return;
  startTimer(s.intervalMinutes);
  // Run first tick shortly after load so conflicts are detected quickly
  setTimeout(syncTick, 8_000);
}

export function updateSettings(newSettings) {
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
export const PlannerSync = {
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
