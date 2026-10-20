// electron/ipc/git-conflicts.cjs
//
// Git Workspace conflict resolution, main side: read a conflicted file's three stages and working
// copy, and resolve it (text, one whole side, or deletion) or put the conflict back. Left is git's
// stage 2 and right is stage 3 in every operation (a rebase swaps what they mean; the UI labels
// handle that). Every write carries the stamp of the read and runs under the repository lock.

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { readText, writeAtomic, BOM } = require('./safe-file.cjs');
const { requireWorktreeFile } = require('./git-files.cjs');

const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const STALE = 'Changed since you reviewed it. Refresh and review again.';
const SUBMODULE = 'Submodule changes need to be managed inside the submodule.';
const PATHSPEC_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];
const KINDS = { UU: 'both-modified', AA: 'both-added', DU: 'deleted-by-left', UD: 'deleted-by-right', AU: 'added-by-left', UA: 'added-by-right', DD: 'both-deleted' };

// Same marker lines as hasMarkers in @nexusmd/core (modules/git/conflicts.js); main can't require ESM core.
const hasMarkers = text => String(text ?? '').split('\n').some(l => {
  const b = l.replace(/\r$/, '');
  return /^<<<<<<<( |$)/.test(b) || b === '=======' || /^>>>>>>>( |$)/.test(b);
});

// What readText throws for a file that isn't editable text; any other error (permissions, I/O) is real.
const NOT_TEXT = /too large to edit|isn't a text file|isn't UTF-8 text/;
const RESOLUTIONS = 'nexusmd-resolutions.json';
const refuse = detail => ({ ok: false, detail });

