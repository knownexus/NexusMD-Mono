// electron/ipc/git-files.cjs
//
// Git Workspace file editor, main side: list a worktree's files, read one as text with a stamp, and
// write it back only if it hasn't changed on disk since that read. Paths are confined to the
// registered worktree by real path (safe-file.cjs); the .git folder is never touched, and creating
// files is out of scope.

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { resolveInside, readText, checkText, writeAtomic, sha256, BOM } = require('@nexusmd/main-kit/safe-file');

const MAX_LIST = 50000;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Kept in step with views/git/image-types.js.
const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif',
};

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

// Opening a worktree file with its default app is allowed only for kinds that are plain text AND that
// no common handler runs, interprets or evaluates. This is an allowlist on purpose: a list of what
// to refuse can never be complete (scripts, installers, shortcuts, macro documents, .html/.svg that
// run script, .csv that a spreadsheet evaluates, and new ones every year). Anything else, including
// unknown and extensionless files, needs the Editor app. Source files for languages that need a
// compiler first (C, Go, Rust, ...) are fine; those that run directly (js, py, sh, ps1) are not.
const PASSIVE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'rst', 'adoc', 'log',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env', 'gitignore', 'gitattributes', 'editorconfig',
  'css', 'scss', 'less',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'java', 'kt', 'swift', 'sql',
]);
// Plain files with no extension that are conventionally documentation.
const PASSIVE_NAMES = new Set([
  'readme', 'license', 'licence', 'notice', 'authors', 'contributors', 'changelog', 'contributing', 'codeowners', 'copying',
  '.gitignore', '.gitattributes', '.editorconfig',
]);

// Judged on the final name only: "invoice.txt.bat" is a .bat, "archive.exe.txt" is a text file.
function isPassiveTextName(rel) {
  if (typeof rel !== 'string') return false;
  const name = path.basename(rel).toLowerCase();
  // A trailing dot or space is dropped by Windows, so "a.txt " would open as "a.txt".
  if (!name || /[. ]$/.test(name)) return false;
  if (PASSIVE_NAMES.has(name)) return true;
  const ext = path.extname(name).slice(1);
  return ext !== '' && PASSIVE_EXTENSIONS.has(ext);
}

// Opens a worktree file with the system's default app. The electron require is lazy so this module
// still loads under plain node (tests inject their own openExternal).
async function defaultOpenExternal(full) {
  const { shell } = require('electron');
  const error = await shell.openPath(full);
  if (error) throw new Error(error);
}

async function looksLikeText(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return !buf.subarray(0, bytesRead).includes(0);
  } finally { await handle.close(); }
}

function registerFiles(handle, { git, requireExactWorktree, requirePaths, withRepoLock, reveal = defaultReveal, openExternal = defaultOpenExternal }) {
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

  // Opens a text file of the worktree with the system's default app: what Git offers when the Editor
  // app isn't installed. Only plain files inside the worktree that could not run anything.
  handle('git:openExternal', async (_e, repo, wt, registered, rel) => {
    await requireExactWorktree(repo, wt, registered);
    const { real } = await target(repo, wt, registered, rel);
    const st = await fsp.stat(real).catch(() => null);
    if (!st) throw new Error(`${rel} no longer exists.`);
    if (!st.isFile()) throw new Error(`${rel} isn't a file.`);
    // Both the name the user sees and where it really lives (a link can point at a program).
    if (!isPassiveTextName(rel) || !isPassiveTextName(real)) {
      throw new Error(`${rel} isn't one of the plain-text kinds that can be opened from here. Install the Editor app to open any file.`);
    }
    if (process.platform !== 'win32' && (st.mode & 0o111)) throw new Error(`${rel} is executable, so it isn't opened from here.`);
    if (!(await looksLikeText(real))) throw new Error(`${rel} isn't a text file, so it isn't opened from here.`);
    await openExternal(real);
  });

  // An image of the worktree as a data URL, from the working tree, the index or HEAD, for the editor
  // and the diff. Only known image extensions; the bytes are never run, just shown by an <img>.
  handle('git:readImage', async (_e, repo, wt, registered, rel, side) => {
    const mime = typeof rel === 'string' ? IMAGE_TYPES[path.extname(rel).slice(1).toLowerCase()] : null;
    if (!mime) throw new Error(`${rel} isn't an image type that can be shown.`);
    if (!['working', 'index', 'head'].includes(side)) throw new Error(`Unknown image side: ${side}`);
    const { real } = await target(repo, wt, registered, rel);
    const tooBig = n => new Error(`${rel} is too large to show here (${Math.round(n / 1024 / 1024)} MB).`);
    let bytes;
    if (side === 'working') {
      const st = await fsp.stat(real).catch(() => null);
      if (!st) return { missing: true };
      if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
      if (st.size > MAX_IMAGE_BYTES) throw tooBig(st.size);
      bytes = await fsp.readFile(real);
    } else {
      const spec = side === 'head' ? `HEAD:${rel}` : `:0:${rel}`;
      const sized = await git(wt, ['cat-file', '-s', spec]);
      if (sized.code !== 0) return { missing: true };
      if (Number(sized.stdout) > MAX_IMAGE_BYTES) throw tooBig(Number(sized.stdout));
      const blob = await git(wt, ['cat-file', 'blob', spec]);
      if (blob.code !== 0) return { missing: true };
      bytes = blob.raw;
    }
    return { mime, size: bytes.length, url: `data:${mime};base64,${bytes.toString('base64')}` };
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

module.exports = { registerFiles, requireWorktreeFile, MAX_LIST, isPassiveTextName, PASSIVE_EXTENSIONS };
