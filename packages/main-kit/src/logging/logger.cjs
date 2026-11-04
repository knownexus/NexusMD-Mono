'use strict';
// A module's logger: logger.error('msg', err, { data }), scope('name'), and the electron-log
// transport that routes everything still using require('electron-log') into the hub.

const { argsToParts, normalizeLevel } = require('./entry.cjs');
const { currentCorrelation } = require('./context.cjs');

/**
 * @param hub  from createLogHub
 * @param {{ mod: string, scope?: string|null }} opts
 */
function createLogger(hub, { mod, scope = null }) {
  const emit = (lvl, args) => {
    try {
      const { msg, err, data } = argsToParts(args);
      hub.write({ mod, lvl, scope, msg, err, data });
    } catch {
      // A logger must never throw into the code that called it.
    }
  };
  const child = name => createLogger(hub, { mod, scope: scope ? `${scope}:${name}` : name });
  return {
    error: (...a) => emit('error', a),
    warn: (...a) => emit('warn', a),
    info: (...a) => emit('info', a),
    debug: (...a) => emit('debug', a),
    // electron-log's names, so code written against it keeps working
    verbose: (...a) => emit('debug', a),
    silly: (...a) => emit('debug', a),
    log: (...a) => emit('info', a),
    scope: child,
    child,
  };
}

/**
 * An electron-log transport (log.transports.hub = …): every message anything sends through
 * electron-log lands in the hub, under the module whose call chain it came from, else core.
 */
function createElectronLogTransport(hub) {
  const transport = (message) => {
    try {
      const { msg, err, data } = argsToParts(message.data ?? []);
      hub.write({
        mod: currentCorrelation()?.mod ?? 'core',
        lvl: normalizeLevel(message.level),
        scope: message.scope ?? null,
        msg, err, data,
      });
    } catch {
      // Never throw back into electron-log.
    }
  };
  transport.level = 'silly';
  return transport;
}

module.exports = { createLogger, createElectronLogTransport };
