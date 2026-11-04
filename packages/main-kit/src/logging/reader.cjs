'use strict';
// Reads the per-module log files back for a viewer: which modules and days exist, a filtered view of
// one day across modules, and everything one call did across modules (by correlation id).
// Nothing here trusts its input: module ids, dates and correlation ids are checked before they are
// used in a path, and a damaged line (a crash can leave the last one cut short) is skipped, not fatal.

const nodeFs = require('node:fs');
const path = require('node:path');
const { isModuleId } = require('./entry.cjs');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CID = /^c-[a-z0-9]{4,16}$/;
const FILE = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

/**
 * @param {{ dir: string, fs?: object, now?: () => number, beforeRead?: () => void }} opts
 *   beforeRead runs before every read; the viewer passes hub.flush so the newest entries are on disk.
 */
function createLogReader({ dir, fs = nodeFs, now = Date.now, beforeRead = () => {} }) {
  const safely = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // module id -> its log files, grouped by day
  function filesByModule(onlyMods) {
    const out = new Map();
    const names = onlyMods ?? safely(() => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name), []);
    for (const mod of names) {
      if (!isModuleId(mod)) continue;
      const days = new Map();
      for (const name of safely(() => fs.readdirSync(path.join(dir, mod)), [])) {
        const m = FILE.exec(name);
        if (!m) continue;
        const file = path.join(dir, mod, name);
        const day = days.get(m[1]) ?? { date: m[1], size: 0, files: [] };
        day.size += safely(() => fs.statSync(file).size, 0);
        day.files.push(file);
        days.set(m[1], day);
      }
      if (days.size) out.set(mod, [...days.values()].sort((a, b) => b.date.localeCompare(a.date)));
    }
    return out;
  }

  /** Every module with logs: [{ mod, days: [{ date, size }] }], core first, days newest first. */
  function modules() {
    beforeRead();
    return [...filesByModule().entries()]
      .map(([mod, days]) => ({ mod, days: days.map(({ date, size }) => ({ date, size })) }))
      .sort((a, b) => (a.mod === 'core' ? -1 : b.mod === 'core' ? 1 : a.mod.localeCompare(b.mod)));
  }

  const haystack = e => `${e.msg ?? ''}\n${e.scope ?? ''}\n${e.err ? `${e.err.name} ${e.err.message} ${e.err.stack ?? ''}` : ''}\n${e.data !== undefined ? JSON.stringify(e.data) : ''}`.toLowerCase();

  /**
   * @param {{ date?: string, mods?: string[], levels?: string[], text?: string, cid?: string, limit?: number }} q
   *   date: one day (UTC, YYYY-MM-DD; today by default; ignored with a cid, which searches every day).
   * @returns {{ entries: object[], truncated: boolean, skipped: number }} the newest `limit` matches, oldest first
   */
  function query(q = {}) {
    beforeRead();
    const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const date = q.cid ? null : (DATE.test(q.date ?? '') ? q.date : (q.date ? 'invalid' : new Date(now()).toISOString().slice(0, 10)));
    const mods = Array.isArray(q.mods) && q.mods.length ? q.mods.filter(isModuleId) : null;
    const levels = Array.isArray(q.levels) && q.levels.length ? new Set(q.levels) : null;
    const text = typeof q.text === 'string' && q.text.trim() ? q.text.trim().toLowerCase() : null;
    const cid = q.cid && CID.test(q.cid) ? q.cid : null;
    if (q.cid && !cid) return { entries: [], truncated: false, skipped: 0 };

    const matches = [];
    let skipped = 0;
    if (mods && !mods.length) return { entries: [], truncated: false, skipped };
    for (const days of filesByModule(mods).values()) {
      for (const day of days) {
        if (date && day.date !== date) continue;
        for (const file of day.files) {
          const content = safely(() => fs.readFileSync(file, 'utf8'), '');
          for (const line of content.split('\n')) {
            if (!line) continue;
            if (cid && !line.includes(cid)) continue;
            let e;
            try { e = JSON.parse(line); } catch { skipped++; continue; }
            if (!e || typeof e !== 'object') { skipped++; continue; }
            if (cid && e.cid !== cid) continue;
            if (levels && !levels.has(e.lvl)) continue;
            if (text && !haystack(e).includes(text)) continue;
            matches.push(e);
          }
        }
      }
    }
    matches.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
    const truncated = matches.length > limit;
    return { entries: truncated ? matches.slice(-limit) : matches, truncated, skipped };
  }

  /** Everything one call did, across modules and days: { entries, modules (in order of first entry), truncated, skipped }. */
  function follow(cid) {
    const r = query({ cid, limit: MAX_LIMIT });
    return { ...r, modules: [...new Set(r.entries.map(e => e.mod))] };
  }

  return { modules, query, follow };
}

module.exports = { createLogReader };
