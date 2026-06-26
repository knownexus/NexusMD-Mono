'use strict';

const { Tray, Menu, app, ipcMain, nativeImage } = require('electron');
const path = require('path');

/**
 * Create and return the system-tray icon for the app.
 *
 * @param {Electron.BrowserWindow} win     The main application window.
 * @param {boolean}               isDark  Whether the OS is in dark mode at launch.
 * @returns {Electron.Tray}
 */
// Minimal valid 16x16 dark-grey PNG (base64) — used when the assets file is missing/invalid
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAI0lEQVQ4jWNgGAWDHfz/z8BAAoz6YNQHgx4YJT4Y9cGgBgAHKAABpkqP0gAAAABJRU5ErkJggg==';

/**
 * Update the tray icon to match the current OS dark/light mode.
 *
 * @param {Electron.Tray} tray
 * @param {boolean}       isDark  true = OS is in dark mode (taskbar dark → use light icon)
 */
function updateTrayIcon(tray, isDark) {
  const name = isDark ? 'tray-icon-light.png' : 'tray-icon.png';
  const iconPath = path.join(__dirname, '..', 'assets', name);
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  tray.setImage(icon);
}

function createTray(win, isDark) {
  const iconPath = path.join(__dirname, '..', 'assets', isDark ? 'tray-icon-light.png' : 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  const tray = new Tray(icon);

  tray.setToolTip('Management Dashboard');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (!win || win.isDestroyed()) return;
        win.show();
        win.focus();
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (!win || win.isDestroyed()) return;
        win.show();
        win.webContents.send('navigate', '/settings');
      },
    },
    {
      label: 'Check for Updates',
      click: () => {
        ipcMain.emit('check-for-updates');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.focus();
  });

  return tray;
}

module.exports = { createTray, updateTrayIcon };
