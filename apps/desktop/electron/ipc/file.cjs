'use strict';

const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

function register(ipcMain) {
  const defaultDir = path.join(app.getPath('documents'), 'NexusMD', 'profiles');

  ipcMain.handle('file:defaultProfileDir', () => defaultDir);

  ipcMain.handle('file:read', async (_e, filePath) => {
    return fs.readFile(filePath, 'utf8');
  });

  ipcMain.handle('file:write', async (_e, filePath, text) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, filePath);
  });

  ipcMain.handle('file:exists', async (_e, filePath) => {
    try { await fs.access(filePath); return true; } catch { return false; }
  });

  ipcMain.handle('file:list', async (_e, dirPath) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.filter(e => e.isFile()).map(e => e.name);
    } catch { return []; }
  });

  ipcMain.handle('file:listDirs', async (_e, dirPath) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { return []; }
  });

  ipcMain.handle('file:delete', async (_e, filePath) => {
    try { await fs.unlink(filePath); } catch { /* ignore missing */ }
  });

  ipcMain.handle('file:mkdir', async (_e, dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
  });
}

module.exports = { register };
