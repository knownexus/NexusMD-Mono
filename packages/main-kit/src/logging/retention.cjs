'use strict';
// Keeps the logs folder from growing without bound: files older than `days` go, then the oldest
// files of any module that is still over `maxBytes`. Legacy flat files (logs/YYYY-MM-DD.log and
// their .old.log rotations) age out with the same rule.

const nodeFs = require('node:fs');
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;
const DATED = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$|^(\d{4}-\d{2}-\d{2})(?:\.old)?\.log$/;

function prune({ dir, days = 14, maxBytes = 100 * 1024 * 1024, now = Date.now(), fs = nodeFs, onError = () => {} }) {
  const deleted = [];
  const remove = (file) => {
    try { fs.unlinkSync(file); deleted.push(file); } catch (err) { onError(err, file); }
  };
  const dated = (name, file) => {
    const m = DATED.exec(name);
    if (!m) return null;
    const t = Date.parse(`${m[1] ?? m[2]}T00:00:00Z`);
    let size = 0;
    try { size = fs.statSync(file).size; } catch (err) { onError(err, file); }
    return { file, t, size };
  };
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { deleted }; } // no logs folder yet
  const cutoff = now - days * DAY_MS;

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      const f = dated(e.name, full);
      if (f && f.t < cutoff) remove(full);
    } else if (e.isDirectory()) {
      let files = [];
      try { files = fs.readdirSync(full).map(n => dated(n, path.join(full, n))).filter(Boolean); } catch (err) { onError(err, full); }
      files.sort((a, b) => a.t - b.t || a.file.localeCompare(b.file));
      let total = 0;
      const kept = [];
      for (const f of files) {
        if (f.t < cutoff) remove(f.file);
        else { kept.push(f); total += f.size; }
      }
      // Over the size cap: oldest first, but never the newest file (it is being written to).
      while (total > maxBytes && kept.length > 1) {
        const f = kept.shift();
        total -= f.size;
        remove(f.file);
      }
    }
  }
  return { deleted };
}

module.exports = { prune };
