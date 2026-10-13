// electron/ipc/report-window.cjs
//
// devenv's HTML reports (call-chain trace, Bruno) open in a NexusMD window instead of the
// default browser. They are local files that run their own scripts, so the window is sandboxed
// with no preload, and every link that would leave the report goes to the system browser.

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const isHttp = url => /^https?:\/\//i.test(url);

function createReportWindows({ BrowserWindow, shell }) {
  // One window per report: opening it again (a re-run writes the same file) refreshes it.
  const open = new Map();
  return function openReport(filePath) {
    const file = path.resolve(filePath);
    const key = file.toLowerCase();
    const existing = open.get(key);
    if (existing && !existing.isDestroyed()) { existing.reload(); existing.focus(); return existing; }
    const win = new BrowserWindow({
      width: 1280, height: 900, title: path.basename(file), autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const own = pathToFileURL(file).href;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.split('#')[0] === own) return;
      e.preventDefault();
      if (isHttp(url)) shell.openExternal(url);
    });
    win.on('closed', () => open.delete(key));
    open.set(key, win);
    win.loadFile(file);
    return win;
  };
}

module.exports = { createReportWindows };
