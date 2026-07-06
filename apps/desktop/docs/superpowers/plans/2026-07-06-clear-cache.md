# Clear cache (desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive "Clear cache" control to the desktop app's Settings → Data & sync that drops only the re-fetchable ADO data snapshot and immediately re-fetches, preserving all profiles, config, preferences, and planner notes.

**Architecture:** The ADO snapshot lives in the renderer's `localStorage` under two keys. We promote those keys to shared named constants (one in `@nexusmd/core`, one in `@nexusmd/ui`) so the clear logic can't drift from the writers. The existing desktop-owned `DesktopDataSyncCard` gains a "Clear cache" row that removes exactly those two keys and calls the desktop's existing `refreshAdoData()` (threaded in as an `onRefreshData` prop), then shows a toast. No `window.confirm` and no window reload — clearing is self-healing.

**Tech Stack:** React (renderer), Vitest + @testing-library/react (jsdom), ESM JS monorepo (`@nexusmd/core`, `@nexusmd/ui`, `apps/desktop`).

## Global Constraints

- Keys removed by "Clear cache": exactly `nexusmd.ado.cache.v1` and `nexusmd.wi.wiTypeStates.cache`. Nothing else.
- Keys that must never be touched by this feature: `nexusmd.ado.org` / `nexusmd.ado.pat` / `nexusmd.ado.projects`, `nexusmd.p.*` (profile-scoped), `nexusmd.planner.week.*`, field/column configs, and all other `nexusmd.*` preferences.
- Desktop only. Do not modify web or app platforms. Shared packages only gain exported constants.
- No `window.confirm` and no `window.location.reload()` for Clear cache.
- Run per-package tests from that package's own directory (workspace/jsdom setup): core from `packages/core`, ui from `packages/ui`, desktop from `apps/desktop`.
- End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Export the ADO cache key constant from core

**Files:**
- Modify: `packages/core/src/modules/ado/loader.js:6` (and internal uses at lines 10, 338)
- Modify: `packages/core/src/modules/ado/index.js:1`
- Modify: `packages/core/src/modules/triage/index.js:4,106`
- Modify: `packages/core/src/modules/digest/index.js:4,71`
- Test: `packages/core/tests/ado/loader.test.js`

**Interfaces:**
- Produces: `export const ADO_CACHE_KEY = 'nexusmd.ado.cache.v1'` from `@nexusmd/core` (re-exported via `packages/core/src/index.js:17` `export * from './modules/ado/index.js'`).

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/core/tests/ado/loader.test.js` (it already imports from the package; add `ADO_CACHE_KEY` to that import or add a new import line):

```javascript
import { ADO_CACHE_KEY } from '../../src/index.js'

