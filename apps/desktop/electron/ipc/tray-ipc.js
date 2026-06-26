'use strict';

const { Menu } = require('electron');

function register(ipcMain, getMainWindow, getTray) {
  ipcMain.handle('tray:setTooltip', (_e, text) => {
    const t = getTray();
    if (t) t.setToolTip(text);
  });

  ipcMain.handle('tray:setContextMenu', (_e, items) => {
    const t = getTray();
    if (!t) return;
    const template = (items || []).map(item => {
      if (item.type === 'separator') return { type: 'separator' };
      return {
        label:   item.label || '',
        enabled: item.enabled !== false,
        click:   () => {
          const w = getMainWindow();
          if (w && !w.isDestroyed()) w.webContents.send('tray:menuClick', item.label);
        },
      };
    });
    t.setContextMenu(Menu.buildFromTemplate(template));
  });

  ipcMain.handle('tray:show', () => {
    const w = getMainWindow();
    if (w) { w.show(); w.focus(); }
  });

  ipcMain.handle('tray:hide', () => {
    const w = getMainWindow();
    if (w) w.hide();
  });
}

module.exports = { register };
