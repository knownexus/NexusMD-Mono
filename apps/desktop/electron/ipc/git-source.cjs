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
// Detection results (including "found nothing") by branch tip, so a poll never re-detects the same state,
// and the detection under way for a key, so overlapping polls share it.
const detected = new Map();
const detecting = new Map();
// Default branch names by common dir, for repositories whose refs aren't files (asked of git once).
const defaults = new Map();

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

// A reftable repository keeps its refs where readRefOid can't see them, so git is asked instead.
function isReftable(commonDir, fsx = fs) {
  try { return fsx.existsSync(path.join(commonDir, 'reftable')); } catch { return false; }
}

const outOf = run => async args => { const r = await run(args); return r.code === 0 ? r.stdout.replace(/\r/g, '').trim() : ''; };

// The branch's own copy on a remote (its upstream, or any refs/remotes/<remote>/<same name>) is where it
// was checked out from, never the branch it was cut from.
async function isOwnRemote(run, branch, ref) {
  if (!ref.startsWith('refs/remotes/')) return false;
  const out = outOf(run);
  if (ref === await out(['for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`])) return true;
  return (await out(['remote'])).split('\n').some(remote => remote && ref === `refs/remotes/${remote}/${branch}`);
}

async function defaultBranchOf(run, commonDir, fsx = fs) {
  if (!isReftable(commonDir, fsx)) return defaultBranch(commonDir, fsx);
  if (!defaults.has(commonDir)) {
    const out = outOf(run);
    const m = /^refs\/remotes\/origin\/(.+)$/.exec(await out(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']));
    const heads = m ? [] : (await out(['for-each-ref', '--format=%(refname)', 'refs/heads/main', 'refs/heads/master'])).split('\n');
    defaults.set(commonDir, m ? m[1] : ['main', 'master'].find(name => heads.includes(`refs/heads/${name}`)) ?? null);
  }
  return defaults.get(commonDir);
}

async function detectSource(run, branch, commonDir) {
  const self = `refs/heads/${branch}`;
  const out = outOf(run);
  // A ref is a usable source if it is a branch ref other than the branch itself and still resolves.
  const resolve = async name => {
    if (!name) return null;
    // --verify keeps rev-parse from echoing --end-of-options and fails for an unknown name.
    const full = await out(['rev-parse', '--verify', '--quiet', '--symbolic-full-name', '--end-of-options', name]);
    if (!isBranchRef(full) || full === self) return null;
    return (await out(['rev-parse', '--verify', '--quiet', '--end-of-options', `${full}^{commit}`])) ? full : null;
  };
  const accept = async name => { const ref = await resolve(name); return ref && !(await isOwnRemote(run, branch, ref)) ? ref : null; };

  // 1. The branch's own reflog says where it was created from (unless that was just "HEAD").
  const own = (await out(['reflog', 'show', '--format=%gs', self, '--'])).split('\n');
  let fromOwnRemote = false;
  for (let i = own.length - 1; i >= 0; i--) {
    const m = /^branch: Created from (.+)$/.exec(own[i]);
    if (!m) continue;
    // "Created from HEAD" names whatever is checked out now, not where the branch came from.
    const ref = m[1] === 'HEAD' || m[1] === '@' ? null : await resolve(m[1]);
    if (ref && !(fromOwnRemote = await isOwnRemote(run, branch, ref))) return ref;
    break;
  }
  // 2. HEAD's reflog remembers the checkout that first moved onto it. After checking out the branch's own
  // remote branch, "moving from X" only names whatever was checked out before, so it is skipped.
  const headLog = fromOwnRemote ? [] : (await out(['reflog', 'show', '--format=%gs', 'HEAD', '--'])).split('\n');
  for (let i = headLog.length - 1; i >= 0; i--) {
    const m = /^checkout: moving from (\S+) to (.+)$/.exec(headLog[i]);
    if (m && m[2] === branch) { const ref = await accept(m[1]); if (ref) return ref; break; }
  }

  // 3. Otherwise the nearest branch: fewest commits between it and this branch, skipping descendants.
  const def = await defaultBranchOf(run, commonDir);
  const defLocal = def ? `refs/heads/${def}` : null;
  const defRemote = def ? `refs/remotes/origin/${def}` : null;
  const listed = (await out(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', ...(def ? [defRemote] : [])]))
    .split('\n').filter(Boolean).map(l => { const i = l.indexOf(' '); return { oid: l.slice(0, i), ref: l.slice(i + 1) }; });
  const myTip = listed.find(c => c.ref === self)?.oid;
  if (!myTip) return null;
  const scored = [];
  for (const c of listed) {
    if (c.ref === self) continue;
    const r = await run(['rev-list', '--count', `${c.ref}..${self}`]);
    const n = r.code === 0 ? Number(r.stdout.trim()) : NaN;
    // Nothing of this branch missing from a candidate at another commit: the candidate was made from it.
    if (!Number.isFinite(n) || (n === 0 && c.oid !== myTip)) continue;
    scored.push({ ref: c.ref, n });
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

  async function get(branch, { head, count } = {}) {
    if (branch === await defaultBranchOf(run, commonDir, fsx)) return null;
    const self = `refs/heads/${branch}`;
    const tipOid = isReftable(commonDir, fsx) ? null : readRefOid(commonDir, self, fsx);
    // When the refs can't be read from disk a stored ref is trusted as it is, and detection is keyed by the
    // head the poll saw, so a poll never re-detects (or re-writes) while that is unchanged.
    const onDisk = tipOid !== null;
    const valid = ref => isBranchRef(ref) && ref !== self && (!onDisk || readRefOid(commonDir, ref, fsx) !== null);
    let ref = null;
    try { ref = readConfigSource(fsx.readFileSync(path.join(commonDir, 'config'), 'utf8'), branch); } catch { /* no config */ }
    if (!valid(ref)) {
      const key = `${commonDir}\0${branch}\0${onDisk ? tipOid : head ?? null}`;
      if (!detected.has(key) || (detected.get(key) && !valid(detected.get(key)))) {
        if (!detecting.has(key)) {
          detecting.set(key, (async () => {
            const found = await detectSource(run, branch, commonDir);
            detected.set(key, found);
            // A failed write still leaves the answer cached above, so the next poll doesn't detect again.
            if (found) { try { await write(branch, found); } catch { /* retried when the tip or ref changes */ } }
          })().finally(() => detecting.delete(key)));
        }
        await detecting.get(key);
      }
      ref = detected.get(key);
      if (!ref) return null;
    }
    if (!count) return { ref, count: null };
    const oid = onDisk ? readRefOid(commonDir, ref, fsx) : (await outOf(run)(['rev-parse', '--verify', '--quiet', '--end-of-options', ref])) || null;
    const tipRef = head || self;
    const key = `${commonDir}\0${branch}\0${tipRef}\0${oid}`;
    if (!counts.has(key)) {
      const r = await run(['rev-list', '--count', `${ref}..${tipRef}`, '--']);
      // A failed count isn't kept, so the next poll tries again.
      if (r.code !== 0) return { ref, count: null };
      counts.set(key, Number(r.stdout.trim()));
    }
    return { ref, count: counts.get(key) };
  }

  return { get, write };
}

module.exports = { readConfigSource, readRefOid, defaultBranch, defaultBranchOf, isOwnRemote, detectSource, createSourceReader };
