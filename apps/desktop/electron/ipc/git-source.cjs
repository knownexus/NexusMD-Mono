// electron/ipc/git-source.cjs
//
// Every non-default branch has a remembered "source branch": the branch it was cut from, kept in
// `branch.<name>.nexusBase` as a full ref (refs/heads/* or refs/remotes/*). The status poll reads it
// straight from the config file and the ref files, so a stored value costs no git spawn. Detection
// spawns git, but only the first time (or when the stored ref is gone), and the answer is written back.

'use strict';

const fs = require('fs');
const path = require('path');

const KEY = 'nexusBase';
const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const isBranchRef = ref => typeof ref === 'string' && (ref.startsWith('refs/heads/') || ref.startsWith('refs/remotes/'));
const lines = text => String(text).split(/\r?\n/);

// A module-level cache of "commits ahead" counts. The ref's oid is in the key, so it never goes stale.
const counts = new Map();
// Detection results (including "found nothing") by branch tip, so a poll never re-detects the same state.
const detected = new Map();

function readConfigSource(configText, branch) {
  let inBranch = false;
  for (const raw of lines(configText)) {
    const line = raw.trim();
    const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (section) {
      inBranch = section[1].toLowerCase() === 'branch' && section[2] !== undefined && section[2].replace(/\\(.)/g, '$1') === branch;
      continue;
    }
    if (!inBranch) continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
    if (!kv || kv[1].toLowerCase() !== KEY.toLowerCase()) continue;
    const value = kv[2].trim();
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(value);
    const out = quoted ? quoted[1].replace(/\\(.)/g, '$1') : value.replace(/\s+[#;].*$/, '');
    return out || null;
  }
  return null;
}

function readRefOid(commonDir, ref, fsx = fs) {
  if (!ref || ref.split('/').some(part => part === '..')) return null;
  try {
    const loose = String(fsx.readFileSync(path.join(commonDir, ...ref.split('/')), 'utf8')).trim();
    if (OID.test(loose)) return loose;
  } catch { /* not a loose ref */ }
  try {
    for (const line of lines(fsx.readFileSync(path.join(commonDir, 'packed-refs'), 'utf8'))) {
      const m = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (.+)$/.exec(line.trim());
      if (m && m[2] === ref) return m[1];
    }
  } catch { /* no packed-refs */ }
  return null;
}

function defaultBranch(commonDir, fsx = fs) {
  try {
    const m = /^ref:\s*refs\/remotes\/origin\/(\S+)/.exec(String(fsx.readFileSync(path.join(commonDir, 'refs', 'remotes', 'origin', 'HEAD'), 'utf8')).trim());
    if (m) return m[1];
  } catch { /* no origin/HEAD */ }
  for (const name of ['main', 'master']) if (readRefOid(commonDir, `refs/heads/${name}`, fsx)) return name;
  return null;
}

async function detectSource(run, branch, commonDir) {
  const self = `refs/heads/${branch}`;
  const out = async args => { const r = await run(args); return r.code === 0 ? r.stdout.replace(/\r/g, '').trim() : ''; };
  // A ref is a usable source if it is a branch ref other than the branch itself and still resolves.
  const accept = async name => {
    if (!name) return null;
    // --verify keeps rev-parse from echoing --end-of-options and fails for an unknown name.
    const full = await out(['rev-parse', '--verify', '--quiet', '--symbolic-full-name', '--end-of-options', name]);
    if (!isBranchRef(full) || full === self) return null;
    return (await out(['rev-parse', '--verify', '--quiet', '--end-of-options', `${full}^{commit}`])) ? full : null;
  };

  // 1. The branch's own reflog says where it was created from (unless that was just "HEAD").
  const own = (await out(['reflog', 'show', '--format=%gs', self, '--'])).split('\n');
  for (let i = own.length - 1; i >= 0; i--) {
    const m = /^branch: Created from (.+)$/.exec(own[i]);
    // "Created from HEAD" names whatever is checked out now, not where the branch came from.
    if (m) { const ref = m[1] === 'HEAD' || m[1] === '@' ? null : await accept(m[1]); if (ref) return ref; break; }
  }
  // 2. HEAD's reflog remembers the checkout that first moved onto it.
  const headLog = (await out(['reflog', 'show', '--format=%gs', 'HEAD', '--'])).split('\n');
  for (let i = headLog.length - 1; i >= 0; i--) {
    const m = /^checkout: moving from (\S+) to (.+)$/.exec(headLog[i]);
    if (m && m[2] === branch) { const ref = await accept(m[1]); if (ref) return ref; break; }
  }

  // 3. Otherwise the nearest branch: fewest commits between it and this branch, skipping descendants.
  const def = defaultBranch(commonDir);
  const defLocal = def ? `refs/heads/${def}` : null;
  const defRemote = def ? `refs/remotes/origin/${def}` : null;
  const refs = (await out(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', ...(def ? [defRemote] : [])]))
    .split('\n').filter(Boolean).map(l => { const i = l.indexOf(' '); return { oid: l.slice(0, i), ref: l.slice(i + 1) }; })
    .filter(c => c.ref !== self);
  const myTip = await out(['rev-parse', '--verify', '--quiet', '--end-of-options', self]);
  if (!myTip) return null;
  const scored = [];
  for (const c of refs) {
    if (c.oid !== myTip && (await run(['merge-base', '--is-ancestor', self, c.ref])).code === 0) continue;
    const n = Number(await out(['rev-list', '--count', `${c.ref}..${self}`]));
    if (Number.isFinite(n)) scored.push({ ref: c.ref, n });
  }
  const rank = ref => (ref === defLocal ? 0 : ref === defRemote ? 1 : 2);
  scored.sort((a, b) => a.n - b.n || rank(a.ref) - rank(b.ref) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return scored.length ? scored[0].ref : null;
}

function createSourceReader({ run, commonDir, fsx = fs }) {
  const write = async (branch, ref) => {
    const r = await run(['config', '--local', `branch.${branch}.${KEY}`, ref]);
    if (r.code !== 0) throw new Error(`Could not store the source branch of ${branch}`);
  };
  const valid = (branch, ref) => isBranchRef(ref) && ref !== `refs/heads/${branch}` && readRefOid(commonDir, ref, fsx) !== null;

  async function get(branch, { head, count } = {}) {
    if (branch === defaultBranch(commonDir, fsx)) return null;
    let ref = null;
    try { ref = readConfigSource(fsx.readFileSync(path.join(commonDir, 'config'), 'utf8'), branch); } catch { /* no config */ }
    if (!valid(branch, ref)) {
      const key = `${commonDir}\0${branch}\0${readRefOid(commonDir, `refs/heads/${branch}`, fsx)}`;
      if (!detected.has(key) || (detected.get(key) && !valid(branch, detected.get(key)))) {
        const found = await detectSource(run, branch, commonDir);
        detected.set(key, found);
        // A failed write still leaves the answer cached above, so the next poll doesn't detect again.
        if (found) { try { await write(branch, found); } catch { /* retried when the tip or ref changes */ } }
      }
      ref = detected.get(key);
      if (!ref) return null;
    }
    if (!count) return { ref, count: null };
    const oid = readRefOid(commonDir, ref, fsx);
    const tipRef = head || `refs/heads/${branch}`;
    const key = `${commonDir}\0${branch}\0${tipRef}\0${oid}`;
    if (!counts.has(key)) {
      const r = await run(['rev-list', '--count', `${ref}..${tipRef}`, '--']);
      counts.set(key, r.code === 0 ? Number(r.stdout.trim()) : null);
    }
    return { ref, count: counts.get(key) };
  }

  return { get, write };
}

module.exports = { readConfigSource, readRefOid, defaultBranch, detectSource, createSourceReader };
