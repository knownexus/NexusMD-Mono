'use strict';

// File access for the Editor app: any file or folder on disk, not confined to a folder the way the
// Git and Dev Environment editors are. What it does hold to:
//   - absolute paths only; no NUL, no raw device paths (\\.\ and \\?\)
//   - text only: UTF-8, no NUL bytes, at most MAX_READ_BYTES
//   - a save carries the stamp (SHA-256 of the bytes) of the read it is based on; if the file changed
//     on disk since, nothing is written and a conflict is reported
//   - saves are atomic (temp file + rename) and go to a symlink's target, keeping the link
const path = require('path');
const fsp = require('fs/promises');
const { readText, checkText, writeAtomic, sha256, BOM } = require('@nexusmd/main-kit/safe-file');

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_LIST = 5000;

class EditorPathError extends Error {}

// The path as given, if it names something we are willing to look at; otherwise throws.
function checkPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new EditorPathError('No path given.');
  if (p.includes('\0')) throw new EditorPathError('That path is not valid.');
  if (/^[\\/]{2}[.?][\\/]/.test(p)) throw new EditorPathError('Device paths cannot be opened.');
  if (!path.isAbsolute(p)) throw new EditorPathError('Only full paths can be opened.');
  return path.resolve(p);
}

const kindOf = st => (st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other');

async function stat(p) {
  const full = checkPath(p);
  const st = await fsp.stat(full).catch(() => null);
  return st ? { exists: true, kind: kindOf(st), size: st.size } : { exists: false, kind: null, size: 0 };
}

async function read(p) {
  const full = checkPath(p);
  const r = await readText(full, path.basename(full), { maxBytes: MAX_READ_BYTES });
  return r.missing ? { missing: true } : { ...r, path: full };
}

// text is the whole file as the renderer holds it (line endings already restored). expectedStamp is
// the stamp of the read it started from, or null for a file that should not exist yet.
async function write(p, text, { expectedStamp = null, overwrite = false, bom = false } = {}) {
  const full = checkPath(p);
  if (typeof text !== 'string') throw new EditorPathError('Nothing to write.');
  const name = path.basename(full);
  const body = Buffer.concat([bom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
  if (body.length > MAX_READ_BYTES) throw new Error(`${name} is too large to save from here.`);

  let current = null;
  try { current = await fsp.readFile(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (current) {
    checkText(current, name, { maxBytes: MAX_READ_BYTES });
    const stamp = sha256(current);
    if (!overwrite && stamp !== expectedStamp) return { ok: false, conflict: true, stamp };
  } else if (expectedStamp != null && !overwrite) {
    return { ok: false, missing: true };
  }

  // The real target: saving through a symlink updates what it points at and keeps the link.
  const real = current ? await fsp.realpath(full) : full;
  await writeAtomic(real, path.dirname(real), body, () => new EditorPathError(`${name} cannot be saved there.`));
  return { ok: true, stamp: sha256(body), path: full };
}

// The entries of a folder: folders first, then files, each alphabetical. An entry that cannot be
// examined is still listed (as 'other') rather than hiding the rest.
async function list(p) {
  const full = checkPath(p);
  const names = await fsp.readdir(full);
  const entries = await Promise.all(names.map(async name => {
    const st = await fsp.stat(path.join(full, name)).catch(() => null);
    return { name, kind: st ? kindOf(st) : 'other', size: st && st.isFile() ? st.size : 0 };
  }));
  entries.sort((a, b) => (a.kind === 'dir') !== (b.kind === 'dir')
    ? (a.kind === 'dir' ? -1 : 1)
    : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  return { path: full, entries: entries.slice(0, MAX_LIST), truncated: entries.length > MAX_LIST };
}

// The paths in a command line that name existing files or folders: what the OS hands us when a file
// is opened with the app. Flags (-x, --x, /x), the program itself and unknown paths are ignored.
function pathsFromArgv(argv, { existsSync = require('fs').existsSync } = {}) {
  const out = [];
  for (const a of (argv || []).slice(1)) {
    if (typeof a !== 'string' || !a || a.startsWith('-')) continue;
    let full;
    try { full = checkPath(a); } catch { continue; }
    if (existsSync(full) && !out.includes(full)) out.push(full);
  }
  return out;
}

module.exports = { checkPath, stat, read, write, list, pathsFromArgv, EditorPathError, MAX_READ_BYTES, MAX_LIST };
