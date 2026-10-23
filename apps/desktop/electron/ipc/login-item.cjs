'use strict';

// Start-on-login (Windows "run when I sign in"). Portable builds run from a
// per-launch temp folder, so the login item must point at the real portable exe
// (PORTABLE_EXECUTABLE_FILE) rather than process.execPath, or Windows would try
// to start a temp copy that no longer exists.

function loginItemPath(env = process.env, execPath = process.execPath) {
  return env.PORTABLE_EXECUTABLE_FILE || execPath;
}

// Windows paths compare without case, quotes or slash direction.
const samePath = (a, b) => {
  const norm = p => String(p || '').replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
  return norm(a) === norm(b);
};

// The login entry keeps the exe that turned it on. Installing a new build (or moving from the
// portable to the installer) leaves it starting the old copy, e.g. a portable build from before
// the window was shown on a hidden launch, which then opens only to the tray. So when this copy
// finds its entry pointing at another exe, it takes the entry over. Returns whether it did.
function repointLoginItem({ app = require('electron').app, env = process.env, execPath = process.execPath } = {}) {
  const target = loginItemPath(env, execPath);
  const items = app.getLoginItemSettings({ path: target })?.launchItems ?? [];
  const elsewhere = items.some(i => i.enabled !== false && !samePath(i.path, target));
  if (!elsewhere || items.some(i => samePath(i.path, target))) return false;
  app.setLoginItemSettings({ openAtLogin: true, path: target });
  return true;
}

// `app` is required lazily so tests can inject a fake without Electron.
function register(ipcMain, { app = require('electron').app, env = process.env, execPath = process.execPath } = {}) {
  const path = () => loginItemPath(env, execPath);
  ipcMain.handle('get-login-item-enabled', () => app.getLoginItemSettings({ path: path() }).openAtLogin);
  ipcMain.handle('set-login-item-enabled', (_e, enabled) => app.setLoginItemSettings({ openAtLogin: !!enabled, path: path() }));
}

module.exports = { register, loginItemPath, repointLoginItem };
