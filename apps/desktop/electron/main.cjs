'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const path = require('path');

const { createTray, updateTrayIcon } = require('./tray.cjs');
const { initNotifications } = require('./notifications.cjs');
const { initUpdater, registerUpdaterIpc } = require('./updater.cjs');

// ---------------------------------------------------------------------------
// Persistent desktop prefs (userData/prefs.json)
// ---------------------------------------------------------------------------
const PREFS_PATH = path.join(app.getPath('userData'), 'prefs.json');

const fs = require('fs');

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

function getOAuthClientId(provider) {
  if (provider === 'google') return prefs.googleClientId || process.env.NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID || '';
  if (provider === 'microsoft') return prefs.msClientId     || process.env.NEXUSMD_MS_DESKTOP_CLIENT_ID     || '';
  return '';
}

// Optional. Google OAuth clients registered as "Web application" type require a
// client_secret at the token endpoint; "Desktop app" clients do not. Microsoft
// public clients must NOT send one. Returns '' when unset, in which case the
// secret is omitted from the token request entirely.
function getOAuthClientSecret(provider) {
  if (provider === 'google') return prefs.googleClientSecret || process.env.NEXUSMD_GOOGLE_DESKTOP_CLIENT_SECRET || '';
  return '';
}

module.exports = { getOAuthClientId, getOAuthClientSecret };

const fileIpc        = require('./ipc/file.cjs');
const pickerIpc      = require('./ipc/picker.cjs');
const badgeIpc       = require('./ipc/badge.cjs');
const deepLinkIpc    = require('./ipc/deepLink.cjs');
const trayIpc        = require('./ipc/tray-ipc.cjs');
const oauthIpc       = require('./ipc/oauth.cjs');
// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running — quit immediately.
  app.quit();
} else {
  // A second launch attempt focused the existing window.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Output folder IPC — lets the renderer pick a directory and save files there
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Login-item IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('get-login-item-enabled', () =>
  app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-login-item-enabled', (_e, enabled) =>
  app.setLoginItemSettings({ openAtLogin: enabled }));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow = null;
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
        { label: 'Refresh data', accelerator: 'F5', click: () => win.webContents.reload() },
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
        { role: 'resetZoom' },
        { role: 'zoomIn', accelerator: 'Ctrl+=' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
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

function windowIconPath(isDark) {
  const name = isDark ? 'icon-light.png' : 'icon.png';
  return path.join(__dirname, '..', 'assets', name);
}

function updateWindowIcon(win, isDark) {
  if (win && !win.isDestroyed()) win.setIcon(windowIconPath(isDark));
}

function createMainWindow() {
  const isDark = nativeTheme.shouldUseDarkColors;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'Management Dashboard',
    icon: windowIconPath(isDark),
    // Frameless: no native title bar at all. The renderer's .topbar acts as the
    // drag region and hosts custom min/max/close controls, so web content fills
    // the entire window with no reserved title-bar strip.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  buildAppMenu(win);

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  // Frameless window: the .topbar acts as the Electron drag handle so the user
  // can still move the window. Interactive elements inside it (buttons, inputs,
  // the custom window controls) are marked no-drag so they remain clickable.
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      .topbar { -webkit-app-region: drag; }
      .topbar button, .topbar input, .topbar a, .topbar select,
      .topbar [role="button"] { -webkit-app-region: no-drag; }
    `);
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Honour user's close preference (unless forceQuit is set by before-quit)
  win.on('close', e => {
    if (!forceQuit && prefs.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // Create renderer window (loads from Vite dev server or dist/renderer/)
  mainWindow = createMainWindow();

  // System tray
  tray = createTray(mainWindow, nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors;
    if (tray) updateTrayIcon(tray, dark);
    updateWindowIcon(mainWindow, dark);
  });

  // Notifications — IPC handler only (no polling; ADO data comes from core adapters)
  initNotifications(mainWindow, ipcMain, null);

  // Auto-updater (event wiring is packaged-only; the IPC contract is always registered)
  initUpdater(mainWindow);
  registerUpdaterIpc();

  // Register Phase 6 IPC handlers
  fileIpc.register(ipcMain);
  pickerIpc.register(ipcMain, () => mainWindow);
  badgeIpc.register(ipcMain);
  deepLinkIpc.register(ipcMain, () => mainWindow);
  trayIpc.register(ipcMain, () => mainWindow, () => tray);
  oauthIpc.register(ipcMain);

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
// Close-to-tray IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-close-to-tray', () => prefs.closeToTray);
ipcMain.handle('set-close-to-tray', (_e, enabled) => {
  prefs.closeToTray = !!enabled;
  savePrefs(prefs);
});

// ---------------------------------------------------------------------------
// OAuth config IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-oauth-config', () => ({
  googleClientId:     prefs.googleClientId     || process.env.NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID     || '',
  googleClientSecret: prefs.googleClientSecret || process.env.NEXUSMD_GOOGLE_DESKTOP_CLIENT_SECRET || '',
  msClientId:         prefs.msClientId         || process.env.NEXUSMD_MS_DESKTOP_CLIENT_ID         || '',
}));

ipcMain.handle('set-oauth-config', (_e, { googleClientId, googleClientSecret, msClientId }) => {
  if (googleClientId     !== undefined) prefs.googleClientId     = googleClientId;
  if (googleClientSecret !== undefined) prefs.googleClientSecret = googleClientSecret;
  if (msClientId         !== undefined) prefs.msClientId         = msClientId;
  savePrefs(prefs);
});

// ---------------------------------------------------------------------------
// Native theme read IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-native-theme', () => nativeTheme.shouldUseDarkColors);

// ---------------------------------------------------------------------------
// Window-control IPC — drives the custom min/max/close buttons in the frameless
// window's renderer topbar.
// ---------------------------------------------------------------------------
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ---------------------------------------------------------------------------
// Clean shutdown
// ---------------------------------------------------------------------------
app.on('before-quit', () => {
  forceQuit = true;
});

// On macOS it is common to keep the app running even with no windows
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
