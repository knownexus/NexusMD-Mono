# Centralise Build Artifacts — Design Spec

**Date:** 2026-06-30
**Status:** Approved

## Goal

Move all moveable build and publish artifacts to a single root-level `dist/` directory with consistent subdirectories, while leaving framework-constrained outputs (`apps/web/server/wwwroot/` and `apps/app/www/`) in place.

## Directory Structure

```
dist/
  desktop/
    renderer/    ← Vite renderer build (intermediate, consumed by electron-builder)
    release/     ← electron-builder packaged installers (NSIS, DMG, AppImage, etc.)
  web/           ← .NET dotnet publish output
```

### Unchanged (framework-constrained)

- `apps/web/server/wwwroot/` — Vite web build; must stay here for ASP.NET to serve it
- `apps/app/www/` — Capacitor build output; must stay here for Capacitor toolchain
- Test artifacts (`coverage/`, `playwright-report/`, `test-results/`) — out of scope

## Files Changed

### `apps/desktop/vite.config.js`

Change `outDir` from `'dist/renderer'` (relative to `apps/desktop/`) to `'../../dist/desktop/renderer'` (relative to `apps/desktop/`, resolves to repo root `dist/desktop/renderer/`).

### `apps/desktop/electron/main.cjs`

The renderer `loadFile` path currently resolves via:
```js
path.join(__dirname, '..', 'dist', 'renderer', 'index.html')
// apps/desktop/electron/ → apps/desktop/ → apps/desktop/dist/renderer/index.html
```

New path must resolve to `dist/desktop/renderer/index.html` from repo root:
```js
path.join(__dirname, '..', '..', '..', 'dist', 'desktop', 'renderer', 'index.html')
// apps/desktop/electron/ → apps/desktop/ → apps/ → repo root → dist/desktop/renderer/
```

### `apps/desktop/package.json`

electron-builder `directories.output` changes from `../dist/desktop` to `../../dist/desktop/release`.

`../dist/desktop` is relative to `apps/desktop/` and resolves to `apps/dist/desktop/`.
`../../dist/desktop/release` resolves to `dist/desktop/release/` at repo root.

### `.gitignore`

Remove these now-redundant specific entries (all covered by the existing top-level `dist/` rule):
- `apps/desktop/dist/`
- `apps/desktop/release/`
- `publish/`

The `dist/` entry already present in `.gitignore` covers the new `dist/desktop/renderer/`, `dist/desktop/release/`, and `dist/web/` locations.

## Out of Scope

- `.NET publish command` target path — controlled by whoever runs `dotnet publish`; no config file in-repo specifies it. The `publish/` → `dist/web/` convention is documented here for CI/developer awareness.
- Test artifact locations.
- `apps/web/server/wwwroot/` and `apps/app/www/`.
