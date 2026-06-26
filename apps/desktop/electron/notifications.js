'use strict';

const { Notification } = require('electron');
const http = require('http');

// Default polling interval (ms). Can be overridden via NOTIFICATION_POLL_MS env var.
const POLL_INTERVAL_MS = parseInt(process.env.NOTIFICATION_POLL_MS, 10) || 60_000;

/**
 * Perform a GET request and resolve with the parsed JSON body.
 * Rejects on network error, non-2xx status, or JSON parse failure.
 * @param {string} url
 * @returns {Promise<any>}
 */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`JSON parse error from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error(`Request timeout: ${url}`));
    });
  });
}

/**
 * Initialize native notification support.
 *
 * Sets up:
 * 1. An IPC handler so the renderer can trigger OS notifications directly.
 * 2. A polling loop that checks /api/prs and /api/builds/recent every
 *    POLL_INTERVAL_MS milliseconds and fires OS notifications for new PRs
 *    or builds whose result has changed.
 *
 * @param {Electron.BrowserWindow} win      The main application window.
 * @param {Electron.IpcMain}       ipcMain
 * @param {number}                 port     The port the .NET API is listening on.
 */
function initNotifications(win, ipcMain, port) {
  // -------------------------------------------------------------------------
  // IPC: renderer → main
  // -------------------------------------------------------------------------
  ipcMain.on('show-notification', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  if (!port) {
    console.warn('[notifications] No port provided — polling disabled.');
    return;
  }

  // -------------------------------------------------------------------------
  // Polling state
  // -------------------------------------------------------------------------
  /** @type {Set<string|number>} */
  const lastPrIds = new Set();

  /**
   * Map of buildId → last-known result string.
   * @type {Map<string|number, string>}
   */
  const lastBuildSnapshot = new Map();

  let firstPoll = true; // skip notifications on the very first poll (seed state)

  // -------------------------------------------------------------------------
  // Helper: show a notification and wire up click → show/focus window
  // -------------------------------------------------------------------------
  function notify(title, body) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    n.show();
  }

  // -------------------------------------------------------------------------
  // Poll PRs
  // -------------------------------------------------------------------------
  async function pollPrs() {
    try {
      const prs = await httpGetJson(`http://localhost:${port}/api/prs`);
      if (!Array.isArray(prs)) return;

      for (const pr of prs) {
        const id = pr.id ?? pr.pullRequestId;
        if (id == null) continue;

        if (!lastPrIds.has(id) && !firstPoll) {
          notify('New PR', `${pr.title || 'Untitled PR'} by ${pr.author || 'unknown'}`);
        }
        lastPrIds.add(id);
      }
    } catch (err) {
      console.warn('[notifications] PR poll failed:', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Poll builds
  // -------------------------------------------------------------------------
  async function pollBuilds() {
    try {
      const builds = await httpGetJson(`http://localhost:${port}/api/builds/recent`);
      if (!Array.isArray(builds)) return;

      for (const build of builds) {
        const id = build.id ?? build.buildId;
        if (id == null) continue;

        const result = (build.result || '').toLowerCase();
        const prev = lastBuildSnapshot.get(id);

        if (!firstPoll && result !== prev && (result === 'succeeded' || result === 'failed')) {
          notify(
            `Build ${build.result}`,
            `${build.definition || 'Unknown definition'} in ${build.project || 'unknown project'}`
          );
        }

        lastBuildSnapshot.set(id, result);
      }
    } catch (err) {
      console.warn('[notifications] Build poll failed:', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Combined poll tick
  // -------------------------------------------------------------------------
  async function poll() {
    await Promise.all([pollPrs(), pollBuilds()]);
    firstPoll = false;
  }

  // Seed state immediately, then poll on the interval
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { initNotifications };
