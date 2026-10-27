'use strict';

const path = require('path');

// Installed builds keep their data in %APPDATA%\NexusMD (Electron derives it
// from productName). Pinning it explicitly means a future change to the app
// name or the standalone/combined install mode can never move the profile,
// prefs.json or the file:// localStorage that lives under it.
const PACKAGED_USER_DATA_DIR = 'NexusMD';

// Returns the userData directory to force, or null to keep Electron's default
// (dev runs use their own directory so they never touch installed data).
function resolveUserDataDir({ isPackaged, appData }) {
  if (!isPackaged || !appData) return null;
  return path.join(appData, PACKAGED_USER_DATA_DIR);
}

function pinUserData(app) {
  // An explicit --user-data-dir (tests, portable setups) is the caller's choice; don't override it.
  if (app.commandLine?.hasSwitch('user-data-dir')) return null;
  const dir = resolveUserDataDir({
    isPackaged: app.isPackaged,
    appData: app.getPath('appData'),
  });
  if (dir) app.setPath('userData', dir);
  return dir;
}

module.exports = { PACKAGED_USER_DATA_DIR, resolveUserDataDir, pinUserData };
