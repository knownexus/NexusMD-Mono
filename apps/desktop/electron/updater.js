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

  // Allow renderer / tray to trigger a manual check
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates();
  });
}

module.exports = { initUpdater };
