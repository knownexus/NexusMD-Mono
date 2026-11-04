'use strict';
// An ipcMain that logs. Every handler registered through it runs inside a correlation (so what it
// calls into is linked to it) and a failure is logged under the module that owns the handler, with
// the channel, how long it ran and the shape (never the content) of its arguments, then rethrown so
// the renderer still gets the rejection.

const { runWithCorrelation } = require('./context.cjs');

// Errors already logged, so a handler that rethrows through another wrapped handler (or through
// withLogging) is reported once.
const reported = new WeakSet();

const SLOW_DEBUG_MS = 1000;   // worth a debug line
const SLOW_WARN_MS = 10000;   // worth a warning (dialogs and long jobs sit between the two)

/** What was passed, without any of it: ['string', 'object(3)', 'array(12)']. */
function argShape(args) {
  return args.map((a) => {
    if (a === null) return 'null';
    if (Array.isArray(a)) return `array(${a.length})`;
    if (a instanceof Uint8Array) return `binary(${a.byteLength})`;
    if (typeof a === 'object') return `object(${Object.keys(a).length})`;
    return typeof a;
  });
}

/**
 * @param ipc  the real ipcMain
 * @param {{ hub: object, moduleId: string, now?: () => number }} opts  `hub` from createLogHub
 */
function createLoggedIpc(ipc, { hub, moduleId, now = Date.now }) {
  const log = hub.logger(moduleId);
  const wrappedListeners = new Map(); // `${channel}` -> Map(original fn -> wrapped fn)

  function report(channel, err, started, args) {
    if (err && typeof err === 'object') {
      if (reported.has(err)) return;
      reported.add(err);
    }
    const expected = !!(err && err.expected === true);
    log.scope(`ipc:${channel}`)[expected ? 'warn' : 'error'](`${channel} failed`, err instanceof Error ? err : new Error(String(err)), { channel, ms: now() - started, args: argShape(args) });
  }

  function noteDuration(channel, started) {
    const ms = now() - started;
    if (ms >= SLOW_WARN_MS) log.scope(`ipc:${channel}`).warn(`${channel} took ${ms} ms`, { channel, ms });
    else if (ms >= SLOW_DEBUG_MS) log.scope(`ipc:${channel}`).debug(`${channel} took ${ms} ms`, { channel, ms });
  }

  // fn wrapped: same arguments, same result (a promise stays a promise), failures logged.
  function wrap(channel, fn) {
    return function loggedHandler(event, ...args) {
      const started = now();
      let result;
      try {
        result = runWithCorrelation(() => fn.call(this, event, ...args), { mod: moduleId });
      } catch (err) {
        report(channel, err, started, args);
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => { noteDuration(channel, started); return value; },
          (err) => { report(channel, err, started, args); throw err; },
        );
      }
      noteDuration(channel, started);
      return result;
    };
  }

  const remember = (channel, fn, wrapped) => {
    const byFn = wrappedListeners.get(channel) ?? new Map();
    byFn.set(fn, wrapped);
    wrappedListeners.set(channel, byFn);
  };

  const overrides = {
    __logged: true,
    handle: (channel, fn) => ipc.handle(channel, wrap(channel, fn)),
    handleOnce: (channel, fn) => ipc.handleOnce(channel, wrap(channel, fn)),
    on(channel, fn) { const w = wrap(channel, fn); remember(channel, fn, w); ipc.on(channel, w); return proxy; },
    once(channel, fn) { const w = wrap(channel, fn); remember(channel, fn, w); ipc.once(channel, w); return proxy; },
    removeListener(channel, fn) {
      const w = wrappedListeners.get(channel)?.get(fn);
      ipc.removeListener(channel, w ?? fn);
      wrappedListeners.get(channel)?.delete(fn);
      return proxy;
    },
  };
  overrides.off = overrides.removeListener;

  // Anything else on ipcMain (removeHandler, listenerCount, …) goes straight to the real one.
  const proxy = new Proxy(ipc, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}

module.exports = { createLoggedIpc, argShape };
