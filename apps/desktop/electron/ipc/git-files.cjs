// electron/ipc/git-files.cjs
//
// Git Workspace file editor, main side: list a worktree's files, read one as text with a stamp, and
// write it back only if it hasn't changed on disk since that read. Paths are confined to the
// registered worktree by real path (safe-file.cjs); the .git folder is never touched, and creating
// files is out of scope.

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { resolveInside, readText, checkText, writeAtomic, sha256, BOM } = require('./safe-file.cjs');

const MAX_LIST = 50000;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;

const notWorktreeFile = rel => new Error(`Not a worktree file: ${rel}`);

// Real path of p, or of its deepest existing parent when p itself doesn't exist yet.
async function realOrParent(p) {
  try { return await fsp.realpath(p); } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
    const parent = path.dirname(p);
    return parent === p ? p : path.join(await realOrParent(parent), path.basename(p));
  }
}

// Same lexical rules as git.cjs's requirePaths, kept here so the export works without that closure.
// The .git test judges the real resolved target, so "a/../.git", backslashes, links and 8.3 names
// can't reach it; any segment named .git is refused, which covers nested repositories too.
async function requireWorktreeFile(wt, rel) {
  if (typeof rel !== 'string' || /^[a-zA-Z]:/.test(rel) || /^[\\/]{2}/.test(rel)) throw notWorktreeFile(rel);
  const { full, realDir } = await resolveInside(await fsp.realpath(wt), rel, notWorktreeFile);
  const real = await realOrParent(full);
  if (path.relative(realDir, real).split(/[\\/]/).some(s => s.toLowerCase() === '.git')) throw notWorktreeFile(rel);
  // `real` is where the file actually lives (a symlinked file's target), confined like `full`.
  return { full, real, realDir };
}

// Every entry is shown selected in its parent folder, which never runs it; openPath would launch a
// worktree folder named like an app bundle (x.app) on macOS. Only the worktree root, a folder the
// user registered, is opened itself. The electron require is lazy so this module still loads under
// plain node (tests inject their own reveal).
async function defaultReveal(full, isRoot) {
  const { shell } = require('electron');
  if (!isRoot) { shell.showItemInFolder(full); return; }
  const error = await shell.openPath(full);
  if (error) throw new Error(error);
}

function registerFiles(handle, { git, requireExactWorktree, requirePaths, withRepoLock, reveal = defaultReveal }) {
  const target = (repo, wt, registered, rel) =>
    requireExactWorktree(repo, wt, registered, () => requirePaths(wt, [rel])).then(() => requireWorktreeFile(wt, rel));

  handle('git:files', async (_e, repo, wt, registered) => {
    await requireExactWorktree(repo, wt, registered);
    const r = await git(wt, ['ls-files', '-z', '-c', '-o', '--exclude-standard']);
    if (r.code !== 0) throw new Error(r.stderr || 'git ls-files failed');
    // A nested repository lists as "dir/", which isn't a file.
    const all = [...new Set(r.stdout.split('\0').filter(p => p && !p.endsWith('/')))].sort();
    return { files: all.slice(0, MAX_LIST), truncated: all.length > MAX_LIST };
  });

  // Shows a file or folder of the worktree, selected, in the OS file manager; '' opens the worktree itself.
  handle('git:reveal', async (_e, repo, wt, registered, rel) => {
    await requireExactWorktree(repo, wt, registered);
    const full = rel ? (await target(repo, wt, registered, rel)).full : await fsp.realpath(wt);
    if (!(await fsp.stat(full).catch(() => null))) throw new Error(`${rel} no longer exists.`);
    await reveal(full, !rel);
  });

  handle('git:readFile', async (_e, repo, wt, registered, rel) => {
    const { full } = await target(repo, wt, registered, rel);
    return readText(full, rel, { maxBytes: MAX_READ_BYTES });
  });

  handle('git:writeFile', async (_e, repo, wt, registered, rel, text, { expectedStamp, overwrite = false, bom = false } = {}) => {
    if (typeof text !== 'string') throw new Error('Nothing to write');
    // Written at the real path, so saving through a symlink updates its target and keeps the link.
    const { real, realDir } = await target(repo, wt, registered, rel);
    const body = Buffer.concat([bom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
    if (body.length > MAX_WRITE_BYTES) throw new Error(`${rel} is too large to save from here.`);
    return withRepoLock(repo, async () => {
      let current;
      try { current = await fsp.readFile(real); } catch (e) { if (e.code === 'ENOENT') return { ok: false, missing: true }; throw e; }
      checkText(current, rel, { maxBytes: MAX_READ_BYTES });
      const stamp = sha256(current);
      if (!overwrite && stamp !== expectedStamp) return { ok: false, conflict: true, stamp };
      await writeAtomic(real, realDir, body, notWorktreeFile);
      return { ok: true, stamp: sha256(body) };
    });
  });
}

module.exports = { registerFiles, requireWorktreeFile, MAX_LIST };
