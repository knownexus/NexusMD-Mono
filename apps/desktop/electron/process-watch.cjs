'use strict';

// Failures that never pass through a handler anyone wrote: an exception nothing caught, a rejected
// promise nobody awaited, a window whose renderer crashed or hung, a page that failed to load, a GPU or
// utility process that died. Each is logged under the module it belongs to (core when it can't be told),
// with enough to act on. Nothing here changes what happens next except the one dialog for an uncaught
// exception, which electron-log used to show and still is.

const { currentCorrelation } = require('@nexusmd/main-kit/logging');

// The first stack frame inside a module's own code names it: the all-in-one build runs
// modules/<id>/src/..., a split app runs resources/apps/<id>/main/index.cjs.
const FRAME_MODULE = [
  /[\\/]modules[\\/]([a-z0-9][a-z0-9_-]*)[\\/]src[\\/]/,
  /[\\/]apps[\\/]([a-z0-9][a-z0-9_-]*)[\\/]main[\\/]/,
];

/** The module a stack trace points into, or null. */
function moduleOfStack(stack) {
  for (const line of String(stack ?? '').split('\n')) {
    for (const re of FRAME_MODULE) {
      const m = re.exec(line);
      if (m) return m[1];
    }
  }
  return null;
}

// A page address without its query or fragment: where it was, not what it carried.
function placeOf(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url ?? '').split(/[?#]/)[0];
  }
}

const toError = (reason) => (reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason) ?? String(reason)));

/**
 * @param {{ app: EventEmitter, hub: object, dialog?: { showErrorBox: Function }, proc?: EventEmitter,
 *           ownerOf?: (webContents) => string|null }} deps
 *   ownerOf says which app a window belongs to (the registry knows); anything else logs as core.
 * @returns {{ dispose: () => void }}
 */
function createProcessWatch({ app, hub, dialog = null, proc = process, ownerOf = () => null }) {
  const core = hub.logger('core');
  // Where an error came from: the call chain it ran in, then its stack, else the shell.
  const moduleOf = err => currentCorrelation()?.mod ?? moduleOfStack(err?.stack) ?? 'core';
  const logFor = mod => hub.logger(mod);
  const removers = [];
  const on = (emitter, event, fn) => { emitter.on(event, fn); removers.push(() => emitter.removeListener(event, fn)); };

  on(proc, 'uncaughtException', (err, origin) => {
    const error = toError(err);
    logFor(moduleOf(error)).error(`uncaught exception${origin && origin !== 'uncaughtException' ? ` (${origin})` : ''}`, error);
    hub.flush();
    try {
      dialog?.showErrorBox('A JavaScript error occurred in the main process', String(error.stack ?? error.message));
    } catch (e) {
      core.warn('could not show the uncaught-exception dialog', e);
    }
  });

  on(proc, 'unhandledRejection', (reason) => {
    const error = toError(reason);
    logFor(moduleOf(error)).error('unhandled promise rejection', error);
  });

  on(proc, 'warning', (warning) => {
    logFor(moduleOf(warning)).warn(`process warning: ${warning?.name}: ${warning?.message}`, { code: warning?.code });
  });

  const watchContents = (wc) => {
    const owner = () => ownerOf(wc) ?? 'core';
    const id = wc.id;
    on(wc, 'render-process-gone', (_e, details) => {
      const clean = details?.reason === 'clean-exit';
      logFor(owner())[clean ? 'info' : 'error'](`renderer process gone: ${details?.reason}`, { reason: details?.reason, exitCode: details?.exitCode, webContents: id });
    });
    on(wc, 'unresponsive', () => logFor(owner()).warn('window is not responding', { webContents: id }));
    on(wc, 'responsive', () => logFor(owner()).info('window is responding again', { webContents: id }));
    on(wc, 'did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is a navigation that was cancelled (a redirect, a click away): ordinary.
      const level = errorCode === -3 ? 'debug' : isMainFrame ? 'error' : 'warn';
      logFor(owner())[level](`page failed to load: ${errorDescription} (${errorCode})`, { url: placeOf(validatedURL), mainFrame: !!isMainFrame, webContents: id });
    });
    on(wc, 'preload-error', (_e, preloadPath, error) => {
      logFor(owner()).error('preload script failed', toError(error), { preload: placeOf(preloadPath), webContents: id });
    });
  };
  on(app, 'web-contents-created', (_e, wc) => watchContents(wc));

  on(app, 'child-process-gone', (_e, details) => {
    const clean = details?.reason === 'clean-exit';
    core[clean ? 'info' : 'error'](`${details?.type ?? 'child'} process gone: ${details?.reason}`, { type: details?.type, reason: details?.reason, exitCode: details?.exitCode, name: details?.name });
  });

  return { dispose: () => { while (removers.length) removers.pop()(); } };
}

module.exports = { createProcessWatch, moduleOfStack, placeOf };
