'use strict';
// For code that has no ctx to take a logger from (a helper file inside an app's main code, the
// shell's small IPC modules). moduleLogger() finds the shell's hub when it logs, through
// globalThis.logHub, so it works from inside an app's bundle too, and does nothing at all where
// there is no hub (unit tests).
//
// ignore() is the one sanctioned way to swallow an error: the code carries on, and the log says what
// was ignored and why. An empty catch block is not allowed (see logging-guard.test.js).

/** A logger for `mod` (and optionally a scope) that resolves the hub at the time it logs. */
function moduleLogger(mod, scope = null) {
  const emit = level => (...args) => {
    try {
      const hub = globalThis.logHub;
      if (!hub) return;
      const logger = hub.logger(mod);
      (scope ? logger.scope(scope) : logger)[level](...args);
    } catch {
      // a logger never throws into the code that called it
    }
  };
  return {
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    debug: emit('debug'),
    verbose: emit('debug'),
    silly: emit('debug'),
    log: emit('info'),
    scope: name => moduleLogger(mod, scope ? `${scope}:${name}` : name),
  };
}

/**
 * Logs an error that is being ignored on purpose, and why. Debug for the ordinary "it wasn't
 * there / was already gone" cases; warn when ignoring it could hide a real problem.
 * @param log    any logger (a module's ctx.log, moduleLogger(…), electron-log's)
 * @param level  'debug' (default) | 'info' | 'warn' | 'error'
 */
function ignore(log, reason, err, level = 'debug') {
  try {
    log[level](`ignored: ${reason}`, err);
  } catch {
    // ignoring an error must not itself throw
  }
}

/** `.catch(ignored(log, 'removing the temp file'))`: ignore() as a promise handler. */
const ignored = (log, reason, level = 'debug') => err => ignore(log, reason, err, level);

module.exports = { moduleLogger, ignore, ignored };
