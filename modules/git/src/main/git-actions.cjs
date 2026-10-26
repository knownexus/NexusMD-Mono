// electron/ipc/git-actions.cjs
//
// Stage 4 of the Git Workspace: branch and sync actions. Every action is previewed first: main reads
// the target's state and returns what will happen, the repository programs that will run, and a
// stamp of that state. `run` recomputes the stamp under the per-repo lock and refuses if anything
// moved. Main builds every argv; options are matched against lists main reads itself, and a final
// check refuses any argv carrying a force flag, whatever built it.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { defaultBranch, isOwnRemote, createSourceReader } = require('./git-source.cjs');

// ':' is git's own "no editor": nothing can wait on an editor. Interactive rebase swaps in the helper.
const WRITE_ENV = { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no' };
// A rebase NexusMD plans writes every message itself, so a line the user starts with '#' is theirs to keep.
const KEEP_HASH_LINES = ['-c', 'commit.cleanup=whitespace'];
const STALE = 'Changed since the preview. Preview again.';
const REJECTED = "The remote has commits you don't have - pull first.";
const PUSHED_RANGE = "Interactive rebase only rewrites commits that haven't been pushed.";
const MERGES_RANGE = 'Interactive rebase only rewrites ranges without merge commits.';
const OID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const PULL_MODES = ['ff', 'rebase', 'merge'];
const REBASE_ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];
const OPERATION_COMMANDS = {
  'Rebase in progress': 'rebase', 'Merge in progress': 'merge', 'Revert in progress': 'revert', 'Cherry-pick in progress': 'cherry-pick',
};
const PLAN_MARKER = 'nexusmd-rebase-plan';
// The full ref name of the base of a rebase NexusMD started, so the conflict view can name it.
const BASE_MARKER = 'nexusmd-rebase-onto';

// Never in a stage 4 argv, whatever options arrive (the design's forbidden list).
const FORBIDDEN_FLAGS = new Set(['--force', '-f', '--force-with-lease', '--force-if-includes', '--delete', '-d', '-D', '--mirror', '--all', '--tags', '--hard']);
const FORBIDDEN_COMMANDS = new Set(['reset', 'clean']);

const RESET_MODES = ['soft', 'mixed', 'hard'];

// The one exception to the forbidden list: the reset kind's own argv, and nothing else shaped like it.
// It never goes through assertSafeArgv; this checks its exact form instead.
// There is no --end-of-options: git's reset rejects it (as of 2.43). The oid is checked to be hex, so it cannot be an option.
function assertResetArgv(args) {
  const [cmd, mode, oid, ...rest] = args;
  if (cmd !== 'reset' || !RESET_MODES.some(m => mode === `--${m}`) || !isOid(oid) || rest.length) throw new Error('Refusing git reset');
  return args;
}

function assertSafeArgv(args) {
  if (FORBIDDEN_COMMANDS.has(args[0])) throw new Error(`Refusing git ${args[0]}`);
  for (const a of args) {
    const flag = a.split('=')[0];
    // `fetch --all` is the one allowed use of --all: it names every remote, it pushes nothing.
    if (FORBIDDEN_FLAGS.has(flag) && !(args[0] === 'fetch' && a === '--all')) throw new Error(`Refusing ${a} in git ${args[0]}`);
    if (args[0] === 'push' && a.startsWith('+')) throw new Error('Refusing a forced refspec');
    if (/safe\.directory/i.test(a)) throw new Error('Refusing to change safe.directory');
  }
  return args;
}

