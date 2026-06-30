# Centralise Build Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all moveable build/publish artifact directories to a single root-level `dist/` directory with consistent subdirectories.

**Architecture:** Four config-only changes — no new code, no new dependencies. Vite, electron-builder, and Electron's main process are each given updated paths that all resolve to the new `dist/desktop/renderer/` and `dist/desktop/release/` locations. `.gitignore` is trimmed of now-redundant specific entries.

**Tech Stack:** Vite, Electron, electron-builder, Node.js `path` module.

## Global Constraints

- No new npm dependencies.
- `apps/web/server/wwwroot/` and `apps/app/www/` are NOT moved — framework-constrained, out of scope.
- Test artifact locations (`coverage/`, `playwright-report/`, `test-results/`) are NOT moved — out of scope.
- All paths must work on Windows, macOS, and Linux (use `path.join`, not string concatenation).
- The existing top-level `dist/` entry in `.gitignore` already covers all new output locations — no new ignore rule is needed.

---

### Task 1: Redirect all desktop build output to `dist/` and clean up `.gitignore`

All four changes are a single atomic task — the vite config, main.cjs loader path, electron-builder output dir, and .gitignore must be consistent or the desktop app fails to build/run.

**Files:**
- Modify: `apps/desktop/vite.config.js`
- Modify: `apps/desktop/electron/main.cjs`
- Modify: `apps/desktop/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `dist/desktop/renderer/` — Vite renderer build consumed by electron-builder and Electron's `loadFile`
- Produces: `dist/desktop/release/` — electron-builder packaged installers
- Produces: `dist/web/` — convention for .NET `dotnet publish` output (documented; no in-repo config drives it)

- [ ] **Step 1: Update `vite.config.js` outDir**

  Open `apps/desktop/vite.config.js`. The current file is:

  ```js
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    base: './',
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
    },
  })
  ```

  Change `outDir` to point to the repo-root `dist/desktop/renderer/`. The config file lives at `apps/desktop/`, so two levels up (`../..`) reaches the repo root:

  ```js
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    base: './',
    build: {
      outDir: '../../dist/desktop/renderer',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
    },
  })
  ```

- [ ] **Step 2: Update `main.cjs` renderer `loadFile` path**

  Open `apps/desktop/electron/main.cjs`. Find the line:

  ```js
  win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  ```

  `__dirname` is `apps/desktop/electron/`. The new renderer output is at `dist/desktop/renderer/` from the repo root, which is three levels up from `apps/desktop/electron/`:

  Replace with:

  ```js
  win.loadFile(path.join(__dirname, '..', '..', '..', 'dist', 'desktop', 'renderer', 'index.html'));
  ```

- [ ] **Step 3: Update electron-builder output directory**

  Open `apps/desktop/package.json`. Find the `build.directories` block:

  ```json
  "directories": {
    "output": "../dist/desktop"
  }
  ```

  `../dist/desktop` is relative to `apps/desktop/` and resolves to `apps/dist/desktop/`. Change it to resolve to the repo-root `dist/desktop/release/`:

  ```json
  "directories": {
    "output": "../../dist/desktop/release"
  }
  ```

- [ ] **Step 4: Clean up `.gitignore`**

  Open `.gitignore`. Remove these three entries (they are now redundant — covered by the existing top-level `dist/` rule, and `publish/` is superseded by `dist/web/`):

  ```
  # Electron
  apps/desktop/dist/
  apps/desktop/release/
  ```

  and:

  ```
  # Publish output (may contain secrets in appsettings files)
  publish/
  ```

  The `# Electron` section should be left with only the line that still applies (none in this section after removal — remove the section header too if empty). The resulting `.gitignore` Electron section becomes empty; delete the `# Electron` header and both lines.

  The file should no longer contain `apps/desktop/dist/`, `apps/desktop/release/`, or `publish/`.

- [ ] **Step 5: Verify with a dry-run build**

  Run the Vite renderer build and confirm output lands in the right place:

  ```bash
  cd apps/desktop
  npm run build:renderer
  ```

  Expected: build succeeds and `dist/desktop/renderer/index.html` exists at the repo root:

  ```bash
  ls ../../dist/desktop/renderer/index.html
  # or from repo root:
  ls dist/desktop/renderer/index.html
  ```

  Expected output: the file is listed (no "No such file" error).

- [ ] **Step 6: Verify Electron dev mode still loads**

  Start the dev server and confirm no load-path errors:

  ```bash
  npm run dev
  ```

  Expected: Electron window opens, no `ERR_FILE_NOT_FOUND` or `loadFile` error in the console. (The dev path uses `loadURL` from the Vite dev server, not `loadFile`, so this also confirms the dev-vs-prod branch is intact.)

- [ ] **Step 7: Commit**

  ```bash
  cd ../..   # back to repo root
  git add apps/desktop/vite.config.js apps/desktop/electron/main.cjs apps/desktop/package.json .gitignore
  git commit -m "chore: centralise build artifacts under dist/"
  ```
