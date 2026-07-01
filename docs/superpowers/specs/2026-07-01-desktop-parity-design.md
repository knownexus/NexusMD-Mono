# Desktop Parity Design

**Date:** 2026-07-01  
**Scope:** `apps/desktop/src/main.jsx`, `apps/desktop/src/view-calendar.jsx` (new), `packages/ui/src/index.js`

## Background

The desktop Electron app lags the web app across seven feature areas. This spec closes all gaps so the desktop renders the same capabilities without changing the shared `@nexusmd/ui` components or the web app.

---

## Section 1 — TweaksPanel + tweak application

### What changes
- Expand `DEFAULT_TWEAKS` in `main.jsx` to add `density` (`'balanced'`), `sidebar` (`'labels'`), `typeLabels` (`false`), and `widgetOrder` (the existing `DASH_WIDGET_ORDER` constant).
- Remove the separate `usePersistedState('nexusmd.dash.widgetOrder', …)` from `ViewBody`; widgetOrder now lives in tweaks state, persisted under `nexusmd.tweaks`.
- In `App`, add `data-density={tweaks.density}` and `data-sidebar={tweaks.sidebar}` to the root `<div>`. The existing `base.css` CSS already handles both attributes.
- Set `window.nexusMDTypeLabels = tweaks.typeLabels` at render time in `App` (same as the web).
- Add `TweaksPanel`, `TweakSection`, `TweakRadio`, `TweakToggle` to the `@nexusmd/ui` import.
- Render `<TweaksPanel title="Display">` inside `App` (sibling of `<ToastHost />`), with two sections:
  - **Appearance**: theme (light/dark radio), density (compact/balanced/cozy radio), sidebar (labels/icons radio), type labels (toggle)
  - **Dashboard**: a "Reset widget order" button only — `DashboardView` already exposes drag handles for inline reordering, so the TweaksPanel does not need a full `WidgetOrderEditor`

### Data flow
`App` owns `tweaks` → passes `tweaks`/`setTweak` → `ViewBody` → consumers.

---

## Section 2 — Prop-wiring fixes

All changes are in `ViewBody` and `App`.

### DashboardView — add missing props
Pass from `App`/`ViewBody`:
- `density={tweaks.density}`
- `team={data.TEAM || []}`
- `acknowledgedSet` — persisted via `usePersistedState('nexusmd.dash.acknowledged', new Set())`, same shape as web
- `needsMeCriteria` — already in `ViewBody` state, just not passed down; add it
- `setPlannerData` — lift `plannerData`/`setPlannerData` from `ViewBody` up to `App` (so TeamView can also write to it); pass down via context or props

### WorkItemsView — fix creation + team
- Change `onCreate={() => {}}` to `onCreate={() => setCreateWI({})}` — `createWI` state already exists in `App` and opens `CreateWorkItemModal`
- Pass `team={data.TEAM || []}` for assignee filtering
- Pass `setItems` as a state setter that updates the local snapshot (optimistic update only — no server write needed beyond what `desktopWorkItemSource` provides)

### newItemIds badges
Add a `useEffect` in `App` that fires on each `data:updated` event:
- Maintains a `seenFingerprints` ref per view (`{ work: Set, pr: Set, builds: Set, tests: Set }`)
- Computes fingerprints: work items → `id|state`, PRs → `id|status`, builds → `id|result`, tests → `id|result|failedTests`
- Any item whose fingerprint was not in the previous seen set is "new"
- Clears the new set for a view when the user navigates to it
- Passes `newItemIds` to `WorkItemsView`, `PRView`, `BuildsView`, `TestsView`

---

## Section 3 — Detail Drawer

Replace `ItemDetailModal` and `PRDetailModal` with a single `DesktopDetailDrawer` component defined in `main.jsx`.

### State change
`openedItem` / `openedPR` → single `drawer` state: `null | { kind: 'wi' | 'pr', data: object }`.

`setOpenedItem(item)` becomes `setDrawer({ kind: 'wi', data: item })`.  
`setOpenedPR(pr)` becomes `setDrawer({ kind: 'pr', data: pr })`.

### Component
```
DesktopDetailDrawer({ drawer, onClose, setItems, team })
  uses Drawer from @nexusmd/ui
  kind='wi' → WorkItemDetail + "Mark done" action (desktopWorkItemSource.saveField) + ADO link
  kind='pr' → PR detail content (same fields as existing PRDetailModal, moved inside Drawer)
```

`Drawer` is already exported from `@nexusmd/ui`. The `WorkItemDetail` component is also already used and imported.

### Mark done
Calls `desktopWorkItemSource.saveField(item.id, 'System.State', 'Done')` then optimistically updates the local items list and closes the drawer.

---

## Section 4 — Missing Settings tabs

Four new `VsCard` stacked cards added to `DesktopSettings` (no nav rail). Cards appear in this order: Appearance (existing), Profile, Planner, Confidential, Desktop, ADO Connection (existing), Profiles (existing), Backup & Restore (existing), Cloud Sync (existing).

