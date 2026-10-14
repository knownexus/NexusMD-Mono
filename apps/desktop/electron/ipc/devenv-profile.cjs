// electron/ipc/devenv-profile.cjs
//
// The Profile tab's file access. The renderer only ever names a path relative to the profile
// folder; the folder itself is recomputed here from the config on every call, with devenv's
// own rule (DEVENV_PROFILE, else <devenv>/profile - buildInvocation clears an inherited
// DEVENV_PROFILE, so this matches what devenv will read).
//
// Profile files hold secrets (docker/*.env), so nothing here puts file contents in an error
// or a log line: errors name the file and an error code only.

'use strict';

const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs']);
const TMP_SUFFIX = '.nexusmd-tmp';
// Windows Defender or an editor can hold a file for a moment just after it was written.
const RENAME_RETRIES = 3;
const RENAME_RETRY_MS = 100;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function resolveProfileDir(config) {
  const { root, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  }
  if (typeof profile === 'string' && profile) {
    if (!path.isAbsolute(profile)) throw new Error('The profile folder in Settings must be an absolute path.');
    return path.resolve(profile);
  }
  return path.resolve(root, 'profile');
}

const notProfileFile = rel => new Error(`Not a profile file: ${typeof rel === 'string' ? rel : String(rel)}`);

function checkRelative(rel) {
  const bad = typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)
    || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel);
  const parts = bad ? [] : rel.split(/[\\/]/);
  if (bad || parts.some(p => p === '' || p === '.' || p === '..')) throw notProfileFile(rel);
  return parts;
}

const isInside = (real, realDir) => real === realDir || real.startsWith(realDir.endsWith(path.sep) ? realDir : realDir + path.sep);

// Real-path containment: a junction or symlink inside the profile must not lead out of it. For
// a file that doesn't exist yet, its nearest existing ancestor is what has to be inside.
async function confine(fsp, dir, rel) {
  const parts = checkRelative(rel);
  const target = path.join(dir, ...parts);
  let realDir;
  try { realDir = await fsp.realpath(dir); } catch { throw new Error(`The profile folder ${dir} doesn't exist.`); }
  let probe = target;
  for (;;) {
    let real;
    try { real = await fsp.realpath(probe); } catch (e) {
      if (e.code !== 'ENOENT' || probe === dir) throw notProfileFile(rel);
      probe = path.dirname(probe);
      continue;
    }
    if (!isInside(real, realDir)) throw notProfileFile(rel);
    // The file itself must not be a link either, even one that stays inside: its real
    // path is what would be written.
    if (probe === target) {
      const st = await fsp.lstat(target);
      if (st.isSymbolicLink()) throw notProfileFile(rel);
    }
    return target;
  }
}

async function readBytes(fsp, file) {
  try { return await fsp.readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function listFiles(fsp, dir) {
  const files = [];
  let truncated = false;
  const walk = async (abs, rel) => {
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (truncated) return;
      // Dirent reports links as links (junctions too on Windows): never followed or listed.
      if (ent.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const childAbs = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) await walk(childAbs, childRel);
      } else if (ent.isFile() && !ent.name.endsWith(TMP_SUFFIX)) {
        if (files.length >= MAX_FILES) { truncated = true; return; }
        let size = 0;
        try { size = (await fsp.stat(childAbs)).size; } catch {}
        files.push({ path: childRel, size });
      }
    }
  };
  await walk(dir, '');
  files.sort((a, b) => a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0);
  return { files, truncated };
}

function registerProfile(handle, { fsp = require('fs/promises') } = {}) {
  handle('devenv:profile:list', async (_e, config) => {
    const dir = resolveProfileDir(config);
    let isDir = false;
    try { isDir = (await fsp.stat(dir)).isDirectory(); } catch {}
    if (!isDir) return { dir, exists: false, files: [], truncated: false };
    let exists = false;
    try { exists = (await fsp.stat(path.join(dir, 'environment.json'))).isFile(); } catch {}
    return { dir, exists, ...(await listFiles(fsp, dir)) };
  });

  handle('devenv:profile:read', async (_e, config, rel) => {
    const dir = resolveProfileDir(config);
    const file = await confine(fsp, dir, rel);
    let st;
    try { st = await fsp.stat(file); } catch (e) {
      if (e.code === 'ENOENT') return { dir, path: rel, missing: true, stamp: null };
      throw new Error(`Couldn't read ${rel}: ${e.code || 'error'}`);
    }
    if (!st.isFile()) throw notProfileFile(rel);
    if (st.size > MAX_BYTES) return { dir, path: rel, stamp: null, tooLarge: true, size: st.size };
    const bytes = await readBytes(fsp, file);
    if (bytes === null) return { dir, path: rel, missing: true, stamp: null };
    const stamp = sha256(bytes);
    if (bytes.includes(0)) return { dir, path: rel, stamp, binary: true };
    let text;
    // ignoreBOM keeps a BOM in the text, so saving writes it back.
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch {
      return { dir, path: rel, stamp, binary: true };
    }
    return { dir, path: rel, text, stamp };
  });

  handle('devenv:profile:write', async (_e, config, rel, text, opts) => {
    const { expected = null, dir: readFrom } = opts || {};
    const dir = resolveProfileDir(config);
    if (readFrom !== dir) throw new Error('The profile folder changed in Settings - reopen the file.');
    if (typeof text !== 'string') throw new Error(`Couldn't save ${rel}: no text`);
    const data = Buffer.from(text, 'utf8');
    if (data.length > MAX_BYTES) throw new Error(`Couldn't save ${rel}: over 1 MiB`);
    let file = await confine(fsp, dir, rel);
    // Not atomic with the rename below; a single user racing themselves is accepted.
    const current = await readBytes(fsp, file);
    const currentStamp = current === null ? null : sha256(current);
    if (currentStamp !== expected) return { ok: false, stale: true, stamp: currentStamp };
    try { await fsp.mkdir(path.dirname(file), { recursive: true }); } catch (e) {
      throw new Error(`Couldn't save ${rel}: ${e.code || 'error'}`);
    }
    // The folders may be new; a link that was already there is still refused.
    file = await confine(fsp, dir, rel);
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}${TMP_SUFFIX}`;
    try { await fsp.writeFile(tmp, data, { flag: 'wx' }); } catch (e) {
      throw new Error(`Couldn't save ${rel}: ${e.code || 'error'}`);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, file);
        break;
      } catch (e) {
        if (attempt < RENAME_RETRIES && RETRY_CODES.has(e.code)) { await sleep(RENAME_RETRY_MS); continue; }
        await fsp.unlink(tmp).catch(() => {});
        throw new Error(`Couldn't save ${rel}: ${e.code || 'error'}`);
      }
    }
    return { ok: true, stamp: sha256(data) };
  });
}

module.exports = { registerProfile, resolveProfileDir, MAX_BYTES, MAX_FILES };
