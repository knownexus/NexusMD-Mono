# Custom Title Bar — Design Spec

**Date:** 2026-06-30  
**Status:** Approved

## Goal

Remove the native Win11 title-bar overlay (minimize / maximize / close controls) from the Electron desktop app and replace them with custom Win11-styled buttons rendered inside the app UI. macOS retains its native traffic-light buttons unchanged.

## Approach

Platform-adaptive: custom buttons on Windows/Linux only. macOS keeps `titleBarStyle: 'hidden'` which always shows native traffic lights — no custom buttons rendered there. The window frame (resize handles, OS shadow, rounded corners) is preserved on all platforms since we keep `frame` at its default (`true`).

## Changes

### `apps/desktop/electron/main.cjs`

- **Remove** `TITLEBAR_HEIGHT`, `TITLEBAR_LIGHT`, `TITLEBAR_DARK`, `titlebarForTheme()`.
- **Remove** `titleBarOverlay` option from `BrowserWindow` constructor.
- **Remove** `tbHeight` variable and the `padding-top: ${tbHeight}px` line from the injected CSS.
- **Remove** `ipcMain.on('set-titlebar-theme', ...)` handler.
- **Add** three fire-and-forget IPC listeners:
  - `window:minimize` → `mainWindow.minimize()`
  - `window:maximize` → toggles `mainWindow.isMaximized() ? unmaximize() : maximize()`
  - `window:close` → `mainWindow.close()`

### `apps/desktop/electron/preload.cjs`

- **Remove** `setTitlebarTheme` from `electronAPI`.
- **Add** `platform: process.platform` — string exposed once at load time so the renderer can branch without an IPC round-trip.
- **Add** `window: { minimize, maximize, close }` — each sends the corresponding `window:*` IPC message.

### `apps/desktop/src/main.jsx`

- **Add** `WindowControls` component:
  - Renders `null` when `window.electronAPI?.platform === 'darwin'`.
  - Three `<button>` elements: Minimize (`─`), Maximize (`▢`), Close (`✕`) using SVG icons.
  - Sizing: `46px × 32px`, no border, transparent background at rest.
  - Hover states (via inline style + React state or CSS class):
    - Minimize / Maximize: `rgba(0,0,0,0.08)` light / `rgba(255,255,255,0.08)` dark.
    - Close: `#c42b1c` background, white icon.
  - All buttons: `WebkitAppRegion: 'no-drag'` to prevent accidental window drag.
- **Place** `<WindowControls />` as the last child of the `<header className="topbar">` element with `marginLeft: 'auto'` to push it to the far right.
- **Remove** the topbar's right padding so buttons sit flush to the window edge.

## Behaviour Notes

- `window:close` honours the existing `closeToTray` preference because it calls `mainWindow.close()`, which triggers the existing `'close'` event handler.
- Maximize toggles correctly: a second click on the maximize button restores the window.
- On macOS the topbar and sidebar-brand are unchanged — traffic lights remain in the OS-managed inset position.
- The `-webkit-app-region: drag` CSS on `.topbar` remains; the buttons override it locally with `no-drag`.

## Out of Scope

- Custom resize handles (OS handles still provided by the native frame).
- Win11 Snap Layouts hover hint on the maximize button (requires native overlay; removed by this change).
- Linux-specific styling (buttons will render but use the same Win11 aesthetic).
