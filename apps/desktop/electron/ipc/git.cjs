// electron/ipc/git.cjs
//
// Runs the git CLI for the Git Workspace module. The renderer names an operation; this file
// owns the exact argv of each one, so the renderer can never pass git arguments. Repository
// paths arrive with the registered-repo list and are checked on every call (main keeps no state).
//
// spawn / kill / filesystem probes are injectable because vi.mock() cannot intercept a CJS require().

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn: nodeSpawn, execFile } = require('child_process');
const { withLogging } = require('./withLogging.cjs');

const STRIP_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
const BRANCH_FORMAT = '--format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)';
// [file in the git dir, label, is a rebase (has head-name)]
const OPERATIONS = [
  ['rebase-merge', 'Rebase in progress', true],
  ['rebase-apply', 'Rebase in progress', true],
  ['MERGE_HEAD', 'Merge in progress', false],
  ['REVERT_HEAD', 'Revert in progress', false],
  ['CHERRY_PICK_HEAD', 'Cherry-pick in progress', false],
];

function gitEnv(base = process.env) {
  // A target always means the requested checkout, even if NexusMD inherited git internals.
  const env = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' };
  for (const k of STRIP_ENV) delete env[k];
  return env;
}

function normalise(p) {
  const s = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function samePath(a, b) {
  return normalise(a) === normalise(b);
}

function isInside(child, parent) {
  const c = normalise(child);
  const p = normalise(parent);
  return c === p || c.startsWith(p + path.sep);
}

function killTree(pid) {
  return new Promise(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

// Windows searches the cwd before PATH for a bare command, so a git.exe committed in a scanned
// folder would run. Resolve to an absolute path from PATH instead.
function findGit(env = process.env, probe = defaultProbe()) {
  const names = process.platform === 'win32' ? ['git.exe', 'git.com'] : ['git'];
  const raw = env.PATH ?? env.Path ?? '';
  for (const entry of String(raw).split(path.delimiter)) {
    // Windows PATH entries may be quoted, e.g. "C:\Program Files\Git\cmd".
    const dir = entry.replace(/^"(.*)"$/, '$1');
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (probe.isFile(candidate)) return candidate;
    }
  }
  return null;
}

// UNC and device paths make Windows authenticate to a remote host just by being touched.
function isRemoteOrDevicePath(p) {
  return /^[\\/]{2}/.test(p);
}

const DIFF_CAP = 1024 * 1024;
const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3'];
const AREAS = ['unstaged', 'staged', 'untracked', 'conflict'];
const STALE = 'Changed since you reviewed it. Refresh and review again.';
const LOCK_HINT = 'Another git process is using this repo; close it or remove the stale lock.';
const SUBMODULE = 'Submodule changes need to be managed inside the submodule.';
const PATHSPEC_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];
const nul = paths => paths.map(p => `${p}\0`).join('');
const refuse = detail => ({ ok: false, detail });

function result(r) {
  const detail = [r.stdout.trim(), r.stderr].filter(Boolean).join('\n');
  if (r.code === 0) return { ok: true, detail: detail || 'Done' };
  return { ok: false, detail: /index\.lock/.test(r.stderr) ? `${detail}\n${LOCK_HINT}` : detail || `git exited with code ${r.code}` };
}

// Cuts one hunk out of a single-file diff: the file header plus the index-th "@@" hunk.
// Numbering matches parseDiff in @nexusmd/core. Lines keep any "\r", so CRLF files apply cleanly.
function extractHunk(text, index) {
  const lines = String(text).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.filter(l => l.startsWith('diff --')).length > 1) throw new Error('This diff covers more than one file. Stage the whole file instead.');
  const starts = [];
  lines.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
  if (!Number.isInteger(index) || index < 0 || index >= starts.length) throw new Error('That hunk no longer exists. Refresh and review again.');
  const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
  return [...lines.slice(0, starts[0]), ...lines.slice(starts[index], end)].join('\n') + '\n';
}

const sha = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex');

// The rest of a porcelain v2 record after its n fixed fields (the path may contain spaces).
function afterFields(record, n) {
  let i = -1;
  for (let k = 0; k < n; k++) i = record.indexOf(' ', i + 1);
  return record.slice(i + 1);
}

