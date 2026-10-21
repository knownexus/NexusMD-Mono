// electron/ipc/git-shell.cjs
//
// Runs the user's DotFiles PowerShell functions (g!, gstat, gpf, …) for the Git Workspace command
// line. Starting pwsh and loading the profile scripts costs seconds, so one pwsh per DotFiles folder
// stays open with them loaded and takes one command at a time on stdin. It is -NonInteractive: a
// function that asks (Read-Host, a confirmation) fails rather than waiting on input nobody can give.
// Only a function or alias the profile scripts define can be run.

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PWSH = 'pwsh';
const NAME = /^[A-Za-z0-9_.!?+-]+$/;
const MAX_ARGS = 64;
const OUTPUT_CAP = 1024 * 1024;
// Terminal control the output drawer can't show: cursor and screen sequences (any CSI but a colour,
// which ends in "m" and is kept), the full reset, and window titles.
// eslint-disable-next-line no-control-regex
const CONTROL = /\x1b(\[[0-9;?]*[ -/]*[@-ln-~]|c|\][^\x07]*\x07)/g;

const quote = s => `'${String(s).replace(/'/g, "''")}'`;
const profileDir = folder => path.join(folder, 'pwsh', 'profile.d');

/** The function and alias names the profile scripts define, so nothing else can be run. */
function definedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/^\s*function\s+global:([^\s{(]+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^\s*Set-Alias\s+(?:-Name\s+)?([^\s]+)/gm)) names.add(m[1]);
  return names;
}

function readProfile(folder, fsx = fs) {
  const dir = profileDir(folder);
  let names;
  try { names = fsx.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.ps1')).sort(); } catch { return ''; }
  return names.map(n => { try { return fsx.readFileSync(path.join(dir, n), 'utf8'); } catch { return ''; } }).join('\n');
}

function registerShell(handle, ctx) {
  const { spawn, kill, requireExactWorktree, isRemoteOrDevicePath, timeoutMs = 60000, fsx = fs, env = process.env } = ctx;
  const sessions = new Map();

  function start(folder) {
    const child = spawn(PWSH, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      // Nothing can answer an editor, pager or credential prompt here: git fails at once instead of waiting.
      cwd: folder, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
    });
    const s = { folder, child, out: '', err: '', waiter: null, queue: Promise.resolve(), dead: false, failure: null };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { s.out += d; s.waiter?.(); });
    child.stderr.on('data', d => { s.err += d; });
    const gone = () => { s.dead = true; s.waiter?.(); if (sessions.get(folder) === s) sessions.delete(folder); };
    child.on('exit', gone);
    // A missing pwsh is only reported here, after spawn has returned.
    child.on('error', e => { s.failure = `PowerShell 7 (pwsh) is needed to run DotFiles scripts: ${e.message}`; gone(); });
    // Load every profile script once, quietly: some (key bindings, prompt) only make sense in a terminal.
    s.ready = send(s, [
      "$ProgressPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      `foreach ($f in Get-ChildItem -LiteralPath ${quote(profileDir(folder))} -Filter *.ps1 | Sort-Object Name) { try { . $f.FullName *> $null } catch { } }`,
    ].join('; '), timeoutMs * 3);
    return s;
  }

  // Writes one line and collects stdout up to its end marker. A line runs at the session's global scope.
  function send(s, line, ms) {
    const id = crypto.randomBytes(8).toString('hex');
    const marker = `<<nexusmd-end ${id} `;
    const run = () => new Promise((resolve, reject) => {
      if (s.dead) { reject(new Error(s.failure ?? 'PowerShell stopped. Run the command again.')); return; }
      s.out = '';
      s.err = '';
      const timer = setTimeout(() => {
        s.waiter = null;
        s.dead = true;
        sessions.delete(s.folder);
        Promise.resolve(kill(s.child.pid)).catch(() => {});
        reject(new Error(`It took longer than ${Math.round(ms / 1000)}s, so PowerShell was stopped.`));
      }, ms);
      s.waiter = () => {
        const at = s.out.indexOf(marker);
        if (at < 0 && !s.dead) return;
        clearTimeout(timer);
        s.waiter = null;
        if (at < 0) { reject(new Error(s.failure ?? (s.err.trim() || 'PowerShell stopped.'))); return; }
        const ok = s.out.slice(at + marker.length).startsWith('ok');
        resolve({ ok, stdout: s.out.slice(0, at), stderr: s.err });
      };
      s.child.stdin.write(`${line}; [Console]::Out.WriteLine("\`n${marker}" + $(if ($global:__nxOk -eq $false) { 'failed' } else { 'ok' }) + '>>')\n`);
    });
    const p = s.queue.then(run, run);
    s.queue = p.catch(() => {});
    return p;
  }

  async function session(folder) {
    let s = sessions.get(folder);
    if (!s || s.dead) { s = start(folder); sessions.set(folder, s); }
    await s.ready;
    return s;
  }

  const clean = t => (t.length > OUTPUT_CAP ? `${t.slice(0, OUTPUT_CAP)}\n[output truncated]` : t).replace(CONTROL, '').replace(/\r/g, '');

  handle('git:shellRun', async (_e, repo, worktreePath, registered, folder, name, args) => {
    await requireExactWorktree(repo, worktreePath, registered, () => {
      if (typeof folder !== 'string' || !path.isAbsolute(folder) || isRemoteOrDevicePath(folder)) throw new Error('The DotFiles folder must be an absolute local path.');
      if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Not a DotFiles command.');
      if (!Array.isArray(args) || args.length > MAX_ARGS || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('Invalid arguments.');
    });
    if (!definedNames(readProfile(folder, fsx)).has(name)) throw new Error(`${name} isn't defined in ${profileDir(folder)}.`);
    const s = await session(folder);
    const line = [
      '$global:__nxOk = $true',
      `try { Set-Location -LiteralPath ${quote(worktreePath)}; $__nxArgs = @(${args.map(quote).join(', ')}); & ${quote(name)} @__nxArgs *>&1 | Out-String -Stream -Width 240 } catch { $global:__nxOk = $false; Write-Output $_.ToString() }`,
    ].join('; ');
    const r = await send(s, line, timeoutMs);
    return { code: r.ok ? 0 : 1, stdout: clean(r.stdout).replace(/\n+$/, ''), stderr: clean(r.stderr).trim() };
  });

  // Starting pwsh and loading the profile takes seconds: the command line asks for it early.
  handle('git:shellWarm', async (_e, folder) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || isRemoteOrDevicePath(folder)) return false;
    if (!readProfile(folder, fsx)) return false;
    await session(folder);
    return true;
  });

  return {
    async disposeAll() {
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map(s => { s.dead = true; return Promise.resolve(kill(s.child.pid)).catch(() => {}); }));
    },
  };
}

module.exports = { registerShell, definedNames, readProfile };
