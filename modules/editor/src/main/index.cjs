'use strict';

// Main-process side of the Editor app. The shell calls register(ctx) once at startup.
//
//   ctx.ipcMain
//   ctx.send(channel, msg)         push a message to the main window
//   ctx.argv                       the command line this launch started with
//   ctx.onSecondInstance(fn)       fn(argv) when the app is launched again while running; returns an unsubscribe
//
// Files named on the command line (the OS "open with" case) wait in a queue until the window asks
// for them, since the window is not there yet at startup; files from a later launch are pushed
// straight to the window.
const { withLogging } = require('@nexusmd/main-kit/with-logging');
const files = require('./editor-files.cjs');

function register(ctx) {
  const handle = withLogging(ctx.ipcMain, ctx.log);
  // `electron .` (an unpackaged run) puts the app's own folder second on the command line; a
  // packaged app has only the files it was given.
  const unpackaged = ctx.defaultApp ?? process.defaultApp;
  const argvOf = argv => (unpackaged && Array.isArray(argv) ? [argv[0], ...argv.slice(2)] : argv);
  const pending = files.pathsFromArgv(argvOf(ctx.argv));

  handle('editor:stat', (_e, p) => files.stat(p));
  handle('editor:read', (_e, p) => files.read(p));
  handle('editor:write', (_e, p, text, options) => files.write(p, text, options));
  handle('editor:list', (_e, p) => files.list(p));
  // What was opened with the app before the window could be told; handed over once.
  handle('editor:take-pending', () => pending.splice(0));

  const off = ctx.onSecondInstance?.(argv => {
    const paths = files.pathsFromArgv(argvOf(argv));
    if (paths.length) ctx.send('editor:open-request', paths);
  });

  return { dispose: () => off?.() };
}

module.exports = { register };
