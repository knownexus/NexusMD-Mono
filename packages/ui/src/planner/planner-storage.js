// planner-storage.js — per-week planner persistence + legacy-migration flag +
// confidential reminder scan. Shared web + app. These were duplicated in each
// app's view-planner.jsx "part 1", differing only by the namespace ('nexusmd.'
// vs 'helm.'), getProfileKey scoping (web identity, app profile-scoped), the
// pref-sync push, and a web-only Google-Drive sync hook (onWeekSaved) — all of
// which now flow through the planner runtime, exactly like loadGlobalNotes.
//
// DOCX export (JSZip/DOM) stays in each app's part 1; it has no shared seam.
import { weekKeyToOffset, PLANNER_SECTIONS, rendererLog, ignore, readJsonKeepingDamaged } from '@nexusmd/core';
import { getPlannerRuntime } from './runtime.js';


const log = rendererLog('planner', 'storage');

// Bare (un-getProfileKey'd) namespaced key for a week's payload. Storage reads
// scope it through getProfileKey; the pref-sync push uses the bare key — matching
// each platform's original behaviour byte-for-byte.
function weekKeyBare(year, week) {
  const { namespace } = getPlannerRuntime();
  return `${namespace}.planner.week.${year}-W${String(week).padStart(2, '0')}`;
}

export function loadWeekPlanner(year, week) {
  const { storage, getProfileKey, namespace } = getPlannerRuntime();
  const bare = weekKeyBare(year, week);
  return readJsonKeepingDamaged({
    storage, getProfileKey, namespace, log, storageKey: getProfileKey(bare),
    collection: 'planner', itemKey: bare.slice(`${namespace}.planner.week.`.length), empty: null,
    what: 'a saved planner week could not be read, so it opens empty', data: { year, week },
  });
}

// Saves the week on this device, then pushes it and tells the host. When the device save fails (storage full or
// blocked) nothing is pushed or announced: the account would hold a week this device cannot show, and the next
// sync could take the older local one over it. Returns whether the week was saved here.
export function saveWeekPlanner(year, week, data, themes) {
  const { storage, getProfileKey, pushPref, onWeekSaved } = getPlannerRuntime();
  const bare = weekKeyBare(year, week);
  const s = JSON.stringify({ data, themes });
  try { storage.setItem(getProfileKey(bare), s); } catch (err) {
    ignore(log, 'a planner week could not be saved on this device (storage full or blocked), so it was not sent to the account either', err, 'warn', { year, week });
    return false;
  }
  pushPref?.(bare, s);
  onWeekSaved?.(year, week);
  return true;
}

export function deleteWeekPlanner(year, week) {
  const { storage, getProfileKey, pushPref } = getPlannerRuntime();
  const bare = weekKeyBare(year, week);
  try { storage.removeItem(getProfileKey(bare)); } catch (err) { ignore(log, 'a planner week could not be removed from this device', err, 'warn', { year, week }); }
  pushPref?.(bare, null);
}

export function getWeeksWithData() {
  const { storage, getProfileKey, namespace } = getPlannerRuntime();
  const result = new Set();
  try {
    const weekPrefix = getProfileKey(`${namespace}.planner.week.`);
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(weekPrefix)) result.add(k.replace(weekPrefix, ''));
    }
  } catch (err) { ignore(log, 'the saved planner weeks could not be listed', err, 'warn'); }
  return result;
}

function migrationFlagBare() {
  const { namespace } = getPlannerRuntime();
  return `${namespace}.planner.legacyMigrated`;
}
export function isLegacyMigrationDone() {
  const { storage, getProfileKey } = getPlannerRuntime();
  try { return storage.getItem(getProfileKey(migrationFlagBare())) === '1'; } catch { return false; }
}
export function markLegacyMigrationDone() {
  const { storage, getProfileKey, pushPref } = getPlannerRuntime();
  const flag = migrationFlagBare();
  try { storage.setItem(getProfileKey(flag), '1'); } catch (err) { ignore(log, 'the planner migration flag could not be saved, so the migration may run again', err, 'warn'); }
  pushPref?.(flag, '1');
}

// Scans all stored planner weeks for confidential rows whose _reminderDate is
// today or in the past and that haven't been dismissed. Returns an array of
// { rowId, sectionId, reminderDate, weekKey, weekOffset }.
export function checkConfidentialReminders() {
  const { storage, getProfileKey, namespace } = getPlannerRuntime();
  const today = new Date().toISOString().slice(0, 10);
  const dismissed = new Set();
  try { JSON.parse(storage.getItem(getProfileKey(`${namespace}.planner.reminderDismissed`)) || '[]').forEach(k => dismissed.add(k)); } catch (err) { ignore(log, 'the dismissed reminders could not be read, so none count as dismissed', err, 'warn'); }
  const due = [];
  try {
    const weekPrefix = getProfileKey(`${namespace}.planner.week.`);
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith(weekPrefix)) continue;
      try {
        const saved = JSON.parse(storage.getItem(k) || 'null');
        if (!saved?.data) continue;
        for (const sec of PLANNER_SECTIONS) {
          if (sec.type !== 'table') continue;
          for (const row of (saved.data[sec.id] || [])) {
            if (row._reminderDate && row._reminderDate <= today && !dismissed.has(row.id + ':' + row._reminderDate)) {
              due.push({ rowId: row.id, sectionId: sec.id, reminderDate: row._reminderDate, weekKey: k, weekOffset: weekKeyToOffset(k) });
            }
          }
        }
      } catch (err) { ignore(log, 'a planner week could not be read for reminders, so it is skipped', err, 'warn', { week: k }); }
    }
  } catch (err) { ignore(log, 'the saved planner weeks could not be scanned for reminders', err, 'warn'); }
  return due;
}
