# Desktop UI Scaling — Design

**Date:** 2026-07-01
**Scope:** Make the desktop (Electron) app scale better across resolutions and window sizes.

## Problem

Two concrete pain points, confirmed with the user:

1. **No user zoom control.** There is no way to scale the whole UI up or down. On large/high-res
   displays the UI can feel small, and users have no lever to adjust it.
2. **Cramped / broken layouts in small windows.** The `BrowserWindow` sets no `minWidth`/`minHeight`,
   so the window can be dragged arbitrarily small. Sizing is almost entirely hardcoded in `px`
   (inline styles in `apps/desktop/src/main.jsx` and rules in `packages/ui/src/styles/base.css`),
   with only a couple of `@media` breakpoints at 1100px/900px. Narrow windows overflow, clip, or
   produce horizontal scrollbars.

## Goals

- Native, persistent, browser-style zoom (Ctrl +/-/0 and Ctrl+mouse-wheel).
- A window can never be sized small enough to break the layout.
- Layouts reflow gracefully as width shrinks (which also covers zoom-in, since zoom shrinks the
  logical viewport).

## Non-goals

- A discrete "UI scale" dropdown in Settings (user chose native zoom only).
- Per-view visual redesigns.
- Persisting window position/bounds across restarts.

## Design

### Part A — Native zoom (desktop-only, `apps/desktop/electron/main.cjs`)

Zoom is owned entirely by the main process. Electron's zoom uniformly scales the whole page, so
**no renderer or `packages/ui` changes are needed** for zoom itself.

- **Persistence:** reuse the existing `userData/prefs.json` store (`loadPrefs`/`savePrefs`, already
  present). Add a `zoomFactor` key.
- **Apply on load:** in the window's `did-finish-load` handler, call
  `win.webContents.setZoomFactor(clamp(prefs.zoomFactor ?? 1))`.
- **Persist on change:** subscribe to `win.webContents.on('zoom-changed', …)` (fires on
  Ctrl+mouse-wheel) and persist the resulting factor. Also persist after the View-menu zoom
  actions so keyboard zoom is saved.
- **Keyboard:** the View menu already has `resetZoom` / `zoomIn` (Ctrl+=) / `zoomOut` roles. Ensure
  **Ctrl+= / Ctrl+- / Ctrl+0** and **Ctrl+mouse-wheel** all work and all persist.
- **Clamp:** constrain the zoom factor to roughly `0.5`–`2.0` (50%–200%) so it can't be driven to an
  unusable extreme. Reset (Ctrl+0) returns to `1.0`.

### Part B — Minimum window size (`apps/desktop/electron/main.cjs`)

Add `minWidth: 900, minHeight: 600` to the `new BrowserWindow({ … })` config. This guarantees the
window can't be dragged into a broken state. Zooming in still triggers responsive reflow because
zoom shrinks the logical CSS viewport.

### Part C — Responsive reflow

#### Desktop sidebar (`apps/desktop/src/main.jsx`)

The desktop sidebar is a **separate, inline-styled implementation** — it does not use the shared
`.app[data-sidebar="icons"]` CSS that the web app's rail uses, and it renders label text raw. So
collapse behavior must be added here directly.

- Add a lightweight window-width hook (window `resize` listener storing `window.innerWidth`).
- Compute `effectiveSidebar = width < 1024 ? 'icons' : tweaks.sidebar`. This auto-collapses to an
  icon-only rail below the breakpoint **without overwriting** the user's saved `sidebar` preference
  (the manual tweak is preserved and re-applies when the window widens again).
- In icons mode:
  - fix the rail to a narrow width (~56px),
  - hide nav label text and the number/shortcut hints,
  - render change-badges as a small dot instead of a count pill,
  - disable / hide the drag-resizer (it only makes sense in labels mode).
- Set `data-sidebar={effectiveSidebar}` on the app root so any dependent styling stays consistent.

**Breakpoint:** 1024px (approved).

#### Shared grids / tables (`packages/ui/src/styles/base.css`)

These changes are in shared UI and also benefit the web app.

- Existing `@media (max-width: 1100px)` already collapses `.grid`, `.stats`, and `.glance-grid`.
- Add a tighter tier (~760px) so `.stats` drops to a single column.
- Confirm table wrappers retain `overflow-x: auto` (base.css:888 already does) so wide tables scroll
  rather than overflow the viewport.

#### Modals (`apps/desktop/src/main.jsx`)

The inline modals use fixed pixel widths (Create Work Item `width: 480`, Project Areas `width: 520`).
Change these to viewport-aware widths, e.g. `width: min(480px, 92vw)` / `width: min(520px, 92vw)`, so
they fit narrow windows. (The shared `Drawer` already uses `width: min(560px, 90vw)`.)

## Files touched

- `apps/desktop/electron/main.cjs` — zoom persistence + apply + clamp; `minWidth`/`minHeight`.
- `apps/desktop/src/main.jsx` — window-width hook; effective sidebar collapse; modal widths.
- `packages/ui/src/styles/base.css` — tighter responsive tier for `.stats`; confirm table overflow.

## Testing

- **Zoom:** Ctrl+=, Ctrl+-, Ctrl+0, and Ctrl+mouse-wheel change zoom; the level survives an app
  restart; factor is clamped at the 50%/200% bounds.
- **Minimum size:** the window cannot be resized below 900×600.
- **Reflow:** narrowing the window below 1024px collapses the sidebar to icons and restores
  labels when widened; the manual sidebar preference is untouched. Below ~1100/760px the dashboard
  grid and stats collapse to fewer columns; wide tables scroll horizontally instead of overflowing.
- **Modals:** Create Work Item and Project Areas modals fit within a narrow (900px) window.
- Desktop unit tests (`apps/desktop`, vitest) continue to pass.
