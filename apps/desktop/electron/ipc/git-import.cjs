// electron/ipc/git-import.cjs
//
// Git Workspace drag-and-drop, main side: copy files or folders dragged in from outside into a folder of
// a registered worktree. The destination is confined like the file editor's (git-files.cjs: real path,
// never inside .git); sources are only read. Nothing is staged, so new files show up as untracked and
// replaced ones as unstaged changes. A name that already exists is replaced only when the caller lists
// it, so the UI can ask first (dryRun reports those names).

'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs/promises');
const { requireWorktreeFile } = require('./git-files.cjs');

const MAX_ENTRIES = 20000;
const RENAME_RETRIES = 3;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const toRel = (...parts) => parts.filter(Boolean).join('/');
const notDestination = rel => new Error(`Not a worktree folder: ${rel}`);

// Every file under the dropped paths with the worktree-relative name it will get. Links are left out
// (copying one would copy whatever it points at), and so is any .git folder or file.
async function expand(sources, destDir) {
  const entries = [];
  const walk = async (abs, rel) => {
    if (entries.length > MAX_ENTRIES) throw new Error(`That is more than ${MAX_ENTRIES} files; drop fewer at a time.`);
    const st = await fsp.lstat(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of (await fsp.readdir(abs)).sort()) {
        if (name.toLowerCase() !== '.git') await walk(path.join(abs, name), toRel(rel, name));
      }
    } else if (st.isFile()) {
      entries.push({ src: abs, rel });
    }
  };
  for (const src of sources) {
    if (typeof src !== 'string' || !path.isAbsolute(src)) throw new Error('Dropped item has no file path.');
    const name = path.basename(src);
    if (!name || name.toLowerCase() === '.git') continue;
    await walk(src, toRel(destDir, name));
  }
  return entries;
}

async function replaceFile(src, real) {
  await fsp.mkdir(path.dirname(real), { recursive: true });
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.nexusmd-${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    await fsp.copyFile(src, tmp);
    for (let attempt = 0; ; attempt++) {
      try { await fsp.rename(tmp, real); break; } catch (e) {
        if (attempt < RENAME_RETRIES && RETRY_CODES.has(e.code)) { await sleep(100); continue; }
        throw e;
      }
    }
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

const sameFile = async (a, b) => {
  try { return (await fsp.realpath(a)).toLowerCase() === (await fsp.realpath(b)).toLowerCase(); } catch { return false; }
};

function registerImport(handle, { requireExactWorktree, withRepoLock }) {
  // options: { dryRun, replace: [rel] }. dryRun → { total, conflicts: [rel], failed }.
  // Otherwise → { added, replaced, skipped, failed: [{ rel, error }] }.
  handle('git:importFiles', async (_e, repo, wt, registered, destDir, sources, { dryRun = false, replace = [] } = {}) => {
    await requireExactWorktree(repo, wt, registered);
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('Nothing was dropped.');
    const dest = typeof destDir === 'string' ? destDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    if (dest) {
      const { full } = await requireWorktreeFile(wt, dest).catch(() => { throw notDestination(dest); });
      const st = await fsp.stat(full).catch(() => null);
      if (st && !st.isDirectory()) throw notDestination(dest);
    }
    const entries = await expand(sources, dest);
    const replaceSet = new Set(replace);

    return withRepoLock(repo, async () => {
      const result = { added: 0, replaced: 0, skipped: 0, failed: [] };
      const conflicts = [];
      for (const { src, rel } of entries) {
        let target;
        try { target = await requireWorktreeFile(wt, rel); } catch (e) { result.failed.push({ rel, error: e.message }); continue; }
        const st = await fsp.lstat(target.real).catch(() => null);
        if (st && !st.isFile()) { result.failed.push({ rel, error: 'A folder or link with that name is in the way.' }); continue; }
        if (st && await sameFile(src, target.real)) { result.skipped++; continue; }
        if (st && !replaceSet.has(rel)) {
          if (dryRun) conflicts.push(rel); else result.skipped++;
          continue;
        }
        if (dryRun) continue;
        try {
          await replaceFile(src, target.real);
          if (st) result.replaced++; else result.added++;
        } catch (e) {
          result.failed.push({ rel, error: e.message });
        }
      }
      return dryRun ? { total: entries.length, conflicts, failed: result.failed } : result;
    });
  });
}

module.exports = { registerImport };
