'use strict';

const { app, dialog, ipcMain } = require('electron');

// Loaded on first use: electron-updater reads the app's version as soon as it loads, which only
// works inside Electron (and isn't needed at all in a development build).
let updater = null;
const getAutoUpdater = () => (updater ??= require('electron-updater').autoUpdater);

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
  const autoUpdater = getAutoUpdater();

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
}

// Some networks (the work VPN) drop the odd connection, so a check that fails at the network
// level is tried again before it's reported. Other errors, like a 404, are reported at once.
const RETRY_DELAYS_MS = [1500, 3000];
const isNetworkError = err => /net::ERR_|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(err?.message ?? '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkWithRetry(autoUpdater, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isNetworkError(err)) throw err;
      console.warn(`[updater] check failed (${err.message}), retrying`);
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * The tray's "Check for Updates": unlike the silent check at launch it always answers — up to
 * date, couldn't check (and why), or a development build that doesn't update. A newer version
 * is left to the 'update-available' prompt above, so it isn't announced twice.
 * Dependencies are injectable so it can be tested without Electron.
 */
async function checkForUpdatesManually({
  app: a = app, dialog: d = dialog, autoUpdater, getWin = () => null, wait = sleep,
} = {}) {
  const win = getWin();
  const show = opts => (win && !win.isDestroyed() ? d.showMessageBox(win, opts) : d.showMessageBox(opts));
  const title = 'Check for Updates';
  if (!a.isPackaged) {
    await show({ type: 'info', title, message: 'This is a development build', detail: `Version ${a.getVersion()}. Updates are only checked in the installed app.` });
    return { available: false };
  }
  try {
    const result = await checkWithRetry(autoUpdater ?? getAutoUpdater(), wait);
    const version = result?.updateInfo?.version;
    const available = result?.isUpdateAvailable ?? (!!version && version !== a.getVersion());
    if (!available) {
      await show({ type: 'info', title, message: "You're up to date", detail: `NexusMD ${a.getVersion()} is the latest version.` });
    }
    return { available, version };
  } catch (err) {
    console.error('[updater] manual check failed:', err.message);
    await show({ type: 'error', title, message: "Couldn't check for updates", detail: err.message });
    return { available: false, error: err.message };
  }
}

/**
 * Register the IUpdateAdapter IPC contract used by the renderer's update.js adapter, and the
 * tray's manual check. Registered unconditionally (incl. dev) so renderer invoke() calls never
 * hang and the tray item always answers; in dev, or when no feed is configured, they resolve to
 * a safe "no update available".
 *
 * @param {() => Electron.BrowserWindow | null} [getWin]
 */
function registerUpdaterIpc(getWin = () => null) {
  ipcMain.on('check-for-updates', () => { checkForUpdatesManually({ getWin }); });

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { available: false };
    try {
      const result = await checkWithRetry(getAutoUpdater());
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
      await getAutoUpdater().downloadUpdate();
      getAutoUpdater().quitAndInstall();
    } catch (err) {
      console.error('[updater] install failed:', err.message);
    }
  });
}

module.exports = { initUpdater, registerUpdaterIpc, checkForUpdatesManually };