function defaultProbe() {
  const stat = p => { try { return fs.statSync(p); } catch { return null; } };
  return {
    isDirectory: p => !!stat(p)?.isDirectory(),
    isFile: p => !!stat(p)?.isFile(),
    exists: p => fs.existsSync(p),
    listDirectories: p => fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name),
    readText: p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    mtime: p => stat(p)?.mtime.toISOString() ?? null,
    isLink: p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } },
    size: p => { const s = stat(p); return s?.isFile() ? s.size : null; },
    readBytes: p => { try { return fs.readFileSync(p); } catch { return null; } },
    unlink: p => fs.unlinkSync(p),
  };
}

// A `.git` file (worktree or submodule) naming a network gitdir would make git touch that host.
function pointsAtNetwork(dir, probe) {
  const dotGit = path.join(dir, '.git');
  if (!probe.isFile(dotGit)) return false;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(probe.readText?.(dotGit) || '');
  return !!m && isRemoteOrDevicePath(m[1]);
}

// Only folders with their own markers count; otherwise every subfolder of a checkout would
// resolve to that checkout's repository.
function isRepositoryRoot(dir, probe) {
  if (pointsAtNetwork(dir, probe)) return false;
  return probe.exists(path.join(dir, '.git')) ||
    probe.isDirectory(path.join(dir, '.git-main')) ||
    probe.isDirectory(path.join(dir, '.bare')) ||
    (probe.isFile(path.join(dir, 'HEAD')) && probe.isDirectory(path.join(dir, 'objects')));
}

