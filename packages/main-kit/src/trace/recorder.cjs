'use strict';
// The one recording of this app instance. The main process owns it: windows push their events here, the main
// process's own runtime (packages/trace) is drained into it, and everything is written to one file.
//
// Events come from several processes in batches that arrive at different times, but the redactor needs them in the order
// they happened (a call before what it called). So events wait in memory, are sorted by time, and only those older than
// `horizonMs` are redacted and written while recording; the rest wait in case an older one is still on its way. Stop
// writes whatever is left.

const nodeFs = require('node:fs');
const path = require('node:path');
const { createRedactor } = require('./redact-trace.cjs');
const { moduleLogger, ignore } = require('../logging/lazy.cjs');
const { createStore, EXT, VERSION } = require('./store.cjs');

const MAX_BATCH = 20000;
const MAX_EVENT_BYTES = 256 * 1024; // one event bigger than this is not stored
const log = moduleLogger('core', 'recorder');

function createRecorder({
  dir, now = Date.now, runtime = globalThis.__nxt, fs = nodeFs, appVersion = '',
  maxBytes = 64 * 1024 * 1024, maxEvents = 1000000, horizonMs = 1500, flushMs = 500,
} = {}) {
  const store = createStore({ dir, fs });
  const listeners = new Set();
  let current = null;

  const status = () => (current
    ? { recording: true, id: current.id, startedAt: current.startedAt, events: current.accepted, capped: !!current.capReason }
    : { recording: false });
  const notify = () => { const s = status(); for (const fn of listeners) { try { fn(s); } catch (err) { ignore(log, 'a recording state listener threw', err, 'warn'); } } };

  const newId = () => {
    const d = new Date(now());
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
    return `rec-${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
  };

  function cap(reason) {
    if (!current || current.capReason) return;
    current.capReason = reason;
    try { runtime?.stop?.(); } catch (err) { ignore(log, 'the call runtime could not be stopped when the recording was capped', err); }
    notify();
  }

  const append = (text) => { if (text) fs.appendFileSync(current.file, text); };

  // Puts an event in the waiting list, counted against the size cap from this moment (not only once it is written), so
  // a flood between two writes cannot fill memory. A time the sender made up is pulled back into the recording's span.
  function queue(c, event) {
    let size;
    try { size = JSON.stringify(event).length; } catch { return false; } // an event that cannot be written is dropped
    if (size > MAX_EVENT_BYTES) return false;
    if (c.bytes + c.pendingBytes + size > maxBytes) { cap('bytes'); return false; }
    const t = Number.isFinite(event.t) ? Math.min(Math.max(event.t, c.startedAt), now()) : now();
    const stored = t === event.t ? event : { ...event, t };
    c.sizes.set(stored, size);
    c.pendingBytes += size;
    c.pending.push(stored);
    return true;
  }

  // Writes what is old enough (or, at stop, everything), in time order, redacted.
  function writePending(all) {
    const c = current;
    if (c.pending.length) {
      c.pending.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const cutoff = all || c.capReason ? Infinity : now() - horizonMs; // once capped, what was accepted is written now
      let n = 0;
      while (n < c.pending.length && (c.pending[n].t ?? 0) <= cutoff) n++;
      const due = c.pending.splice(0, n);
      for (const event of due) c.pendingBytes -= c.sizes.get(event) ?? 0;
      let chunk = '';
      for (const event of due) {
        const line = JSON.stringify(c.redactor.redact(event)) + '\n';
        if (c.bytes + chunk.length + line.length > maxBytes) { c.capReason ??= 'bytes'; cap('bytes'); break; }
        chunk += line;
        c.written++;
      }
      c.bytes += chunk.length;
      append(chunk);
      if (c.capReason) { c.pending.length = 0; c.pendingBytes = 0; }
    }
    if (c.capReason && !c.capWritten) {
      c.capWritten = true;
      append(JSON.stringify({ k: 'cap', t: now(), proc: 'main', reason: c.capReason }) + '\n');
    }
  }

  function tick(all) {
    const c = current;
    if (!c) return;
    try { for (const e of runtime?.drain?.() ?? []) queue(c, e); } catch (err) { ignore(log, 'the main process calls could not be read from the runtime, so this part of the recording is missing them', err, 'warn'); }
    writePending(all);
  }

  function start(label = '') {
    if (current) throw new Error('A recording is already running');
    const id = newId();
    const file = path.join(dir, id + EXT);
    const header = JSON.stringify({ nxrec: VERSION, id, label: String(label).slice(0, 120), startedAt: now(), app: appVersion }) + '\n';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, header, { flag: 'wx' });
    } catch (err) {
      throw new Error(`The recording could not start: ${err.message}`);
    }
    current = { id, file, startedAt: now(), pending: [], pendingBytes: 0, sizes: new WeakMap(), redactor: createRedactor(), bytes: header.length, accepted: 0, written: 0, capReason: null, capWritten: false, timer: null, prevOnCap: runtime?.onCap ?? null };
    if (runtime) {
      runtime.onCap = () => cap('events');
      runtime.start?.({ proc: 'main', maxEvents });
    }
    current.timer = setInterval(() => { try { tick(false); } catch (err) { ignore(log, 'writing the recording failed; the next write tries again', err, 'warn'); } }, flushMs);
    current.timer.unref?.();
    notify();
    return { id };
  }

  /** Events from a window. Anything that is not an event is dropped; so is everything once capped or stopped. */
  function add(events, { win } = {}) {
    const c = current;
    if (!c || c.capReason || !Array.isArray(events)) return;
    for (const e of events.slice(0, MAX_BATCH)) {
      if (!e || typeof e !== 'object' || typeof e.k !== 'string' || typeof e.id !== 'string' && e.k !== 'cap') continue;
      if (c.accepted >= maxEvents) { cap('events'); return; }
      const stamped = win != null && e.win == null && e.proc === 'renderer' ? { ...e, win } : e;
      if (queue(c, stamped)) c.accepted++;
      if (c.capReason) return;
    }
  }

  async function stop() {
    const c = current;
    if (!c) throw new Error('Not recording');
    clearInterval(c.timer);
    try {
      tick(true);
      try { runtime?.stop?.(); } catch (err) { ignore(log, 'the call runtime could not be stopped at the end of the recording', err); }
      tick(true); // anything the runtime held until it stopped
      append(JSON.stringify({ end: true, status: c.capReason ? 'capped' : 'finished', endedAt: now(), events: c.written }) + '\n');
    } finally {
      if (runtime) runtime.onCap = c.prevOnCap;
      current = null;
      notify();
    }
    return store.get(c.id);
  }

  /** For the app quitting: writes what is waiting, synchronously, and leaves the file without an end line (it reads as unfinished). */
  function close() {
    const c = current;
    if (!c) return;
    clearInterval(c.timer);
    try {
      tick(true);
      try { runtime?.stop?.(); } catch (err) { ignore(log, 'the call runtime could not be stopped when the app quit', err); }
      tick(true);
    } finally {
      if (runtime) runtime.onCap = c.prevOnCap;
      current = null;
      notify();
    }
  }

  return { start, stop, add, close, status, flush: async () => { if (current) tick(false); }, onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, store };
}

module.exports = { createRecorder };
