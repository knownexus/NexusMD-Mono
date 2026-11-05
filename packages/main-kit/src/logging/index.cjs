'use strict';
// Structured, per-module logging for the shell and the apps it hosts.
//   const hub = createLogHub({ dir })           // the shell makes one
//   hub.logger('git').error('push failed', err) // each module logs under its own id
// See hub.cjs for what happens to an entry, context.cjs for correlation.

const { createLogHub } = require('./hub.cjs');
const { createLogger, createElectronLogTransport } = require('./logger.cjs');
const { createLoggedIpc } = require('./ipc.cjs');
const { createLogReader } = require('./reader.cjs');
const { moduleLogger, ignore, ignored } = require('./lazy.cjs');
const { runWithCorrelation, currentCorrelation } = require('./context.cjs');
const { redactString, redactValue } = require('./redact.cjs');
const { LEVELS, isModuleId, normalizeLevel } = require('./entry.cjs');

function createHub(opts) {
  const hub = createLogHub(opts);
  const loggers = new Map();
  /** The logger for a module id (an invalid id logs as core). Same id, same logger. */
  hub.logger = (mod) => {
    const id = isModuleId(mod) ? mod : 'core';
    if (!loggers.has(id)) loggers.set(id, createLogger(hub, { mod: id }));
    return loggers.get(id);
  };
  return hub;
}

module.exports = {
  createLogHub: createHub,
  createLogger,
  createElectronLogTransport,
  createLoggedIpc,
  createLogReader,
  moduleLogger,
  ignore,
  ignored,
  runWithCorrelation,
  currentCorrelation,
  redactString,
  redactValue,
  LEVELS,
  isModuleId,
  normalizeLevel,
};
