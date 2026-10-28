'use strict';


const log = require('electron-log');
const path = require('path');
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, net, shell } = require('electron');
const { pinUserData } = require('./user-data.cjs');

// Must run before anything reads app.getPath('userData') (logs, prefs, stores).
pinUserData(app);

// Configure electron-log — 'silly' is the lowest (most verbose) level, so
// every log/info/warn/error/debug/verbose/silly call is written to file.
log.transports.file.level = 'silly';
log.transports.console.level = 'silly';

// Set log file path to {userData}/logs/{YYYY-MM-DD}.log
const logsDir = path.join(app.getPath('userData'), 'logs');
log.transports.file.resolvePathFn = () => {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(logsDir, `${date}.log`);
};

// Patch console to use electron-log (all console.log → file + console)
console.log = log.info;
console.warn = log.warn;
console.error = log.error;

// Make log global for use in other modules
global.log = log;

// Disable GPU hardware acceleration. On some Windows GPU/driver combinations
// (and in remote/virtualised sessions) Chromium's GPU compositor fails to
// paint the packaged window, leaving it blank white while the renderer has
// actually loaded and executed fine. Launching with `--disable-gpu` renders
// correctly, so we disable acceleration up-front for reliability across
// machines. Must be called before app 'ready'. This dashboard is not
// GPU-bound, so the rendering-smoothness cost is negligible.
app.disableHardwareAcceleration();

// Forward every renderer's console.* calls into the same log file. Renderer
// windows run their own JS context (contextIsolation/sandbox), so the console
// patch above only covers the main process — without this, errors like the
// OAuth flow's console.error() in cloud-auth.js never reach the log file.
// preload: false — the default preload injection would run in every window's
// session, including the sandboxed link-window tabs that load arbitrary
// external sites (ADO work items, PRs). spyRendererConsole alone listens for
// console-message on all webContents from the main process, no injection needed.
log.initialize({ preload: false, spyRendererConsole: true });

// Catch anything that would otherwise bypass console.* entirely: uncaught
// exceptions and unhandled promise rejections in the main process. Keeps the
// native "A JavaScript error occurred" dialog (showDialog defaults to true)
// so a fatal main-process crash is still visible, not just silently logged.
log.errorHandler.startCatching();
const { createTray, updateTrayIcon } = require('./tray.cjs');
const { initNotifications } = require('./notifications.cjs');
const { initUpdater, registerUpdaterIpc } = require('./updater.cjs');
const { startAppUpdater } = require('./app-updater.cjs');
const { pendingUpdates, applyAppUpdates } = require('./app-apply.cjs');

const appRegistry    = require('./app-registry.cjs');

// All-in-one, or apps installed as folders of their own (see app-registry.cjs).
const appLayout = appRegistry.getLayout(process.env, {
  isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, userDataPath: app.getPath('userData'),
});
// Each installed app at its newest usable version: a downloaded update where there is one.
const splitApps = appLayout.appsDir
  ? appRegistry.resolveApps(appLayout.appsDir, { updatesDir: appLayout.updatesDir, log: log.scope('apps') })
  : null;
