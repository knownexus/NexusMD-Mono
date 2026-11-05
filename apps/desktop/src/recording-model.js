// recording-model.js — turns the flat list of events in a recording into the tree the viewer shows (recording-tree.jsx).
//
// The events are what packages/trace/src/runtime.js and the window and main process recorders write (see
// packages/main-kit/src/trace/recorder.cjs): `enter` / `ret` / `err` for calls (an IPC call is a call named ipc:<channel>),
// and `click`, `net`, `log` for the rest, each with the id of the call it happened under. A node is:
//   { id, parent, kind: 'click'|'call'|'ipc'|'net'|'log'|'action', title, start, ms?, args?, value?, error?, failed?,
//     file?, line?, data?, proc, win?, children }

const FN = /^(.*?):(\d+):(\d+):(.*)$/;

/** 120 ms, 1.2 s, 42 s */
export const durationLabel = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);

/** How long after the start of the recording something happened: +0 ms, +520 ms, +1.3 s. */
export function offsetLabel(ts, start) {
  const ms = ts - start;
  return Number.isFinite(ms) ? `+${durationLabel(Math.max(0, ms))}` : '';
}

/** 'path/file.js:12:3:name' -> { file, line, col, name }; anything else is just a name. */
export function parseFn(fn) {
  const m = typeof fn === 'string' ? FN.exec(fn) : null;
  if (!m) return { name: typeof fn === 'string' ? fn : '' };
  return { file: m[1], line: Number(m[2]), col: Number(m[3]), name: m[4] };
}

const hostAndPath = (url) => {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return String(url ?? ''); } // not a URL we can read: show it as it is
};

/** @returns {{ roots: object[], byId: Map<string, object>, unfinished: object[], capped: boolean, capReason: string|null, count: number, start: number|null }} */
export function buildTree(events) {
  const byId = new Map();
  const nodes = [];
  const ends = [];
  let capped = false;
  let capReason = null;

  const add = (e, node) => {
    const full = { id: e.id, parent: e.p ?? null, start: e.t, proc: e.proc, win: e.win, children: [], ...node };
    byId.set(e.id, full);
    nodes.push(full);
  };

  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    switch (e.k) {
      case 'enter': {
        if (typeof e.fn === 'string' && e.fn.startsWith('ipc:')) { add(e, { kind: 'ipc', title: e.fn.slice(4), args: e.a }); break; }
        const f = parseFn(e.fn);
        add(e, { kind: 'call', title: f.name || 'anonymous', args: e.a, file: f.file, line: f.line });
        break;
      }
      case 'click': add(e, { kind: 'click', title: `Clicked ${e.d?.name ?? ''}`.trim(), data: e.d, done: true }); break;
      case 'net': {
        const d = e.d ?? {};
        const failed = !!d.error || (typeof d.status === 'number' && d.status >= 400);
        add(e, { kind: 'net', title: `${d.method ?? 'GET'} ${hostAndPath(d.url)} ${d.error ? 'failed' : (d.status ?? '')}`.trim(), data: d, ms: d.ms, failed, done: true });
        break;
      }
      case 'log': {
        const d = e.d ?? {};
        add(e, { kind: 'log', title: `${d.lvl ?? 'info'}: ${d.msg ?? ''}`, data: d, error: d.err, failed: d.lvl === 'error', done: true });
        break;
      }
      case 'ret': case 'err': ends.push(e); break;
      case 'cap': capped = true; capReason = e.reason ?? null; break;
      default: break; // an event this version does not know is left out, not an error
    }
  }

  for (const e of ends) {
    const node = byId.get(e.id);
    if (!node) continue;
    node.done = true;
    node.ms = e.ms;
    if (e.k === 'ret') node.value = e.v;
    else { node.error = e.e; node.failed = true; }
  }

  const roots = [];
  for (const node of nodes) {
    const parent = node.parent && node.parent !== node.id ? byId.get(node.parent) : null;
    if (parent) parent.children.push(node);
    else {
      if (node.kind === 'call') node.kind = 'action'; // nothing in the recording led to it: a timer, a push from elsewhere
      roots.push(node);
    }
  }
  const byStart = (a, b) => (a.start ?? 0) - (b.start ?? 0);
  roots.sort(byStart);
  for (const node of nodes) if (node.children.length > 1) node.children.sort(byStart);

  return {
    roots, byId, capped, capReason, count: nodes.length,
    unfinished: nodes.filter((n) => (n.kind === 'call' || n.kind === 'ipc' || n.kind === 'action') && !n.done),
    start: nodes.length ? Math.min(...nodes.map((n) => n.start ?? Infinity)) : null,
  };
}

const text = (v) => { try { return v === undefined ? '' : JSON.stringify(v); } catch { return ''; } }; // a value that will not print is not searched

function haystack(n) {
  const err = n.error ? `${n.error.name ?? ''} ${n.error.message ?? ''}` : '';
  return `${n.title} ${n.file ?? ''} ${text(n.args)} ${text(n.value)} ${err} ${text(n.data)}`.toLowerCase();
}

/** The ids of the nodes that match `query`, and of the nodes above them; null for an empty query (everything shows). */
export function searchTree(tree, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return null;
  const shown = new Set();
  for (const node of tree.byId.values()) {
    if (!haystack(node).includes(q)) continue;
    for (let n = node; n && !shown.has(n.id); n = n.parent ? tree.byId.get(n.parent) : null) shown.add(n.id);
  }
  return shown;
}

/** The node that failed first (a call that threw, an error logged, a request that failed), or null. */
export function firstError(tree) {
  let first = null;
  for (const node of tree.byId.values()) if (node.failed && (first === null || (node.start ?? 0) < (first.start ?? 0))) first = node;
  return first;
}