### Profile card
Fields persisted to localStorage under `getProfileKey('nexusmd.profile.*')`:
- Display name (`nexusmd.profile.displayName`)
- Role (`nexusmd.profile.role`, default `'Engineering Manager'`)
- Team (`nexusmd.profile.team`)
- Timezone (`nexusmd.profile.timeZone`, default from `Intl.DateTimeFormat().resolvedOptions().timeZone`)
- Photo — file picker, stored as data URL under `getProfileKey('nexusmd.profile.photo')`

All use the same localStorage keys as the web so profile data is portable across platforms via backup/restore.

### Planner prefs card
Fields persisted to localStorage under `getProfileKey('nexusmd.planner.*')`:
- Landing view (`nexusmd.planner.landing`) — glance / week / month — rendered as `VsSeg`
- Nav style (`nexusmd.planner.nav`) — rail / tabs — rendered as `VsSeg`
- Entry style (`nexusmd.planner.entry`) — inline / modal — rendered as `VsSeg`
- Carry-over prompt (`nexusmd.planner.carryPrompt`) — on/off toggle

These are the same keys the shared `PlannerView` already reads, so changes take effect immediately on next planner load.

### Confidential card
- Button: "Set / change password" → opens `VsPasswordModal` (already in `@nexusmd/ui`)
- Toggle: auto-relock (`nexusmd.confidential.autoRelock`)
- Read-only count of locked sections from `loadConfidentialConfig()`

`loadConfidentialConfig` and `hashPassword` are already exported from `@nexusmd/ui` (used by the planner). Import them.

### Desktop card (Electron-only, rendered conditionally on `window.electronAPI`)
- **Start on login** toggle — reads/writes via `electronAPI.getLoginItemEnabled()` / `electronAPI.setLoginItemEnabled(val)`
- **Close to tray** toggle — reads/writes via `electronAPI.getCloseToTray()` / `electronAPI.setCloseToTray(val)`
- **Output folder** — shows current path, "Change…" button calls `electronAPI.pickOutputFolder()`, "Clear" removes from localStorage

All three IPC calls already exist in the Electron main process (the web's SettingsView already uses them). No main-process changes needed.

---

## Section 5 — Calendar view

### Nav
Add `{ id: 'calendar', label: 'Calendar', icon: 'planner' }` to `NAV` in `main.jsx` (after `tests`, before `team`, mirroring web order).

### New file: `apps/desktop/src/view-calendar.jsx`
Imports `CalendarView`, `OutlookService` and the date-math helpers from `@nexusmd/ui`. No Google Calendar — the desktop only supports Outlook, which is already authenticated via the Integrations panel (`makeDesktopOAuthService('microsoft')`).

`CalendarView` receives:
- `calendarEvents` — state array managed in `App` (populated via `OutlookService.fetchEvents()` on mount and on manual refresh)
- `onNavigatePlanner` — navigates to `'planner'` view
- `onUpdateEvent` — calls `OutlookService.updateEvent()`
- `onDeleteEvent` — calls `OutlookService.deleteEvent()`
- `onCreateEvent` — calls `OutlookService.createEvent()`

### State location
`calendarEvents` / `setCalendarEvents` live in `App`. Fetched once on mount if Outlook is connected; a refresh button in CalendarView triggers a re-fetch.

---

## Section 6 — Team mutations + quick links

### Team mutations
Lift `plannerData` / `setPlannerData` from `ViewBody` to `App` (needed for `onScheduleOneOnOne` and dashboard planner integration).

Wire in `ViewBody` → `TeamView`:
- `onTeamChange(newTeam)` — stores custom members to `localStorage` under `getProfileKey('nexusmd.team.custom')`, merges with ADO team on next render (same pattern as web)
- `onAddNote(devId, note)` — writes to `plannerData` (global notes section)
- `onScheduleOneOnOne(dev)` — creates a planner entry and navigates to the planner view

### Quick links
- Add `quickLinks` to `DEFAULT_TWEAKS` with the same three defaults as the web app (UAT Testing, Dev Testing, Cirrus HR)
- Pass `tweaks.quickLinks` to `DashboardView`
- Add a **Quick Links card** to `DesktopSettings`: a simple list with add/remove/edit rows (label, URL, colour picker using `VsRow` + inline inputs), same visual style as other settings cards

---

## Section 7 — Dead export cleanup

Remove three unused re-exports from `packages/ui/src/index.js`:
- `RawFieldsInspector` (line 77) — never consumed by any app
- `OutlookSetupModal` (line 61) — never imported anywhere
- `DayColumn` (line 62) — internal calendar sub-component, should not be a public export

No other files change; nothing imports these.

---

## Implementation order

1. Dead export cleanup (Section 7) — zero risk, no dependencies
2. TweaksPanel + tweak application (Section 1)
3. Prop-wiring fixes (Section 2) — depends on tweaks widgetOrder being in tweaks state
4. Detail Drawer (Section 3) — independent
5. Missing Settings tabs (Section 4) — independent
6. Calendar view (Section 5) — independent
7. Team mutations + quick links (Section 6) — depends on plannerData lift (Section 2/3)
