// electron/ipc/report-window.cjs
//
// devenv's HTML reports (call-chain trace, Bruno) open in a NexusMD window instead of the
// default browser. They are local files that run their own scripts, so the window is sandboxed
// with no preload, and every link that would leave the report goes to the system browser.

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const isHttp = url => /^https?:\/\//i.test(url);

const PARTITION = 'devenv-reports';
const allowed = permission => permission === 'clipboard-sanitized-write';

function createReportWindows({ BrowserWindow, shell, session, log = () => {} }) {
  const openExternal = url => Promise.resolve(shell.openExternal(url)).catch(e => log('Could not open link from a report', e));
  // Reports run their own scripts, so they get a non-persistent session of their own: the
  // default one shares file:// storage with the main renderer, which holds OAuth tokens.
  let sessionReady = false;
  const lockSession = () => {
    if (sessionReady) return;
    sessionReady = true;
    const ses = session.fromPartition(PARTITION);
    // Plain clipboard writes only, for the trace report's "Copy as curl".
    ses.setPermissionRequestHandler((wc, permission, callback) => callback(allowed(permission)));
    ses.setPermissionCheckHandler((wc, permission) => allowed(permission));
  };
  // One window per report: opening it again (a re-run writes the same file) refreshes it.
  const open = new Map();
  return function openReport(filePath) {
    const file = path.resolve(filePath);
    const key = file.toLowerCase();
    const existing = open.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.reload();
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }
    lockSession();
    const win = new BrowserWindow({
      width: 1280, height: 900, title: path.basename(file), autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION },
    });
    const own = pathToFileURL(file).href;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.split('#')[0] === own) return;
      e.preventDefault();
      if (isHttp(url)) openExternal(url);
    });
    win.on('closed', () => open.delete(key));
    open.set(key, win);
    // A reload() during the first load aborts it; that is not an error worth surfacing.
    Promise.resolve(win.loadFile(file)).catch(e => log(`Could not load report ${file}`, e));
    return win;
  };
}

module.exports = { createReportWindows };
