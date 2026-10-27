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
const { withLogging } = require('@nexusmd/main-kit/with-logging');
const { resolveInside, readText, writeAtomic, sha256, BOM, TMP_FILE } = require('@nexusmd/main-kit/safe-file');

const MAX_READ = 1024 * 1024;
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.idea']);
const notProfileFile = rel => new Error(`Not a profile file: ${rel}`);

function profileDir(config) {
  const { root, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  if (profile && (typeof profile !== 'string' || !path.isAbsolute(profile))) throw new Error('The profile folder in Settings must be an absolute path.');
  return path.resolve(profile || path.join(root, 'profile'));
}

const exists = p => fsp.stat(p).then(() => true, () => false);
const isDir = p => fsp.stat(p).then(s => s.isDirectory(), () => false);

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
    const { full } = await resolveInside(dir, rel, notProfileFile);
    return readText(full, rel, { maxBytes: MAX_READ });
  });

  handle('devenv:profile-write', async (_e, config, rel, text, opts) => {
    opts = opts || {};
    if (typeof text !== 'string') throw new Error('Nothing to save.');
    const body = Buffer.concat([opts.bom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
    if (body.length > MAX_WRITE) throw new Error(`${rel} is too large to save here.`);
    const dir = profileDir(config);
    if (!(await isDir(dir))) throw new Error(`No profile folder at ${dir}.`);
    const { full, realDir } = await resolveInside(dir, rel, notProfileFile);
    let current = null;
    try { current = await fsp.readFile(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const currentStamp = current ? sha256(current) : null;
    if (!opts.overwrite) {
      if (current && (opts.create || currentStamp !== opts.expectedStamp)) return { ok: false, conflict: true, stamp: currentStamp };
      if (!current && !opts.create) return { ok: false, missing: true };
    }
    await writeAtomic(full, realDir, body, notProfileFile);
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
