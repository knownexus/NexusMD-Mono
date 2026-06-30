# Custom Title Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the native Win11 title-bar overlay and replace minimize/maximize/close with custom Win11-styled buttons rendered in the app's topbar (Windows/Linux only; macOS keeps native traffic lights).

**Architecture:** Three-layer change: (1) main process removes the overlay config and gains 3 IPC handlers for window control, (2) preload bridges those handlers to the renderer and exposes `process.platform`, (3) renderer adds a `WindowControls` React component that calls the preload API and is hidden on macOS. CSS for hover states is injected via the existing `insertCSS` call in main.cjs to keep styling out of inline React styles.

**Tech Stack:** Electron 29+, React 18, plain CSS injected via `webContents.insertCSS`.

## Global Constraints

- No new npm dependencies.
- All IPC channels use fire-and-forget `ipcRenderer.send` / `ipcMain.on` (not `invoke`/`handle`) — consistent with existing `set-titlebar-theme` pattern.
- `contextIsolation: true`, `sandbox: true` — renderer cannot access Node APIs directly.
- Custom buttons must not appear on `darwin` (macOS keeps native traffic lights).
- `window:close` must trigger the existing `closeToTray` logic (achieved by calling `mainWindow.close()`, not `app.quit()`).

---

### Task 1: Main process — remove overlay, add window-control IPC

**Files:**
- Modify: `apps/desktop/electron/main.cjs`

**Interfaces:**
- Produces IPC channels consumed by Task 2:
  - `'window:minimize'` — no payload → `mainWindow.minimize()`
  - `'window:maximize'` — no payload → toggle maximize/restore
  - `'window:close'`   — no payload → `mainWindow.close()`

- [ ] **Step 1: Remove the overlay constants and helper**

  In `main.cjs`, delete lines 106–112 (the block from `const TITLEBAR_HEIGHT` through the closing brace of `titlebarForTheme`):

  ```js
  // DELETE these lines:
  const TITLEBAR_HEIGHT = 40;
  const TITLEBAR_LIGHT  = { color: '#fbf8ee', symbolColor: '#2c2618', height: TITLEBAR_HEIGHT };
  const TITLEBAR_DARK   = { color: '#16202c', symbolColor: '#d6dfe8', height: TITLEBAR_HEIGHT };

  function titlebarForTheme(isDark) {
    return isDark ? TITLEBAR_DARK : TITLEBAR_LIGHT;
  }
  ```

- [ ] **Step 2: Remove `titleBarOverlay` from `BrowserWindow` and clean up CSS injection**

  In `createMainWindow()`, the `BrowserWindow` options block currently ends with:
  ```js
  titleBarStyle: 'hidden',
  titleBarOverlay: titlebarForTheme(isDark),
  ```
  Remove `titleBarOverlay: titlebarForTheme(isDark),` so only `titleBarStyle: 'hidden'` remains.

  Then find the `tbHeight` block and the `insertCSS` call. Replace the entire block (from `const tbHeight` through the closing backtick of `insertCSS`) with:

  ```js
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      html { box-sizing: border-box; }
      .topbar, .sidebar-brand { -webkit-app-region: drag; }
      .topbar button, .topbar input, .topbar a, .topbar select,
      .topbar [role="button"] { -webkit-app-region: no-drag; }

      /* Win11-style custom window controls */
      .wc-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 100%;
        background: transparent;
        border: none;
        cursor: default;
        color: inherit;
        -webkit-app-region: no-drag;
        padding: 0;
      }
      .wc-btn:hover { background: rgba(0, 0, 0, 0.08); }
      .wc-btn.wc-close:hover { background: #c42b1c; color: #fff; }
      @media (prefers-color-scheme: dark) {
        .wc-btn:hover { background: rgba(255, 255, 255, 0.08); }
        .wc-btn.wc-close:hover { background: #c42b1c; color: #fff; }
      }
    `);
  });
  ```

- [ ] **Step 3: Remove the `set-titlebar-theme` IPC handler**

  Delete lines 297–301 (the `ipcMain.on('set-titlebar-theme', ...)` block):

  ```js
  // DELETE this block:
  ipcMain.on('set-titlebar-theme', (_e, isDark) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(titlebarForTheme(isDark));
    }
  });
  ```

- [ ] **Step 4: Add the three window-control IPC handlers**

  Add the following block immediately after the `ipcMain.handle('get-native-theme', ...)` line (around line 292):

  ```js
  // ---------------------------------------------------------------------------
  // Custom window controls — renderer calls these instead of native overlay
  // ---------------------------------------------------------------------------
  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ```

- [ ] **Step 5: Verify the main process changes compile cleanly**

  Run:
  ```
  cd apps/desktop
  npm run build 2>&1 | head -40
  ```

  Expected: no syntax errors. (A Vite dev-server start is fine too — just checking no crash on load.)

- [ ] **Step 6: Commit**

  ```bash
  git add apps/desktop/electron/main.cjs
  git commit -m "feat(desktop): remove titlebar overlay, add window-control IPC"
  ```

---

### Task 2: Preload — expose `platform` and `window` controls

**Files:**
- Modify: `apps/desktop/electron/preload.cjs`

**Interfaces:**
- Consumes IPC channels from Task 1: `'window:minimize'`, `'window:maximize'`, `'window:close'`
- Produces on `window.electronAPI`:
  - `platform: string` — value of `process.platform` (`'win32'`, `'darwin'`, `'linux'`)
  - `window.minimize(): void`
  - `window.maximize(): void`
  - `window.close(): void`

- [ ] **Step 1: Remove `setTitlebarTheme`**

  In `preload.cjs`, delete the `setTitlebarTheme` property (lines 57–58):

  ```js
  // DELETE:
  setTitlebarTheme: (isDark) => ipcRenderer.send('set-titlebar-theme', isDark),
  ```

- [ ] **Step 2: Add `platform` and `window` to `electronAPI`**

  Inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, add after the `getNativeTheme` line:

  ```js
  // Platform identifier — lets the renderer show/hide custom window controls
  // without an extra IPC round-trip.
  platform: process.platform,

  // Custom window controls (replaces native titleBarOverlay on Win/Linux).
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },
  ```

- [ ] **Step 3: Verify sandbox allows `process.platform`**

  `process.platform` is available in the preload context even with `sandbox: true` because Electron injects a partial `process` object into sandboxed preloads. No change needed — just confirming this.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/desktop/electron/preload.cjs
  git commit -m "feat(desktop): expose platform + window controls via preload"
  ```

