'use strict';
// An ipcMain that logs. Every handler registered through it runs inside a correlation (so what it
// calls into is linked to it) and a failure is logged under the module that owns the handler, with
// the channel, how long it ran and the shape (never the content) of its arguments, then rethrown so
// the renderer still gets the rejection.

const { runWithCorrelation, currentCorrelation } = require('./context.cjs');

// Errors already logged, so a handler that rethrows through another wrapped handler (or through
// withLogging) is reported once.
const reported = new WeakSet();

// The recording's own traffic, and the log's: never a node in a recording (it would record itself).
const NOT_RECORDED = /^(?:trace|recording|log|logs):/;

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
function createLoggedIpc(ipc, { hub, moduleId, now = Date.now, trace, runtime } = {}) {
  // While a recording runs, a call becomes a node `ipc:<channel>`, under the window call that made it when the window
  // said so (packages/main-kit/src/trace/link.cjs), and everything its handler calls is under it. Both are looked up
  // when a call arrives, not when this is created: the shell makes its ipcMain before the recording machinery exists.
  const linkOf = () => trace ?? globalThis.traceLink;
  const runtimeOf = () => runtime ?? globalThis.__nxt;
  const log = hub.logger(moduleId);
  const wrappedListeners = new Map(); // `${channel}` -> Map(original fn -> wrapped fn)

  // The failure and slow-call lines are logged after the handler has finished, outside its correlation. Log them back
  // inside it (same id, starting from this module alone, since they are this module's own lines and did not
  // arrive through the modules the call went on to), or the call cannot be followed to its failure.
  const inCall = (cid, fn) => (cid ? runWithCorrelation(fn, { mod: moduleId, cid }) : fn());

  function report(channel, err, started, args, cid) {
    if (err && typeof err === 'object') {
      if (reported.has(err)) return;
      reported.add(err);
    }
    const expected = !!(err && err.expected === true);
    inCall(cid, () => log.scope(`ipc:${channel}`)[expected ? 'warn' : 'error'](`${channel} failed`, err instanceof Error ? err : new Error(String(err)), { channel, ms: now() - started, args: argShape(args) }));
  }

  function noteDuration(channel, started, cid) {
    const ms = now() - started;
    if (ms >= SLOW_WARN_MS) inCall(cid, () => log.scope(`ipc:${channel}`).warn(`${channel} took ${ms} ms`, { channel, ms }));
    else if (ms >= SLOW_DEBUG_MS) inCall(cid, () => log.scope(`ipc:${channel}`).debug(`${channel} took ${ms} ms`, { channel, ms }));
  }

  // fn wrapped: same arguments, same result (a promise stays a promise), failures logged.
  function wrap(channel, fn) {
    const logged = function loggedHandler(event, ...args) {
      const started = now();
      let result;
      let cid; // this call's correlation id, to log its failure and its duration under
      try {
        result = runWithCorrelation(() => { cid = currentCorrelation()?.cid; return fn.call(this, event, ...args); }, { mod: moduleId });
      } catch (err) {
        report(channel, err, started, args, cid);
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => { noteDuration(channel, started, cid); return value; },
          (err) => { report(channel, err, started, args, cid); throw err; },
        );
      }
      noteDuration(channel, started, cid);
      return result;
    };

    return function recordedHandler(event, ...args) {
      const rt = runtimeOf();
      if (!rt || !rt.on || NOT_RECORDED.test(channel)) return logged.call(this, event, ...args);
      const callId = linkOf()?.take(event?.sender?.id, channel) ?? null;
      let frame = null;
      const open = () => { frame = rt.enter(`ipc:${channel}`, null, args); };
      if (callId) rt.run(callId, open); else open();
      if (!frame) return logged.call(this, event, ...args);
      let result;
      try {
        result = rt.run(frame.id, () => logged.call(this, event, ...args));
      } catch (err) {
        rt.err(frame, err);
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then((value) => { rt.ret(frame, value); return value; }, (err) => { rt.err(frame, err); throw err; });
      }
      rt.ret(frame, result);
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
