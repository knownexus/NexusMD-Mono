// electron/ipc/devenv-profile.cjs
//
// The devenv profile (environment.json, mac.json, compose files, scripts...) as files the Dev
// Environment Profile tab can list, read and save. Paths come from the renderer relative to the
// profile folder and must stay inside it - judged by real paths, so a junction can't lead out.
// Reads return a SHA-256 stamp of the file's bytes; saves compare it (not the mtime) to detect
// outside changes, write via temp file + rename (retried on Windows sharing errors), and return the new stamp.

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { withLogging } = require('./withLogging.cjs');

const MAX_READ = 1024 * 1024;
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.idea']);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const RENAME_RETRIES = 3;
const RENAME_RETRY_MS = 100;
// Windows sharing errors while antivirus or an editor has the file open for a moment.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TMP_FILE = /^\..+\.nexusmd-[0-9a-f]{8}\.tmp$/;
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function profileDir(config) {
  const { root, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  if (profile && (typeof profile !== 'string' || !path.isAbsolute(profile))) throw new Error('The profile folder in Settings must be an absolute path.');
  return path.resolve(profile || path.join(root, 'profile'));
}

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
const exists = p => fsp.stat(p).then(() => true, () => false);
const isDir = p => fsp.stat(p).then(s => s.isDirectory(), () => false);

async function resolveFile(dir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) throw new Error(`Not a profile file: ${rel}`);
  // Windows would read "name:stream" as an alternate data stream and silently drop a trailing dot or space.
  if (process.platform === 'win32' && (rel.includes(':') || rel.split(/[\\/]/).some(s => s !== '.' && s !== '..' && /[. ]$/.test(s)))) throw new Error(`Not a profile file: ${rel}`);
  const full = path.resolve(dir, rel);
  if (!inside(dir, full)) throw new Error(`Not a profile file: ${rel}`);
  const realDir = (await realDeep(dir)) || dir;
  const realFull = await realDeep(full);
  if (!realFull || !inside(realDir, realFull)) throw new Error(`Not a profile file: ${rel}`);
  return { full, realDir };
}

async function listFiles(dir) {
  const files = [];
  let truncated = false;
  async function walk(abs, rel) {
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (e.isSymbolicLink()) continue;
      if (!e.isDirectory() && TMP_FILE.test(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(abs, e.name), r); continue; }
      if (!e.isFile()) continue;
      const st = await fsp.stat(path.join(abs, e.name));
      files.push({ path: r, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  await walk(dir, '');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
}

function register(ipcMain, { logger } = {}) {
  const handle = withLogging(ipcMain, logger);

  handle('devenv:profile-info', async (_e, config) => {
    const dir = profileDir(config);
    return { dir, isDefault: !config.profile, exists: await exists(path.join(dir, 'environment.json')), example: await isDir(path.join(path.resolve(config.root), 'profile.example')) };
  });

  handle('devenv:profile-list', async (_e, config) => {
    const dir = profileDir(config);
    if (!(await isDir(dir))) return { dir, files: [], truncated: false };
    return { dir, ...(await listFiles(dir)) };
  });

  handle('devenv:profile-read', async (_e, config, rel) => {
    const dir = profileDir(config);
    const { full } = await resolveFile(dir, rel);
    let st;
    try { st = await fsp.stat(full); } catch (e) { if (e.code === 'ENOENT') return { missing: true }; throw e; }
    if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
    if (st.size > MAX_READ) throw new Error(`${rel} is too large to edit here (${Math.round(st.size / 1024)} KB).`);
    let buf = await fsp.readFile(full);
    const stamp = sha256(buf);
    if (buf.subarray(0, 8192).includes(0)) throw new Error(`${rel} isn't a text file.`);
    const bom = buf.subarray(0, 3).equals(BOM);
    if (bom) buf = buf.subarray(3);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw new Error(`${rel} isn't UTF-8 text.`); }
    return { text, bom, stamp };
  });

  handle('devenv:profile-write', async (_e, config, rel, text, opts) => {
    opts = opts || {};
    if (typeof text !== 'string') throw new Error('Nothing to save.');
    const body = Buffer.concat([opts.bom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
    if (body.length > MAX_WRITE) throw new Error(`${rel} is too large to save here.`);
    const dir = profileDir(config);
    if (!(await isDir(dir))) throw new Error(`No profile folder at ${dir}.`);
    const { full, realDir } = await resolveFile(dir, rel);
    let current = null;
    try { current = await fsp.readFile(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const currentStamp = current ? sha256(current) : null;
    if (!opts.overwrite) {
      if (current && (opts.create || currentStamp !== opts.expectedStamp)) return { ok: false, conflict: true, stamp: currentStamp };
      if (!current && !opts.create) return { ok: false, missing: true };
    }
    await fsp.mkdir(path.dirname(full), { recursive: true });
    // Re-check after mkdir: the folders may have changed since resolveFile looked.
    const realParent = await realDeep(path.dirname(full));
    if (!realParent || !inside(realDir, realParent + path.sep)) throw new Error(`Not a profile file: ${rel}`);
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
    return { ok: true, stamp: sha256(body) };
  });

  handle('devenv:profile-create', async (_e, config) => {
    const dir = profileDir(config);
    const example = path.join(path.resolve(config.root), 'profile.example');
    if (!(await isDir(example))) throw new Error(`No profile.example in ${config.root}.`);
    if (await exists(path.join(dir, 'environment.json'))) throw new Error(`A profile already exists at ${dir}.`);
    if ((await isDir(dir)) && (await fsp.readdir(dir)).length) throw new Error(`${dir} isn't empty - choose an empty folder or remove it first.`);
    await fsp.cp(example, dir, { recursive: true, errorOnExist: true, force: false });
    return { ok: true, dir };
  });
}

module.exports = { register, profileDir };
