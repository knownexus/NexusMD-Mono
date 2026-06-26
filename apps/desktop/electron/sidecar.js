'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const READY_POLL_INTERVAL_MS = 500;
const READY_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
const emitter = new EventEmitter();

let apiPort = null;
let apiProcess = null;
let retryCount = 0;
let stopping = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a free TCP port by binding to port 0 and immediately closing.
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Resolve the path to the .NET API binary.
 * - Packaged: resources/api/NexusMDWeb.Api(.exe)
 * - Dev: sister repo relative to this file
 */
function resolveApiBinaryPath() {
  const isPackaged = require('electron').app.isPackaged;
  const exeSuffix = process.platform === 'win32' ? '.exe' : '';

  if (isPackaged) {
    return path.join(
      process.resourcesPath,
      'api',
      `NexusMDWeb.Api${exeSuffix}`
    );
  }

  // Dev: __dirname is <repo>/electron/, so go up two levels to reach the
  // sister NexusMD-Web repo.
  return path.resolve(
    __dirname,
    '..',
    '..',
    'NexusMD-Web',
    'NexusMD-Web',
    'bin',
    'Release',
    'net8.0',
    `NexusMDWeb.Api${exeSuffix}`
  );
}

/**
 * Poll GET /api/config until it returns HTTP 200 or timeout expires.
 * @param {number} port
 * @returns {Promise<void>}
 */
function waitForReady(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    function poll() {
      if (Date.now() > deadline) {
        return reject(new Error(`Sidecar did not become ready within ${READY_TIMEOUT_MS}ms`));
      }

      const req = http.get(`http://localhost:${port}/api/config`, res => {
        res.resume(); // drain the body
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(poll, READY_POLL_INTERVAL_MS);
        }
      });

      req.on('error', () => {
        // Connection refused — process not up yet
        setTimeout(poll, READY_POLL_INTERVAL_MS);
      });

      req.setTimeout(READY_POLL_INTERVAL_MS, () => {
        req.destroy();
        setTimeout(poll, READY_POLL_INTERVAL_MS);
      });
    }

    poll();
  });
}

/**
 * Spawn the .NET API process on `port`.
 * @param {number} port
 * @returns {ChildProcess}
 */
function spawnApi(port) {
  const binaryPath = resolveApiBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `API binary not found at ${binaryPath}. Run: dotnet publish -c Release in NexusMDWeb.Api`
    );
  }

  console.log(`[sidecar] Spawning API: ${binaryPath} --urls http://localhost:${port}`);

  // In dev the binary is at <project>/bin/Release/net8.0/ — go up to <project>/
  // so ASP.NET finds appsettings.json, appsettings.user.json, and wwwroot.
  // In packaged mode, dotnet publish copies wwwroot alongside the binary so
  // path.dirname(binaryPath) is already correct.
  const { app: electronApp } = require('electron');
  const cwd = electronApp.isPackaged
    ? path.dirname(binaryPath)
    : path.resolve(path.dirname(binaryPath), '..', '..', '..');

  const proc = spawn(binaryPath, ['--urls', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
    // Detach on non-Windows so we can kill cleanly
    detached: process.platform !== 'win32',
  });

  proc.stdout.on('data', data => {
    console.log(`[api] ${data.toString().trim()}`);
  });

  proc.stderr.on('data', data => {
    console.error(`[api:err] ${data.toString().trim()}`);
  });

  return proc;
}

/**
 * Attempt to start the API with retry logic.
 * Returns true on success, false when retries are exhausted (also emits `sidecar-failed`).
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function startWithRetry(port) {
  while (retryCount <= MAX_RETRIES && !stopping) {
    if (retryCount > 0) {
      console.log(`[sidecar] Retry ${retryCount}/${MAX_RETRIES} in ${RETRY_DELAY_MS}ms…`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    try {
      apiProcess = spawnApi(port);

      await waitForReady(port);
      console.log(`[sidecar] API ready on port ${port}`);

      // Watch for unexpected exits after a successful start
      apiProcess.once('exit', (code, signal) => {
        if (!stopping) {
          console.error(`[sidecar] API exited unexpectedly (code=${code}, signal=${signal})`);
          retryCount = MAX_RETRIES + 1; // exhaust retries on unexpected crash
          emitter.emit('sidecar-failed', new Error(`API process exited (code=${code})`));
        }
      });

      return true; // success — exit the retry loop
    } catch (err) {
      console.error(`[sidecar] Start attempt ${retryCount + 1} failed:`, err.message);

      // Kill the failed process if it's still running
      if (apiProcess && !apiProcess.killed) {
        apiProcess.kill();
        apiProcess = null;
      }

      retryCount++;
    }
  }

  // All retries exhausted
  const failureError = new Error(`API failed to start after ${MAX_RETRIES} retries`);
  emitter.startupFailed = true;
  emitter.emit('sidecar-failed', failureError);
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the API sidecar. Resolves when the API is ready to serve requests.
 * Rejects (and also emits 'sidecar-failed') if all retries are exhausted.
 * @returns {Promise<void>}
 */
async function start() {
  stopping = false;
  retryCount = 0;
  apiPort = await findFreePort();

  // startWithRetry emits 'sidecar-failed' on exhaustion but doesn't throw.
  // We wrap it so the caller can also use try/catch as a fallback.
  return new Promise((resolve, reject) => {
    function onFailed(err) {
      reject(err);
    }
    emitter.once('sidecar-failed', onFailed);

    startWithRetry(apiPort)
      .then(started => {
        // Remove the temporary listener so it doesn't fire on a later crash
        // and double-reject this (already settled) promise.
        emitter.removeListener('sidecar-failed', onFailed);
        if (started) {
          // Only resolve when the sidecar actually started successfully.
          resolve();
        }
        // If !started, sidecar-failed was already emitted and onFailed called
        // reject() before we reach here — the promise is already settled.
      })
      .catch(err => {
        emitter.removeListener('sidecar-failed', onFailed);
        reject(err);
      });
  });
}

/**
 * Return the port the API is (or will be) listening on.
 * @returns {number|null}
 */
function getPort() {
  return apiPort;
}

/**
 * Stop the API sidecar gracefully.
 */
function stop() {
  stopping = true;
  if (apiProcess && !apiProcess.killed) {
    console.log('[sidecar] Stopping API process…');
    if (process.platform === 'win32') {
      // On Windows, kill the process tree
      spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      process.kill(-apiProcess.pid, 'SIGTERM');
    }
    apiProcess = null;
  }
}

// Allow callers to listen for 'sidecar-failed'
emitter.start = start;
emitter.getPort = getPort;
emitter.stop = stop;

module.exports = emitter;
