'use strict';

// Main-process side of the Git Workspace app. The shell calls register(ctx) once at startup
// for each installed app; everything Git needs from the shell comes in through ctx, so this
// file never reaches back into apps/desktop.
//
//   ctx.ipcMain, ctx.BrowserWindow, ctx.dialog   Electron pieces
//   ctx.preloadPath                              preload script for pop-out windows
//   ctx.windowIcon()                             current window icon (follows the theme)
//   ctx.loadRenderer(win, hash)                  load the app's renderer into a window
const gitIpc = require('./git.cjs');
const { createPopouts } = require('./popout.cjs');

function register(ctx) {
  const { ipcMain } = ctx;
  const processes = gitIpc.register(ipcMain);

  // Pop-out windows: the editor, conflict and diff screens in a window of their own.
  const popouts = createPopouts({
    BrowserWindow: ctx.BrowserWindow,
    dialog: ctx.dialog,
    preload: ctx.preloadPath,
    icon: ctx.windowIcon(),
    load: ctx.loadRenderer,
  });
  ipcMain.handle('popout:open', (_e, spec) => popouts.open(spec));
  ipcMain.on('popout:changed', (e, repoPath) => popouts.changed(e.sender, repoPath));

  return {
    // Stops running git processes when the app quits.
    dispose: () => processes.disposeAll(),
  };
}

module.exports = { register };