const ownershipMessage = p => `Git refuses this repository because another user owns its folder. If you trust it, run git config --global --add safe.directory ${p} yourself.`;
const networkMessage = remote => `git timed out talking to ${remote} - a credential or SSH prompt may be waiting. Run git fetch once in a terminal to set it up.`;
const sha = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
const short = ref => ref.replace(/^refs\/(heads|remotes)\//, '');
const refLabel = ref => ref.replace(/^refs\/(heads|remotes|tags)\//, '');
const isOid = v => typeof v === 'string' && OID.test(v);

// The same rules as core's checkBranchName, then git's own check-ref-format runs too.
function branchNameProblem(n) {
  if (typeof n !== 'string' || !n) return 'Give the branch a name.';
  if (n === '@' || n === 'HEAD') return `'${n}' isn't a branch name.`;
  if (n.startsWith('-') || n.startsWith('/')) return "A branch name can't start with - or /.";
  if (n.endsWith('/') || n.endsWith('.') || n.endsWith('.lock')) return "A branch name can't end with /, . or .lock.";
  if (n.includes('..') || n.includes('@{') || n.includes('//')) return "A branch name can't contain .., @{ or //.";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(n)) return "A branch name can't contain spaces or any of ~ ^ : ? * [ \\.";
  if (n.split('/').some(p => p.startsWith('.') || p.endsWith('.lock'))) return 'No part of a branch name can start with a dot or end with .lock.';
  return null;
}

// Mirrors core's rebaseTodo / rebaseMessages (shared fixtures keep them in step).
function rebaseTodo(rows) { return rows.map(r => `${r.action} ${r.oid}\n`).join(''); }
function squashGroups(rows) {
  const groups = [];
  for (const r of rows) {
    if (r.action === 'drop') continue;
    if ((r.action === 'squash' || r.action === 'fixup') && groups.length) groups[groups.length - 1].push(r);
    else groups.push([r]);
  }
  return groups;
}
function rebaseMessages(rows) {
  const out = {};
  for (const g of squashGroups(rows)) {
    const head = g[0];
    const last = g[g.length - 1];
    // git asks for a reworded commit's message before folding anything into it.
    if (head.action === 'reword' && head.message) out[head.oid] = head.message;
    if (g.length === 1) continue;
    const message = last.message || (head.action === 'reword' ? head.message : null);
    if (message) out[last.oid] = message;
  }
  return out;
}
// Rebases run with commit.cleanup=whitespace so a '#' line the user wrote is kept, which also keeps git's
// own '#' template lines whenever the editor is left alone. So every reword, and every group with a
// squash (fixup-only groups keep the first message without asking), must come with a message.
function rebaseMessagesMissing(rows) {
  const messages = rebaseMessages(rows);
  const given = oid => typeof messages[oid] === 'string' && messages[oid].trim() !== '';
  return squashGroups(rows).some(g => (g[0].action === 'reword' && !given(g[0].oid))
    || (g.slice(1).some(r => r.action === 'squash') && !given(g[g.length - 1].oid)));
}

function registerActions(handle, ctx) {
  const { git, requireExactWorktree, withRepoLock, gitDirOf, inProgress, isInside, samePath, isRemoteOrDevicePath, editorCommand, fsx = fs } = ctx;
  // Network and hook-running actions get longer; both are injectable for tests.
  const LONG = ctx.longTimeoutMs ?? 120000;
  const SHORT = ctx.shortTimeoutMs ?? 30000;
  const PROGRAMS_TTL = ctx.programsTtlMs ?? 60000;

  const w = (wt, args, opts = {}) => git(wt, assertSafeArgv(args), { ...opts, env: { ...WRITE_ENV, ...(opts.env || {}) } });
  const read = (wt, args) => git(wt, args);
  const out = r => (r.code === 0 ? r.stdout.trim() : null);

  async function targetState(wt) {
    // Each git process costs about half a second on Windows, so HEAD, the branch and its upstream
    // come from status's own `# branch.*` headers. Only the upstream's commit needs another process.
    const status = await read(wt, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (status.code !== 0) {
      if (/dubious ownership/.test(status.stderr)) throw Object.assign(new Error(ownershipMessage(wt)), { ownership: true });
      throw new Error(status.stderr || 'git status failed');
    }
    const all = status.stdout.split('\0').filter(Boolean);
    const header = key => all.find(r => r.startsWith(`# branch.${key} `))?.slice(`# branch.${key} `.length) ?? null;
    const oid = header('oid');
    const name = header('head');
    const head = oid && oid !== '(initial)' ? oid : null;
    const symbolic = name && name !== '(detached)' ? `refs/heads/${name}` : null;
    const upstream = symbolic ? header('upstream') : null;
    // A gone upstream is still named, but without the ahead/behind line.
    const upstreamOid = upstream && header('ab') ? out(await read(wt, ['rev-parse', '--verify', '--quiet', '@{upstream}'])) : null;
    const { operation } = await inProgress(await gitDirOf(wt));
    const records = all.filter(r => !r.startsWith('# '));
    return {
      head, symbolic, upstream, upstreamOid, operation, status: status.stdout,
      conflicts: records.some(r => r.startsWith('u ')),
      // Untracked files don't stop a rebase or a pull; tracked changes do.
      tracked: records.some(r => r[0] === '1' || r[0] === '2' || r[0] === 'u'),
      dirty: records.length > 0,
    };
  }

  const actionStamp = (state, extra) => sha(state.head ?? '', state.symbolic ?? '', state.upstream ?? '', state.upstreamOid ?? '', state.status, state.operation, extra ?? '');

  // The hooks and config programs a worktree runs, kept for programsTtlMs: reading them takes three
  // git processes, and every preview shows them.
  const programsCache = new Map();
  async function programs(wt) {
    const kept = programsCache.get(wt);
    if (kept && Date.now() - kept.at < PROGRAMS_TTL) return kept.list;
    const list = await readPrograms(wt);
    programsCache.set(wt, { at: Date.now(), list });
    return list;
  }

  async function readPrograms(wt) {
    const list = [];
    const hooksPath = out(await read(wt, ['config', '--get', 'core.hooksPath']));
    const common = out(await read(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const dir = hooksPath ? path.resolve(wt, hooksPath) : common ? path.join(common, 'hooks') : null;
    if (dir) {
      let names = [];
      try { names = fsx.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && !d.name.endsWith('.sample')).map(d => d.name); } catch { /* no hooks folder */ }
      for (const n of names.sort()) list.push(`${n} hook`);
    }
    const cfg = await read(wt, ['config', '--local', '--get-regexp', '^(filter\\..*\\.(clean|smudge|process)|core\\.sshcommand|credential\\..*helper)$']);
    for (const line of cfg.code === 0 ? cfg.stdout.split('\n').filter(Boolean) : []) {
      const key = line.split(' ')[0].toLowerCase();
      const m = /^filter\.(.+)\.(clean|smudge|process)$/.exec(key);
      const name = m ? `filter ${m[1]}` : key === 'core.sshcommand' ? 'core.sshCommand' : 'credential helper';
      if (!list.includes(name)) list.push(name);
    }
    return list;
  }

  async function remotes(wt) {
    const r = await read(wt, ['remote']);
    return r.code === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
  }
  async function refNames(wt, ...prefixes) {
    const r = await read(wt, ['for-each-ref', '--format=%(refname)', ...prefixes]);
    return new Set(r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []);
  }
  async function worktreeEntries(wt) {
    const r = await read(wt, ['worktree', 'list', '--porcelain', '-z']);
    const entries = [];
    let cur = null;
    for (const f of r.stdout.split('\0')) {
      if (f.startsWith('worktree ')) { cur = { path: f.slice(9), branch: null, bare: false, locked: false }; entries.push(cur); }
      else if (cur && f.startsWith('branch ')) cur.branch = f.slice(7);
      else if (cur && f === 'bare') cur.bare = true;
      else if (cur && f.startsWith('locked')) cur.locked = true;
    }
    return entries;
  }
  async function stashList(wt) {
    const r = await read(wt, ['stash', 'list', '--format=%H%x00%gd']);
    return r.code === 0 ? r.stdout.split('\n').filter(Boolean).map(l => { const [oid, name] = l.split('\0'); return { oid, name }; }) : [];
  }
  async function commitExists(wt, oid) {
    return (await read(wt, ['cat-file', '-e', `${oid}^{commit}`])).code === 0;
  }
  async function subjects(wt, range, max = 50) {
    const r = await read(wt, ['log', `--max-count=${max}`, '--format=%h%x00%s', ...range]);
    return r.code === 0 ? r.stdout.split('\n').filter(Boolean).map(l => { const [oid, subject] = l.split('\0'); return { oid, subject }; }) : [];
  }
  const notDuring = state => { if (state.operation) throw new Error(`${state.operation}. Continue or abort it first.`); };
  const branchOf = state => { if (!state.symbolic?.startsWith('refs/heads/')) throw new Error('Check out a branch first (HEAD is detached).'); return short(state.symbolic); };

  async function upstreamRemote(wt, state) {
    if (!state.upstream) throw new Error('No upstream is set for this branch.');
    if (!state.upstreamOid) throw new Error('The upstream branch is gone.');
    const remote = out(await read(wt, ['config', '--get', `branch.${branchOf(state)}.remote`]));
    if (!remote) throw new Error('No upstream is set for this branch.');
    if (remote !== '.' && !(await remotes(wt)).includes(remote)) throw new Error(`Unknown remote ${remote}.`);
    return remote;
  }

  async function newBranch(wt, name) {
    const problem = branchNameProblem(name);
    if (problem) throw new Error(problem);
    if ((await read(wt, ['check-ref-format', '--branch', name])).code !== 0) throw new Error(`git doesn't accept ${name} as a branch name.`);
    if ((await read(wt, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])).code === 0) throw new Error(`A branch named ${name} already exists.`);
  }

  // Each kind: check(wt, options, state, repo) → validated options (throws for anything off),
  // preview(...) → details, extra(...) → stamp extra, steps(options, state) → argv list, timeout.
  const ACTIONS = {
    fetch: {
      timeout: LONG,
      // Nothing local is changed by a fetch, so a commit made since the preview doesn't make it stale.
      stamp: () => 'fetch',
      check: async () => ({}),
      preview: async wt => ({ remotes: await remotes(wt), note: "Updates remote branches, including the ones devenv's branch picker lists." }),
      steps: () => [['fetch', '--all', '--prune']],
      network: () => 'the remotes',
    },
    pull: {
      timeout: LONG,
      check: async (wt, o, state) => {
        const mode = o.mode ?? 'ff';
        if (!PULL_MODES.includes(mode)) throw new Error(`Unknown pull mode: ${mode}`);
        notDuring(state);
        const remote = await upstreamRemote(wt, state);
        if (mode === 'rebase' && state.tracked) throw new Error('Rebase needs a clean worktree - stash first.');
        const counts = out(await read(wt, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])) || '0\t0';
        const [ahead, behind] = counts.split(/\s+/).map(Number);
        if (mode === 'ff' && ahead > 0 && behind > 0) throw new Error('Your branch and its upstream have both moved on - pull with rebase or merge.');
        return { mode, remote, ahead, behind };
      },
      preview: async (wt, o) => ({ ...o, asOf: 'as of the last fetch', incoming: await subjects(wt, ['HEAD..@{upstream}'], 20) }),
      steps: (o, state) => {
        const fetch = o.remote === '.' ? [] : [['fetch', o.remote]];
        const merge = o.mode === 'rebase' ? ['rebase', '--end-of-options', state.upstream]
          : o.mode === 'merge' ? ['merge', '--no-edit', '--end-of-options', state.upstream]
            : ['merge', '--ff-only', '--end-of-options', state.upstream];
        return [...fetch, merge];
      },
      network: o => o.remote,
      before: async (wt, o, state) => { if (o.mode === 'rebase') await rememberBase(wt, state.upstream); },
    },
    push: {
      timeout: LONG,
      check: async (wt, o, state) => {
        const local = branchOf(state);
        notDuring(state);
        const known = await remotes(wt);
        const remote = o.remote ?? (known.length === 1 ? known[0] : null);
        if (!remote || !known.includes(remote)) throw new Error('Choose a remote to push to.');
        const dest = o.dest ?? local;
        const problem = branchNameProblem(dest);
        if (problem) throw new Error(problem);
        if ((await read(wt, ['check-ref-format', '--branch', dest])).code !== 0) throw new Error(`git doesn't accept ${dest} as a branch name.`);
        const setUpstream = typeof o.setUpstream === 'boolean' ? o.setUpstream : !state.upstream;
        return { local, remote, dest, setUpstream };
      },
      extra: async (wt, o) => out(await read(wt, ['rev-parse', '--verify', '--quiet', `refs/remotes/${o.remote}/${o.dest}`])) ?? 'new',
      preview: async (wt, o) => {
        const tracking = out(await read(wt, ['rev-parse', '--verify', '--quiet', `refs/remotes/${o.remote}/${o.dest}`]));
        const commits = await subjects(wt, tracking ? [`${tracking}..HEAD`] : ['HEAD', '--not', '--remotes']);
        return { ...o, newBranch: !tracking, commits, remotes: await remotes(wt) };
      },
      steps: o => [['push', '--porcelain', ...(o.setUpstream ? ['--set-upstream'] : []), o.remote, `refs/heads/${o.local}:refs/heads/${o.dest}`]],
      network: o => o.remote,
      failure: r => (/\[rejected\]|non-fast-forward|fetch first|\(rejected\)|! refs/.test(`${r.stdout}\n${r.stderr}`) ? REJECTED : null),
    },
    branch: {
      timeout: LONG,
      check: async (wt, o) => {
        await newBranch(wt, o.name);
        const start = o.start ?? 'HEAD';
        const known = await refNames(wt, 'refs/heads/', 'refs/remotes/');
        if (start !== 'HEAD' && !known.has(start) && !(isOid(start) && await commitExists(wt, start))) throw new Error('Choose where the branch starts.');
        return { name: o.name, start, checkout: !!o.checkout, remote: start.startsWith('refs/remotes/') };
      },
      preview: async (wt, o) => o,
      steps: o => [o.checkout
        ? ['switch', ...(o.remote ? ['--track'] : []), '-c', o.name, o.start]
        : ['branch', '--no-track', o.name, o.start]],
      // The new branch's source is the branch it was cut from: the start ref, or else the branch checked out now.
      // Tracking the branch's own remote branch says nothing about where it was cut from, so nothing is recorded.
      after: async (wt, o, state) => {
        const start = /^refs\/(heads|remotes)\//.test(o.start) ? o.start : null;
        const ref = start ?? (state.symbolic?.startsWith('refs/heads/') ? state.symbolic : null);
        if (!ref || ref === `refs/heads/${o.name}`) return;
        if (await isOwnRemote(args => read(wt, args), o.name, ref)) return;
        const dir = await commonDirOf(wt);
        if (!dir || o.name === defaultBranch(dir, fsx)) return;
        await createSourceReader({ run: args => read(wt, args), commonDir: dir, fsx }).write(o.name, ref);
      },
    },
    setSource: {
      timeout: SHORT,
      check: async (wt, o) => {
        const refs = await refNames(wt, 'refs/heads/', 'refs/remotes/');
        const dir = await commonDirOf(wt);
        if (typeof o.branch !== 'string' || !refs.has(`refs/heads/${o.branch}`) || o.branch === defaultBranch(dir, fsx)) throw new Error('Choose a branch other than the default.');
        if (typeof o.ref !== 'string' || !refs.has(o.ref) || o.ref === `refs/heads/${o.branch}`) throw new Error('Choose a different branch as the source.');
        return { branch: o.branch, ref: o.ref };
      },
      preview: async (wt, o) => o,
      steps: o => [['config', '--local', `branch.${o.branch}.nexusBase`, o.ref]],
      stamp: () => 'setSource',
    },
    checkout: {
      timeout: LONG,
      check: async (wt, o, state) => {
        notDuring(state);
        if (o.oid !== undefined) {
          if (!isOid(o.oid) || !(await commitExists(wt, o.oid))) throw new Error('Choose a commit to check out.');
          return { oid: o.oid };
        }
        if (!(await refNames(wt, 'refs/heads/')).has(o.branch)) throw new Error('Choose a branch to check out.');
        const elsewhere = (await worktreeEntries(wt)).find(e => e.branch === o.branch && !samePath(e.path, wt));
        if (elsewhere) throw new Error(`${short(o.branch)} is checked out in ${elsewhere.path}.`);
        return { branch: o.branch };
      },
      preview: async (wt, o, state) => ({ ...o, carriesChanges: state.tracked }),
      steps: o => [o.oid ? ['switch', '--detach', o.oid] : ['switch', short(o.branch)]],
    },
    worktreeAdd: {
      timeout: LONG,
      check: async (wt, o, state, repo) => {
        const refs = await refNames(wt, 'refs/heads/', 'refs/remotes/');
        if (!refs.has(o.ref)) throw new Error('Choose a branch for the new worktree.');
        const target = o.path;
        if (typeof target !== 'string' || !path.isAbsolute(target) || isRemoteOrDevicePath(target)) throw new Error('The worktree folder must be an absolute local path.');
        if (!isInside(target, repo.path) || samePath(target, repo.path)) throw new Error('The worktree folder must be inside the repository folder.');
        if (fsx.existsSync(target)) throw new Error(`${target} already exists.`);
        if (!fsx.existsSync(path.dirname(target))) throw new Error(`${path.dirname(target)} doesn't exist.`);
        const remote = o.ref.startsWith('refs/remotes/');
        const name = remote ? short(o.ref).replace(/^[^/]+\//, '') : short(o.ref);
        const local = refs.has(`refs/heads/${name}`);
        const elsewhere = (await worktreeEntries(wt)).find(e => e.branch === `refs/heads/${name}`);
        if ((local || !remote) && elsewhere) throw new Error(`${name} is already checked out in ${elsewhere.path}.`);
        return { ref: o.ref, path: target, name, remote, reuse: remote && local };
      },
      preview: async (wt, o) => o,
      steps: o => [o.remote && !o.reuse
        ? ['worktree', 'add', '--track', '-b', o.name, o.path, short(o.ref)]
        : ['worktree', 'add', o.path, o.name]],
    },
    worktreeRemove: {
      timeout: SHORT,
      check: async (wt, o) => {
        const entries = await worktreeEntries(wt);
        const i = entries.findIndex(e => typeof o.path === 'string' && samePath(e.path, o.path));
        if (i < 0) throw new Error('Choose a worktree to remove.');
        if (i === 0 || entries[i].bare) throw new Error("The repository's main worktree can't be removed.");
        if (entries[i].locked) throw new Error('That worktree is locked.');
        return { path: entries[i].path, cwd: entries[0].path };
      },
      preview: async (wt, o) => ({ path: o.path, note: 'The folder is removed; its branch is kept.' }),
      steps: o => [['worktree', 'remove', o.path]],
      // The worktree being removed may be the one the user had selected; git runs from the main one.
      cwd: o => o.cwd,
    },
    stashPush: {
      timeout: SHORT,
      check: async (wt, o, state) => {
        if (!state.dirty) throw new Error('Nothing to stash.');
        const message = typeof o.message === 'string' && o.message.trim() ? o.message.trim().replace(/\s*\n\s*/g, ' ').slice(0, 200) : 'NexusMD stash';
        return { message, includeUntracked: !!o.includeUntracked };
      },
      preview: async (wt, o) => o,
      steps: o => [['stash', 'push', ...(o.includeUntracked ? ['--include-untracked'] : []), '-m', o.message]],
    },
    stashApply: stashKind('apply'),
    stashPop: stashKind('pop'),
    stashDrop: stashKind('drop'),
    revert: {
      timeout: LONG,
      check: async (wt, o, state) => {
        notDuring(state);
        if (!isOid(o.oid)) throw new Error('Choose a commit to revert.');
        const r = await read(wt, ['rev-list', '--parents', '--max-count=1', '--end-of-options', o.oid]);
        if (r.code !== 0) throw new Error('That commit no longer exists.');
        const parents = r.stdout.trim().split(' ').slice(1);
        if (parents.length > 1) {
          if (!Number.isInteger(o.parent) || o.parent < 1 || o.parent > parents.length) throw new Error('Choose which parent of the merge to keep.');
          return { oid: o.oid, parent: o.parent };
        }
        return { oid: o.oid, parent: null };
      },
      preview: async (wt, o) => ({ ...o, subject: (await subjects(wt, ['--max-count=1', o.oid], 1))[0]?.subject ?? '' }),
      steps: o => [['revert', '--no-edit', ...(o.parent ? ['-m', String(o.parent)] : []), '--end-of-options', o.oid]],
    },
    cherryPick: {
      timeout: LONG,
      check: async (wt, o, state) => {
        notDuring(state);
        const branch = branchOf(state);
        if (state.tracked) throw new Error('Cherry-pick needs a clean worktree - stash first.');
        if (!isOid(o.oid)) throw new Error('Choose a commit to cherry-pick.');
        const r = await read(wt, ['rev-list', '--parents', '--max-count=1', '--end-of-options', o.oid]);
        if (r.code !== 0) throw new Error('That commit no longer exists.');
        const parents = r.stdout.trim().split(' ').slice(1);
        let parent = null;
        if (parents.length > 1) {
          if (!Number.isInteger(o.parent) || o.parent < 1 || o.parent > parents.length) throw new Error('Choose which parent of the merge to compare with.');
          parent = o.parent;
        }
        if ((await read(wt, ['merge-base', '--is-ancestor', o.oid, 'HEAD'])).code === 0) throw new Error(`${branch} already has that commit.`);
        return { oid: o.oid, parent, base: parents[(parent ?? 1) - 1] ?? null, x: !!o.x, branch };
      },
      extra: async (wt, o) => `${o.oid}\0${o.parent}\0${o.x}`,
      preview: async (wt, o) => {
        const names = r => (r.code === 0 ? r.stdout.split('\0').filter(Boolean) : []);
        const picked = names(await read(wt, o.base
          ? ['diff', '--name-only', '-z', '--no-ext-diff', '--end-of-options', o.base, o.oid]
          : ['diff-tree', '--no-commit-id', '--root', '-r', '-z', '--name-only', '--end-of-options', o.oid]));
        const since = out(await read(wt, ['merge-base', 'HEAD', o.oid]));
        const mine = new Set(since ? names(await read(wt, ['diff', '--name-only', '-z', '--no-ext-diff', '--end-of-options', since, 'HEAD'])) : []);
        return {
          oid: o.oid, parent: o.parent, x: o.x, branch: o.branch,
          subject: (await subjects(wt, ['--max-count=1', o.oid], 1))[0]?.subject ?? '',
          files: picked.length, overlap: picked.filter(f => mine.has(f)),
        };
      },
      steps: o => [['cherry-pick', ...(o.x ? ['-x'] : []), ...(o.parent ? ['-m', String(o.parent)] : []), '--end-of-options', o.oid]],
    },
    reset: {
      timeout: SHORT,
      check: async (wt, o, state) => {
        notDuring(state);
        const branch = branchOf(state);
        const mode = o.mode ?? 'mixed';
        if (!RESET_MODES.includes(mode)) throw new Error(`Unknown reset mode: ${String(mode)}`);
        if (!isOid(o.oid) || !(await commitExists(wt, o.oid))) throw new Error('Choose a commit to reset to.');
        if (o.oid === state.head) throw new Error(`${branch} is already at that commit.`);
        if ((await read(wt, ['merge-base', '--is-ancestor', o.oid, 'HEAD'])).code !== 0) throw new Error(`Reset only moves ${branch} back to one of its own commits.`);
        return { oid: o.oid, mode, branch };
      },
      // A hard reset throws away tracked content, so its stamp covers that content itself: status alone
      // doesn't change when an already-modified file is edited again.
      extra: async (wt, o) => {
        if (o.mode !== 'hard') return `${o.oid}\0${o.mode}`;
        const d = await read(wt, ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--no-color']);
        if (d.code !== 0) throw new Error(d.stderr || 'git diff failed');
        return `${o.oid}\0${o.mode}\0${sha(d.stdout)}`;
      },
      preview: async (wt, o, state) => {
        // The tracked files whose uncommitted changes (staged or not) a hard reset throws away.
        const lost = o.mode === 'hard' && state.tracked
          ? (out(await read(wt, ['diff', 'HEAD', '--name-only', '-z', '--no-ext-diff'])) ?? '').split('\0').filter(Boolean)
          : [];
        const leaves = await subjects(wt, [`${o.oid}..HEAD`]);
        const count = Number(out(await read(wt, ['rev-list', '--count', `${o.oid}..HEAD`])) || 0);
        const unpushed = Number(out(await read(wt, ['rev-list', '--count', `${o.oid}..HEAD`, '--not', '--remotes'])) || 0);
        return {
          ...o, subject: (await subjects(wt, ['--max-count=1', o.oid], 1))[0]?.subject ?? '',
          leaves, count, pushed: count - unpushed, dirty: state.tracked, lost,
        };
      },
      // Not through w(): reset is on the forbidden list for every other kind, so this argv has its own check.
      run: async (wt, o) => finish(wt, await git(wt, assertResetArgv(['reset', `--${o.mode}`, o.oid]), { timeout: SHORT, env: { ...WRITE_ENV } })),
    },
    continue: {
      timeout: LONG,
      check: async (wt, o, state) => {
        const command = OPERATION_COMMANDS[state.operation];
        if (!command) throw new Error('Nothing is in progress.');
        if (state.conflicts) throw new Error('Resolve and stage the conflicted files first.');
        return { command };
      },
      preview: async (wt, o) => o,
      run: async (wt, o) => continueOrAbort(wt, o.command, 'continue'),
    },
    skip: {
      timeout: LONG,
      check: async (wt, o, state) => {
        const command = OPERATION_COMMANDS[state.operation];
        if (!command) throw new Error('Nothing is in progress.');
        if (command === 'merge') throw new Error("A merge can't skip; continue or abort it.");
        return { command };
      },
      preview: async (wt, o) => ({ ...o, note: 'Drops this commit from the result.' }),
      run: async (wt, o) => continueOrAbort(wt, o.command, 'skip'),
    },
    abort: {
      timeout: SHORT,
      check: async (wt, o, state) => {
        const command = OPERATION_COMMANDS[state.operation];
        if (!command) throw new Error('Nothing is in progress.');
        return { command };
      },
      preview: async (wt, o) => ({ ...o, note: 'Undoes everything this operation has done so far.' }),
      run: async (wt, o) => continueOrAbort(wt, o.command, 'abort'),
    },
    rebase: {
      timeout: LONG,
      check: async (wt, o, state) => {
        notDuring(state);
        const branch = branchOf(state);
        if (state.tracked && !o.autostash) throw new Error('Rebase needs a clean worktree - stash first, or tick "Stash my changes".');
        const onto = typeof o.onto === 'string' ? o.onto.trim() : '';
        if (!onto || onto.startsWith('-')) throw new Error('Choose where to rebase onto.');
        const known = await refNames(wt, 'refs/heads/', 'refs/remotes/', 'refs/tags/');
        const oid = out(await read(wt, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${onto}^{commit}`]));
        if (!oid) throw new Error(`${onto} isn't a branch, tag or commit in this repository.`);
        if (onto === `refs/heads/${branch}` || onto === branch) throw new Error(`${branch} can't be rebased onto itself.`);
        const ref = known.has(onto) ? onto : null;
        const remote = ref?.startsWith('refs/remotes/') ? (await remotes(wt)).find(r => ref.startsWith(`refs/remotes/${r}/`)) ?? null : null;
        const fetch = !!o.fetch && !!remote;
        if (!fetch && !(await read(wt, ['rev-list', '--max-count=1', '--end-of-options', `HEAD..${oid}`])).stdout.trim()) {
          throw new Error(`${branch} already contains everything in ${ref ? refLabel(ref) : onto}.`);
        }
        return { onto: ref ?? oid, name: onto, label: ref ? refLabel(ref) : onto, oid, branch, remote, fetch, autostash: !!o.autostash, rebaseMerges: !!o.rebaseMerges };
      },
      extra: async (wt, o) => `${o.oid}\0${o.fetch}\0${o.autostash}\0${o.rebaseMerges}`,
      preview: async (wt, o, state) => {
        const replay = await subjects(wt, [`${o.oid}..HEAD`]);
        // One listing with parents gives both the count and the merges (a line with two or more parents).
        const lines = (out(await read(wt, ['rev-list', '--parents', `${o.oid}..HEAD`])) || '').split('\n').filter(Boolean);
        const count = lines.length;
        const merges = lines.filter(l => l.split(' ').length > 2).length;
        const unpushed = Number(out(await read(wt, ['rev-list', '--count', `${o.oid}..HEAD`, '--not', '--remotes'])) || 0);
        return {
          ...o, replay, count, pushed: count - unpushed, merges, dirty: state.tracked,
          incoming: await subjects(wt, [`HEAD..${o.oid}`], 20), asOf: o.fetch ? 'before fetching' : o.remote ? 'as of the last fetch' : null,
        };
      },
      steps: o => [
        ...(o.fetch ? [['fetch', o.remote]] : []),
        ['rebase', ...(o.autostash ? ['--autostash'] : []), ...(o.rebaseMerges ? ['--rebase-merges'] : []), '--end-of-options', o.onto],
      ],
      network: o => o.remote,
      // A typed branch name is remembered too; a commit names nothing, so rememberBase skips it.
      before: async (wt, o) => { await rememberBase(wt, o.name); },
    },
    rebaseInteractive: {
      timeout: LONG,
      check: async (wt, o, state) => {
        notDuring(state);
        if (state.tracked) throw new Error('Interactive rebase needs a clean worktree - stash first.');
        const refs = await refNames(wt, 'refs/heads/', 'refs/remotes/');
        if (!(isOid(o.base) && await commitExists(wt, o.base)) && !refs.has(o.base)) throw new Error('Choose where the rebase starts.');
        const rows = Array.isArray(o.rows) ? o.rows : [];
        if (rows.some(r => !r || !isOid(r.oid) || !REBASE_ACTIONS.includes(r.action) || (r.message != null && typeof r.message !== 'string'))) throw new Error('Invalid rebase plan.');
        const range = (await read(wt, ['rev-list', '--reverse', '--end-of-options', `${o.base}..HEAD`])).stdout.split('\n').filter(Boolean);
        const planned = rows.map(r => r.oid);
        if (range.length !== planned.length || [...range].sort().join() !== [...planned].sort().join()) throw new Error('The commits changed since the plan was made. Open the rebase again.');
        const unpushed = (await read(wt, ['rev-list', '--not', '--remotes', '--not', '--end-of-options', `${o.base}..HEAD`])).stdout.split('\n').filter(Boolean);
        if (unpushed.length !== range.length) throw new Error(PUSHED_RANGE);
        if ((await read(wt, ['rev-list', '--merges', '--end-of-options', `${o.base}..HEAD`])).stdout.trim()) throw new Error(MERGES_RANGE);
        const kept = rows.filter(r => r.action !== 'drop');
        if (!kept.length) throw new Error('Keep at least one commit.');
        if (kept[0].action === 'squash' || kept[0].action === 'fixup') throw new Error("The first commit can't be squashed or fixed up.");
        if (rebaseMessagesMissing(rows)) throw new Error('Give every reworded or squashed commit a message.');
        return { base: o.base, rows: rows.map(r => ({ oid: r.oid, action: r.action, message: r.message ?? null })), range };
      },
      extra: async (wt, o) => o.range.join(','),
      preview: async (wt, o) => ({ base: o.base, count: o.rows.length, todo: rebaseTodo(o.rows) }),
      run: async (wt, o) => runRebase(wt, o),
    },
  };

  function stashKind(verb) {
    return {
      timeout: SHORT,
      check: async (wt, o) => {
        const list = await stashList(wt);
        const entry = list.find(e => e.oid === o.oid);
        if (!isOid(o.oid) || !entry) throw new Error('That stash no longer exists.');
        return { oid: o.oid, index: !!o.index };
      },
      extra: async (wt, o) => o.oid,
      preview: async (wt, o) => ({ ...o, subject: (await subjects(wt, ['--max-count=1', o.oid], 1))[0]?.subject ?? '' }),
      verb,
    };
  }

  function editorEnv(planFile) {
    const exe = (editorCommand?.exe ?? process.execPath).replace(/\\/g, '/');
    const helper = (editorCommand?.helper ?? path.join(__dirname, 'git-editor.cjs').replace('app.asar', 'app.asar.unpacked')).replace(/\\/g, '/');
    // The variable is set inside the editor command so it reaches the helper but not the repository's hooks.
    const cmd = mode => `ELECTRON_RUN_AS_NODE=1 "${exe}" "${helper}" ${mode}`;
    return { NEXUSMD_REBASE_PLAN: planFile, GIT_SEQUENCE_EDITOR: cmd('sequence'), GIT_EDITOR: cmd('message') };
  }

  async function commonDirOf(wt) {
    return out(await read(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  }

  async function gitDirFile(wt) {
    const dir = await gitDirOf(wt);
    return dir ? path.join(dir, PLAN_MARKER) : null;
  }

  function cleanupPlan(markerFile) {
    try {
      const plan = fsx.readFileSync(markerFile, 'utf8').trim();
      if (plan) fsx.rmSync(plan, { force: true });
    } catch { /* no plan recorded */ }
    try { fsx.rmSync(markerFile, { force: true }); } catch { /* already gone */ }
  }

  // Remembers which branch a rebase started here is rebasing onto; only a ref name is kept (an oid names nothing).
  async function rememberBase(wt, base) {
    if (!base || base.startsWith('-')) return;
    const full = out(await read(wt, ['rev-parse', '--symbolic-full-name', base]));
    const dir = await gitDirOf(wt);
    if (!dir || !full || !/^refs\/(heads|remotes)\//.test(full)) return;
    try { fsx.writeFileSync(path.join(dir, BASE_MARKER), `${full}\n`); } catch { /* the name just won't be shown */ }
  }

  // Shared by continue, abort and skip (through finish): once nothing is in progress the remembered base is stale.
  async function forgetBaseIfIdle(wt) {
    const dir = await gitDirOf(wt);
    const { operation } = await inProgress(dir);
    if (dir && !operation) {
      try { fsx.rmSync(path.join(dir, BASE_MARKER), { force: true }); } catch { /* already gone */ }
      // git-conflicts.cjs's record of resolved files is just as stale.
      try { fsx.rmSync(path.join(dir, 'nexusmd-resolutions.json'), { force: true }); } catch { /* already gone */ }
    }
    return operation;
  }

  async function finish(wt, r) {
    const operation = await forgetBaseIfIdle(wt);
    const detail = [r.stdout.trim(), r.stderr].filter(Boolean).join('\n') || (r.code === 0 ? 'Done' : `git exited with code ${r.code}`);
    if (r.code === 0 && !operation) return { ok: true, detail };
    return { ok: false, detail, ...(operation ? { conflict: true, operation } : {}) };
  }

  async function runRebase(wt, o) {
    const planFile = path.join(os.tmpdir(), `nexusmd-rebase-${crypto.randomBytes(8).toString('hex')}.json`);
    fsx.writeFileSync(planFile, JSON.stringify({ todo: rebaseTodo(o.rows), messages: rebaseMessages(o.rows) }), { mode: 0o600 });
    const marker = await gitDirFile(wt);
    try {
      await rememberBase(wt, o.base);
      const r = await w(wt, [...KEEP_HASH_LINES, 'rebase', '-i', '--end-of-options', o.base], { timeout: LONG, env: editorEnv(planFile) });
      const res = await finish(wt, r);
      // Stopped on a conflict: keep the plan so Continue applies the remaining rewords.
      if (res.conflict && marker) fsx.writeFileSync(marker, planFile);
      else fsx.rmSync(planFile, { force: true });
      return res;
    } catch (e) {
      fsx.rmSync(planFile, { force: true });
      throw e;
    }
  }

  async function continueOrAbort(wt, command, verb) {
    const marker = command === 'rebase' ? await gitDirFile(wt) : null;
    let env = {};
    let config = [];
    if (marker && verb !== 'abort') {
      try {
        const planFile = fsx.readFileSync(marker, 'utf8').trim();
        if (planFile && fsx.existsSync(planFile)) { env = editorEnv(planFile); config = KEEP_HASH_LINES; }
      } catch { /* a rebase NexusMD didn't start */ }
    }
    const r = await w(wt, [...config, command, `--${verb}`], { timeout: verb === 'abort' ? SHORT : LONG, env });
    const res = await finish(wt, r);
    if (marker && (verb === 'abort' || res.ok)) cleanupPlan(marker);
    return res;
  }

  async function runSteps(wt, kind, o, state) {
    const a = ACTIONS[kind];
    const cwd = a.cwd ? a.cwd(o) : wt;
    if (a.verb) return runStash(wt, a.verb, o);
    if (a.run) return a.run(wt, o, state);
    if (a.before) await a.before(wt, o, state);
    const outputs = [];
    for (const args of a.steps(o, state)) {
      let r;
      try {
        r = await w(cwd, args, { timeout: a.timeout });
      } catch (e) {
        if (/timed out/.test(e.message) && a.network) return { ok: false, detail: networkMessage(a.network(o)) };
        throw e;
      }
      outputs.push([r.stdout.trim(), r.stderr].filter(Boolean).join('\n'));
      if (r.code !== 0) {
        const special = a.failure ? a.failure(r) : null;
        if (/dubious ownership/.test(r.stderr)) return { ok: false, detail: ownershipMessage(wt) };
        const res = await finish(cwd, r);
        return special ? { ...res, detail: `${special}\n\n${res.detail}` } : res;
      }
    }
    if (a.before) await forgetBaseIfIdle(wt);
    // The action itself worked, so a source that can't be recorded isn't worth reporting a failure for.
    if (a.after) { try { await a.after(wt, o, state); } catch { /* status detects the source again later */ } }
    return { ok: true, detail: outputs.filter(Boolean).join('\n') || 'Done' };
  }

  async function runStash(wt, verb, o) {
    if (verb === 'drop' || verb === 'pop') {
      // stash@{n} shifts as stashes come and go: resolve it again right before using it.
      const resolveName = async () => (await stashList(wt)).find(e => e.oid === o.oid)?.name ?? null;
      if (verb === 'pop') {
        const applied = await w(wt, ['stash', 'apply', ...(o.index ? ['--index'] : []), o.oid], { timeout: SHORT });
        const res = await finish(wt, applied);
        const conflicted = (await read(wt, ['status', '--porcelain=v2', '-z'])).stdout.split('\0').some(r => r.startsWith('u '));
        if (applied.code !== 0 || conflicted) return { ...res, ok: false, detail: `${res.detail}\nThe stash was kept.` };
        const name = await resolveName();
        if (!name) return { ok: true, detail: `${res.detail}\nThe stash was already gone.` };
        const dropped = await w(wt, ['stash', 'drop', name], { timeout: SHORT });
        return finish(wt, dropped);
      }
      const name = await resolveName();
      if (!name) return { ok: false, detail: 'That stash no longer exists.' };
      return finish(wt, await w(wt, ['stash', 'drop', name], { timeout: SHORT }));
    }
    return finish(wt, await w(wt, ['stash', 'apply', ...(o.index ? ['--index'] : []), o.oid], { timeout: SHORT }));
  }

  const action = kind => {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, kind)) throw new Error(`Unknown action: ${String(kind)}`);
    return ACTIONS[kind];
  };
  const stampOf = async (a, wt, o, state) => (a.stamp ? a.stamp() : actionStamp(state, a.extra ? await a.extra(wt, o, state) : ''));

  handle('git:remotes', async (_e, repo, wt, registered) => {
    await requireExactWorktree(repo, wt, registered);
    return (await read(wt, ['remote', '-v'])).stdout;
  });

  handle('git:stashes', async (_e, repo, wt, registered) => {
    await requireExactWorktree(repo, wt, registered);
    return (await read(wt, ['stash', 'list', '--format=%H%x00%gd%x00%ct%x00%s'])).stdout;
  });

  handle('git:preview', async (_e, repo, wt, registered, kind, options) => {
    const a = await requireExactWorktree(repo, wt, registered, () => action(kind));
    let state;
    try { state = await targetState(wt); } catch (e) { return { eligible: false, reason: e.message, details: null, programs: [], stamp: null }; }
    let o;
    try { o = await a.check(wt, options ?? {}, state, repo); } catch (e) { return { eligible: false, reason: e.message, details: null, programs: [], stamp: null }; }
    return { eligible: true, reason: null, details: a.preview ? await a.preview(wt, o, state) : null, programs: await programs(wt), stamp: await stampOf(a, wt, o, state) };
  });

  handle('git:run', async (_e, repo, wt, registered, kind, options, stamp) => {
    const a = await requireExactWorktree(repo, wt, registered, () => action(kind));
    return withRepoLock(repo, async () => {
      let state;
      try { state = await targetState(wt); } catch (e) { return { ok: false, detail: e.message }; }
      let o;
      try { o = await a.check(wt, options ?? {}, state, repo); } catch (e) { return { ok: false, detail: e.message }; }
      if (await stampOf(a, wt, o, state) !== stamp) return { ok: false, stale: true, detail: STALE };
      return runSteps(wt, kind, o, state);
    });
  });

  return { ACTIONS, targetState, programs, assertSafeArgv };
}

module.exports = {
  registerActions, assertSafeArgv, assertResetArgv, branchNameProblem, rebaseTodo, rebaseMessages,
  WRITE_ENV, BASE_MARKER, STALE, REJECTED, PUSHED_RANGE, MERGES_RANGE, ownershipMessage, networkMessage,
};
