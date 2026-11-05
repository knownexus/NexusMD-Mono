'use strict';
// The recording files: <dir>/<id>.nxrec, JSON lines. The first line is the header { nxrec: <format version>, id, label,
// startedAt, app }, then one event per line, then (when the recording ended normally) an end line
// { end: true, status, endedAt, events }. A file with no end line is a recording whose process died: it is still
// listed and still reads, up to the last whole line.
//
// A file in a format version this build cannot read is listed as unreadable and is never changed or removed by the
// app (not by retention either). The person can still delete it.

const nodeFs = require('node:fs');
const path = require('node:path');
const { moduleLogger, ignore } = require('../logging/lazy.cjs');

const log = moduleLogger('core', 'recordings');

const VERSION = 1;
const EXT = '.nxrec';
const ID_RE = /^rec-\d{8}-\d{6}-[a-z0-9]{4}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 8 * 1024;
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

const parseLine = (line) => { try { return JSON.parse(line); } catch { return undefined; } }; // a torn or foreign line
const isHeader = (h) => !!h && typeof h === 'object' && Number.isInteger(h.nxrec) && typeof h.id === 'string' && ID_RE.test(h.id);

function createStore({ dir, fs = nodeFs } = {}) {
  const fileOf = (id) => {
    if (!ID_RE.test(String(id))) throw new Error(`"${id}" is not a recording id`);
    return path.join(dir, id + EXT);
  };

  function readRange(file, from, length) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, from);
      return buf.subarray(0, n).toString('utf8');
    } finally { fs.closeSync(fd); }
  }

  // What the list shows, without reading a whole large file: the first line, the last line, the size.
  function describe(file) {
    const size = fs.statSync(file).size;
    const firstLine = readRange(file, 0, Math.min(size, HEAD_BYTES)).split('\n', 1)[0];
    const header = parseLine(firstLine);
    if (!isHeader(header)) return null;
    const base = { id: header.id, label: typeof header.label === 'string' ? header.label : '', startedAt: header.startedAt, bytes: size, version: header.nxrec };
    if (header.nxrec !== VERSION) return { ...base, events: 0, status: 'unreadable' };
    const tail = readRange(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES).split('\n').filter(Boolean);
    const last = tail.length ? parseLine(tail[tail.length - 1]) : undefined;
    if (last && last.end === true) return { ...base, endedAt: last.endedAt, events: last.events ?? 0, status: last.status === 'capped' ? 'capped' : 'finished' };
    // No end line: the process died. Count what can be read.
    const events = fs.readFileSync(file, 'utf8').split('\n').slice(1).filter((l) => { const e = parseLine(l); return e && typeof e.k === 'string'; }).length;
    return { ...base, events, status: 'unfinished' };
  }

  function files() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; } // no folder yet: no recordings
    return names.filter((n) => n.endsWith(EXT) && ID_RE.test(n.slice(0, -EXT.length))).map((n) => path.join(dir, n));
  }

  function list() {
    const out = [];
    for (const f of files()) {
      try { const info = describe(f); if (info) out.push(info); } catch (err) { ignore(log, `the recording file ${path.basename(f)} could not be read, so it is left out of the list`, err, 'warn'); }
    }
    return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  const get = (id) => describe(fileOf(id));

  async function read(id) {
    const text = fs.readFileSync(fileOf(id), 'utf8');
    const [first, ...rest] = text.split('\n');
    const header = parseLine(first);
    if (!isHeader(header)) throw new Error('That file is not a NexusMD recording');
    if (header.nxrec !== VERSION) throw new Error(`This recording is in format version ${header.nxrec}; this version of NexusMD reads version ${VERSION}`);
    const events = [];
    let end;
    for (const line of rest) {
      if (!line) continue;
      const e = parseLine(line);
      if (!e) continue;
      if (e.end === true) end = e;
      else if (typeof e.k === 'string') events.push(e);
    }
    return { header, events, end };
  }

  async function remove(id) { await fs.promises.unlink(fileOf(id)); }

  async function exportTo(id, dest) { await fs.promises.copyFile(fileOf(id), dest); }

  async function importFrom(src) {
    const size = fs.statSync(src).size;
    if (size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a recording');
    const header = parseLine(readRange(src, 0, Math.min(size, HEAD_BYTES)).split('\n', 1)[0]);
    if (!isHeader(header)) throw new Error('That file is not a NexusMD recording');
    const target = fileOf(header.id);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) await fs.promises.copyFile(src, target);
    return describe(target);
  }

  /** Removes recordings last written more than `days` ago. Unreadable ones are kept. @returns how many were removed */
  function prune({ days = 14, now = Date.now() } = {}) {
    let removed = 0;
    for (const f of files()) {
      try {
        const info = describe(f);
        if (!info || info.status === 'unreadable') continue;
        if (fs.statSync(f).mtimeMs < now - days * DAY_MS) { fs.unlinkSync(f); removed++; }
      } catch (err) { ignore(log, `the recording file ${path.basename(f)} could not be checked for retention, so it is kept`, err, 'warn'); }
    }
    return removed;
  }

  return { list, get, read, remove, exportTo, importFrom, prune, fileOf, VERSION };
}

module.exports = { createStore, ID_RE, EXT, VERSION };
