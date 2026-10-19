// electron/ipc/safe-file.cjs
//
// Confined, atomic text-file I/O shared by the devenv profile and the Git Workspace editor.
// Paths are relative to an allowed folder and judged by real path, so a junction or symlink can't
// lead out. Reads return a SHA-256 stamp of the bytes; writes go via temp file + rename (retried on
// Windows sharing errors).

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const RENAME_RETRIES = 3;
const RENAME_RETRY_MS = 100;
// Windows sharing errors while antivirus or an editor has the file open for a moment.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TMP_FILE = /^\..+\.nexusmd-[0-9a-f]{8}\.tmp$/;
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const inside = (dir, p) => {
  const d = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return fold(p).startsWith(fold(d));
};
// Windows and macOS file systems are case-insensitive by default; Linux's is not.
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const fold = s => (CASE_INSENSITIVE ? s.toLowerCase() : s);

// Real path of p even when its tail doesn't exist yet: realpath the deepest existing ancestor, then
// re-append the missing segments. A junction anywhere above is thus resolved, which a lexical
// fallback would miss. A dangling link (lstat works, realpath doesn't) is refused outright.
async function realDeep(p) {
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(await fsp.realpath(cur), ...tail.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      if (await fsp.lstat(cur).then(() => true, () => false)) return null;
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

// notOk(rel) builds the error thrown for any path that isn't a plain file path inside dir.
async function resolveInside(dir, rel, notOk) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) throw notOk(rel);
  // Windows would read "name:stream" as an alternate data stream and silently drop a trailing dot or space.
  if (process.platform === 'win32' && (rel.includes(':') || rel.split(/[\\/]/).some(s => s !== '.' && s !== '..' && /[. ]$/.test(s)))) throw notOk(rel);
  const full = path.resolve(dir, rel);
  if (!inside(dir, full)) throw notOk(rel);
  const realDir = (await realDeep(dir)) || dir;
  const realFull = await realDeep(full);
  if (!realFull || !inside(realDir, realFull)) throw notOk(rel);
  return { full, realDir };
}

// Refuses what isn't editable text: over maxBytes, containing NUL, or not UTF-8.
function checkText(buf, rel, { maxBytes }) {
  if (buf.length > maxBytes) throw new Error(`${rel} is too large to edit here (${Math.round(buf.length / 1024)} KB).`);
  if (buf.subarray(0, 8192).includes(0)) throw new Error(`${rel} isn't a text file.`);
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(buf.subarray(0, 3).equals(BOM) ? 3 : 0)); } catch { throw new Error(`${rel} isn't UTF-8 text.`); }
}

async function readText(full, rel, { maxBytes }) {
  let st;
  try { st = await fsp.stat(full); } catch (e) { if (e.code === 'ENOENT') return { missing: true }; throw e; }
  if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
  if (st.size > maxBytes) throw new Error(`${rel} is too large to edit here (${Math.round(st.size / 1024)} KB).`);
  const buf = await fsp.readFile(full);
  checkText(buf, rel, { maxBytes });
  const bom = buf.subarray(0, 3).equals(BOM);
  return { text: new TextDecoder('utf-8').decode(bom ? buf.subarray(3) : buf), bom, stamp: sha256(buf) };
}

async function writeAtomic(full, realDir, body, notOk) {
  await fsp.mkdir(path.dirname(full), { recursive: true });
  // Re-check after mkdir: the folders may have changed since resolveInside looked.
  const realParent = await realDeep(path.dirname(full));
  if (!realParent || !inside(realDir, realParent + path.sep)) throw notOk(path.relative(realDir, full).split(path.sep).join("/"));
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.nexusmd-${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    await fsp.writeFile(tmp, body);
    for (let attempt = 0; ; attempt++) {
      try { await fsp.rename(tmp, full); break; } catch (e) {
        if (attempt < RENAME_RETRIES && RETRY_CODES.has(e.code)) { await sleep(RENAME_RETRY_MS); continue; }
        throw e;
      }
    }
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { resolveInside, readText, checkText, writeAtomic, sha256, BOM, TMP_FILE };