function registerConflicts(handle, { git, requireExactWorktree, requirePaths, withRepoLock, filesState, indexEntries, gitDirOf, result }) {
  const target = (repo, wt, registered, rel) =>
    requireExactWorktree(repo, wt, registered, () => requirePaths(wt, [rel])).then(() => requireWorktreeFile(wt, rel));

  const stagesOf = (entries, rel) => entries.filter(e => e.path === rel && e.stage !== '0');

  // A stage's text, or null when it is absent or not editable text (NUL, over 1 MB, not UTF-8).
  async function blobText(wt, entry) {
    if (!entry) return { text: null, binary: false };
    const r = await git(wt, ['cat-file', 'blob', entry.oid]);
    if (r.code !== 0) throw new Error(r.stderr || 'git cat-file failed');
    const buf = r.raw;
    if (buf.length > MAX_READ_BYTES || buf.subarray(0, 8192).includes(0)) return { text: null, binary: true };
    const bom = buf.subarray(0, 3).equals(BOM);
    try {
      return { text: { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? buf.subarray(3) : buf), bom }, binary: false };
    } catch { return { text: null, binary: true }; }
  }

  handle('git:conflict', async (_e, repo, wt, registered, rel) => {
    const { real } = await target(repo, wt, registered, rel);
    const state = await filesState(wt, [rel]);
    const staged = stagesOf(state.entries, rel);
    if (!staged.length) throw new Error(`Not conflicted any more: ${rel}`);
    // A gitlink's stages are commits, not blobs: say what to do instead of cat-file's error.
    if (staged.some(e => e.mode === '160000')) throw new Error(SUBMODULE);
    const byStage = n => staged.find(e => e.stage === String(n)) || null;
    const [base, left, right] = await Promise.all([1, 2, 3].map(n => blobText(wt, byStage(n))));
    const symlink = staged.some(e => e.mode === '120000');
    let binary = symlink || base.binary || left.binary || right.binary;
    let working = null;
    let missing = false;
    if (!symlink) try {
      const r = await readText(real, rel, { maxBytes: MAX_READ_BYTES });
      if (r.missing) missing = true;
      else working = { text: r.text, bom: r.bom, stamp: r.stamp };
    } catch (e) { if (!NOT_TEXT.test(e.message)) throw e; binary = true; }
    const record = state.records.find(r => r.kind === 'u' && r.path === rel);
    return {
      kind: (record && KINDS[record.xy]) || null,
      binary,
      symlink,
      // No working file to resolve line by line (deleted since the conflict): only whole sides are offered.
      missing,
      stages: binary ? { base: null, left: null, right: null } : { base: base.text, left: left.text, right: right.text },
      working: binary ? null : working,
      stamp: state.stamp,
    };
  });

  // Validate, lock, re-check the reviewed state, then act. `arg` is the resolution, when there is one.
  function conflictWrite(channel, hasArg, act) {
    handle(channel, async (_e, repo, wt, registered, rel, ...rest) => {
      const expected = rest[rest.length - 1];
      const { full, real, realDir } = await target(repo, wt, registered, rel);
      return withRepoLock(repo, async () => {
        const state = await filesState(wt, [rel]);
        if (state.stamp !== expected) return { ok: false, stale: true, detail: STALE };
        return act({ wt, rel, full, real, realDir, state, arg: hasArg ? rest[0] : undefined });
      });
    });
  }

  // What each resolve left in the index, kept in the worktree's git dir so unresolve can tell the file
  // is still exactly as resolved. Cleared when the operation ends (git-actions.cjs).
  async function readRecords(wt) {
    const dir = await gitDirOf(wt);
    if (!dir) return { dir, map: {} };
    try {
      const map = JSON.parse(await fsp.readFile(path.join(dir, RESOLUTIONS), 'utf8'));
      return { dir, map: map && typeof map === 'object' && !Array.isArray(map) ? map : {} };
    } catch { return { dir, map: {} }; }
  }
  async function writeRecords(dir, map) {
    if (!dir) return;
    const file = path.join(dir, RESOLUTIONS);
    if (!Object.keys(map).length) { await fsp.rm(file, { force: true }); return; }
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(map));
    await fsp.rename(tmp, file);
  }
  async function remember(wt, rel) {
    try {
      const [{ dir, map }, entries] = await Promise.all([readRecords(wt), indexEntries(wt)]);
      const e = entries.find(x => x.path === rel && x.stage === '0');
      map[rel] = e ? { oid: e.oid, mode: e.mode } : { deleted: true };
      await writeRecords(dir, map);
    } catch { /* without a record the file just can't be un-resolved */ }
  }
  const done = async (wt, rel, r) => { const out = result(r); if (out.ok) await remember(wt, rel); return out; };

  const add = (wt, rel) => git(wt, ['add', ...PATHSPEC_STDIN], { input: `${rel}\0` });
  const remove = (wt, rel) => git(wt, ['rm', '-f', '--quiet', '--', rel]);

  conflictWrite('git:resolveConflict', true, async ({ wt, rel, real, realDir, state, arg: resolution }) => {
    const staged = stagesOf(state.entries, rel);
    if (!staged.length) return refuse(`Not conflicted any more: ${rel}`);
    if (staged.some(e => e.mode === '160000')) return refuse(SUBMODULE);
    const take = resolution?.take;
    if (take === 'text') {
      if (staged.some(e => e.mode === '120000')) return refuse(`${rel} is a symbolic link; take one side instead.`);
      if (typeof resolution.text !== 'string') return refuse('Nothing to write');
      if (resolution.force !== true && hasMarkers(resolution.text)) return refuse('The text still has conflict markers.');
      const body = Buffer.concat([resolution.bom ? BOM : Buffer.alloc(0), Buffer.from(resolution.text, 'utf8')]);
      if (body.length > MAX_WRITE_BYTES) return refuse(`${rel} is too large to save from here.`);
      await writeAtomic(real, realDir, body, () => new Error(`Not a worktree file: ${rel}`));
      return done(wt, rel, await add(wt, rel));
    }
    if (take === 'delete') return done(wt, rel, await remove(wt, rel));
    if (take === 'left' || take === 'right') {
      // An absent side means that side deleted the file, so taking it deletes it.
      if (!staged.some(e => e.stage === (take === 'left' ? '2' : '3'))) return done(wt, rel, await remove(wt, rel));
      const co = await git(wt, ['checkout', take === 'left' ? '--ours' : '--theirs', '--', rel]);
      if (co.code !== 0) return result(co);
      return done(wt, rel, await add(wt, rel));
    }
    return refuse(`Unknown resolution: ${take}`);
  });

  // Only a file that was resolved here and not touched since: the resolve-undo record brings back the
  // stages (even a missing side), and markers are rebuilt only when both sides exist.
  conflictWrite('git:unresolve', false, async ({ wt, rel, full, state }) => {
    if (state.entries.some(e => e.mode === '160000')) return refuse(SUBMODULE);
    if (stagesOf(state.entries, rel).length) return refuse('Still conflicted — nothing to undo.');
    const undo = await git(wt, ['ls-files', '--resolve-undo', '-z', '--', rel]);
    if (undo.code !== 0) return result(undo);
    if (!undo.stdout.trim()) return refuse(`Nothing to undo for ${rel}.`);
    const { dir, map } = await readRecords(wt);
    const rec = map[rel];
    if (!rec || typeof rec !== 'object') return refuse(`${rel} was resolved outside NexusMD — undo it there.`);
    const changed = refuse(`${rel} has changes since it was resolved.`);
    const zero = state.entries.find(e => e.path === rel && e.stage === '0');
    if (rec.deleted) {
      if (zero || await fsp.lstat(full).then(() => true, () => false)) return changed;
    } else {
      if (!zero || zero.oid !== rec.oid || zero.mode !== rec.mode) return changed;
      if (zero.mode === '120000') {
        if (state.records.some(r => r.path === rel && r.xy !== '.' && r.xy[1] !== '.')) return changed;
      } else {
        const h = await git(wt, ['hash-object', '--', rel]);
        if (h.code !== 0 || h.stdout.trim() !== rec.oid) return changed;
      }
    }
    const back = await git(wt, ['update-index', '--unresolve', '--', rel]);
    if (back.code !== 0) return result(back);
    delete map[rel];
    await writeRecords(dir, map);
    const back2 = stagesOf(await indexEntries(wt), rel);
    const stages = back2.map(e => e.stage);
    if (back2.some(e => e.mode === '120000')) return { ok: true, detail: 'Done' };
    if (stages.includes('2') && stages.includes('3')) return result(await git(wt, ['checkout', '-m', '--', rel]));
    return { ok: true, detail: 'Done' };
  });
}

module.exports = { registerConflicts, hasMarkers };
