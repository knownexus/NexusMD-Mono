# Planner Sync — Design Spec
**Date:** 2026-06-15
**Status:** Approved

## Overview

Add automatic sync of planner data to local disk and/or Google Drive. Two instances of the app can point at the same Drive folder and both read/write planner files, with per-week conflict detection and a resolution modal when both sides have changed.

The existing `localStorage` keys remain the live working copy. Local disk and Drive are sync targets only — no breaking changes to the planner's current read/write paths.

---

## File Format & Storage Structure

### Per-week files (local and Drive)

```
planner-{profileId}-2026-W24.json
planner-{profileId}-2026-W25.json
...
```

Profile ID is included in the filename so two profiles on the same Drive account don't collide.

Each week file:
```json
{
  "version": 7,
  "savedAt": "2026-06-15T09:12:00Z",
  "profileId": "abc123",
  "data": { ... },
  "themes": { ... }
}
```

### Sync state (local only, never uploaded)

Stored at `{appData}/NexusMD/planner-sync-state.json`:
```json
{
  "weeks": {
    "2026-W24": { "driveVersion": 7, "driveFileId": "1abc...", "syncedAt": "2026-06-15T09:12:00Z" },
    "2026-W25": { "driveVersion": 3, "driveFileId": "1def...", "syncedAt": "2026-06-15T08:00:00Z" }
  }
}
```

### Offline queue

Stored at `{appData}/NexusMD/planner-offline-queue/` — same week file format, written immediately when Drive sync is enabled but the app is offline.

---

## Settings & Configuration

A new **"Planner Sync"** card in the Settings page, placed after the existing "Google Drive Backup" card. The existing backup card is unchanged.

### Controls

**Storage destinations** (independent toggles):
- **Save to local folder** — toggle + folder path (clicking path opens Electron `dialog.showOpenDialog`)
- **Save to Google Drive** — toggle; if Google is not connected, shows an inline "Connect Google" prompt

**Sync frequency** (applies to both enabled destinations):
- Preset chips: `Every 15 min` / `Every hour` / `Every 6 hours` / `Daily`
- A `Custom` chip that reveals a minutes input field

**On-change autosave:** Always active when either destination is enabled. Debounced 5 seconds after the last edit. No separate toggle.

**Status line** (bottom of card):
- Last synced: `Today at 09:12` or `Never`
- State: `Up to date` / `Syncing…` / `Offline — saving locally` / `Conflict on W24` (tappable — opens conflict modal)

Settings persisted to `localStorage` under the active profile key (`nexusmd.p.{id}.planner.sync`).

---

## Sync Engine (`planner-sync.js`)

New module loaded alongside existing planner files. Stateless between calls — reads settings and sync-state on each invocation.

### On-change autosave

The existing `saveWeekPlanner(year, week, data, themes)` function is wrapped to call `PlannerSync.onWeekSaved(year, week)` after saving to localStorage. That function:

1. Increments the week's `version`
2. Writes the week file to the local folder (if local sync enabled)
3. Queues a Drive upload (if Drive sync enabled and online)

Drive uploads are fire-and-forget with ×2 retry. Failures update the status line badge — not blocking errors.

If the app is offline and Drive sync is enabled, the week file is written to the offline queue folder instead.

### Periodic sync (timer)

Set on app start; reset when sync settings change. On each tick:

1. Check connectivity; if offline, skip Drive steps but continue local writes
2. Fetch Drive file metadata for all known week files (batch metadata request — no full downloads)
3. Compare each Drive file's `version` against `planner-sync-state.json`
4. For each week:
   - **Drive newer, local unchanged** → pull Drive file, update localStorage, update sync state
   - **Local newer, Drive unchanged** → push local file to Drive, update sync state
   - **Both changed** → flag as conflict; surface in status line

### Offline → reconnect

On each periodic sync tick, if the offline queue folder contains files:

1. Upload each queued file to Drive in order
2. On success: delete the queued file; if local sync is also enabled, copy to the local folder
3. Clear "Offline" status once queue is empty

### First-run bootstrap (new instance pointing at existing Drive folder)

On enabling Drive sync:

1. Fetch all existing week files for this profile from Drive
2. For each: if no local version exists, pull into localStorage; if a local version exists with a lower version number, pull from Drive
3. Show a progress indicator in the Settings card during bootstrap

---

## Conflict Resolution Modal

Shown when the user taps a conflict badge in the status line.

**Content:**
- Week label (e.g. "Week 24 — Jun 9–15")
- Two columns: "This device" and "Google Drive" — each showing version number, saved timestamp, and a summary of differing rows (added/changed/removed counts per section)

**Actions:**
- **Keep mine** — push local version to Drive, update sync state
- **Use Drive version** — pull Drive version into localStorage, update sync state
- **Cancel** — leave conflict unresolved (badge remains)

No three-way merge.

---

## Electron IPC

New IPC channels (renderer → main):

| Channel | Payload | Response |
|---|---|---|
| `planner:pick-folder` | — | `{ path: string \| null }` |
| `planner:write-file` | `{ path, filename, content }` | `{ ok: boolean }` |
| `planner:read-file` | `{ path, filename }` | `{ content: string \| null }` |
| `planner:list-files` | `{ path }` | `{ files: string[] }` |

All file operations go via IPC — the renderer never calls Node APIs directly.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Google not connected / token expired | Drive sync skips silently; status shows "Google disconnected"; no repeated auth prompts |
| Local folder missing or removed | One-time toast; local sync disabled until user re-picks folder in Settings; Drive sync unaffected |
| App offline (Drive sync enabled) | Writes to offline queue; status shows "Offline — saving locally"; flushes on reconnect |
| Drive upload fails after retry | Status badge shows error; next periodic sync retries |
| Bootstrap conflict (both local and Drive have data) | Pull Drive if Drive version > local version; otherwise keep local and push to Drive |

---

## Out of Scope

- Three-way merge
- Real-time collaborative editing (changes propagate only on save + periodic sync interval)
- Sync of non-planner data (settings, confidential config) — the existing Drive Backup card covers that
