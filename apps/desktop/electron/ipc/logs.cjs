'use strict';

const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { moduleLogger, ignore, ignored } = require('@nexusmd/main-kit/logging');
const modLog = moduleLogger('core');

// The shell's logger under this scope; plain console when run outside the app (tests).
const logger = () => (globalThis.log?.scope ? globalThis.log.scope('logs') : console);

function register(ipcMain, { hub } = {}) {
  // Entries from the renderer's logger and its error hooks (src/shell/renderer-log.js). Fire and
  // forget: a logging call never waits on the main process. The hub validates, attributes to the
  // module the entry names, rate-limits per window and marks it as coming from a renderer.
  if (hub) {
    ipcMain.on('log:ingest', (event, entry) => {
      const id = event?.sender?.id;
      hub.ingest(entry, { sender: `window-${id ?? '?'}`, win: id });
    });
  }

  const logsDir = path.join(app.getPath('userData'), 'logs');

  // Ensure logs directory exists
  fs.mkdir(logsDir, { recursive: true }).catch(ignored(modLog, 'creating the logs folder', 'warn'));

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
      logger().error('logs:list failed', err);
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
      logger().error('logs:read failed', err);
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
      logger().error('logs:delete failed', err);
      return false;
    }
  });
}

module.exports = { register };