function register(ipcMain, deps = {}) {
  const {
    spawn = nodeSpawn,
    kill = killTree,
    probe = defaultProbe(),
    timeoutMs = 30000,
    maxConcurrent = 6,
    logger,
    env = process.env,
    now = Date.now,
    commonDirTtlMs = 5000,
    commitTimeoutMs = 120000,
  } = deps;
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  let gitPath = deps.gitPath !== undefined ? deps.gitPath : findGit(env, probe);
  const handle = withLogging(ipcMain, logger);
  const running = new Set();
  const waiting = [];
  // normalised folder → { commonDir, at }: one poll asks resolve, worktrees and branches per repo.
  const commonDirs = new Map();
  const locks = new Map();
  let disposed = false;
  let active = 0;
  let version = null;

  // Git is looked up again until found, so installing it and reopening the screen works.
  function gitExecutable() {
    if (!gitPath) gitPath = findGit(env, probe);
    return gitPath;
  }

  const acquire = () => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error('Git Workspace is shutting down')); return; }
    if (active < maxConcurrent) { active++; resolve(); } else waiting.push({ resolve, reject });
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next.resolve(); else active--;
  };

  async function git(cwd, args, { input = null, timeout = timeoutMs } = {}) {
    const exe = gitExecutable();
    if (!exe) throw new Error('Git not found');
    await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(exe, ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
          cwd, env: gitEnv(), windowsHide: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        });
        running.add(child);
        const out = [];
        const err = [];
        let settled = false;
        let timer = null;
        const done = fn => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(child);
          fn();
        };
        timer = setTimeout(() => done(() => {
          Promise.resolve(kill(child.pid)).catch(() => {});
          reject(new Error(`git ${args[0]} timed out after ${Math.round(timeout / 1000)}s`));
        }), timeout);
        child.stdout.on('data', c => out.push(Buffer.from(c)));
        child.stderr.on('data', c => err.push(Buffer.from(c)));
        child.on('error', e => done(() => reject(new Error(`Couldn't start git: ${e.message}`))));
        child.on('close', code => done(() => {
          const bytes = Buffer.concat(out);
          resolve({ code, stdout: bytes.toString('utf8'), stderr: Buffer.concat(err).toString('utf8').trim(), bytes: bytes.length });
        }));
        if (input != null) {
          // A write to a process that already exited must not crash main.
          child.stdin.on('error', () => {});
          child.stdin.end(input);
        }
      });
    } finally {
      release();
    }
  }

  function requireAbsolute(p, what) {
    if (typeof p === 'string' && isRemoteOrDevicePath(p)) throw new Error("Network (UNC) paths aren't supported");
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${what} must be an absolute path`);
  }

  function requireRegistered(repo, registered) {
    requireAbsolute(repo?.path, 'Repository path');
    if (!Array.isArray(registered) || !registered.some(r => typeof r === 'string' && path.isAbsolute(r) && samePath(r, repo.path))) {
      throw new Error(`Not a registered repository: ${repo.path}`);
    }
  }

  async function requireWorktree(repo, worktreePath, registered) {
    requireRegistered(repo, registered);
    requireAbsolute(worktreePath, 'Worktree path');
    if (!isInside(worktreePath, repo.path)) {
      const listed = (await worktreeList(repo.path)).split('\0').filter(f => f.startsWith('worktree ')).map(f => f.slice(9));
      if (!listed.some(p => samePath(p, worktreePath))) throw new Error(`Not a worktree of ${repo.path}: ${worktreePath}`);
    }
  }

  // File paths come from the renderer: relative, inside the worktree, never the worktree itself.
  function requirePaths(worktreePath, paths) {
    if (!Array.isArray(paths) || !paths.length) throw new Error('Choose at least one file');
    const root = path.resolve(worktreePath);
    for (const p of paths) {
      const bad = typeof p !== 'string' || !p || p.includes('\0') || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || isRemoteOrDevicePath(p);
      const full = bad ? null : path.resolve(root, p);
      if (bad || !isInside(full, root) || samePath(full, root)) throw new Error(`Invalid file path: ${p}`);
    }
    return paths;
  }

  async function head(wt) {
    const r = await git(wt, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : '';
  }

  // `ls-files --stage -z` entries: "<mode> <oid> <stage>\t<path>".
  async function indexEntries(wt) {
    const r = await git(wt, ['ls-files', '--stage', '-z']);
    if (r.code !== 0) throw new Error(r.stderr || 'git ls-files failed');
    return r.stdout.split('\0').filter(Boolean).map(raw => {
      const tab = raw.indexOf('\t');
      const [mode, oid, stage] = raw.slice(0, tab).split(' ');
      return { mode, oid, stage, path: raw.slice(tab + 1), raw };
    });
  }

  // Porcelain v2 records for the given paths (a rename matches on either name).
  async function statusFor(wt, paths) {
    const r = await git(wt, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
    if (r.code !== 0) throw new Error(r.stderr || 'git status failed');
    const want = new Set(paths);
    const records = r.stdout.split('\0');
    const found = [];
    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const kind = raw[0];
      let p = null;
      let orig = null;
      if (kind === '?') p = raw.slice(2);
      else if (kind === '1') p = afterFields(raw, 8);
      else if (kind === '2') { p = afterFields(raw, 9); orig = records[++i]; }
      else if (kind === 'u') p = afterFields(raw, 10);
      if (p !== null && (want.has(p) || (orig && want.has(orig)))) {
        found.push({ kind, xy: kind === '?' ? '??' : raw.slice(2, 4), path: p, orig, raw: orig ? `${raw}\0${orig}` : raw });
      }
    }
    return found;
  }

  // What a whole-file review promises: HEAD, the paths' index entries and their status records.
  async function filesState(wt, paths) {
    const want = new Set(paths);
    const [h, entries, records] = await Promise.all([head(wt), indexEntries(wt), statusFor(wt, paths)]);
    const mine = entries.filter(e => want.has(e.path));
    return { head: h, entries: mine, records, stamp: sha(h, ...mine.map(e => e.raw), ...records.map(r => r.raw)) };
  }

  async function commitState(wt) {
    const [h, entries] = await Promise.all([head(wt), indexEntries(wt)]);
    return { head: h, entries, stamp: sha(h, ...entries.map(e => e.raw)) };
  }

  // Untracked files have no git diff; build an all-added one so they share the viewer.
  function untrackedDiff(wt, rel) {
    const full = path.resolve(wt, rel);
    if (probe.isLink(full)) throw new Error(`Refusing to read a linked file: ${rel}`);
    const size = probe.size(full);
    if (size == null) return { text: '', truncated: false, binary: false, size: 0, gone: true };
    if (size > DIFF_CAP) return { text: '', truncated: true, binary: false, size };
    const bytes = probe.readBytes(full);
    if (!bytes) return { text: '', truncated: false, binary: false, size: 0, gone: true };
    if (bytes.subarray(0, 8000).includes(0)) return { text: '', truncated: false, binary: true, size };
    if (!bytes.length) return { text: '', truncated: false, binary: false, size: 0 };
    const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return {
      text: `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}\n`).join('')}`,
      truncated: false, binary: false, size,
    };
  }

  async function diffText(wt, area, paths) {
    if (!AREAS.includes(area)) throw new Error(`Unknown change area: ${area}`);
    if (area === 'untracked') return untrackedDiff(wt, paths[0]);
    const r = await git(wt, [...DIFF_ARGS, ...(area === 'staged' ? ['--cached'] : []), '--', ...paths]);
    if (r.code !== 0) throw new Error(r.stderr || `git diff failed (exit ${r.code})`);
    const truncated = r.bytes > DIFF_CAP;
    const text = truncated ? r.stdout.slice(0, DIFF_CAP) : r.stdout;
    return { text, truncated, binary: /^(Binary files |GIT binary patch)/m.test(text), size: r.bytes };
  }

  async function resolveCommon(dir) {
    const key = normalise(dir);
    const cached = commonDirs.get(key);
    if (cached && now() - cached.at < commonDirTtlMs) return cached.commonDir;
    if (pointsAtNetwork(dir, probe)) throw new Error("Network (UNC) paths aren't supported");
    const layouts = [path.join(dir, '.git-main'), path.join(dir, '.bare')];
    const hasDotGit = probe.exists(path.join(dir, '.git'));
    const order = !hasDotGit && layouts.some(p => probe.isDirectory(p)) ? [...layouts, dir] : [dir, ...layouts];
    for (const candidate of order) {
      if (!probe.isDirectory(candidate)) continue;
      const r = await git(candidate, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      if (r.code === 0 && r.stdout.trim()) {
        const commonDir = r.stdout.trim();
        const at = now();
        for (const [k, v] of commonDirs) if (at - v.at >= commonDirTtlMs) commonDirs.delete(k);
        commonDirs.set(key, { commonDir, at });
        return commonDir;
      }
    }
    throw new Error(`No repository at ${dir} (including .git-main and .bare)`);
  }

  async function worktreeList(repoPath) {
    const r = await git(await resolveCommon(repoPath), ['worktree', 'list', '--porcelain', '-z']);
    if (r.code !== 0) throw new Error(r.stderr || 'git worktree list failed');
    return r.stdout;
  }

  async function inProgress(gitDir) {
    if (!gitDir) return { operation: '', rebasingBranch: null };
    for (const [name, label, rebase] of OPERATIONS) {
      const p = path.join(gitDir, name);
      if (!probe.exists(p)) continue;
      const head = rebase ? (probe.readText(path.join(p, 'head-name')) || '').trim() : '';
      return { operation: label, rebasingBranch: head.startsWith('refs/heads/') ? head : null };
    }
    return { operation: '', rebasingBranch: null };
  }

  // Writes to one repository run one at a time; reads never wait.
  async function withRepoLock(repo, fn) {
    const key = normalise(await resolveCommon(repo.path));
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (locks.get(key) === tail) locks.delete(key);
    }
  }

  async function gitDirOf(wt) {
    const r = await git(wt, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
    return r.code === 0 ? r.stdout.split(/\r?\n/)[0].trim() : '';
  }

  // Shared shape of a whole-file write: validate, lock, re-check the reviewed state, then act.
  function fileWrite(channel, act) {
    handle(channel, async (_e, repo, worktreePath, registered, paths, expected) => {
      await requireWorktree(repo, worktreePath, registered);
      const rel = requirePaths(worktreePath, paths);
      return withRepoLock(repo, async () => {
        const state = await filesState(worktreePath, rel);
        if (state.stamp !== expected) return { ok: false, stale: true, detail: STALE };
        if (state.entries.some(e => e.mode === '160000')) return refuse(SUBMODULE);
        return act(worktreePath, rel, state);
      });
    });
  }

  handle('git:version', async () => {
    if (!version) {
      try {
        const r = await git(process.cwd(), ['--version']);
        version = r.code === 0 ? r.stdout.trim() : null;
      } catch {
        version = null;
      }
    }
    return version;
  });

  handle('git:resolve', async (_e, dir) => {
    requireAbsolute(dir, 'Folder');
    return { commonDir: await resolveCommon(dir) };
  });

  handle('git:worktrees', async (_e, repo, registered) => {
    requireRegistered(repo, registered);
    return worktreeList(repo.path);
  });

  handle('git:status', async (_e, repo, worktreePath, registered) => {
    await requireWorktree(repo, worktreePath, registered);
    if (!probe.isDirectory(worktreePath)) return { missing: true };
    const status = await git(worktreePath, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (status.code !== 0) return { error: status.stderr || `git status failed (exit ${status.code})` };
    // A gone upstream is detected in core from the missing `# branch.ab` line, so no extra spawn.
    const dirs = await git(worktreePath, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
    const [gitDir = '', commonDir = ''] = dirs.code === 0 ? dirs.stdout.split(/\r?\n/).map(s => s.trim()) : [];
    return {
      porcelain: status.stdout,
      ...(await inProgress(gitDir)),
      fetchedAt: commonDir ? probe.mtime(path.join(commonDir, 'FETCH_HEAD')) : null,
    };
  });

  handle('git:diff', async (_e, repo, worktreePath, registered, change) => {
    await requireWorktree(repo, worktreePath, registered);
    if (!AREAS.includes(change?.area)) throw new Error(`Unknown change area: ${change?.area}`);
    const paths = requirePaths(worktreePath, change.paths);
    const d = await diffText(worktreePath, change.area, paths);
    const { stamp } = await filesState(worktreePath, paths);
    return { ...d, stamp: sha(stamp, d.text) };
  });

  handle('git:stamp', async (_e, repo, worktreePath, registered, request) => {
    await requireWorktree(repo, worktreePath, registered);
    if (request?.kind === 'commit') return (await commitState(worktreePath)).stamp;
    if (request?.kind === 'files') return (await filesState(worktreePath, requirePaths(worktreePath, request.paths))).stamp;
    throw new Error('Unknown stamp request');
  });

  fileWrite('git:stage', async (wt, rel) => result(await git(wt, ['add', ...PATHSPEC_STDIN], { input: nul(rel) })));

  fileWrite('git:unstage', async (wt, rel, state) => result(await git(wt,
    state.head ? ['restore', '--staged', ...PATHSPEC_STDIN] : ['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...PATHSPEC_STDIN],
    { input: nul(rel) })));

  fileWrite('git:discard', async (wt, rel, state) => {
    const tracked = new Set(state.entries.filter(e => e.stage === '0').map(e => e.path));
    const unstaged = new Set(state.records.filter(r => (r.kind === '1' || r.kind === '2') && r.xy[1] !== '.').map(r => r.path));
    const bad = rel.find(p => !tracked.has(p) || !unstaged.has(p));
    if (bad) return refuse(`Discard only accepts tracked files with unstaged changes: ${bad}`);
    return result(await git(wt, ['restore', '--worktree', ...PATHSPEC_STDIN], { input: nul(rel) }));
  });

  // Files only: never a directory, never through a linked folder, and only while still untracked.
  // Every path is checked before anything is deleted.
  fileWrite('git:deleteUntracked', async (wt, rel, state) => {
    const untracked = new Set(state.records.filter(r => r.kind === '?').map(r => r.path));
    const root = path.resolve(wt);
    for (const p of rel) {
      const full = path.resolve(root, p);
      if (!untracked.has(p)) return refuse(`Not an untracked file any more: ${p}`);
      if (probe.isDirectory(full)) return refuse(`Refusing a directory: ${p}`);
      for (let dir = path.dirname(full); isInside(dir, root) && !samePath(dir, root); dir = path.dirname(dir)) {
        if (probe.isLink(dir)) return refuse(`Refusing a path through a linked folder: ${p}`);
      }
    }
    let deleted = 0;
    for (const p of rel) {
      try {
        probe.unlink(path.resolve(root, p));
        deleted++;
      } catch (e) {
        return refuse(`Deleted ${deleted} of ${rel.length} files; could not delete ${p}: ${e.message}`);
      }
    }
    return { ok: true, detail: `Deleted ${deleted} untracked file${deleted === 1 ? '' : 's'}.` };
  });

  handle('git:commit', async (_e, repo, worktreePath, registered, message, expected) => {
    await requireWorktree(repo, worktreePath, registered);
    if (typeof message !== 'string' || !message.trim()) return refuse('Enter a commit message.');
    return withRepoLock(repo, async () => {
      const state = await commitState(worktreePath);
      if (state.stamp !== expected) return { ok: false, stale: true, detail: STALE };
      if (state.entries.some(e => e.stage !== '0')) return refuse('Resolve conflicts before committing.');
      const { operation } = await inProgress(await gitDirOf(worktreePath));
      if (operation) return refuse(`${operation}. Continue or abort it first.`);
      const staged = await git(worktreePath, ['diff', '--cached', '--quiet', '--no-ext-diff']);
      if (staged.code === 0) return refuse('No staged changes.');
      if (staged.code !== 1) return refuse(staged.stderr || `git diff failed (exit ${staged.code})`);
      try {
        return result(await git(worktreePath, ['commit', '-F', '-'], { input: message, timeout: commitTimeoutMs }));
      } catch (e) {
        return refuse(`${e.message}. Hooks may have left partial output in the worktree.`);
      }
    });
  });

  function hunkWrite(channel, area, reverse) {
    handle(channel, async (_e, repo, worktreePath, registered, paths, index, expected) => {
      await requireWorktree(repo, worktreePath, registered);
      const rel = requirePaths(worktreePath, paths);
      return withRepoLock(repo, async () => {
        const state = await filesState(worktreePath, rel);
        if (!state.entries.length) return refuse('Untracked files are staged whole.');
        if (state.entries.some(e => e.stage !== '0')) return refuse('Conflicted files are staged whole, after resolving them.');
        if (state.entries.some(e => e.mode === '160000')) return refuse(SUBMODULE);
        const d = await diffText(worktreePath, area, rel);
        if (sha(state.stamp, d.text) !== expected) return { ok: false, stale: true, detail: STALE };
        if (d.binary || d.truncated) return refuse('Binary or truncated diffs are staged whole.');
        let patch;
        try { patch = extractHunk(d.text, index); } catch (e) { return refuse(e.message); }
        return result(await git(worktreePath, ['apply', '--cached', ...(reverse ? ['--reverse'] : []), '--whitespace=nowarn', '-'], { input: patch }));
      });
    });
  }

  hunkWrite('git:stageHunk', 'unstaged', false);
  hunkWrite('git:unstageHunk', 'staged', true);

  handle('git:branches', async (_e, repo, registered) => {
    requireRegistered(repo, registered);
    const r = await git(await resolveCommon(repo.path), ['for-each-ref', '--sort=refname', BRANCH_FORMAT, 'refs/heads/']);
    if (r.code !== 0) throw new Error(r.stderr || 'git for-each-ref failed');
    return r.stdout;
  });

  handle('git:discover', async (_e, roots, repos) => {
    const known = new Map();
    for (const repo of Array.isArray(repos) ? repos : []) {
      if (typeof repo?.path !== 'string' || !path.isAbsolute(repo.path) || isRemoteOrDevicePath(repo.path)) continue;
      try { known.set(normalise(await resolveCommon(repo.path)), repo.name); } catch { /* unavailable registrations can't match */ }
    }
    const seen = new Set();
    const found = [];
    for (const root of Array.isArray(roots) ? roots : []) {
      if (typeof root !== 'string' || !path.isAbsolute(root) || isRemoteOrDevicePath(root) || !probe.isDirectory(root)) continue;
      let names;
      try { names = probe.listDirectories(root); } catch { continue; }
      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      for (const name of names) {
        const dir = path.join(root, name);
        try {
          if (!isRepositoryRoot(dir, probe)) continue;
          const commonDir = await resolveCommon(dir);
          const key = normalise(commonDir);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ name, path: dir.replace(/\\/g, '/'), commonDir, registeredAs: known.get(key) ?? null });
        } catch { /* unreadable or not a repository after all: skip it */ }
      }
    }
    return found;
  });

  handle('git:checkFolders', async (_e, paths) =>
    (Array.isArray(paths) ? paths : []).map(p => ({ path: p, exists: typeof p === 'string' && path.isAbsolute(p) && !isRemoteOrDevicePath(p) && probe.isDirectory(p) })));

  return {
    cacheSize: () => commonDirs.size,
    async disposeAll() {
      disposed = true;
      commonDirs.clear();
      for (const w of waiting.splice(0)) w.reject(new Error('Git Workspace is shutting down'));
      const all = [...running];
      running.clear();
      await Promise.all(all.map(c => Promise.resolve(kill(c.pid)).catch(() => {})));
    },
  };
}

module.exports = { register, gitEnv, isRepositoryRoot, findGit, extractHunk };
