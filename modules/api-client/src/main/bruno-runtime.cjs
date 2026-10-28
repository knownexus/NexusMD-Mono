'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const defaultLog = require('electron-log');
const { withLogging } = require('@nexusmd/main-kit/with-logging');

// Runs Bruno-style scripts (bru / req / res / test / expect). Same sandbox and
// the same rule as api-client-script.cjs — read its SECURITY note: no host
// object ever enters the context; only JSON strings cross, both ways. The
// Bruno API itself is built inside the sandbox by bruno-prelude.sandbox.js.
//
// What's different is that a script can `await bru.runRequest(path)`, which
// needs the renderer to send another request mid-script. So a run is a
// session: start() runs the script until it finishes or is left waiting on
// runRequest; in the second case it returns the pending requests and keeps the
// sandbox, and resume() hands each result back in (as a string). With
// microtaskMode 'afterEvaluate' each step's promise jobs run inside that
// step's runInContext call, so the per-step timeout covers async code too.

const DEFAULT_TIMEOUT_MS = 5000;
const SESSION_TTL_MS = 2 * 60 * 1000;
const MAX_SESSIONS = 20;

const PRELUDE = fs.readFileSync(path.join(__dirname, 'bruno-prelude.sandbox.js'), 'utf8');

function newSandbox() {
  const options = { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' };
  return vm.createContext(vm.constants?.DONT_CONTEXTIFY ?? Object.create(null), options);
}

// A string literal for `value` as JSON, safe to splice into sandbox source.
const jsonLiteral = (value) => JSON.stringify(JSON.stringify(value ?? null));

function createBrunoRuntime({ timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
  const sessions = new Map();

  const run = (sandbox, source) => vm.runInContext(source, sandbox, { timeout: timeoutMs });

  function sweep() {
    for (const [id, s] of sessions) if (s.expires < now()) sessions.delete(id);
  }

  // Reads where the script got to. Finished (or failed) -> the final outcome;
  // waiting on runRequest -> a session to resume.
  function step(sandbox, existingId) {
    const out = run(sandbox, '__report()');
    if (typeof out !== 'string') throw new Error('The script left a report that is not plain data.');
    const report = JSON.parse(out);

    if (report.finished) {
      if (existingId) sessions.delete(existingId);
      return { done: true, context: report.context, logs: report.logs, error: report.finished.ok ? null : report.finished.error };
    }
    if (!report.pending.length) {
      if (existingId) sessions.delete(existingId);
      return { done: true, context: report.context, logs: report.logs, error: 'The script is waiting on something that never finishes (only bru.runRequest can be awaited).' };
    }

    const sessionId = existingId || crypto.randomUUID();
    sessions.set(sessionId, { sandbox, expires: now() + SESSION_TTL_MS });
    return { done: false, sessionId, pending: report.pending, context: report.context, logs: report.logs };
  }

  function start(script, input) {
    sweep();
    if (sessions.size >= MAX_SESSIONS) return { done: true, context: null, logs: [], error: 'Too many scripts are waiting on bru.runRequest.' };
    const sandbox = newSandbox();
    try {
      run(sandbox, `var __input = JSON.parse(${jsonLiteral(input)});`);
      run(sandbox, PRELUDE);
      run(sandbox, `__begin(async function () {\n${script}\n});`);
      return step(sandbox, null);
    } catch (err) {
      return { done: true, context: null, logs: [], error: err?.message || String(err) };
    }
  }

  function resume(sessionId, requestId, result) {
    const session = sessions.get(sessionId);
    if (!session) return { done: true, context: null, logs: [], error: 'This script run has expired; send the request again.' };
    try {
      run(session.sandbox, `__settle(${Number(requestId)}, ${jsonLiteral(result)});`);
      return step(session.sandbox, sessionId);
    } catch (err) {
      sessions.delete(sessionId);
      return { done: true, context: null, logs: [], error: err?.message || String(err) };
    }
  }

  return { start, resume, sessionCount: () => sessions.size };
}

function register(ipcMain, deps = {}) {
  const { logger = defaultLog, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  const handle = withLogging(ipcMain, logger);
  const runtime = createBrunoRuntime({ timeoutMs });

  handle('api-client:bruno:start', async (_e, script, input) => runtime.start(script, input));
  handle('api-client:bruno:resume', async (_e, sessionId, requestId, result) => runtime.resume(sessionId, requestId, result));
}

module.exports = { register, createBrunoRuntime };
