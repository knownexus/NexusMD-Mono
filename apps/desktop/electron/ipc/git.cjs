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
  const env = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
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

function defaultProbe() {
  const stat = p => { try { return fs.statSync(p); } catch { return null; } };
  return {
    isDirectory: p => !!stat(p)?.isDirectory(),
    isFile: p => !!stat(p)?.isFile(),
    exists: p => fs.existsSync(p),
    listDirectories: p => fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name),
    readText: p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    mtime: p => stat(p)?.mtime.toISOString() ?? null,
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
  } = deps;
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  let gitPath = deps.gitPath !== undefined ? deps.gitPath : findGit(env, probe);
  const handle = withLogging(ipcMain, logger);
  const running = new Set();
  const waiting = [];
  // normalised folder → { commonDir, at }: one poll asks resolve, worktrees and branches per repo.
  const commonDirs = new Map();
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

  async function git(cwd, args) {
    const exe = gitExecutable();
    if (!exe) throw new Error('Git not found');
    await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(exe,['--no-pager', '-c', 'core.fsmonitor=false', ...args], { cwd, env: gitEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
          reject(new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }), timeoutMs);
        child.stdout.on('data', c => out.push(Buffer.from(c)));
        child.stderr.on('data', c => err.push(Buffer.from(c)));
        child.on('error', e => done(() => reject(new Error(`Couldn't start git: ${e.message}`))));
        child.on('close', code => done(() => resolve({
          code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8').trim(),
        })));
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
    requireRegistered(repo, registered);
    requireAbsolute(worktreePath, 'Worktree path');
    if (!isInside(worktreePath, repo.path)) {
      const listed = (await worktreeList(repo.path)).split('\0').filter(f => f.startsWith('worktree ')).map(f => f.slice(9));
      if (!listed.some(p => samePath(p, worktreePath))) throw new Error(`Not a worktree of ${repo.path}: ${worktreePath}`);
    }
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

module.exports = { register, gitEnv, isRepositoryRoot, findGit };
