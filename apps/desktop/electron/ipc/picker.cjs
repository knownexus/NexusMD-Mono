'use strict';

const { dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');

function register(ipcMain, getMainWindow) {
  ipcMain.handle('picker:pickFile', async (_e, filter) => {
    const win = getMainWindow();
    const ext = filter?.ext;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      ...(ext ? { filters: [{ name: 'Files', extensions: [ext.replace(/^\./, '')] }] } : {}),
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const text = await fs.readFile(filePath, 'utf8');
    return { path: filePath, name: path.basename(filePath), text };
  });

  ipcMain.handle('picker:pickDirectory', async () => {
    const win = getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('picker:saveFile', async (_e, name, text) => {
    const win = getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: name,
    });
    if (canceled || !filePath) return;
    await fs.writeFile(filePath, text, 'utf8');
  });
}

module.exports = { register };
