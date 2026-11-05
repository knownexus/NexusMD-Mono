'use strict';
// The log hub the shell owns: every module's logger and the renderer's batches end up here. It
// stamps, redacts and caps entries, writes them to the module's own file, keeps a ring of recent
// ones and tells subscribers (the viewer's live tail). Nothing here ever throws into a caller.

const nodeFs = require('node:fs');
const { createWriter } = require('./writer.cjs');
const { prune } = require('./retention.cjs');
const { currentCorrelation } = require('./context.cjs');
const { redactString, redactValue } = require('./redact.cjs');
const { RANK, normalizeLevel, isModuleId, cap, safeStringify, MAX_MSG, MAX_DATA } = require('./entry.cjs');

const RING = 500;
const CID_MEMORY = 2000;
const SYNC_FLUSH_GAP_MS = 100;
const INGEST_LIMIT = 200; // entries per sender per second

function createLogHub({
  dir, level = 'info', maxFileBytes, retention = {}, now = Date.now, fs = nodeFs, flushMs = 250,
  sid = `s-${Math.random().toString(36).slice(2, 8)}`, pid = process.pid, fallback = console,
} = {}) {
  let minRank = RANK[normalizeLevel(level)];
  let seq = 0;
  let lastSyncFlush = 0;
  let timer = null;
  let warnedDisk = false;
  const ring = [];
  const subscribers = new Set();
  const cidModules = new Map(); // cid -> Set of modules whose entries carried it
  const senders = new Map();    // sender key -> { windowStart, count, dropped }

  const writer = createWriter({
    dir, fs, maxFileBytes,
    onError: (err) => {
      // The disk is the one thing the log can't report to itself: say so once, on the console.
      if (!warnedDisk) { warnedDisk = true; fallback.error?.('[logging] could not write the log files:', err.message); }
    },
  });

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; writer.flush(); }, flushMs);
    timer.unref?.();
  }

  /**
   * Records one entry from trusted code.
   * @param {{ mod: string, lvl: string, scope?: string|null, msg?: string, err?: object|null, data?: any,
   *           proc?: 'main'|'renderer', win?: number, cid?: string, clientTs?: string }} raw
   */
  function write(raw) {
    try {
      const lvl = normalizeLevel(raw.lvl);
      if (RANK[lvl] > minRank) return null;
      const mod = isModuleId(raw.mod) ? raw.mod : 'core';
      // `detached`: not part of the call chain this happens to run in (an entry from a window, handled inside the
      // shell's logged ipcMain, is not a call that went through core).
      const store = raw.detached ? undefined : currentCorrelation();
      const cid = raw.cid ?? store?.cid;
      // The modules this call came through before reaching `mod`, in order (not for an entry that
      // names a different chain's cid). Written on the entry so the hop is still there on disk,
      // after the in-memory cidModules map has forgotten it.
      const via = store && cid === store.cid ? store.path.filter(m => m !== mod) : [];
      const entry = {
        v: 1,
        seq: seq++,
        ts: new Date(now()).toISOString(),
        sid,
        lvl,
        mod,
        proc: raw.proc === 'renderer' ? 'renderer' : 'main',
        pid,
        ...(raw.win != null ? { win: raw.win } : {}),
        ...(cid ? { cid } : {}),
        ...(via.length ? { via } : {}),
        ...(raw.scope ? { scope: cap(String(raw.scope), 120) } : {}),
        msg: cap(redactString(raw.msg ?? ''), MAX_MSG),
        ...(raw.err ? { err: redactValue(raw.err) } : {}),
        ...(raw.clientTs ? { clientTs: String(raw.clientTs).slice(0, 40) } : {}),
      };
      if (raw.data !== undefined) {
        const data = redactValue(raw.data);
        const text = safeStringify(data) ?? '';
        entry.data = text.length > MAX_DATA ? { truncated: cap(text, MAX_DATA) } : data;
      }
      if (cid) {
        const mods = cidModules.get(cid) ?? new Set();
        mods.add(mod);
        for (const m of store?.path ?? []) mods.add(m);
        cidModules.set(cid, mods);
        if (cidModules.size > CID_MEMORY) cidModules.delete(cidModules.keys().next().value);
      }

      ring.push(entry);
      if (ring.length > RING) ring.shift();
      writer.add(entry);
      for (const fn of subscribers) {
        try { fn(entry); } catch (err) { fallback.error?.('[logging] a subscriber threw:', err.message); }
      }
      // Errors are what get looked at after a crash: get them to disk now (at most every 100 ms).
      if (lvl === 'error' && now() - lastSyncFlush >= SYNC_FLUSH_GAP_MS) {
        lastSyncFlush = now();
        writer.flush();
      } else {
        schedule();
      }
      return entry;
    } catch (err) {
      // A logger must never take its caller down; the console is the last place left to say so.
      try { fallback.error?.('[logging] entry dropped:', err.message); } catch { /* nothing left to try */ }
      return null;
    }
  }

  /**
   * Records an entry from the renderer (untrusted): validated, attributed to the module it names
   * (or core), rate-limited per sender, and marked proc 'renderer'.
   */
  function ingest(raw, { sender = 'renderer', win } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const t = now();
    const s = senders.get(sender) ?? { windowStart: t, count: 0, dropped: 0 };
    senders.set(sender, s);
    if (t - s.windowStart >= 1000) {
      if (s.dropped) write({ mod: 'core', lvl: 'warn', scope: 'logging', msg: `${s.dropped} renderer log entries from ${sender} were dropped (over ${INGEST_LIMIT} a second)`, proc: 'renderer', win });
      s.windowStart = t; s.count = 0; s.dropped = 0;
    }
    if (++s.count > INGEST_LIMIT) { s.dropped++; return null; }
    return write({
      mod: isModuleId(raw.mod) ? raw.mod : 'core',
      lvl: raw.lvl,
      scope: typeof raw.scope === 'string' ? raw.scope : null,
      msg: typeof raw.msg === 'string' ? raw.msg : String(raw.msg ?? ''),
      err: raw.err && typeof raw.err === 'object' ? { name: String(raw.err.name ?? 'Error'), message: String(raw.err.message ?? ''), ...(raw.err.stack ? { stack: cap(String(raw.err.stack), 8192) } : {}) } : null,
      data: raw.data,
      cid: typeof raw.cid === 'string' && /^c-[a-z0-9]{4,16}$/.test(raw.cid) ? raw.cid : undefined,
      clientTs: raw.ts,
      proc: 'renderer',
      win,
      detached: true,
    });
  }

  return {
    write,
    ingest,
    /** Writes everything buffered, now. */
    flush: () => { if (timer) { clearTimeout(timer); timer = null; } writer.flush(); },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    /** The most recent entries (up to 500), oldest first: what the live tail opens with. */
    recent: () => ring.slice(),
    /** Every module whose entries carried this correlation id. */
    modulesOf: cid => [...(cidModules.get(cid) ?? [])],
    setLevel(l) { minRank = RANK[normalizeLevel(l)]; },
    prune: () => prune({ dir, days: retention.days, maxBytes: retention.maxBytes, now: now(), fs, onError: () => {} }),
  };
}

module.exports = { createLogHub };
