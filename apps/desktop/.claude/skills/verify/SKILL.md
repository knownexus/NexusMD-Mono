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

## What's currently BLOCKED in this sandbox

`npx playwright test` (the `e2e/*.spec.js` suite using `_electron.launch`)
does not work in this shell environment — **not** a code regression, it fails
identically on the pre-existing, unmodified `e2e/smoke.spec.js`.

Symptom: `electron.launch: Target page, context or browser has been closed`.
Manually launching `node_modules/electron/dist/electron.exe .` (with or
without `--remote-debugging-port`) shows in its own log that it gets to
`app ready; creating main window`, logs GPU disk-cache "Access is denied"
errors, then the process exits on its own shortly after (no crash dump, exit
code 0) — consistent with `ready-to-show`/`win.show()` never actually
succeeding because this shell has no interactive Windows window station /
GPU access, which trips `window-all-closed` → `app.quit()`.

If you hit this again: don't burn time re-diagnosing it as a regression.
Confirm quickly by running the unmodified `smoke.spec.js` — if it also fails
the same way, it's this environment limitation, not your change. Report the
GUI surface as BLOCKED with this reason, rather than declaring PASS from
unit tests alone.

## Fallback verification strategy used

When the Electron GUI can't be driven directly:
1. Trace the exact prop-drilling / state-wiring path by hand (React
   component tree, `grep`-verified) — confirm the click handler chain is
   complete end-to-end, not just that a function exists.
2. Run the full vitest suite to catch regressions in adjacent logic.
3. Report the GUI-surface verdict as BLOCKED (not PASS) and say so plainly.
