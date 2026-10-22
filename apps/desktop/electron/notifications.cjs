'use strict';

const { Notification } = require('electron');

/**
 * Native notification support: lets the renderer raise an OS notification over IPC.
 * (Data refresh and its notifications are driven from the renderer via core adapters,
 * so there is no polling here.)
 *
 * @param {Electron.IpcMain} ipcMain
 */
function initNotifications(ipcMain) {
  ipcMain.on('show-notification', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });
}

module.exports = { initNotifications };
