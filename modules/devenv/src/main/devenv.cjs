// electron/ipc/devenv.cjs
//
// Runs devenv (devenv.ps1 in the folder set in Settings) for the Dev Environment module, as
// hidden pwsh processes - the only place NexusMD starts them. devenv runs in host mode
// (DEVENV_HOST=nexusmd): its questions arrive as "@@devenv {...}" stdout lines, which the
// renderer answers through devenv:answer (one JSON line on the process's stdin).
//
// spawn / kill / send / shell / fileExists are injectable (same pattern as db-manager.cjs's
// drivers) because vi.mock() cannot intercept a CJS require() inside this file.

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn: nodeSpawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { withLogging } = require('@nexusmd/main-kit/with-logging');

const PREFIX = '@@devenv ';
// Files the module may open (reports, logs); never executables or scripts.
const OPENABLE_EXTENSIONS = new Set(['.html', '.htm', '.txt', '.log', '.json', '.md', '.csv']);

const QUERIES = [
  ['status', '--json'], ['build', 'status', '--json'], ['logs', 'targets', '--json'],
  ['test', 'runs', '--json'], ['test', 'collection', '--json'],
  ['db', 'baselines', '--json'], ['db', 'scripts', '--json'], ['emulator', 'avds', '--json'], ['mac', 'status', '--json'],
];
// Queries that end with one folder: an absolute path, never something devenv would read as an option.
const FOLDER_QUERIES = [['test', 'collection', '--json', '--collection']];

function isQuery(argv) {
  if (!Array.isArray(argv) || argv.some(a => typeof a !== 'string')) return false;
  const starts = q => q.every((a, i) => a === argv[i]);
  if (QUERIES.some(q => q.length === argv.length && starts(q))) return true;
  return FOLDER_QUERIES.some(q => q.length + 1 === argv.length && starts(q)
    && path.isAbsolute(argv[q.length]) && !argv[q.length].startsWith('-'));
}

