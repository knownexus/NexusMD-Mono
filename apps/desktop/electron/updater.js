'use strict';

const { autoUpdater } = require('electron-updater');
const { app, dialog, ipcMain } = require('electron');

/**
 * Initialize auto-update behaviour.
 * Checks for updates silently on launch; prompts the user when one is found.
 * No-ops in development (where app-update.yml does not exist).
 *
 * @param {Electron.BrowserWindow} win
 */
function initUpdater(win) {
  // Skip entirely in development — app-update.yml doesn't exist and
  // checkForUpdatesAndNotify() would throw or print confusing errors.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Silent check on startup
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    // Network unavailable or no update — silently ignore
  });

  autoUpdater.on('update-available', info => {
    if (!win || win.isDestroyed()) return;
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available. Download now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on('update-downloaded', () => {
    if (!win || win.isDestroyed()) return;
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. The app will restart to install it.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', err => {
    console.error('[updater] Auto-update error:', err.message);
  });

  // Push update-available events to the renderer so the IUpdateAdapter can surface them.
  autoUpdater.on('update-available', info => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:available', { available: true, version: info?.version });
    }
  });

  // Allow renderer / tray to trigger a manual check
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates();
  });
}

/**
 * Register the IUpdateAdapter IPC contract used by the renderer's update.js adapter.
 * Registered unconditionally (incl. dev) so renderer invoke() calls never hang; in dev
 * or when no feed is configured, they resolve to a safe "no update available".
 */
function registerUpdaterIpc() {
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { available: false };
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      const available = !!info && info.version !== app.getVersion();
      return { available, version: info?.version };
    } catch {
      return { available: false };
    }
  });

  ipcMain.handle('updater:install', async () => {
    if (!app.isPackaged) return;
    try {
      await autoUpdater.downloadUpdate();
      autoUpdater.quitAndInstall();
    } catch (err) {
      console.error('[updater] install failed:', err.message);
    }
  });
}

module.exports = { initUpdater, registerUpdaterIpc };