describe('ADO_CACHE_KEY', () => {
  it('is the shared ADO snapshot storage key', () => {
    expect(ADO_CACHE_KEY).toBe('nexusmd.ado.cache.v1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/ado/loader.test.js -t "shared ADO snapshot"`
Expected: FAIL — `ADO_CACHE_KEY` is `undefined` (not exported yet).

- [ ] **Step 3: Export the constant and wire the duplicates to it**

In `packages/core/src/modules/ado/loader.js`, replace line 6:

```javascript
export const ADO_CACHE_KEY = 'nexusmd.ado.cache.v1'
```

Then update the two internal references so they use the new name. Line ~10 in `loadCachedAdoData`:

```javascript
    const raw = storage.get(ADO_CACHE_KEY)
```

Line ~338 in the assemble/persist block:

```javascript
    try { storage.set(ADO_CACHE_KEY, data) } catch (_) {}
```

In `packages/core/src/modules/ado/index.js`, replace line 1:

```javascript
export { loadAdoData, loadCachedAdoData, ADO_CACHE_KEY } from './loader.js'
```

In `packages/core/src/modules/triage/index.js`, delete the literal declaration on line 4 (`const ADO_CACHE_KEY = 'nexusmd.ado.cache.v1'`) and import it instead. Update the import block at the top (after line 2):

```javascript
import { ADO_CACHE_KEY } from '../ado/loader.js'
```

In `packages/core/src/modules/digest/index.js`, delete the literal declaration on line 4 and add:

```javascript
import { ADO_CACHE_KEY } from '../ado/loader.js'
```

(The usages at `triage/index.js:106` and `digest/index.js:71` already reference `ADO_CACHE_KEY` — leave them unchanged.)

- [ ] **Step 4: Run the full core suite to verify nothing broke**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all tests green, including the new `ADO_CACHE_KEY` test and the existing loader/triage/digest tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/loader.js packages/core/src/modules/ado/index.js packages/core/src/modules/triage/index.js packages/core/src/modules/digest/index.js packages/core/tests/ado/loader.test.js
git commit -m "$(printf 'refactor(core): export ADO_CACHE_KEY as shared constant\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Export the wiTypeStates cache key constant from ui

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx:369,373`
- Modify: `packages/ui/src/views/view-settings.jsx:767`
- Modify: `packages/ui/src/index.js` (add re-export near line 91 `export { WorkItemsView } ...`)
- Test: `packages/ui/tests/wi-type-states-key.test.js` (new)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `export const WI_TYPE_STATES_CACHE_KEY = 'nexusmd.wi.wiTypeStates.cache'` from `@nexusmd/ui`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/tests/wi-type-states-key.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { WI_TYPE_STATES_CACHE_KEY } from '../src/index.js'

describe('WI_TYPE_STATES_CACHE_KEY', () => {
  it('is the board work-item-type states cache key', () => {
    expect(WI_TYPE_STATES_CACHE_KEY).toBe('nexusmd.wi.wiTypeStates.cache')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/wi-type-states-key.test.js`
Expected: FAIL — `WI_TYPE_STATES_CACHE_KEY` is `undefined`.

- [ ] **Step 3: Add the constant, use it at both writers, and re-export it**

In `packages/ui/src/views/view-workitems.jsx`, add the constant near the top of the file, immediately after the existing imports (before the first component):

```javascript
export const WI_TYPE_STATES_CACHE_KEY = 'nexusmd.wi.wiTypeStates.cache';
```

Then update the two literal uses. Line ~369:

```javascript
    const cached = localStorage.getItem(WI_TYPE_STATES_CACHE_KEY);
```

Line ~373:

```javascript
      .then(data => { setWiTypeStates(data); localStorage.setItem(WI_TYPE_STATES_CACHE_KEY, JSON.stringify(data)); })
```

In `packages/ui/src/views/view-settings.jsx`, line ~767 (inside `BoardColumnsCard`), replace the literal with the imported constant. First add it to the existing `@nexusmd/core`... no — it is a ui-local constant, so import it from the sibling view. Add this import near the other view imports at the top of `view-settings.jsx`:

```javascript
import { WI_TYPE_STATES_CACHE_KEY } from './view-workitems.jsx';
```

Then change line ~767:

```javascript
    try { return JSON.parse(localStorage.getItem(WI_TYPE_STATES_CACHE_KEY) || '{}'); }
```

In `packages/ui/src/index.js`, add next to the WorkItemsView export (line ~91):

```javascript
export { WorkItemsView, WI_TYPE_STATES_CACHE_KEY } from './views/view-workitems.jsx'
```

(Replace the existing `export { WorkItemsView } from './views/view-workitems.jsx'` line with the line above.)

- [ ] **Step 4: Run the new test plus the board-fields test to verify nothing broke**

Run: `cd packages/ui && npx vitest run tests/wi-type-states-key.test.js tests/board-card-fields.test.jsx`
Expected: PASS — both files green.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/wi-type-states-key.test.js
git commit -m "$(printf 'refactor(ui): export WI_TYPE_STATES_CACHE_KEY as shared constant\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Add the Clear cache row to DesktopDataSyncCard

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx` (imports at lines 1-17; `DesktopDataSyncCard` at 326-374; `DesktopSettings` render of the card at ~560)
- Test: `apps/desktop/src/DesktopDataSyncCard.test.jsx`

**Interfaces:**
- Consumes: `ADO_CACHE_KEY` from `@nexusmd/core` (Task 1); `WI_TYPE_STATES_CACHE_KEY` and `toast` from `@nexusmd/ui` (Task 2 / existing).
- Produces: `DesktopDataSyncCard` accepts a new optional prop `onRefreshData?: () => Promise<void>`. When provided, it renders a "Clear cache" row whose button removes the two cache keys, calls `onRefreshData()`, and toasts.

- [ ] **Step 1: Write the failing tests**

The test file mocks `@nexusmd/ui` wholesale and does not currently mock `@nexusmd/core`. Extend the mocks and add three tests.

At the top of `apps/desktop/src/DesktopDataSyncCard.test.jsx`, add a core mock after the existing `vi.mock('./logs-card.jsx', ...)` (line ~19):

```javascript
vi.mock('@nexusmd/core', () => ({ ADO_CACHE_KEY: 'nexusmd.ado.cache.v1' }))
```

Extend the existing `vi.mock('@nexusmd/ui', () => ({ ... }))` object (lines 20-40) by adding these two entries alongside the others:

```javascript
  toast: vi.fn(),
  WI_TYPE_STATES_CACHE_KEY: 'nexusmd.wi.wiTypeStates.cache',
```

Then add these tests inside the `describe('DesktopDataSyncCard', ...)` block:

```javascript
  it('does not render Clear cache when onRefreshData is absent', () => {
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear cache' })).toBeNull()
  })

  it('clears only the two cache keys and re-fetches when Clear cache is clicked', async () => {
    const onRefreshData = vi.fn().mockResolvedValue()
    localStorage.setItem('nexusmd.ado.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.wi.wiTypeStates.cache', '{}')
    localStorage.setItem('nexusmd.ado.org', 'acme')
    localStorage.setItem('nexusmd.planner.week.2026-W27', 'notes')

    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} onRefreshData={onRefreshData} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))

    expect(localStorage.getItem('nexusmd.ado.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.wi.wiTypeStates.cache')).toBeNull()
    expect(localStorage.getItem('nexusmd.ado.org')).toBe('acme')
    expect(localStorage.getItem('nexusmd.planner.week.2026-W27')).toBe('notes')
    expect(onRefreshData).toHaveBeenCalledTimes(1)
  })

  it('does not call window.confirm or reload for Clear cache', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onRefreshData = vi.fn().mockResolvedValue()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} onRefreshData={onRefreshData} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onRefreshData).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/DesktopDataSyncCard.test.jsx`
Expected: FAIL — no "Clear cache" button exists; the two new positive tests fail on `getByRole(... 'Clear cache')`.

- [ ] **Step 3: Implement the Clear cache row**

In `apps/desktop/src/desktop-settings.jsx`, extend the `@nexusmd/ui` import (lines 2-8) to also bring in `toast` and `WI_TYPE_STATES_CACHE_KEY`, and add a `@nexusmd/core` import for `ADO_CACHE_KEY`. After the existing import block (after line 17), the two changed/added imports read:

```javascript
import {
  Icon, CardFrame,
  VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker, BoardColumnsCard,
  VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView,
  PlToggle, VsPasswordModal, loadConfidentialConfig,
  CardsAndTablesSettings, toast, WI_TYPE_STATES_CACHE_KEY,
} from '@nexusmd/ui'
import { ADO_CACHE_KEY } from '@nexusmd/core'
```

Change the `DesktopDataSyncCard` signature (line 326) to accept the new prop:

```javascript
export function DesktopDataSyncCard({ refreshInterval, onRefreshIntervalChange, onRefreshData }) {
```

Add a `clearCache` handler next to the existing `clearLocal` (after the `clearLocal` function, before the `return`):

```javascript
  const clearCache = () => {
    try {
      localStorage.removeItem(ADO_CACHE_KEY)
      localStorage.removeItem(WI_TYPE_STATES_CACHE_KEY)
    } catch {}
    toast?.('Cache cleared — refreshing…', 'success')
    onRefreshData?.().catch(() => {})
  }
```

Add the "Clear cache" row immediately **above** the existing "Clear local data" row (before the `<VsRow title="Clear local data" ...>` at line ~369), rendered only when `onRefreshData` is provided:

```javascript
      {onRefreshData && (
        <VsRow title="Clear cache" desc="Drop the cached ADO data and re-fetch — keeps profiles, settings, and planner notes">
          <button className="btn sm ghost" onClick={clearCache}>Clear cache</button>
        </VsRow>
      )}
```

In `DesktopSettings`, pass `onRefreshData` to the card. Change the render at line ~560 from:

```javascript
              <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
```

to:

```javascript
              <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} onRefreshData={onRefreshData} />
```

(`onRefreshData` is already a `DesktopSettings` prop — line 466 — wired from `main.jsx`'s `refreshAdoData` at `main.jsx:570`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/DesktopDataSyncCard.test.jsx`
Expected: PASS — all tests green, including the original six.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/desktop-settings.jsx apps/desktop/src/DesktopDataSyncCard.test.jsx
git commit -m "$(printf 'feat(desktop): add targeted Clear cache control\n\nDrops only the ADO snapshot (nexusmd.ado.cache.v1 +\nnexusmd.wi.wiTypeStates.cache) and re-fetches, preserving profiles,\nconfig, and planner notes.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Verify end-to-end in the running desktop app

**Files:** none (manual verification).

- [ ] **Step 1: Build/run the desktop app**

Use the project's run skill or the desktop app's dev command. Confirm the app launches and an ADO profile with data is active.

- [ ] **Step 2: Exercise the control**

Go to Settings → Data & sync. Confirm a "Clear cache" row appears above "Clear local data". With DevTools open on the renderer, run `localStorage.getItem('nexusmd.ado.cache.v1')` and confirm it is populated. Click "Clear cache".

Expected: a "Cache cleared — refreshing…" toast; `nexusmd.ado.cache.v1` briefly `null` then repopulated by the re-fetch; `nexusmd.ado.org` and any `nexusmd.planner.week.*` keys unchanged; the window does NOT reload; PR/work-item views repopulate with fresh data.

- [ ] **Step 3: Run the full affected test suites once more**

Run: `cd packages/core && npx vitest run` then `cd ../../packages/ui && npx vitest run` then `cd ../../apps/desktop && npx vitest run`
Expected: PASS across all three.

---

## Notes for the implementer

- The two cache keys are flat (not profile-scoped) and org-guarded inside `loadCachedAdoData`, so clearing is global across profiles for the ADO snapshot — this matches how the cache is written today. Do not route these through `getProfileKey`.
- If ADO is offline/unconfigured when Clear cache is clicked, `refreshAdoData()` is a no-op and views show the empty state until the next successful fetch. The toast still fires. This is acceptable and self-correcting.
- Do not add a `window.confirm` — Clear cache is deliberately non-destructive, unlike the adjacent "Clear local data".
