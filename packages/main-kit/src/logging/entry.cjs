'use strict';
// The shape of one log entry, and turning what callers pass (log.error('msg', err, {…})) into it.
// Pure: no I/O, no Electron.

const LEVELS = ['error', 'warn', 'info', 'debug'];
const RANK = { error: 0, warn: 1, info: 2, debug: 3 };
// A module id is also a directory name, so this is the path-traversal guard.
const MODULE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_MSG = 4096;
const MAX_DATA = 8192;
const MAX_STACK = 8192;

/** error | warn | info | debug for any level name a caller (or electron-log) might use. */
function normalizeLevel(level) {
  switch (String(level).toLowerCase()) {
    case 'error': case 'fatal': return 'error';
    case 'warn': case 'warning': return 'warn';
    case 'info': case 'log': return 'info';
    default: return 'debug'; // verbose, debug, silly, anything unknown
  }
}

const isModuleId = id => typeof id === 'string' && id.length <= 64 && MODULE_ID.test(id);
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function errorToObject(e) {
  return {
    name: String(e.name || 'Error'),
    message: String(e.message ?? ''),
    ...(e.code != null ? { code: String(e.code) } : {}),
    ...(e.stack ? { stack: cap(String(e.stack), MAX_STACK) } : {}),
  };
}

/** JSON.stringify that survives circular references, BigInt and binary data. */
function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return `${v}n`;
    if (v instanceof Uint8Array) return `[binary ${v.byteLength} bytes]`;
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
    }
    return v;
  });
}

/**
 * What a logging call passed, as { msg, err, data }: strings and numbers make the message, the
 * first Error becomes err (and the message when there is no text), objects become data.
 */
function argsToParts(args) {
  const text = [];
  let err = null;
  let data;
  for (const a of args) {
    if (a instanceof Error) {
      if (!err) err = errorToObject(a);
      else text.push(`${a.name}: ${a.message}`);
    } else if (a !== null && typeof a === 'object') {
      if (data === undefined) data = a;
      else data = { ...(Array.isArray(data) ? { items: data } : data), extra: [...(data.extra ?? []), a] };
    } else if (a !== undefined) {
      text.push(String(a));
    }
  }
  const msg = text.join(' ') || (err ? err.message : '');
  return { msg, err, data };
}

module.exports = { LEVELS, RANK, MODULE_ID, MAX_MSG, MAX_DATA, normalizeLevel, isModuleId, cap, errorToObject, safeStringify, argsToParts };
