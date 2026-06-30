# Cross-Platform Planner + MarkdownViewer Design

**Date:** 2026-06-30  
**Scope:** Share `PlannerView` into `@nexusmd/ui` (replacing per-app orchestrators), add `PLANNER_SECTIONS` to `@nexusmd/core`, and wire both Planner and MarkdownViewer into the Electron desktop.

---

## Problem

- `PlannerView` exists in two diverging copies (`apps/web/src/view-planner-2.jsx` and `apps/app/src/planner/view-planner-2.jsx`). Each hardcodes its own storage namespace (`nexusmd.*` vs `helm.*`), its own `pushPref` call, and has independent drift (app has debounced save + FAB; web does not).
- `PLANNER_SECTIONS` also exists in two copies; the app's version is canonical (it has a `datetime` col in `meetSched` that the web is missing).
- The Electron desktop shows a `<Placeholder>` for both Planner and Markdown — neither feature is wired up.
- `MarkdownViewer` is already in `@nexusmd/ui`; it just needs a desktop nav entry and case.

---

## Approach

Runtime-driven extraction (Approach A): move `PlannerView` into `@nexusmd/ui` as a single shared component that reads its storage namespace and `pushPref` callback from the existing `plannerRuntime` singleton (`getPlannerRuntime()`). Each app's `NexusDataProvider` already calls `setPlannerRuntime` — no per-app wiring changes needed.

---

## Section 1: File Movement

| File | Action |
|------|--------|
| `packages/core/src/planner-sections.js` | **New** — canonical `PLANNER_SECTIONS` + `PL_GROUPS` |
| `packages/ui/src/planner/docx.js` | **New** — `plannerExportDocx` extracted from web |
| `packages/ui/src/views/view-planner.jsx` | **New** — merged shared `PlannerView` orchestrator |
| `packages/ui/src/index.js` | Add exports: `PlannerView`, `plannerExportDocx` |
| `apps/web/src/view-planner.jsx` | Keep helpers; add `export { PlannerView } from '@nexusmd/ui'` |
| `apps/web/src/view-planner-2.jsx` | **Delete** |
| `apps/app/src/planner/view-planner.jsx` | Keep helpers; add `export { PlannerView } from '@nexusmd/ui'` |
| `apps/app/src/planner/view-planner-2.jsx` | **Delete** |
| `apps/desktop/src/main.jsx` | Import + wire `PlannerView`, `MarkdownViewer`; add nav entries |

---

## Section 2: `PLANNER_SECTIONS` Consolidation

The app's `PLANNER_SECTIONS` is the canonical version: it includes `{ t: 'datetime', k: 'when' }` in the `meetSched` section, which the web's copy omits.

**Changes:**
- Create `packages/core/src/planner-sections.js` with the app's full `PLANNER_SECTIONS` and `PL_GROUPS` definitions.
- Export both from `@nexusmd/core`.
- The web's `view-planner.jsx` already imports `PLANNER_SECTIONS` from `@nexusmd/core` — no change needed there.
- The app's `view-planner.jsx` drops its local definition and imports from `@nexusmd/core`.
- No data migration: the `datetime` col was already being written by the app. Web data simply gains the col definition; existing rows without it continue to work (col is optional).

---

## Section 3: `plannerExportDocx` Extraction

`plannerExportDocx` is nearly identical in both apps (JSZip + blob construction). Only the file-save mechanism differs.

**Changes:**
- Create `packages/ui/src/planner/docx.js` with the shared DOCX generation logic. The default export path uses `URL.createObjectURL` + `<a>.click()` (browser download), which works in web and Electron unchanged.
- Export `plannerExportDocx` from `@nexusmd/ui`.
- The shared `PlannerView` accepts an optional `onExportDocx(data, themes, dateStr)` prop. When provided, the view calls it instead of triggering the browser download. The mobile app passes its Capacitor native file-save handler. Web and desktop omit the prop.

---

## Section 4: Shared `PlannerView` Orchestrator

Single source at `packages/ui/src/views/view-planner.jsx`. Platform seams resolved as follows:

### 4.1 Namespace + pushPref

