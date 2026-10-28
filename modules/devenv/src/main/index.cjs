'use strict';

// Main-process side of the Dev Environment app. The shell calls register(ctx) once at startup;
// everything needed from the shell comes in through ctx.
//
//   ctx.ipcMain
//   ctx.send(channel, msg)   push a message to the main window (run output lines, exits)
const devenvIpc = require('./devenv.cjs');
const devenvProfileIpc = require('./devenv-profile.cjs');

function register(ctx) {
  const { ipcMain } = ctx;
  const runs = devenvIpc.register(ipcMain, { send: ctx.send });
  devenvProfileIpc.register(ipcMain);
  return {
    // Ends any still-running scripts when the app quits.
    dispose: () => runs.disposeAll(),
    // Asked before an update replaces this app while NexusMD runs.
    busy: () => runs.busy(),
  };
}

module.exports = { register };
