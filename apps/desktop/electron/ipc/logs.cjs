'use strict';

const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

function register(ipcMain) {
  const logsDir = path.join(app.getPath('userData'), 'logs');

  // Ensure logs directory exists
  fs.mkdir(logsDir, { recursive: true }).catch(() => {});

  ipcMain.handle('logs:list', async () => {
    try {
      const files = await fs.readdir(logsDir, { withFileTypes: true });
      const logFiles = files.filter(f => f.isFile() && f.name.match(/^\d{4}-\d{2}-\d{2}\.log$/));
      
      const list = await Promise.all(
        logFiles.map(async f => {
          const filePath = path.join(logsDir, f.name);
          const stat = await fs.stat(filePath);
          return {
            date: f.name.replace('.log', ''),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        })
      );
      
      // Sort by date, newest first
      return list.sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      console.error('[logs:list]', err.message);
      return [];
    }
  });

  ipcMain.handle('logs:read', async (_e, { date }) => {
    try {
      if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        throw new Error('Invalid date format');
      }
      const filePath = path.join(logsDir, `${date}.log`);
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } catch (err) {
      console.error('[logs:read]', err.message);
      return null;
    }
  });

  ipcMain.handle('logs:delete', async (_e, { date }) => {
    try {
      if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        throw new Error('Invalid date format');
      }
      const filePath = path.join(logsDir, `${date}.log`);
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      console.error('[logs:delete]', err.message);
      return false;
    }
  });
}

module.exports = { register };
