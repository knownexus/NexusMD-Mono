'use strict';

const { app } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { moduleLogger, ignore, ignored, createLogReader } = require('@nexusmd/main-kit/logging');
const modLog = moduleLogger('core');

const TAIL_BATCH_MS = 100; // how long new entries are gathered before they are pushed to a viewer

// The shell's logger under this scope; plain console when run outside the app (tests).
const logger = () => (globalThis.log?.scope ? globalThis.log.scope('logs') : console);

function register(ipcMain, { hub } = {}) {
  // Entries from the renderer's logger and its error hooks (packages/core/src/log.js). Fire and
  // forget: a logging call never waits on the main process. The hub validates, attributes to the
  // module the entry names, rate-limits per window and marks it as coming from a renderer.
  if (hub) {
    ipcMain.on('log:ingest', (event, entry) => {
      const id = event?.sender?.id;
      hub.ingest(entry, { sender: `window-${id ?? '?'}`, win: id });
    });
  }

  const logsDir = path.join(app.getPath('userData'), 'logs');

  // The viewer's view of the per-module files (what the hub wrote). The hub's buffer is flushed
  // before each read so the newest entries are included.
  if (hub) {
    const reader = createLogReader({ dir: logsDir, beforeRead: () => hub.flush() });
    ipcMain.handle('logs:modules', () => reader.modules());
    ipcMain.handle('logs:query', (_e, q) => reader.query(q && typeof q === 'object' ? q : {}));
    ipcMain.handle('logs:follow', (_e, cid) => reader.follow(cid));

    // Live tail: while a window has it on, new entries are pushed to it in batches ('logs:entries').
    // tail-start answers with the most recent entries so the view opens with context.
    const tails = new Map(); // webContents id -> { off, timer, pending }
    const stopTail = (id) => {
      const t = tails.get(id);
      if (!t) return;
      t.off();
      clearTimeout(t.timer);
      tails.delete(id);
    };
    ipcMain.handle('logs:tail-start', (event) => {
      const wc = event.sender;
      stopTail(wc.id);
      const t = { pending: [], timer: null, off: null };
      t.off = hub.subscribe((entry) => {
        t.pending.push(entry);
        if (t.timer) return;
        t.timer = setTimeout(() => {
          t.timer = null;
          const batch = t.pending.splice(0);
          if (wc.isDestroyed()) return stopTail(wc.id);
          wc.send('logs:entries', batch);
        }, TAIL_BATCH_MS);
        t.timer.unref?.();
      });
      tails.set(wc.id, t);
      wc.once('destroyed', () => stopTail(wc.id));
      return hub.recent();
    });
    ipcMain.handle('logs:tail-stop', (event) => { stopTail(event.sender.id); return true; });
  }

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
