'use strict';
// One JSON-lines file per module per day: <dir>/<module>/YYYY-MM-DD.jsonl, rolling to
// YYYY-MM-DD.1.jsonl, .2.jsonl … at maxFileBytes. Entries are buffered and written in batches;
// identical consecutive entries in a batch collapse into one with a repeat count (rep).

const nodeFs = require('node:fs');
const path = require('node:path');
const { safeStringify } = require('./entry.cjs');

const COLLAPSE_MS = 1000;
const fileName = (date, index) => (index ? `${date}.${index}.jsonl` : `${date}.jsonl`);

function createWriter({ dir, fs = nodeFs, maxFileBytes = 10 * 1024 * 1024, onError = () => {} }) {
  const buffers = new Map(); // module -> entries waiting to be written
  const files = new Map();   // module -> { date, index, size }
  const made = new Set();    // module directories already created

  function add(entry) {
    const buf = buffers.get(entry.mod) ?? [];
    buffers.set(entry.mod, buf);
    const last = buf[buf.length - 1];
    if (last && !entry.err && !last.err && last.lvl === entry.lvl && last.scope === entry.scope && last.msg === entry.msg
      && Date.parse(entry.ts) - Date.parse(last.ts) < COLLAPSE_MS) {
      last.rep = (last.rep ?? 1) + 1;
      return;
    }
    buf.push(entry);
  }

  function sizeOf(file) {
    try { return fs.statSync(file).size; } catch { return 0; } // not there yet: empty
  }

  // The file this module's next line of `bytes` goes to, rolling over when it would overflow.
  function target(mod, date, bytes) {
    let f = files.get(mod);
    if (!f || f.date !== date) {
      f = { date, index: 0, size: 0 };
      files.set(mod, f);
      while ((f.size = sizeOf(path.join(dir, mod, fileName(date, f.index)))) >= maxFileBytes) f.index++;
    }
    if (f.size > 0 && f.size + bytes > maxFileBytes) {
      f.index++;
      f.size = 0;
    }
    return f;
  }

  function flush() {
    for (const [mod, buf] of buffers) {
      if (!buf.length) continue;
      buffers.set(mod, []);
      try {
        if (!made.has(mod)) { fs.mkdirSync(path.join(dir, mod), { recursive: true }); made.add(mod); }
        let pending = '';
        let pendingFile = null;
        const commit = () => {
          if (pending) fs.appendFileSync(pendingFile, pending, 'utf8');
          pending = '';
        };
        for (const entry of buf) {
          const line = `${safeStringify(entry)}\n`;
          const bytes = Buffer.byteLength(line);
          const f = target(mod, entry.ts.slice(0, 10), bytes);
          const file = path.join(dir, mod, fileName(f.date, f.index));
          if (file !== pendingFile) { commit(); pendingFile = file; }
          pending += line;
          f.size += bytes;
        }
        commit();
      } catch (err) {
        onError(err, mod);
      }
    }
  }

  const pendingCount = () => [...buffers.values()].reduce((n, b) => n + b.length, 0);
  return { add, flush, pendingCount };
}

module.exports = { createWriter, fileName };
