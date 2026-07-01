# Desktop Settings Tabs

**Date:** 2026-07-01  
**Status:** Approved

---

## Problem

The desktop app's settings page (`DesktopSettings` in `apps/desktop/src/main.jsx`) is a long scrollable list of ~14 cards with no navigation structure. The app and web already have a 7-tab left-rail settings layout. The desktop should match that pattern for consistency and usability.

---

## Scope

- **In scope:** `apps/desktop` only — `main.jsx` and new files
- **Out of scope:** `apps/app`, `apps/web`, `@nexusmd/ui` — no changes to shared packages or other platforms

---

## Architecture

### File extraction

All `DesktopSettings` code (the component itself and its inline child components — `DesktopProfileCard`, `DesktopPlannerPrefsCard`, `DesktopConfidentialCard`, `DesktopAppCard`, `DesktopQuickLinksCard`, `AdoConnectionCard`, `DesktopDataSyncCard`) is extracted from `apps/desktop/src/main.jsx` into a new file:

**`apps/desktop/src/desktop-settings.jsx`** — exports `DesktopSettings` as a named export.

`main.jsx` replaces those definitions with a single import:
```js
import { DesktopSettings } from './desktop-settings.jsx'
```

No component behaviour changes during extraction.

### Tab shell

`DesktopSettings` gains a left-rail tab layout:

```
┌──────────┬──────────────────────────────┐
│ Profile  │                              │
│ Appearance│  <active tab content>       │
│ Planner  │                              │
│ Profiles │                              │
│ Confidential│                           │
│ Data & sync│                            │
│ Integrations│                           │
│ Desktop  │                              │
└──────────┴──────────────────────────────┘
```

Tab state: `const [settingsTab, setSettingsTab] = useState('profile')` — no persistence across app restarts, resets to Profile on open.

Only the active tab's content is rendered (conditional render, not CSS hide/show).

---

## Tab Structure

| Tab | Components |
|-----|-----------|
| **Profile** | `DesktopProfileCard`, Project areas `VsCard` |
| **Appearance** | Appearance/theme `VsCard` |
| **Planner** | `DesktopPlannerPrefsCard`, `BoardColumnsCard` |
| **Profiles** | `VsProfiles`, `BackupRestoreCard`, `CloudSyncCard` |
| **Confidential** | `DesktopConfidentialCard` |
| **Data & sync** | `DesktopDataSyncCard`, `LogsCard` |
| **Integrations** | `AdoConnectionCard`, `IntegrationsView` |
| **Desktop** | `DesktopAppCard`, `DesktopQuickLinksCard` |

Tab labels and icons match the app/web convention:

| Tab | Icon |
|-----|------|
| Profile | `person` |
| Appearance | `palette` |
| Planner | `calendar` |
| Profiles | `layers` |
| Confidential | `lock` |
| Data & sync | `sync` |
| Integrations | `plug` |
| Desktop | `desktop` |

---

## Testing

### Setup

Add `vitest.config.js` to `apps/desktop` (jsdom environment + React plugin — same config as `packages/ui`):

```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
})
```

Add `"test": "vitest run"` to `apps/desktop/package.json` scripts.

All tests use `vi.stubGlobal('electronAPI', { ... })` to mock IPC calls.

Shared `@nexusmd/ui` components (`VsProfiles`, `BackupRestoreCard`, `CloudSyncCard`, `BoardColumnsCard`, `IntegrationsView`) are not tested here — they are covered by `packages/ui` tests.

### Test files

All test files live in `apps/desktop/src/`:

| File | What it covers |
|------|----------------|
| `desktop-settings.test.jsx` | Default tab is Profile on mount; clicking each tab renders its content and hides others |
| `DesktopProfileCard.test.jsx` | Field edits call `electronAPI.store.set` with the correct key/value |
| `DesktopAppCard.test.jsx` | Startup-on-login toggle calls `electronAPI.app.setLoginItem`; close-to-tray toggle persists correctly |
| `DesktopQuickLinksCard.test.jsx` | Add link appends to list and persists; edit updates in place; delete removes from list |
| `AdoConnectionCard.test.jsx` | Saving org URL + PAT calls correct store IPC; project discovery fires the discovery handler |
| `DesktopPlannerPrefsCard.test.jsx` | Changing each pref calls `electronAPI.store.set` with the correct key |
| `DesktopConfidentialCard.test.jsx` | Password change flow calls the correct IPC handler with the entered value |
| `DesktopDataSyncCard.test.jsx` | Clear data calls correct IPC; refresh interval change persists via store |
| `LogsCard.test.jsx` | `electronAPI.logs.list` called on mount; selecting a date calls `logs.read`; delete calls `logs.delete` and refreshes list |

---

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/main.jsx` | Remove `DesktopSettings` and all inline child components; add import |
| `apps/desktop/src/desktop-settings.jsx` | New file — `DesktopSettings` + child components + tab shell |
| `apps/desktop/vitest.config.js` | New file — vitest config (jsdom + React) |
| `apps/desktop/package.json` | Add `"test": "vitest run"` script |
| `apps/desktop/src/desktop-settings.test.jsx` | New — tab navigation tests |
| `apps/desktop/src/DesktopProfileCard.test.jsx` | New — profile card tests |
| `apps/desktop/src/DesktopAppCard.test.jsx` | New — app card tests |
| `apps/desktop/src/DesktopQuickLinksCard.test.jsx` | New — quick links tests |
| `apps/desktop/src/AdoConnectionCard.test.jsx` | New — ADO connection tests |
| `apps/desktop/src/DesktopPlannerPrefsCard.test.jsx` | New — planner prefs tests |
| `apps/desktop/src/DesktopConfidentialCard.test.jsx` | New — confidential card tests |
| `apps/desktop/src/DesktopDataSyncCard.test.jsx` | New — data sync tests |
| `apps/desktop/src/LogsCard.test.jsx` | New — logs card tests |
