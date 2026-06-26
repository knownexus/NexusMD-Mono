'use strict';

const { app } = require('electron');

function register(ipcMain, getMainWindow) {
  // Register the protocol at app startup (must be called before app is ready on some platforms)
  if (process.defaultApp) {
    // Dev mode: add --allow-file-access-from-files to the app command
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('nexusmd', process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient('nexusmd');
  }

  // macOS: open-url event
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('deepLink:url', url);
  });

  // Windows/Linux: second-instance with protocol URL in argv
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('nexusmd://'));
    if (url) {
      const win = getMainWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send('deepLink:url', url);
      }
    }
  });
}

module.exports = { register };