// The one app of a single-app install: it gives the window and the tray their name and icon.
const standaloneApp = splitApps && splitApps.length === 1 ? splitApps[0] : null;
// Windows groups the taskbar and routes notifications by this id. A single-app install has its own, which its
// shortcuts carry too (installer.nsh), so it pins and groups as that app; everything else is NexusMD.
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId(standaloneApp ? `com.knownexus.nexusmd.${standaloneApp.id}` : 'com.knownexus.nexusmd');
}
const appTable = splitApps ? appRegistry.modulesFromScan(splitApps) : undefined;
const fileIpc        = require('./ipc/file.cjs');
const pickerIpc      = require('./ipc/picker.cjs');
const badgeIpc       = require('./ipc/badge.cjs');
const deepLinkIpc    = require('./ipc/deepLink.cjs');
const trayIpc        = require('./ipc/tray-ipc.cjs');
const logsIpc        = require('./ipc/logs.cjs');
const oauthIpc       = require('./ipc/oauth.cjs');
const loginItemIpc   = require('./ipc/login-item.cjs');
const linkWindow     = require('./link-window/manager.cjs');
const { createWindowOpenHandler } = require('./link-window/window-open.cjs');
const { buildLinkMenuTemplate } = require('./link-window/link-context-menu.cjs');
const { clampZoomFactor, nextZoom, ZOOM_DEFAULT } = require('./zoom.cjs')

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
const secondInstanceListeners = new Set();
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running — quit immediately.
  app.quit();
} else {
  // A second launch attempt focuses the existing window, and tells the installed apps what it was
  // launched with (e.g. the Editor opens a file given on the command line).
  app.on('second-instance', (_event, argv) => {
    for (const listener of secondInstanceListeners) {
      try { listener(argv); } catch (err) { log.error('second-instance listener failed', err); }
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow = null;
let appModules = null;
let appUpdater = null;
let tray = null;
let forceQuit = false;

// ---------------------------------------------------------------------------
// Window factory
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Application menu — minimal Windows 11 style (no verbose File/Edit/View bar)
// ---------------------------------------------------------------------------
function buildAppMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    // macOS needs the app name as the first menu
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Refresh data', accelerator: 'F5', click: () => win.webContents.send('refresh-data') },
        { type: 'separator' },
        { label: 'Hide to tray', click: () => win.hide() },
        { label: 'Quit', accelerator: isMac ? 'Cmd+Q' : 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => applyZoom(win, ZOOM_DEFAULT) },
        { label: 'Zoom In',    accelerator: 'CmdOrCtrl+=', click: () => applyZoom(win, nextZoom(win.webContents.getZoomFactor(), 'in')) },
        { label: 'Zoom Out',   accelerator: 'CmdOrCtrl+-', click: () => applyZoom(win, nextZoom(win.webContents.getZoomFactor(), 'out')) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // Dev builds only: Ctrl+R picks up a rebuilt renderer without restarting the app.
        ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'About Management Dashboard', click: () => {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'Management Dashboard',
            message: 'Management Dashboard',
            detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}`,
            buttons: ['OK'],
          });
        }},
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Window icon utility
// ---------------------------------------------------------------------------
function windowIconPath(isDark) {
  if (standaloneApp?.iconPath) return standaloneApp.iconPath;
  const name = isDark ? 'icon-light.png' : 'icon.png';
  return path.join(__dirname, '..', 'assets', name);
}

function updateWindowIcon(win, isDark) {
  if (win && !win.isDestroyed()) win.setIcon(windowIconPath(isDark));
}

// Apply and persist a zoom factor for the given window.
function applyZoom(win, factor) {
  const f = clampZoomFactor(factor)
  win.webContents.setZoomFactor(f)
  prefs.zoomFactor = f
  try { savePrefs(prefs) } catch { /* best-effort */ }
  try { win.webContents.send('zoom:changed', f) } catch { /* best-effort */ }
}

// Downloaded app updates the window can apply without restarting NexusMD (app-apply.cjs). Without
// an updater (all-in-one or development builds) there is never anything to apply.
function resolveAppsNow() {
  const appsLog = log.scope('apps');
  // Asked again on every check; which version runs is logged once, at launch.
  const quiet = { error: (...a) => appsLog.error(...a), warn: (...a) => appsLog.warn(...a), info: () => {} };
  return appRegistry.resolveApps(appLayout.appsDir, { updatesDir: appLayout.updatesDir, log: quiet });
}

function pendingAppUpdates() {
  return appUpdater ? pendingUpdates(splitApps, resolveAppsNow(), disabledApps) : [];
}

function registerAppUpdatesIpc() {
  ipcMain.handle('app-updates:pending', () => pendingAppUpdates());
  ipcMain.handle('app-updates:check', async () => {
    if (!appUpdater) return { enabled: false, error: null, pending: [] };
    const result = await appUpdater.check();
    return { enabled: true, error: result.error ?? null, pending: pendingAppUpdates() };
  });
  ipcMain.handle('app-updates:apply', (_e, { force = false } = {}) => {
    if (!appUpdater || !appModules) return { applied: [], busy: [], failed: [] };
    return applyAppUpdates({
      running: splitApps, table: appTable, started: appModules, disabled: disabledApps, force,
      resolve: resolveAppsNow,
      toModule: a => appRegistry.modulesFromScan([a])[a.id],
      // After the reply, so the window hears what happened before it reloads.
      reload: () => setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache(); }, 100),
      log: log.scope('app-updates'),
    });
  });
}

// Loads the app's page into a window; `hash` (no leading #) is how a pop-out says what to show.
function loadRenderer(win, hash = '') {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(hash ? `${process.env.VITE_DEV_SERVER_URL}#${hash}` : process.env.VITE_DEV_SERVER_URL);
  } else {
    // Packaged: extraResources/renderer. Unpackaged (npm start, e2e): vite's outDir.
    // A split layout names its shell folder; otherwise: installed = extraResources/renderer,
    // unpackaged (npm start, e2e) = vite's outDir.
    const rendererDir = appLayout.shellDir
      || (app.isPackaged
        ? path.join(process.resourcesPath, 'renderer')
        : path.join(__dirname, '..', '..', '..', 'dist', 'desktop', 'renderer'));
    win.loadFile(path.join(rendererDir, 'index.html'), hash ? { hash } : undefined);
  }
}

function createMainWindow() {
  const isDark = nativeTheme.shouldUseDarkColors;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Management Dashboard',
    icon: windowIconPath(isDark),
    backgroundColor: isDark ? '#1f1f1f' : '#ffffff',
    // Hidden title bar allows custom window controls to be rendered
    titleBarStyle: 'hidden',
    webPreferences: {
      // A hidden window must not have its timers and rendering throttled, or tests would crawl.
      backgroundThrottling: process.env.NEXUSMD_HIDDEN !== '1',
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  buildAppMenu(win);

  // Links are routed through the tabbed link window (see link-window/manager.cjs).
  // <a target="_blank"> links (e.g. dashboard quick links) trigger window.open;
  // route allowed http(s) URLs into the link window and deny the raw popup.
  win.webContents.setWindowOpenHandler(createWindowOpenHandler({
    isAllowedUrl: linkWindow.isAllowedUrl,
    openLink:     linkWindow.openLink,
    popoutOptions: { title: 'NexusMD output', icon: windowIconPath(isDark) },
  }));
  // The pop-out stays blank apart from what the renderer writes into it: it can't
  // navigate away or open windows of its own.
  win.webContents.on('did-create-window', (child) => {
    child.webContents.on('will-navigate', (e) => e.preventDefault());
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  // Right-click a link to choose where it opens: in-app (default left-click
  // behavior), the system browser, or copy the address. Handled centrally here
  // via params.linkURL so it covers every <a> in every view.
  win.webContents.on('context-menu', (_event, params) => {
    const template = buildLinkMenuTemplate({
      linkURL: params.linkURL,
      isAllowedUrl: linkWindow.isAllowedUrl,
    });
    if (!template) return;

    const actions = {
      open:         () => linkWindow.openLink(params.linkURL),
      openExternal: () => shell.openExternal(params.linkURL),
      copy:         () => clipboard.writeText(params.linkURL),
    };
    const menu = Menu.buildFromTemplate(
      template.map(({ label, action }) => ({ label, click: actions[action] }))
    );
    menu.popup({ window: win });
  });

  loadRenderer(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(clampZoomFactor(prefs.zoomFactor ?? ZOOM_DEFAULT))
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

  // Ctrl+mouse-wheel zoom — step our own tracked factor (not getZoomFactor())
  // so a single notch is exactly one step even if Electron has already applied
  // its own wheel zoom before this fires, and so it stays clamped and persisted.
  win.webContents.on('zoom-changed', (_e, direction) => {
    applyZoom(win, nextZoom(prefs.zoomFactor ?? ZOOM_DEFAULT, direction))
  })

  // Show the window as soon as it exists rather than waiting for ready-to-show: that event can
  // fail to fire (a slow or failed first paint with the GPU off), leaving the app running in the
  // tray with no window. backgroundColor covers the moment before the page paints.
  // Automated runs (e2e/launch.js) keep the window out of sight. A window that is never shown
  // draws about one frame a second, which stalls everything that waits on a frame (Playwright's
  // waitForFunction and its "element is stable" check before a click), so it is shown, but fully
  // transparent, off the taskbar, without focus and letting the mouse through.
  if (process.env.NEXUSMD_HIDDEN === '1') {
    win.setOpacity(0);
    win.setSkipTaskbar(true);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  } else {
    win.show();
    // Windows applies the launcher's show state to a process's first ShowWindow, so a
    // launcher that starts us hidden (the portable build's, start-on-login) leaves the window
    // hidden. The second call isn't overridden.
    if (!win.isVisible()) win.show();
    win.focus();
    log.scope('lifecycle').info(`main window shown (visible=${win.isVisible()})`);
  }

  // Honour user's close preference (unless forceQuit is set by before-quit)
  win.on('close', e => {
    if (!forceQuit && prefs.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  // The renderer blocks unload while it holds unsaved edits (the Git Workspace editor). Electron
  // would then silently refuse to close or quit, so ask here; Discard lets the unload go ahead.
  win.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Unsaved changes', message: 'You have unsaved changes.', detail: 'Discard them and close?',
    });
    if (choice === 0) e.preventDefault();
    else forceQuit = false;
  });

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  log.scope('lifecycle').info('app ready; creating main window');
  // The preload asks which apps are installed (and what bridge they need) while it loads, so this
  // must be answerable before the first window exists.
  appRegistry.register(ipcMain, process.env, appTable, splitApps, disabledApps);

  // Create renderer window (loads from Vite dev server or dist/renderer/)
  mainWindow = createMainWindow();

  // System tray
  tray = createTray(mainWindow, nativeTheme.shouldUseDarkColors,
    standaloneApp ? { iconPath: standaloneApp.iconPath, tooltip: standaloneApp.manifest.productName } : undefined);

  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors;
    if (tray) updateTrayIcon(tray, dark);
    updateWindowIcon(mainWindow, dark);
  });

  // Notifications — IPC handler for renderer-raised OS notifications
  initNotifications(ipcMain);

  // Auto-updater (event wiring is packaged-only; the IPC contract is always registered)
  initUpdater(mainWindow);
  registerUpdaterIpc(() => mainWindow);

  // App updates: newer versions of the installed apps, downloaded to run from the next launch, or
  // applied now from the window (registerAppUpdatesIpc). In an installed split build; elsewhere only
  // when pointed at an index (and only there with another key).
  if (splitApps && appLayout.updatesDir && (app.isPackaged || process.env.NEXUSMD_APPS_INDEX_URL)) {
    appUpdater = startAppUpdater({
      apps: splitApps,
      updatesDir: appLayout.updatesDir,
      fetch: url => net.fetch(url),
      indexUrl: process.env.NEXUSMD_APPS_INDEX_URL || undefined,
      publicKey: (!app.isPackaged && process.env.NEXUSMD_APPS_PUBLIC_KEY) || undefined,
      delayMs: process.env.NEXUSMD_APP_UPDATE_DELAY_MS ? Number(process.env.NEXUSMD_APP_UPDATE_DELAY_MS) : undefined,
      log: log.scope('app-updates'),
      onChecked: () => {
        const ready = pendingAppUpdates();
        if (ready.length && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-updates:ready', ready);
      },
    });
  }
  registerAppUpdatesIpc();

  // Register Phase 6 IPC handlers
  fileIpc.register(ipcMain);
  pickerIpc.register(ipcMain, () => mainWindow);
  badgeIpc.register(ipcMain);
  deepLinkIpc.register(ipcMain, () => mainWindow);
  trayIpc.register(ipcMain, () => mainWindow, () => tray);
  logsIpc.register(ipcMain);
  oauthIpc.register(ipcMain);
  // Apps split into their own package (Git Workspace, ...): each registers its own IPC and windows.
  appModules = appRegistry.registerModules({
    ipcMain, BrowserWindow, dialog,
    argv: process.argv,
    onSecondInstance: (fn) => { secondInstanceListeners.add(fn); return () => secondInstanceListeners.delete(fn); },
    send: (channel, msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, msg); },
    preloadPath: path.join(__dirname, 'preload.cjs'),
    windowIcon: () => windowIconPath(nativeTheme.shouldUseDarkColors),
    loadRenderer,
  }, process.env, appTable, log.scope('apps'), disabledApps);
  loginItemIpc.register(ipcMain, { app });
  // Start-on-login keeps the exe that turned it on; a packaged build takes it over from an older
  // copy (which may open only to the tray). Not in dev, where execPath is electron.exe itself.
  if (app.isPackaged && process.platform === 'win32') {
    try {
      if (loginItemIpc.repointLoginItem({ app })) log.scope('lifecycle').info('start-on-login now opens this copy');
    } catch (err) {
      log.scope('lifecycle').warn('could not update start-on-login', err);
    }
  }
  linkWindow.register(ipcMain);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// ---------------------------------------------------------------------------
// Output folder IPC — lets the renderer pick a directory and save files there
// ---------------------------------------------------------------------------
const fs = require('fs');

// ---------------------------------------------------------------------------
// Persistent desktop prefs (userData/prefs.json)
// ---------------------------------------------------------------------------
const PREFS_PATH = path.join(app.getPath('userData'), 'prefs.json');

function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function savePrefs(data) {
  const tmp = PREFS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, PREFS_PATH);
}

const prefs = loadPrefs();
if (prefs.closeToTray === undefined) prefs.closeToTray = true;

// Installed apps the user has switched off in Settings. Read once: the apps wire up their IPC,
// windows and screens at startup, so a change applies on the next start (apps:set-disabled).
const disabledApps = Array.isArray(prefs.disabledApps) ? prefs.disabledApps.filter(id => typeof id === 'string') : [];

ipcMain.handle('pick-output-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('save-file', async (_e, { filename, content, folder }) => {
  const targetDir = folder || app.getPath('downloads');
  const filePath  = path.join(targetDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
});

// Open an external URL in the system browser (used for cloud OAuth sign-in).
ipcMain.handle('open-external', async (_e, url) => { await shell.openExternal(url); });

// Open a link (ADO work item, PR, etc.) as a tab in the shared link window.
// Scheme is validated here and again in manager.cjs (defense in depth) so a
// compromised renderer can't pass through file:/javascript: URLs.
ipcMain.handle('link-window:open', (_e, url) => {
  if (!linkWindow.isAllowedUrl(url)) return;
  linkWindow.openLink(url);
});

// ---------------------------------------------------------------------------
// Close-to-tray IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-close-to-tray', () => prefs.closeToTray);
ipcMain.handle('set-close-to-tray', (_e, enabled) => {
  prefs.closeToTray = !!enabled;
  savePrefs(prefs);
});

// ---------------------------------------------------------------------------
// Switching installed apps on and off — saved now, applied by restarting
// ---------------------------------------------------------------------------
// What is saved, which may differ from what this session is running with (disabledApps above).
ipcMain.handle('apps:get-disabled', () => prefs.disabledApps ?? []);
ipcMain.handle('apps:set-disabled', (_e, ids, { restart = false } = {}) => {
  prefs.disabledApps = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string'))] : [];
  savePrefs(prefs);
  log.scope('apps').info(`switched-off apps: ${prefs.disabledApps.join(', ') || 'none'}${restart ? '; restarting' : ''}`);
  if (restart) {
    // The portable build runs from a temp copy; start the real exe again (as start-on-login does).
    // The relaunch only happens if the quit does: unsaved edits can still cancel it.
    app.relaunch({ execPath: loginItemIpc.loginItemPath() });
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// Zoom IPC — lets the Appearance settings slider drive the native zoom engine
// ---------------------------------------------------------------------------
ipcMain.handle('get-zoom-factor', () => clampZoomFactor(prefs.zoomFactor ?? ZOOM_DEFAULT));
ipcMain.handle('set-zoom-factor', (_e, factor) => {
  if (mainWindow && !mainWindow.isDestroyed()) applyZoom(mainWindow, factor);
});

// ---------------------------------------------------------------------------
// Native theme read IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-native-theme', () => nativeTheme.shouldUseDarkColors);

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

// ---------------------------------------------------------------------------
// Clean shutdown
// ---------------------------------------------------------------------------
// before-quit only lets the windows close: a window with unsaved edits can still cancel the quit
// (will-prevent-unload above), so the backends are shut down in will-quit, once every window has closed.
app.on('before-quit', () => {
  log.scope('lifecycle').info('app quitting');
  forceQuit = true;
});

app.on('will-quit', () => {
  log.scope('lifecycle').info('windows closed; shutting down backends');
  appModules?.disposeAll().catch(err => log.scope('lifecycle').error('apps disposeAll failed', err));
});

// On macOS it is common to keep the app running even with no windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
