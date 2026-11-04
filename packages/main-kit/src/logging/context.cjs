'use strict';
// Correlation: everything that runs inside one call chain shares a correlation id (cid), and the
// modules it passes through are recorded, so entries from different modules can be linked as one
// incident. AsyncLocalStorage carries it across awaits and callbacks without touching any payload.

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
let counter = 0;
const newCid = () => `c-${Date.now().toString(36).slice(-4)}${(++counter % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Runs fn inside a correlation: the current one when there is one (adding `mod` to the modules it
 * has touched), otherwise a new one.
 * @returns whatever fn returns (a promise stays a promise)
 */
function runWithCorrelation(fn, { mod, cid } = {}) {
  const cur = als.getStore();
  const path = cur ? (mod && !cur.path.includes(mod) ? [...cur.path, mod] : cur.path) : (mod ? [mod] : []);
  return als.run({ cid: cid ?? cur?.cid ?? newCid(), mod: mod ?? cur?.mod, path }, fn);
}

/** { cid, mod, path } of the call chain being run, or undefined outside one. */
const currentCorrelation = () => als.getStore();

module.exports = { runWithCorrelation, currentCorrelation };
