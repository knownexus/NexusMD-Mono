'use strict';
const vm = require('vm');
const defaultLog = require('electron-log');
const { withLogging } = require('@nexusmd/main-kit/with-logging');

const DEFAULT_TIMEOUT_MS = 5000;

// SECURITY: Node's `vm` module is explicitly documented as NOT a security
// boundary (https://nodejs.org/api/vm.html), and this is not theoretical here —
// verified directly against this Electron/Node build: a completely bare
// vm.createContext() (nothing passed in from the host, not even a console
// shim) can still reach the live host `process` object via
// `(function(){}).constructor("return process")()` — i.e. the classic
// Function-constructor-chain escape works even against script-defined
// functions with zero host references. Passing fewer host objects into the
// sandbox (we pass none) does NOT close this.
//
// The concrete mitigation that DOES close this specific, verified escape
// path: `codeGeneration: { strings: false, wasm: false }` disables creating
// new functions from strings (Function()/eval()/the .constructor("...") gadget)
// inside the context, without breaking normal scripts (property mutation,
// JSON, arithmetic, etc. all still work — only dynamic code generation is
// blocked). This is NOT a full hardened isolate — other V8-level techniques
// not involving string-based code generation may still exist — so scripts
// must still be treated as trusted, user-authored automation (the same trust
// model as Postman/Bruno's own request scripts), never as a boundary against
// untrusted content. That's also why postman-import.js deliberately does NOT
// auto-import scripts from imported collections: an imported collection.json
// may come from someone else, and a script is the one thing in this module
// that must stay opt-in. A genuinely hardened boundary would need a real V8
// isolate (e.g. `isolated-vm`) or OS-level process isolation — both bigger,
// dependency-adding changes not attempted here.
//
// No console is exposed (Node auto-injects one into vm contexts regardless of
// what's passed in, so this isn't a control we can rely on either way); `logs`
// is always [] — kept in the return shape for adapter-contract stability (see
// IScriptRunnerAdapter).
//
// No host-realm object may enter the context either. The context data used to be built here with
// JSON.parse, so `context.constructor.constructor("return process")()` reached the HOST's Function
// constructor — which codeGeneration (a per-context setting) does not restrict. Now the data is
// created by the context's own JSON.parse from a string, and the result comes back out as a JSON
// string parsed here, so only primitives cross the boundary in either direction.
//
// The same applies to the sandbox's global itself. Contextifying a host object (even `{}`) lets
// `this.constructor.constructor("return process")()` (and globalThis.*, this.toString.constructor)
// find the HOST's Object/Function through the global's lookups, so the global must have no host
// object behind it: DONT_CONTEXTIFY gives the context a global of its own, and a null-prototype
// object is the equivalent on a Node without it. Checked against Node 26 and Electron 43's Node 24.
function newSandbox() {
  const options = { codeGeneration: { strings: false, wasm: false } };
  return vm.createContext(vm.constants?.DONT_CONTEXTIFY ?? Object.create(null), options);
}

function runScript(script, context = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sandbox = newSandbox();
  try {
    const source = JSON.stringify(JSON.stringify(context ?? {}));
    vm.runInContext(`var context = JSON.parse(${source});`, sandbox, { timeout: timeoutMs });
    vm.runInContext(script, sandbox, { timeout: timeoutMs });
    const out = vm.runInContext('JSON.stringify(context)', sandbox, { timeout: timeoutMs });
    if (typeof out !== 'string') throw new Error('The script left a context that is not plain data.');
    return { context: JSON.parse(out), logs: [], error: null };
  } catch (err) {
    return { context: null, logs: [], error: err?.message || String(err) };
  }
}

function register(ipcMain, deps = {}) {
  const { logger = defaultLog, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  const handle = withLogging(ipcMain, logger);

  handle('api-client:script:run', async (_e, script, context) => runScript(script, context, { timeoutMs }));
}

module.exports = { register, runScript };
