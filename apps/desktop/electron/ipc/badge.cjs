'use strict';

const { app } = require('electron');

function register(ipcMain) {
  ipcMain.handle('badge:set', (_e, count) => {
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(count);
  });

  ipcMain.handle('badge:clear', () => {
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(0);
  });
}

module.exports = { register };
