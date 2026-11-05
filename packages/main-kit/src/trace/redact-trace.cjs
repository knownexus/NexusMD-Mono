'use strict';
// A recording holds far more than a log line: arguments, return values, requests and responses. Before an event is
// stored it goes through a redactor. Three layers, in order:
//   1. rules that replace a whole event's content (a sign-in request, a credential IPC channel, a function named like
//      a credential and everything it calls);
//   2. the log hub's redaction on every other value (secret key names, bearer tokens, credentials in URLs, token=…);
//   3. nothing else. A value no rule recognises is shown: a recording keeps request and response bodies because they
//      are what the person needs to find a cause. This is best effort, not a guarantee.
//
// One redactor per recording: it has to remember which calls are open and which were denied, because a return value
// carries no function name and a call's children carry no sign of what their parent was.

const { redactValue } = require('../logging/redact.cjs');
const deny = require('./deny.json');

const rx = (list) => list.map((s) => new RegExp(s, 'i'));
const DEFAULT_DENY = { urls: rx(deny.urls), functions: rx(deny.functions), channels: rx(deny.channels) };

const hides = (list, text) => typeof text === 'string' && list.some((r) => r.test(text));

// 'file.js:12:0:getAuthToken' -> 'get auth token'; 'sign_in' -> 'sign in'
const nameWords = (fn) => {
  const name = typeof fn === 'string' ? fn.slice(fn.lastIndexOf(':') + 1) : '';
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase();
};

/**
 * @param {{ urls: RegExp[], functions: RegExp[], channels: RegExp[] }} [rules]
 * @returns {{ redact(event: object): object }}  `redact` returns a copy that is safe to store (the input is never
 *   changed). Events must be given in the order they happened, per process (an enter before its return).
 */
function createRedactor(rules = DEFAULT_DENY) {
  const open = new Map(); // id of a call that has started and not ended -> true when it, or a caller, was denied
  const deniedIds = new Set(); // every denied call, for the whole recording: a callback or timer started inside one runs
  //                              later, after it has returned, and still carries it as its parent

  function redact(event) {
    const out = { ...event };
    const replace = (field, why) => { out[field] = { $redacted: why }; return out; };
    const parentDenied = event.p != null && deniedIds.has(event.p);

    if (event.k === 'enter') {
      // An IPC call is a frame named ipc:<channel>; its channel is judged as a channel, not as a function name.
      const channel = typeof event.fn === 'string' && event.fn.startsWith('ipc:') ? event.fn.slice(4) : null;
      const denied = parentDenied || (channel !== null ? hides(rules.channels, channel) : hides(rules.functions, nameWords(event.fn)));
      open.set(event.id, denied);
      if (denied) deniedIds.add(event.id);
      return denied ? replace('a', 'function') : (out.a = redactValue(event.a), out);
    }
    if (event.k === 'ret' || event.k === 'err') {
      const field = event.k === 'ret' ? 'v' : 'e';
      const known = open.has(event.id);
      const denied = deniedIds.has(event.id);
      open.delete(event.id);
      if (!known) return replace(field, 'unknown frame'); // never saw it start: cannot tell what it was, so hide it
      return denied ? replace(field, 'function') : (out[field] = redactValue(event[field]), out);
    }
    if (event.d !== undefined) {
      const d = event.d;
      if (parentDenied) return replace('d', 'function');
      if (d && typeof d === 'object') {
        if (hides(rules.urls, d.url)) return replace('d', 'url');
        if (hides(rules.channels, d.channel)) return replace('d', 'channel');
      }
      out.d = redactValue(d);
    }
    return out;
  }

  return { redact };
}

module.exports = { createRedactor, DEFAULT_DENY };
