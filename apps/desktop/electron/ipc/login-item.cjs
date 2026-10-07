'use strict';

// Start-on-login (Windows "run when I sign in"). Portable builds run from a
// per-launch temp folder, so the login item must point at the real portable exe
// (PORTABLE_EXECUTABLE_FILE) rather than process.execPath, or Windows would try
// to start a temp copy that no longer exists.

function loginItemPath(env = process.env, execPath = process.execPath) {
  return env.PORTABLE_EXECUTABLE_FILE || execPath;
}

// `app` is required lazily so tests can inject a fake without Electron.
function register(ipcMain, { app = require('electron').app, env = process.env, execPath = process.execPath } = {}) {
  const path = () => loginItemPath(env, execPath);
  ipcMain.handle('get-login-item-enabled', () => app.getLoginItemSettings({ path: path() }).openAtLogin);
  ipcMain.handle('set-login-item-enabled', (_e, enabled) => app.setLoginItemSettings({ openAtLogin: !!enabled, path: path() }));
}

module.exports = { register, loginItemPath };