All hardcoded key prefixes are replaced with the runtime value:

```js
const rt = getPlannerRuntime()
// e.g. localStorage key: rt.namespace + '.planner.nav'
// sync:                   rt.pushPref?.(key, value)
```

`rt.namespace` is `'nexusmd'` on web/desktop and `'helm'` on app (set by `NexusDataProvider` via `setPlannerRuntime`). This means existing per-profile localStorage data is preserved on both platforms without migration.

### 4.2 Mobile Detection

The app's `isPhone` + `effectiveNavMode` logic (rail → tabs when `max-width: 600px`) is preserved in the shared view. Desktop always resolves `isPhone = false` and uses `rail` as default. No platform prop needed.

### 4.3 Header Markup

The shared view uses the `.page-head` class (web convention). The app's stylesheet adds a one-line alias:

```css
.m-appbar { /* alias */ }
```

This avoids leaking platform knowledge into the shared component as a prop.

### 4.4 Navigation Global

The shared view reads `window.NexusMDNav` only. Any caller in the app that currently writes to `window.HelmNav` is renamed to `window.NexusMDNav`.

### 4.5 Quick Capture FAB + Sheet

The FAB and `Sheet` bottom-drawer are rendered only when `isPhone === true`, so they never appear on desktop or web. `Sheet` (`apps/app/src/components.jsx:63-99`) moves to `@nexusmd/ui` — it is a generic bottom-drawer that depends only on `Icon`, which is already in `@nexusmd/ui`.

### 4.6 Save Strategy

The app's 600ms debounced save with unmount-flush replaces the web's immediate save universally. Behaviour is identical for normal usage; the debounce prevents main-thread lock-up on rapid keystrokes in large tables.

---

## Section 5: Web + App Shim Migration

### Web

`apps/web/src/view-planner.jsx` — keep all helper exports (`loadWeekPlanner`, `saveWeekPlanner`, `weekStorageKey`, `buildEmptyPlannerData`, `hasMeaningfulPlannerData`, etc.) since the rest of the web codebase imports from there. Add:

```js
export { PlannerView } from '@nexusmd/ui'
```

`apps/web/src/view-planner-2.jsx` — **deleted**.

### App

`apps/app/src/planner/view-planner.jsx` — same pattern: keep helpers, drop local `PLANNER_SECTIONS`, import it from `@nexusmd/core`, add:

```js
export { PlannerView } from '@nexusmd/ui'
```

`apps/app/src/planner/view-planner-2.jsx` — **deleted**.

### Signature Compatibility

The shared `PlannerView` keeps the existing prop signature `{ data, setData, themes, setThemes, onExportDocx? }`. Both host pages pass the same props as before; no call-site changes needed.

---

## Section 6: Desktop Wiring

In `apps/desktop/src/main.jsx`:

```js
// Add to imports
import { PlannerView, MarkdownViewer } from '@nexusmd/ui'

// Add to NAV array (before 'settings')
{ id: 'markdown', label: 'Notes', icon: 'pin' },

// Replace 'planner' Placeholder in ViewBody switch
case 'planner':  return <PlannerView />
case 'markdown': return <MarkdownViewer />
```

No additional props needed:
- `PlannerView` reads namespace/pushPref from the existing `NexusDataProvider` runtime.
- DOCX export uses the browser-download path, which works fine in Electron.
- `MarkdownViewer` is fully self-contained.

---

## Non-Goals

- Migrating existing localStorage data between `helm.*` and `nexusmd.*` namespaces — each platform keeps its own scoped keys.
- Changing the `MarkdownViewer` feature itself — it is already in `@nexusmd/ui` and works on web/app.
- Adding cloud sync for Planner on desktop — that is a separate piece of work.

---

## Rollout Order

1. `@nexusmd/core`: add `PLANNER_SECTIONS` + `PL_GROUPS`
2. `@nexusmd/ui`: add `Sheet`, `plannerExportDocx`, shared `PlannerView`
3. Web: update shim, delete `-2.jsx`
4. App: update shim, rename `window.HelmNav`, delete `-2.jsx`
5. Desktop: add nav entries + cases
