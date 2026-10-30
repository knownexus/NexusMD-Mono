// api-script-runner.js — IScriptRunnerAdapter for the API client on Android.
// Desktop runs pre-request / post-response / test scripts in a Node `vm`; here they run in a
// dedicated Web Worker that is terminated if it overruns. Same contract either way: the script
// sees a plain-data `context`, may mutate it, and the result comes back as JSON. Scripts are
// trusted, user-authored automation (as in Postman/Bruno), not a boundary against untrusted code,
// so the worker only drops the obvious I/O globals.

const DEFAULT_TIMEOUT_MS = 5000;

// Self-contained on purpose: its source text is what the worker runs.
export function runScriptSource(script, contextJson) {
  try {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches']) {
      try { Object.defineProperty(globalThis, name, { value: undefined, configurable: true }); } catch (_) { /* not removable */ }
    }
    const context = JSON.parse(contextJson);
    // eslint-disable-next-line no-new-func
    new Function('context', script)(context);
    const out = JSON.stringify(context);
    if (typeof out !== 'string') throw new Error('The script left a context that is not plain data.');
    return { context: JSON.parse(out), logs: [], error: null };
  } catch (err) {
    return { context: null, logs: [], error: err?.message || String(err) };
  }
}

// The whole worker program, as text: the script runner above plus the message handler.
export const workerSource = () => `const run = ${runScriptSource.toString()};
  self.onmessage = (e) => self.postMessage(run(e.data.script, e.data.contextJson));`;

function defaultCreateWorker() {
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  const worker = new Worker(url);
  return { worker, dispose: () => { worker.terminate(); URL.revokeObjectURL(url); } };
}

export function createScriptRunner({ createWorker = defaultCreateWorker, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    run(script, context) {
      return new Promise((resolve) => {
        let handle;
        try { handle = createWorker(); } catch (err) {
          resolve({ context: null, logs: [], error: err?.message || String(err) });
          return;
        }
        const finish = (result) => { clearTimeout(timer); handle.dispose(); resolve(result); };
        const timer = setTimeout(() => finish({ context: null, logs: [], error: 'Script timed out' }), timeoutMs);
        handle.worker.onmessage = (e) => finish(e.data);
        handle.worker.onerror = (e) => finish({ context: null, logs: [], error: e?.message || 'Script failed' });
        handle.worker.postMessage({ script, contextJson: JSON.stringify(context ?? {}) });
      });
    },
  };
}

export const scriptRunnerAdapter = createScriptRunner();
