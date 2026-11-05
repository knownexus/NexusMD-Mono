'use strict';
// Which main-process files get the call reports, decided by where they live in the repository. One answer for
// every way they are added: the load hook when running from source, the staging step for the installed app, and the
// build of each app's own main bundle.

const MAIN_CODE = [
  /^apps\/desktop\/electron\//,       // the shell
  /^packages\/main-kit\/src\//,       // what the shell and the apps share
  /^modules\/[^/]+\/src\/main\//,     // each app's main-process side
];

// Never traced: the logger and the recorder (they would trace themselves), the trace package, the preload (it runs in
// the window's sandbox, not here), the hook, the recording IPC, and code that is run inside a sandbox.
const NEVER = [
  /^packages\/main-kit\/src\/(?:logging|trace)\//,
  /^packages\/trace\//,
  /^apps\/desktop\/electron\/(?:preload|trace-hook)\.cjs$/,
  /^apps\/desktop\/electron\/ipc\/recordings\.cjs$/,
  /\.sandbox\.c?js$/,
];

const norm = (p) => String(p).replace(/\\/g, '/');

/** @param {string} rel  path relative to the repository root */
function shouldTraceMain(rel) {
  const p = norm(rel);
  if (!/\.c?js$/.test(p)) return false;
  if (/(^|\/)node_modules\//.test(p) || /\.(?:test|spec)\./.test(p)) return false;
  if (NEVER.some((r) => r.test(p))) return false;
  return MAIN_CODE.some((r) => r.test(p));
}

/** Where a file of the staged app lives in the repository, or null when it is not ours (a dependency, an asset). */
function sourcePathOf(staged) {
  const p = norm(staged);
  if (p.startsWith('electron/')) return `apps/desktop/${p}`;
  const kit = 'node_modules/@nexusmd/main-kit/';
  if (p.startsWith(kit)) return `packages/main-kit/${p.slice(kit.length)}`;
  return null;
}

module.exports = { shouldTraceMain, sourcePathOf };
