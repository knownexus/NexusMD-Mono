---
name: verify
description: How to (attempt to) verify apps/desktop changes at runtime
---

# Verifying apps/desktop

## What works

- `npm test` (vitest) from `apps/desktop/` — fast, reliable, runs the full
  component/unit suite.
- `npx vite build` — builds the renderer to `../../dist/desktop/renderer`.
  Required before any Electron launch attempt (`electron/main.cjs` falls back
  to `process.resourcesPath/renderer` when `VITE_DEV_SERVER_URL` isn't set).

## Driving the real app (works in this sandbox)

Use `e2e/launch.js` (`launchApp({ seed })`), not a bare `electron.launch`. It starts the app with
a throwaway `--user-data-dir` and `--disable-gpu`. The earlier "BLOCKED" diagnosis (no window
station) was wrong: the shared profile's cache folders gave "Access is denied" and Electron quit
right after "app ready". With a clean profile the window renders and Playwright can drive it.

- `npx vite build` first, then `npx playwright test e2e/smoke.spec.js` (5 tests, ~10s).
- `seed` writes localStorage before first render; a key starting with `profile:` goes under the
  active profile (e.g. `'profile:git.config'` to register repos for the Git Workspace).
- `scripts/git-click-timing.mjs <repo> <file>` and `scripts/git-poll-timing.mjs <repo...>` time the
  Git Workspace in the real app (read-only; repos are looked up under C:/repos).
- Main-process IPC can be wrapped for timing via `app.evaluate(({ ipcMain }) => ipcMain._invokeHandlers)`.

## Fallback verification strategy used

If launching still fails (confirm with the unmodified smoke spec):
1. Trace the exact prop-drilling / state-wiring path by hand (React
   component tree, `grep`-verified) — confirm the click handler chain is
   complete end-to-end, not just that a function exists.
2. Run the full vitest suite to catch regressions in adjacent logic.
3. Report the GUI-surface verdict as BLOCKED (not PASS) and say so plainly.
