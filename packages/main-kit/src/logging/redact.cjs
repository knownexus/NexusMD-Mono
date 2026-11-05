'use strict';
// Secrets never reach a log file: the hub runs every entry through here, so no producer can bypass it.

const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|api[-_ ]?key|cookie|private[-_ ]?key|connection[-_ ]?string|dsn|credential/i;
const REDACTED = '[redacted]';
// `"…key containing a secret word…": "value"` in a piece of JSON text that is not whole JSON. The same words as
// SECRET_KEY, so the two cannot drift apart; the value may hold escaped quotes.
const JSON_SECRET_PAIR = new RegExp(String.raw`("[^"\n]{0,200}(?:${SECRET_KEY.source})[^"\n]{0,200}"\s*:\s*)"(?:[^"\\]|\\.)*"`, 'gi');

// V8 quotes the start of the text a failed JSON.parse choked on: `Unexpected token 's', "secret torn" is not
// valid JSON`. That text is whatever was being parsed (a note, a profile, a response), so it is dropped
// wherever it turns up in a message or a stack. (packages/core/src/log.js does the same before an error
// leaves a window.)
const JSON_QUOTE = /Unexpected token [\s\S]*?is not valid JSON/g;
const JSON_QUOTE_GONE = 'not valid JSON (the text that failed to parse is not logged)';

// JSON text that parses is redacted as a value (every key SECRET_KEY knows, any depth, escapes and all), then written
// back out compact. Text that is not whole JSON (a fragment, a log line with JSON in it) goes through the patterns below.
// Nothing downstream keeps more than a few KB of any one value (entry.cjs caps them, recordings cut them), so text past
// this length is dropped before the patterns run: a huge string must not be able to make redaction slow.
const MAX_REDACT_INPUT = 200000;
const MAX_JSON_TEXT = MAX_REDACT_INPUT;
function redactJsonText(text) {
  const t = text.trim();
  if (t.length > MAX_JSON_TEXT || (t[0] !== '{' && t[0] !== '[')) return null;
  try { return JSON.stringify(redactValue(JSON.parse(t))); } catch { return null; }
}

/** Text with passwords, tokens and credentials in URLs, headers and connection strings blanked out. */
function redactString(s) {
  let text = String(s);
  if (text.length > MAX_REDACT_INPUT) text = `${text.slice(0, MAX_REDACT_INPUT)}…(+${text.length - MAX_REDACT_INPUT} chars not shown)`;
  const json = redactJsonText(text);
  if (json !== null) return json;
  return text
    .replace(JSON_QUOTE, JSON_QUOTE_GONE)
    // scheme://user:password@host
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, `$1$2:${REDACTED}@`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g, REDACTED)
    // Password=…; Token=… (connection strings, query strings)
    // (also access_token, refresh_token, id_token and client_secret: `_` is a word character, so a bare `token` misses them)
    .replace(/\b((?:access|refresh|id|auth|client)[-_]?(?:token|secret)|password|pwd|secret|token|api[-_]?key|accountkey|sharedaccesskey)\s*=\s*[^;\s&'"]+/gi, `$1=${REDACTED}`)
    // "password": "…" inside JSON text
    .replace(JSON_SECRET_PAIR, `$1"${REDACTED}"`)
    // Authorization: Basic …  (Bearer is handled above)
    .replace(/\b(authorization\s*:\s*)(?!Bearer)[^\r\n]+/gi, `$1${REDACTED}`);
}

/** A value with secret-looking keys blanked and every string redacted; never mutates the input. */
function redactValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= 6) return '[too deep]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redactValue(v, depth + 1, seen);
  }
  return out;
}

module.exports = { REDACTED, redactString, redactValue };