---

### Task 3: Renderer — `WindowControls` component

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes from Task 2:
  - `window.electronAPI.platform: string`
  - `window.electronAPI.window.minimize(): void`
  - `window.electronAPI.window.maximize(): void`
  - `window.electronAPI.window.close(): void`
- Consumes CSS classes from Task 1: `.wc-btn`, `.wc-close`

- [ ] **Step 1: Add the `WindowControls` component**

  Add this function directly before the `App` function in `main.jsx`:

  ```jsx
  function WindowControls() {
    if (window.electronAPI?.platform === 'darwin') return null;
    const win = window.electronAPI?.window;
    return (
      <div style={{ display: 'flex', alignSelf: 'stretch', marginLeft: 'auto', marginTop: -10, marginBottom: -10 }}>
        <button className="wc-btn" onClick={() => win?.minimize()} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button className="wc-btn" onClick={() => win?.maximize()} title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0h10v10H0V0zm1 1v8h8V1H1z" fill="currentColor" />
          </svg>
        </button>
        <button className="wc-btn wc-close" onClick={() => win?.close()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    );
  }
  ```

  The `marginTop: -10` / `marginBottom: -10` counters the topbar's `10px` vertical padding so the buttons fill the full header height — matching the Win11 flush-to-edge convention.

- [ ] **Step 2: Wire `WindowControls` into the topbar and remove right padding**

  Find the `<header className="topbar" ...>` element. Make two changes:

  1. Change `padding: '10px 18px'` → `padding: '10px 0 10px 18px'` (remove right padding so controls sit flush to the window edge).
  2. Add `<WindowControls />` as the last child of the `<header>`.

  The header should look like:

  ```jsx
  <header className="topbar" style={{
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 10px 18px',
    borderBottom: '1px solid var(--border)',
  }}>
    <Icon name={active.icon} size={16} />
    <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
    <WindowControls />
  </header>
  ```

- [ ] **Step 3: Start the dev app and verify**

  ```bash
  cd apps/desktop
  npm run dev
  ```

  Check:
  - The native Win11 window controls (top-right corner) are **gone**.
  - Three custom buttons appear at the right end of the topbar.
  - Minimize button hides the window to taskbar.
  - Maximize button expands the window; clicking again restores it.
  - Close button hides to tray (if `closeToTray` is enabled) or quits.
  - Hovering minimize/maximize shows a subtle grey background.
  - Hovering close shows a red (`#c42b1c`) background with white icon.
  - The topbar is still draggable (click-and-drag on the blank area moves the window).
  - On macOS (if available): no custom buttons appear; native traffic lights visible top-left.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/desktop/src/main.jsx
  git commit -m "feat(desktop): add Win11-style custom window controls to topbar"
  ```
