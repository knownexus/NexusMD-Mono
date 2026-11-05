'use strict';
// A recording holds far more than a log line: arguments, return values, requests and responses. Before an event is
// stored it goes through here. Three layers, in order:
//   1. rules that replace a whole event's content (a sign-in request, a function named like a credential);
//   2. the log hub's redaction on every value (secret key names, bearer tokens, credentials in URLs, token=… text);
//   3. nothing else. A value no rule recognises is shown: a recording keeps request and response bodies because they
//      are what the person needs to find a cause. This is best effort, not a guarantee.

const { redactValue } = require('../logging/redact.cjs');
const deny = require('./deny.json');

const rx = (list) => list.map((s) => new RegExp(s, 'i'));
const DEFAULT_DENY = { urls: rx(deny.urls), functions: rx(deny.functions), channels: rx(deny.channels) };

const hides = (list, text) => typeof text === 'string' && list.some((r) => r.test(text));
const nameOf = (fn) => (typeof fn === 'string' ? fn.slice(fn.lastIndexOf(':') + 1) : '');

/**
 * A copy of `event` that is safe to store (the input is never changed).
 * @param {object} event  a trace event (see packages/trace/src/runtime.js)
 * @param {{ urls: RegExp[], functions: RegExp[], channels: RegExp[] }} [rules]
 * @param {Set<string>} [denied]  ids of frames whose function was denied, so their return value is replaced too;
 *        pass the same set for the whole recording.
 */
function redactEvent(event, rules = DEFAULT_DENY, denied = new Set()) {
  const out = { ...event };
  const replace = (field, why) => { out[field] = { $redacted: why }; return out; };

  if (event.k === 'enter') {
    if (hides(rules.functions, nameOf(event.fn))) { denied.add(event.id); return replace('a', 'function'); }
    out.a = redactValue(event.a);
    return out;
  }
  if (event.k === 'ret' || event.k === 'err') {
    const field = event.k === 'ret' ? 'v' : 'e';
    if (denied.has(event.id) || hides(rules.functions, nameOf(event.fn))) return replace(field, 'function');
    out[field] = redactValue(event[field]);
    return out;
  }
  if (event.d !== undefined) {
    const d = event.d;
    if (d && typeof d === 'object') {
      if (hides(rules.urls, d.url)) return replace('d', 'url');
      if (hides(rules.channels, d.channel)) return replace('d', 'channel');
    }
    out.d = redactValue(d);
  }
  return out;
}

module.exports = { redactEvent, DEFAULT_DENY };
