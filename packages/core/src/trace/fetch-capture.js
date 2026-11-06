// fetch-capture.js — while a recording runs, every network request the page makes is a node in it, with what was sent and what
// came back, under the call that made it. The page gets exactly the response it would have got.
//
// A body over 64 KB, and any binary body, is not kept: it becomes { $cut: 'body', bytes } so the recording says how much
// was there. A response that says it is larger than that is not even read.
import { rendererLog, ignore, ignored } from '../log.js';

const log = rendererLog('core', 'trace-fetch');
const MAX_BODY = 64 * 1024;
const TEXTUAL = /^(?:text\/|application\/(?:json|xml|x-www-form-urlencoded|javascript|graphql)|[^;]*\+(?:json|xml))/i;
const EMIT_LIMITS = { str: MAX_BODY + 1024 };

const headersObject = (headers) => {
  try { return Object.fromEntries(new Headers(headers).entries()); } catch (err) { ignore(log, 'request headers could not be read for the recording', err); return {}; }
};

const cutBody = (bytes) => ({ $cut: 'body', bytes });

function describeBody(body) {
  if (body == null) return undefined;
  if (typeof body === 'string') return body.length > MAX_BODY ? cutBody(body.length) : body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) { const t = body.toString(); return t.length > MAX_BODY ? cutBody(t.length) : t; }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return cutBody(body.size);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return cutBody(body.byteLength);
  return cutBody(null); // a form, a stream: not read
}

function describeRequest(input, init) {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const url = typeof input === 'string' ? input : (typeof URL !== 'undefined' && input instanceof URL) ? input.href : (input?.url ?? String(input));
  const method = String(init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
  const headers = headersObject(init?.headers ?? (isRequest ? input.headers : undefined));
  const body = init?.body !== undefined ? describeBody(init.body) : (isRequest && method !== 'GET' && method !== 'HEAD' ? cutBody(null) : undefined);
  return { method, url, headers, ...(body !== undefined ? { body } : {}) };
}

// Reads a copy of a body up to MAX_READ bytes: to its end (its exact size, and the first MAX_BODY bytes as text if it is small), or, for
// a body that goes on past that (no length given, or a stream), until the limit, then lets go of it. Memory stays bounded either way.
const MAX_READ = 8 * 1024 * 1024;
async function readCapped(copy) {
  const reader = copy.body?.getReader();
  if (!reader) return { bytes: 0, head: new Uint8Array(0) };
  const kept = [];
  let keptBytes = 0;
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (keptBytes <= MAX_BODY) { kept.push(value); keptBytes += value.byteLength; }
    // (Not awaited: cancelling one side of a copied stream only finishes when the page has let go of its side too.)
    if (total > MAX_READ) { reader.cancel().catch(ignored(log, 'giving up on a very long response body')); return { atLeast: total }; }
  }
  const head = new Uint8Array(Math.min(keptBytes, MAX_BODY + 1));
  let at = 0;
  for (const chunk of kept) { if (at >= head.length) break; head.set(chunk.subarray(0, head.length - at), at); at += chunk.byteLength; }
  return { bytes: total, head };
}

async function describeResponse(res) {
  const out = { status: res.status, statusText: res.statusText, responseHeaders: headersObject(res.headers) };
  try {
    const type = res.headers.get('content-type') ?? '';
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY) return { ...out, responseBody: cutBody(declared) };
    if (/text\/event-stream/i.test(type)) return { ...out, responseBody: cutBody(null) }; // a stream with no end: never read
    const read = await readCapped(res.clone());
    if (read.atLeast) return { ...out, responseBody: { $cut: 'body', atLeast: read.atLeast } };
    if (read.bytes > MAX_BODY || (type && !TEXTUAL.test(type))) return { ...out, responseBody: cutBody(read.bytes) };
    return { ...out, responseBody: new TextDecoder().decode(read.head) };
  } catch (err) {
    ignore(log, 'a response body could not be read for the recording (the page still gets it)', err);
    return out;
  }
}

/** @param {{ fetch: Function }} [w]  @returns {() => void} uninstall */
export function installFetchCapture(w = typeof window !== 'undefined' ? window : undefined) {
  const original = w?.fetch;
  if (typeof original !== 'function') return () => {};

  const wrapped = function (...args) {
    const runtime = globalThis.__nxt;
    if (!runtime?.on) return original.apply(w, args);
    const parent = runtime.current();
    const started = performance.now();
    const request = describeRequest(args[0], args[1]);
    return original.apply(w, args).then(
      (res) => {
        const ms = Math.round(performance.now() - started);
        describeResponse(res).then((response) => runtime.emit('net', { ...request, ...response, ms }, parent, EMIT_LIMITS));
        return res;
      },
      (err) => {
        runtime.emit('net', { ...request, error: String(err?.message ?? err), ms: Math.round(performance.now() - started) }, parent, EMIT_LIMITS);
        throw err;
      },
    );
  };
  w.fetch = wrapped;
  return () => { if (w.fetch === wrapped) w.fetch = original; };
}