function killTree(pid) {
  // child.kill() would leave docker / dotnet / adb grandchildren running.
  return new Promise(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function lineSplitter(onLine) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  const drain = () => {
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  };
  return {
    push(chunk) { buf += decoder.write(chunk); drain(); },
    end() {
      buf += decoder.end();
      drain();
      if (buf) { onLine(buf.replace(/\r$/, '')); buf = ''; }
    },
  };
}

function buildInvocation(config, argv, fileExists = fs.existsSync) {
  const { root, pwsh, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  }
  const script = path.join(root, 'devenv.ps1');
  if (!fileExists(script)) throw new Error(`No devenv.ps1 in ${root}`);
  if (!Array.isArray(argv) || argv.some(a => typeof a !== 'string')) throw new Error('devenv arguments must be strings');
  const env = { ...process.env, DEVENV_HOST: 'nexusmd' };
  if (profile) env.DEVENV_PROFILE = profile;
  else delete env.DEVENV_PROFILE;
  return {
    command: pwsh || 'pwsh',
    args: ['-NoProfile', '-NonInteractive', '-File', script, ...argv],
    options: { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

function parseControl(line) {
  if (!line.startsWith(PREFIX)) return null;
  try { return JSON.parse(line.slice(PREFIX.length)); } catch { return null; }
}

function register(ipcMain, deps = {}) {
  const {
    spawn = nodeSpawn,
    kill = killTree,
    send = () => {},
    shell = require('electron').shell,
    fileExists = fs.existsSync,
    isDirectory = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    catalogTimeoutMs = 30000,
    exitGraceMs = 2000,
    logger,
    openReport,
  } = deps;
  // Created on first use so tests and non-Electron loads never require `electron` for it.
  let reportWindows = openReport;
  const showReport = file => {
    if (!reportWindows) {
      const { createReportWindows } = require('./report-window.cjs');
      const { BrowserWindow, session } = require('electron');
      const scoped = logger?.scope?.('devenv');
      const log = (msg, e) => scoped?.error?.(msg, e);
      reportWindows = createReportWindows({ BrowserWindow, shell, session, log });
    }
    reportWindows(file);
  };
  const handle = withLogging(ipcMain, logger);
  const runs = new Map();
  const collectors = new Set();
  let nextId = 1;

  function start(config, argv, { exclusive = true, label } = {}) {
    if (exclusive) {
      for (const r of runs.values()) {
        if (r.exclusive) throw new Error(`devenv is still running "${r.label}" - wait for it or cancel it first.`);
      }
    }
    const inv = buildInvocation(config, argv, fileExists);
    const runId = nextId++;
    const child = spawn(inv.command, inv.args, inv.options);
    const run = { child, exclusive, label: label || argv.join(' '), cancelled: false };
    runs.set(runId, run);
    const out = lineSplitter(line => send('devenv:line', { runId, stream: 'stdout', line }));
    const err = lineSplitter(line => send('devenv:line', { runId, stream: 'stderr', line }));
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    // An answer written just as the process exits must not crash the main process.
    child.stdin.on?.('error', () => {});
    let finished = false;
    let graceTimer = null;
    const finish = code => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer);
      out.end();
      err.end();
      runs.delete(runId);
      send('devenv:exit', { runId, code, cancelled: run.cancelled });
    };
    child.on('error', e => {
      send('devenv:line', { runId, stream: 'stderr', line: `Couldn't start ${inv.command}: ${e.message}` });
      finish(-1);
    });
    child.on('close', code => finish(code ?? -1));
    // 'close' never fires if a grandchild keeps the stdio pipes open; don't hold the slot forever.
    child.on('exit', code => {
      if (finished) return;
      graceTimer = setTimeout(() => finish(code ?? -1), exitGraceMs);
    });
    return runId;
  }

  function collect(config, argv, timeoutMessage) {
    const inv = buildInvocation(config, argv, fileExists);
    return new Promise((resolve, reject) => {
      const child = spawn(inv.command, inv.args, inv.options);
      collectors.add(child);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        collectors.delete(child);
        Promise.resolve(kill(child.pid)).catch(() => {});
        reject(new Error(timeoutMessage));
      }, catalogTimeoutMs);
      const lines = [];
      const errLines = [];
      const out = lineSplitter(l => lines.push(l));
      const err = lineSplitter(l => errLines.push(l));
      child.stdout.on('data', c => out.push(c));
      child.stderr.on('data', c => err.push(c));
      child.stdin.end?.();
      child.on('error', e => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        collectors.delete(child);
        reject(new Error(`Couldn't start ${inv.command}: ${e.message}`));
      });
      child.on('close', code => {
        out.end();
        err.end();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        collectors.delete(child);
        resolve({ lines, stderr: errLines.join('\n'), code });
      });
    });
  }

  handle('devenv:run', async (_e, config, argv, opts) => ({ runId: start(config, argv, opts ?? {}) }));

  handle('devenv:answer', async (_e, runId, answer) => {
    const run = runs.get(runId);
    if (!run) throw new Error('That devenv command has already finished.');
    if (!answer || typeof answer.id !== 'string') throw new Error('Invalid answer');
    // Answers can be passwords: they go to stdin and nowhere else (no logging here).
    const line = answer.cancel ? { id: answer.id, cancel: true } : { id: answer.id, value: answer.value ?? '' };
    run.child.stdin.write(JSON.stringify(line) + '\n');
    return { ok: true };
  });

  handle('devenv:cancel', async (_e, runId) => {
    const run = runs.get(runId);
    if (!run) return { ok: false };
    run.cancelled = true;
    await kill(run.child.pid);
    return { ok: true };
  });

  // A reloaded renderer has lost its runIds; this lets it find (and cancel) runs it started.
  handle('devenv:active', async () =>
    [...runs.entries()].map(([runId, r]) => ({ runId, label: r.label, exclusive: r.exclusive })));

  handle('devenv:catalog', async (_e, config) => {
    const { lines, stderr, code } = await collect(config, ['help', '--json'], 'devenv took too long to list its commands');
    for (const line of lines) {
      const msg = parseControl(line);
      if (msg && msg.type === 'result' && msg.kind === 'catalog') return msg;
    }
    const detail = stderr || lines.slice(-5).join('\n') || 'Is this devenv up to date?';
    throw new Error(`devenv didn't return its command list (exit ${code}). ${detail}`);
  });

  // Read-only questions for the Status tab: they never take the exclusive slot, so status
  // keeps refreshing while a start or stop is running.
  handle('devenv:query', async (_e, config, argv) => {
    if (!isQuery(argv)) throw new Error(`Not a devenv query: ${Array.isArray(argv) ? argv.join(' ') : String(argv)}`);
    const { lines, stderr, code } = await collect(config, argv, `devenv took too long to answer ${argv.join(' ')}`);
    const results = [];
    for (const line of lines) {
      const msg = parseControl(line);
      if (msg && msg.type === 'result') results.push(msg);
    }
    return { code, results, stderr };
  });

  handle('devenv:open', async (_e, target) => {
    if (target && typeof target.url === 'string') {
      if (!/^https?:\/\//i.test(target.url)) throw new Error('Only http(s) URLs can be opened');
      await shell.openExternal(target.url);
      return { ok: true };
    }
    if (target && typeof target.path === 'string') {
      if (!path.isAbsolute(target.path) || !fileExists(target.path)) throw new Error(`Not found: ${target.path}`);
      const ext = path.extname(target.path).toLowerCase();
      if (!OPENABLE_EXTENSIONS.has(ext) && !isDirectory(target.path)) throw new Error(`Refusing to open ${target.path}`);
      if (ext === '.html' || ext === '.htm') { showReport(target.path); return { ok: true }; }
      const error = await shell.openPath(target.path);
      if (error) throw new Error(error);
      return { ok: true };
    }
    throw new Error('Nothing to open');
  });

  return {
    // A command is running (a query isn't one): stopping the app now would interrupt it.
    busy: () => runs.size > 0,
    async disposeAll() {
      const all = [...runs.values()].map(r => r.child).concat([...collectors]);
      runs.clear();
      collectors.clear();
      await Promise.all(all.map(c => kill(c.pid)));
    },
  };
}

module.exports = { register, buildInvocation, lineSplitter };
