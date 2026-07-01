# Nav Reordering + Zoom Control — Design

**Date:** 2026-07-02
**App:** `apps/desktop` (Electron + React SPA)
**Status:** Approved for planning

## Summary

Two small, independent additions to the desktop **Appearance** settings section
(`apps/desktop/src/main.jsx`, the `TweakSection title="Appearance"` block):

1. **Reorder the nav sidebar** from Settings via a drag-to-reorder list.
2. **A zoom control** that drives the existing whole-app Electron zoom engine.

Both reuse existing infrastructure, so the surface area is intentionally small.

## Feature A — Reorder nav sidebar (in Settings)

### State & persistence

- Add `navOrder` to the `tweaks` defaults — an array of nav ids matching the
  current `NAV` order (`dashboard, calendar, work, prs, builds, tests, team,
  triage, planner, markdown, settings`).
- Persists through the existing `nexusmd.tweaks` localStorage mechanism via
  `setTweak('navOrder', …)`, identical to how `widgetOrder` works today.

### Rendering

Extract a pure helper `orderedNav(navOrder, NAV)` that:

- returns items in `navOrder` sequence,
- **appends** any `NAV` items missing from a stored order (so nav items added in
  future builds still appear for users with an older stored order),
- **drops** stale ids no longer present in `NAV`.

The sidebar render changes from `NAV.map(...)` to
`orderedNav(tweaks.navOrder, NAV).map(...)`. The live sidebar stays click-only —
no drag on the sidebar itself (per decision: reordering happens in Settings).

### Editor UI

- A new `NavOrderEditor` component rendered inside the Appearance section: a
  vertical list of nav items, each with a grip handle and `draggable`, reusing
  the same HTML5 `onDragStart` / `onDragOver` / `onDrop` reorder approach already
  used for dashboard widgets in `packages/ui/src/views/view-dashboard.jsx`.
- All items are reorderable, including `settings`.
- A **"Reset nav order"** `TweakButton` below the list resets `navOrder` to the
  default, mirroring the existing "Reset widget order" button.

## Feature B — Zoom control (in Settings)

The whole-app zoom engine already exists in the Electron main process:
`electron/zoom.cjs` (`ZOOM_MIN=0.5`, `ZOOM_MAX=2.0`, `ZOOM_STEP=0.1`,
`ZOOM_DEFAULT=1.0`, `clampZoomFactor`, `nextZoom`), plus `applyZoom(win, factor)`
in `main.cjs`, menu accelerators (Ctrl+0 / Ctrl+= / Ctrl+-), and a
`zoom-changed` handler for Ctrl+mouse-wheel. Zoom is persisted as
`prefs.zoomFactor` (native window pref), **not** in localStorage tweaks.

### Main process (`electron/main.cjs`)

- Add IPC handler `get-zoom-factor` → returns `prefs.zoomFactor ?? ZOOM_DEFAULT`.
- Add IPC handler `set-zoom-factor` → calls existing `applyZoom(win, factor)`
  (which already clamps and persists).
- Update `applyZoom` to emit `win.webContents.send('zoom:changed', f)` after
  applying, so a settings slider stays in sync when zoom changes via menu,
  Ctrl±, or mouse wheel.

### Preload (`electron/preload.cjs`)

Expose on `window.electronAPI`:

- `getZoomFactor()` → `ipcRenderer.invoke('get-zoom-factor')`
- `setZoomFactor(f)` → `ipcRenderer.invoke('set-zoom-factor', f)`
- `onZoomChanged(cb)` → subscribes to `zoom:changed`, returns an unsubscribe fn
  (follow the existing listener cleanup pattern in preload).

### Renderer (`apps/desktop/src/main.jsx`)

- A `TweakSlider label="Zoom"` in the Appearance section: `min={50}`,
  `max={200}`, `step={10}`, `unit="%"`. Range matches the `zoom.cjs` clamp of
  0.5–2.0.
- Value is held in **local React state**, not in `tweaks` (zoom is owned by
  Electron). Initialize from `getZoomFactor()` on mount, update on
  `onZoomChanged`, and write back via `setZoomFactor(v / 100)`.
- When `window.electronAPI` is absent (web build / tests), the zoom slider is not
  rendered.

## Data flow

```
Nav reorder:   NavOrderEditor (drag) → setTweak('navOrder', ids)
               → tweaks.navOrder (localStorage) → orderedNav() → sidebar render

Zoom:          TweakSlider → electronAPI.setZoomFactor(f) → IPC 'set-zoom-factor'
               → applyZoom() → webContents.setZoomFactor + persist prefs
               → 'zoom:changed' → onZoomChanged → slider state (sync)
               (also: menu / Ctrl± / wheel → applyZoom → same sync path)
```

## Error handling & edge cases

- `orderedNav` is total: unknown stored ids are dropped, missing `NAV` ids are
  appended — never throws, always returns a complete, valid list.
- Zoom IPC calls are guarded by `window.electronAPI` presence; absent → slider
  hidden, no calls made.
- `set-zoom-factor` reuses `clampZoomFactor` inside `applyZoom`, so out-of-range
  values from the renderer are clamped in the main process (defence in depth).

## Testing

- **`orderedNav`** (pure): correct ordering; appends `NAV` items missing from a
  stored order; drops stale ids; empty/undefined `navOrder` → full `NAV` order.
- **Zoom conversion**: factor↔percent round-trips at the boundaries (0.5↔50,
  2.0↔200, 1.0↔100).
- **Render**: Appearance section shows the nav editor; zoom slider is hidden when
  `window.electronAPI` is undefined and shown when it is mocked.

## Out of scope (YAGNI)

- Hiding/showing individual nav items (reorder only).
- Drag-to-reorder on the live sidebar itself.
- Per-view or font-only zoom (whole-app native zoom only).
