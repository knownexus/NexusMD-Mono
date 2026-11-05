// runtime.js — what instrumented code reports to: `globalThis.__nxt`.
//
// The build adds a start and an end report to every function in our own code (see instrument.mjs). Those reports call
// the methods here. When nothing is recording, `enter` returns null after one flag check and the rest return their
// argument, so the cost of a traced function when idle is that check.
//
// This file is a plain script with no import or export, so the same file loads as a script, as a module in a window
// (Vite) and with `require` in the main process. It installs onto an existing `globalThis.__nxt` if there is one, so
// a stub that instrumented code captured before this loaded becomes the real thing.
//
// Nothing here may throw into the code being traced, or change what it returns.
(function (root) {
  'use strict';

  var api = root.__nxt && typeof root.__nxt === 'object' ? root.__nxt : (root.__nxt = {});

  // The frame running now. Node keeps it with async context (so it follows work across awaits and timers); a window
  // has no such thing and keeps it in one variable that aw/resume keep right around each await.
  var als = null;
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
      als = new (require('node:async_hooks').AsyncLocalStorage)();
    }
  } catch (e) { als = null; }
  var curVar = null;
  function getCur() { if (als) { var s = als.getStore(); return s === undefined ? null : s; } return curVar; }
  function setCur(id) { if (als) als.enterWith(id); else curVar = id; }

  var perf = typeof performance !== 'undefined' && performance && typeof performance.now === 'function' && typeof performance.timeOrigin === 'number' ? performance : null;
  function now() { return perf ? perf.timeOrigin + perf.now() : Date.now(); }

  var buf = [];
  var total = 0;
  var bytes = 0;
  var seq = 0;
  var prefix = 'p';
  var proc = 'main';
  var win;
  var maxEvents = 200000;
  var maxBytes = 0;
  var capped = false;

  var LIMITS = { depth: 4, str: 2000, items: 50 };

  function typeName(v) { try { return Object.prototype.toString.call(v).slice(8, -1); } catch (e) { return 'Object'; } }

  // A JSON-safe copy of a value, cut to a size that can be shown. Never throws: whatever cannot be read becomes a
  // marker like { $cut: 'circular' }.
  function cut(value, limits) {
    var L = { depth: LIMITS.depth, str: LIMITS.str, items: LIMITS.items };
    if (limits) { if (limits.depth != null) L.depth = limits.depth; if (limits.str != null) L.str = limits.str; if (limits.items != null) L.items = limits.items; }
    try { return walk(value, 0, [], L); } catch (e) { return { $cut: 'unreadable' }; }
  }

  function walk(v, depth, ancestors, L) {
    var t = typeof v;
    if (v === null || t === 'boolean') return v;
    if (t === 'undefined') return { $cut: 'undefined' };
    if (t === 'number') return isFinite(v) ? v : { $cut: 'number', value: String(v) };
    if (t === 'string') return v.length > L.str ? v.slice(0, L.str) + '…(+' + (v.length - L.str) + ' chars)' : v;
    if (t === 'bigint') return { $cut: 'bigint', value: String(v) };
    if (t === 'symbol') return { $cut: 'symbol', value: String(v.description || '') };
    if (t === 'function') return { $cut: 'function', name: v.name || '' };
    if (ancestors.indexOf(v) !== -1) return { $cut: 'circular' };
    var kind;
    try {
      if (ArrayBuffer.isView(v)) return { $cut: 'binary', bytes: v.byteLength };
      if (v instanceof ArrayBuffer) return { $cut: 'binary', bytes: v.byteLength };
      if (v instanceof Date) return isNaN(v.getTime()) ? { $cut: 'date', value: 'invalid' } : v.toISOString();
      if (v instanceof Error) return { name: String(v.name), message: walk(String(v.message), depth + 1, ancestors, L) };
      kind = typeName(v);
      if (kind === 'Promise') return { $cut: 'promise' };
      // An Electron IPC event (the first argument of every handler) and anything that is an EventEmitter (webContents,
      // ipcMain, a stream) hold the whole process inside them: say what they are, not what they hold.
      if (typeof v.processId === 'number' && typeof v.frameId === 'number' && v.sender) return { $cut: 'ipc-event', processId: v.processId };
      if (typeof v.on === 'function' && typeof v.emit === 'function' && typeof v._events === 'object') return { $cut: 'EventEmitter', name: (v.constructor && v.constructor.name) || 'EventEmitter' };
      if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return { $cut: 'dom', tag: String(v.nodeName).toLowerCase() };
    } catch (e) { return { $cut: 'unreadable' }; }
    if (depth > L.depth) return { $cut: 'depth' };
    ancestors.push(v);
    try {
      if (Array.isArray(v)) {
        var arr = [];
        var n = Math.min(v.length, L.items);
        for (var i = 0; i < n; i++) arr.push(walk(v[i], depth + 1, ancestors, L));
        if (v.length > n) arr.push({ $cut: 'items', more: v.length - n });
        return arr;
      }
      if (kind === 'Map' || kind === 'Set') {
        var list = [];
        var count = 0;
        v.forEach(function (a, b) {
          if (count++ < L.items) list.push(kind === 'Map' ? [walk(b, depth + 1, ancestors, L), walk(a, depth + 1, ancestors, L)] : walk(a, depth + 1, ancestors, L));
        });
        var out = { $cut: kind, size: v.size, items: list };
        return out;
      }
      var keys = Object.keys(v);
      var obj = {};
      var shown = Math.min(keys.length, L.items);
      for (var k = 0; k < shown; k++) {
        var key = keys[k];
        var val;
        try { val = v[key]; } catch (e) { obj[key] = { $cut: 'getter-threw' }; continue; }
        obj[key] = walk(val, depth + 1, ancestors, L);
      }
      if (keys.length > shown) obj.$more = keys.length - shown;
      return obj;
    } catch (e) {
      return { $cut: 'unreadable' };
    } finally {
      ancestors.pop();
    }
  }

  function errorOf(e) {
    try {
      if (e && typeof e === 'object' && 'message' in e) {
        var out = { name: String(e.name || 'Error'), message: String(e.message) };
        if (e.stack) out.stack = String(e.stack).slice(0, 8000);
        return out;
      }
      return { name: 'NonError', message: typeof e === 'string' ? e : JSON.stringify(cut(e)) };
    } catch (x) { return { name: 'Error', message: 'unreadable error' }; }
  }

  function nextId() { return prefix + (win != null ? win : (typeof process !== 'undefined' && process.pid ? process.pid : 0)) + '-' + (++seq); }

  // Adds one event, or stops the recording when the cap is hit (the cap event says so).
  function push(ev) {
    if (capped) return false;
    if (total >= maxEvents || (maxBytes && bytes >= maxBytes)) {
      capped = true;
      api.on = false;
      buf.push({ k: 'cap', t: now(), proc: proc, reason: total >= maxEvents ? 'events' : 'bytes' });
      try { if (typeof api.onCap === 'function') api.onCap(total >= maxEvents ? 'events' : 'bytes'); } catch (e) { /* the callback's problem */ }
      return false;
    }
    total++;
    if (maxBytes) { try { bytes += JSON.stringify(ev).length; } catch (e) { bytes += 200; } }
    buf.push(ev);
    return true;
  }

  function stamp(ev) { ev.t = now(); ev.proc = proc; if (win != null) ev.win = win; return ev; }

  api.on = false;
  api.onCap = api.onCap || null;
  api.cut = cut;

  api.start = function (opts) {
    try {
      opts = opts || {};
      proc = opts.proc === 'renderer' ? 'renderer' : 'main';
      win = opts.win;
      prefix = proc.charAt(0);
      maxEvents = opts.maxEvents > 0 ? opts.maxEvents : 200000;
      maxBytes = opts.maxBytes > 0 ? opts.maxBytes : 0;
      buf = []; total = 0; bytes = 0; capped = false;
      setCur(null);
      api.on = true;
    } catch (e) { api.on = false; }
  };
  api.stop = function () { api.on = false; };
  api.drain = function () { var out = buf; buf = []; return out; };

  api.enter = function (fn, thisArg, args) {
    if (!api.on) return null;
    try {
      var a = [];
      if (args) for (var i = 0; i < args.length; i++) a.push(cut(args[i]));
      var parent = getCur();
      var frame = { id: nextId(), p: parent, t0: now() };
      if (!push(stamp({ k: 'enter', id: frame.id, p: parent, fn: fn, a: a }))) return null;
      setCur(frame.id);
      return frame;
    } catch (e) { return null; }
  };

  api.ret = function (frame, value) {
    if (!frame) return value;
    try {
      setCur(frame.p);
      if (api.on) push(stamp({ k: 'ret', id: frame.id, v: cut(value), ms: now() - frame.t0 }));
    } catch (e) { /* tracing must not change the result */ }
    return value;
  };

  api.err = function (frame, error) {
    if (!frame) return;
    try {
      setCur(frame.p);
      if (api.on) push(stamp({ k: 'err', id: frame.id, e: errorOf(error), ms: now() - frame.t0 }));
    } catch (e) { /* the caller rethrows the real error */ }
  };

  // Around an await (or yield): while the function waits it is not the running frame; when it resumes it is again.
  api.aw = function (frame, value) { if (frame) { try { setCur(frame.p); } catch (e) { /* ignore */ } } return value; };
  api.resume = function (frame, value) { if (frame) { try { setCur(frame.id); } catch (e) { /* ignore */ } } return value; };

  api.current = function () { try { return getCur(); } catch (e) { return null; } };

  // Runs fn with `parentId` as the running frame (a call that arrived from another process, or a click).
  api.run = function (parentId, fn) {
    if (als) return als.run(parentId === undefined ? null : parentId, fn);
    var prev = curVar;
    curVar = parentId === undefined ? null : parentId;
    try { return fn(); } finally { curVar = prev; }
  };

  api.emit = function (kind, d, parent) {
    if (!api.on) return null;
    try {
      var id = nextId();
      var ev = stamp({ k: kind, id: id, p: parent !== undefined ? parent : getCur(), d: cut(d, { depth: 6, str: 8000, items: 100 }) });
      return push(ev) ? id : null;
    } catch (e) { return null; }
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
