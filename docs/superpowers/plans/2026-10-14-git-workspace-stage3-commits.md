# Git Workspace — Stage 3 (Commits browser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse a worktree's (or a branch's) history in the Git Workspace view:
- a graph with refs and unpushed markers;
- literal search by message, author or path;
- all / unpushed / since-base filters;
- commit → files → diff drill-down, with a parent picker for merges.

It stays read-only throughout.

**Architecture:**
- **Main.** `electron/ipc/git.cjs` gains five read operations: `refs`, `log`, `commitDetails`, `commitFiles`, `commitDiff`.
  - Main validates a query object against lists it reads itself (refs, a commit's parents) and builds every argv.
  - No lock; nothing writes.
- **Core.** `@nexusmd/core` gains `history.js`, which holds the parsers and the query builder.
- **Renderer.**
  - The worktree panel gets a `Changes | History` switch.
  - History has a toolbar, a graph list and a commit detail, which reuses stage 2's `DiffPane` read-only.
  - A small session cache and a two-request background queue keep status polling responsive.

**Tech Stack:**
- Electron 43 (CommonJS main);
- React 18 + Vite renderer (ESM);
- `@nexusmd/core` (ESM, no build);
- Vitest 4 + Testing Library (no jest-dom);
- the git CLI (≥ 2.24 for `--end-of-options`).

**Spec:** `docs/superpowers/specs/2026-10-13-git-workspace-design.md`. The **Stage 3 — Commits browser** section is the contract. Before starting, read all of Decisions, "Decisions made during stage 1 implementation", "Amendments made during stage 2 planning" and Stage 3.

**Verified while planning:**
- The argv forms below were run against real git 2.43.
- The `parseLog` / `graphCells` / `parseSearch` code in Task 1 was run against real `git log --graph --decorate=full` output: a merge, a tag, a remote ref and a detached HEAD.

## Global Constraints

- **Branch:** work on `feature/git-workspace-stage3`; Task 1 creates it from `master`. Stage only the paths each task names.
- **Code style** (`WRITING_MODULES.md`):
  - no semicolons in `.js`/`.jsx` ESM; semicolons in `.cjs`;
  - comments only for *why*;
  - JSDoc on exported functions whose parameters aren't obvious.
- **Core boundaries:** `packages/core` never imports from an app. Main can't `require()` core, so main keeps its own copy of the query rules (Task 2). Both copies are tested against the same cases.
- **Module registration** is unchanged: desktop-only (`requiredAdapters: ['git']`, `defaultEnabled: false`), and there is no `git` key in `createNoOpAdapters()`.
- **Git process rules (main):** everything from stages 1–2 still applies:
  - absolute git path, argv arrays, `windowsHide`;
  - `--no-pager -c core.fsmonitor=false`;
  - the env from `gitEnv()` with `GIT_LITERAL_PATHSPECS=1`;
  - 30 000 ms timeout with a tree-kill; at most 6 concurrent processes.
- **History flags:** every stage 3 call also passes `-c log.showSignature=false -c i18n.logOutputEncoding=UTF-8 -c color.ui=never`. Put them in one constant, `HISTORY_CONFIG`, inserted right after the stage 1 `-c` pair.
- **Forbidden in stage 3:** any command that writes (refs, index, working tree, config, objects). Stage 3 also adds no `git:` channel that takes `expected`.
- **Refs and oids** reach git only after `--end-of-options`, and only after matching something main read itself. Search text reaches git only inside a single `--grep=` / `--author=` element, or after `--`.
- **Caps:**
  - log page sizes are multiples of 200, from 200 to 5000;
  - log output 8 MB (`8 * 1024 * 1024`);
  - commit diffs 1 MB (stage 2's `DIFF_CAP`).
- **Exact copy (verbatim):**
  - Timeout: `History took too long - narrow it with a search or a filter.`
  - Missing commit: `This commit no longer exists - refresh.`
  - Gone ref: `That branch no longer exists.`
  - Shallow: `Shallow clone - older history isn't here.`
  - Unborn: `No commits yet.`
  - No remotes: `No remotes`
  - Search placeholder: `words · @author · :path`
- **Test commands** (from `C:\repos\NexusMD-Mono`):
  - core: `npm -w packages/core test -- <filter>`
  - desktop: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- <filter>`
  - full: both without a filter.
- **Commit messages** end with your session's Co-Authored-By attribution line.

**Planning decisions** (Task 8 records them in the spec):
- **Method names:** the adapter methods are `refs`, `log`, `commitDetails`, `commitFiles` and `commitDiff`. `commitDetails` avoids a clash with stage 2's `commit` write.
- **`commitDiff` paths:** `commitDiff` takes `paths` (both names for a rename), like stage 2's hunk operations.
- **The history cwd:**
  - **A worktree:** history uses that worktree's path.
  - **An inactive branch:** history uses the repo's first non-prunable worktree entry, including a bare entry. If there is none, the History tab shows the repo error instead.
- **`refs` caching:** `refs` is read once per History view open and per ⟳. A query naming a ref that's no longer in the list is refused with `That branch no longer exists.`, which tells the view to re-read.
- **`DiffPane` gains two optional props:**
  - `sides`, which overrides `diffSides(change)`;
  - `readOnly`, which hides hunk buttons and words the binary/too-large notices without "Stage or discard".

  Stage 2 callers are unchanged.

## Review Focus

1. **Search text that looks like options or patterns.** For example `--all`, `-n1`, `a.b`, `[x]` and `.*`. These must be matched literally and never become flags. Pinned in Task 2 (argv) and Task 4 (real git).
2. **A ref renamed or deleted between list and query,** or a branch named like an option (`-x`). These must be refused before spawning. Pinned in Task 2.
3. **Merge parents.** A `parent` that isn't one of the commit's own parents must be refused. Parent 2's file list must differ from parent 1's on the fixture merge. Pinned in Tasks 3 and 4.
4. **Status polling starved by history.** At most two history requests may be in flight from the renderer, and a fast scroll through 50 commits must not queue 50 requests. Pinned in Task 5.
5. **A page that moves under the user.** A new commit lands, or HEAD moves. The old rows stay until the new page arrives, and focus stays on the same oid. Pinned in Task 5.

---

## File Structure

**Core (`packages/core/src/modules/git/`)**
- `history.js` (new): `parseRefs`, `parseLog`, `graphCells`, `parseSearch`, `historyQuery`, `HISTORY_STEP`, `HISTORY_MAX`, `defaultBase`, `parseRefList`, `parseCommitDetails`, `parseNameStatus`, `parentLabel`.
- `fixtures/log-merge.txt`, `log-detached.txt`, `log-octopus.txt`, `log-criss-cross.txt`, `name-status-renames.bin` (new): recorded output (Task 1, Step 1).
- `index.js`, `../../index.js`, `../../adapters/index.js` (`IGitAdapter`), `tests/public-api.test.js`: exports.

**Main (`apps/desktop/electron/`)**
- `ipc/git.cjs`: `HISTORY_CONFIG`, `checkQuery`, `logArgs`, the five handlers.
- `ipc/git.test.js`: argv and refusal tests.
- `ipc/git.history.integration.test.js` (new): real git.
- `preload.cjs`: five channels.

**Renderer (`apps/desktop/src/`)**
- `adapters/git.js`: five methods.
- `git-config.js`: `view.panel`.
- `views/git/`:
  - `history-cache.js` (new): LRU maps and the request queue;
  - `use-history.js` (new): refs and pages for one target;
  - `use-commit.js` (new): details, files and a diff for the focused commit, plus prefetch;
  - `history-pane.jsx` (new): toolbar, graph list, keys;
  - `commit-detail.jsx` (new): header, parent picker, files, diff;
  - `diff-pane.jsx`: `sides` and `readOnly` props;
  - `worktree-panel.jsx`: the `Changes | History` switch;
  - `view-git.jsx`: inactive branch rows open History.

---

### Task 1: Branch and core history parsers

**Files:**
- Create: `packages/core/src/modules/git/history.js`, `history.test.js`, the fixtures above
- Modify: `packages/core/src/modules/git/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces (produced):**
- `parseRefs(decoration) → [{ kind: 'head'|'branch'|'remote'|'tag'|'other', name }]`
- `parseLog(text) → [{ graph, commit: null | { oid, parents, author, email, time, refs, subject } }]`. `time` is in ms.
- `graphCells(graph) → [{ ch, lane }]`
- `parseSearch(input) → null | { kind: 'message'|'author'|'path', text }`. It throws a user-facing message on bad input.
- `HISTORY_STEP = 200`, `HISTORY_MAX = 5000`
- `historyQuery({ ref, filter = 'all', base = null, search = null, limit = HISTORY_STEP }) → query`. It throws the same messages main uses.
- `parseRefList(raw) → [{ ref, oid, upstream, head }]`, from the `refs` output.
- `defaultBase(refs, { ref, upstream, originHead }) → ref | null`
- `parseCommitDetails(raw) → { oid, parents, author, authorEmail, authorDate, committer, committerEmail, committerDate, refs, message }`
- `parseNameStatus(raw) → [{ status, path, oldPath }]`. `status` is one letter (`M A D T R C U X`) and `score` is kept for `R`/`C`.
- `parentLabel(details, index) → string`

- [ ] **Step 1: Create the branch and record the fixtures**

```bash
git checkout -b feature/git-workspace-stage3 master
```

Record the fixtures from a throwaway repository in the session scratchpad, with an isolated config so your own aliases and decorations don't leak in:

```bash
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1   # PowerShell: $env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_NOSYSTEM='1'
git init -q -b main --bare remote.git && git init -q -b main w && cd w
git config user.name 'Ana Ñ' && git config user.email ana@example.com
for i in 1 2; do echo $i > f; git add f; git commit -qm "c$i a.b"; done
git remote add origin ../remote.git && git push -q origin HEAD:main && git fetch -q origin
echo 3 > f && git commit -qam 'c3 [x] ünïcode'
git tag v1 HEAD~1 && git checkout -q -b side HEAD~1 && echo s > s && git add s && git commit -qm side
git checkout -q main && git merge -q --no-ff side -m 'Merge side'
F='--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s'
git log --graph --topo-order --decorate=full "$F" --end-of-options HEAD > ../log-merge.txt
git checkout -q --detach HEAD~1 && git log --graph --topo-order --decorate=full --max-count=2 "$F" --end-of-options HEAD > ../log-detached.txt && git checkout -q main
# Octopus: --no-ff, or git fast-forwards to the first branch and the merge has only two parents.
git checkout -q -b o1 main && echo a > o1 && git add o1 && git commit -qm o1
git checkout -q -b o2 main && echo b > o2 && git add o2 && git commit -qm o2
git checkout -q main && git merge -q --no-ff o1 o2 -m octopus && git log --graph --topo-order --decorate=full "$F" --end-of-options HEAD > ../log-octopus.txt
# Criss-cross: two merges in opposite directions.
git checkout -q -b x1 v1 && echo 1 > x && git add x && git commit -qm x1
git checkout -q -b x2 v1 && echo 2 > y && git add y && git commit -qm x2
git merge -q --no-edit x1 && git checkout -q x1 && git merge -q --no-edit x2~1
git log --graph --topo-order --decorate=full "$F" --end-of-options x1 x2 > ../log-criss-cross.txt
git checkout -q x2 && git mv f 'f renamed.txt' && echo z > 'ü z.txt' && git add -A && git commit -qm renames
git diff-tree --no-commit-id -r -z -M --name-status HEAD^ HEAD > ../name-status-renames.bin
```

This script was run while planning (git 2.43): `log-merge.txt` has 7 lines, the octopus commit has 3 parents, and the rename record is `R100 f → f renamed.txt`.

Copy the five files from the scratchpad into `packages/core/src/modules/git/fixtures/`. They are LF-only; check that `.gitattributes` doesn't convert them (`*.bin` must stay binary).

- [ ] **Step 2: Write the failing tests** in `history.test.js`:

| Test | Expect |
|---|---|
| `parseLog(log-merge)` | 7 rows; the 2nd and 5th are connectors (`commit: null`); the merge has 2 parents; the root has 0; refs on the merge are `[head HEAD, branch main]`; `c2` has `[tag v1, remote origin/main]`; `time` is a number in ms |
| `parseLog(log-detached)` | the first commit's refs are exactly `[head HEAD]` |
| `parseLog(log-octopus)` | the octopus commit has 3 parents and its graph starts `*-.`; every commit row's `graph` contains `*` |
| `parseLog(log-criss-cross)` | both merges parse; no row is dropped (count rows = count lines) |
| `parseLog` on a page cut mid-graph (the first 3 lines of log-merge) | 3 rows, no throw |
| `parseLog` with a subject containing `\x1f` | the subject is kept whole |
| `parseRefs` | `HEAD -> refs/heads/a/b` → head + branch `a/b`; `refs/remotes/origin/a` → remote `origin/a`; `tag: refs/tags/v1` → tag; `refs/heads/origin/main` → **branch** `origin/main`; an unknown part → `other` |
| `graphCells('| * ')` | glyphs `│ ● ` with lanes `0 0 1 1`; `*-.` → `●─·` |
| `parseSearch` | `fix bug` → message; `@ Ana` → author `Ana`; `:src/a b.cs` → path; `\@home` → message `@home`; `\:x` → message `:x`; `''` → null; `@` throws `Type a name after @`; `:` throws `Type a path after :`; 201 chars throws; a newline throws |
| `historyQuery` | defaults (`filter: 'all'`, `limit: 200`); `sinceBase` without a base throws `Pick a base to compare with`; a limit of 300 or 5200 throws; a path search with `..` or an absolute path throws `Search paths must be inside the worktree`; an unknown filter throws |
| `parseRefList` + `defaultBase` | uses `originHead`; otherwise `main`, then `master`; never the ref itself; else `null` |
| `parseCommitDetails` | a multi-line message keeps its blank lines; committer ≠ author kept; an empty body |
| `parseNameStatus(name-status-renames.bin)` | `R100` → `{ status: 'R', score: 100, oldPath: 'f', path: 'f renamed.txt' }`; `A ü z.txt` |
| `parentLabel` | `1 (main line) · 1538ae7`, `2 (merged in) · d4fa71e`, `3 · …` for an octopus |

- [ ] **Step 3: Run them and watch them fail**

`npm -w packages/core test -- history`

- [ ] **Step 4: Implement `history.js`**

The parsing core (verified against real output while planning):

```js
// packages/core/src/modules/git/history.js
//
// The commits browser's model: parsing `git log --graph` (records after a \x1e marker, fields split
// by \x1f, refs from --decorate=full so local and remote branches can't be confused), the search
// syntax, and the query object main validates again before building any argv.

const RS = '\x1e'
const US = '\x1f'
export const HISTORY_STEP = 200
export const HISTORY_MAX = 5000
const FILTERS = ['all', 'unpushed', 'sinceBase']

export function parseRefs(decoration) {
  if (!decoration) return []
  return decoration.split(', ').filter(Boolean).flatMap(part => {
    if (part === 'HEAD') return [{ kind: 'head', name: 'HEAD' }]
    if (part.startsWith('HEAD -> ')) return [{ kind: 'head', name: 'HEAD' }, ...parseRefs(part.slice(8))]
    if (part.startsWith('tag: refs/tags/')) return [{ kind: 'tag', name: part.slice(15) }]
    if (part.startsWith('refs/heads/')) return [{ kind: 'branch', name: part.slice(11) }]
    if (part.startsWith('refs/remotes/')) return [{ kind: 'remote', name: part.slice(13) }]
    if (part.startsWith('refs/tags/')) return [{ kind: 'tag', name: part.slice(10) }]
    return [{ kind: 'other', name: part }]
  })
}

export function parseLog(text) {
  const rows = []
  for (const line of String(text ?? '').split('\n')) {
    if (line === '') continue
    const at = line.indexOf(RS)
    if (at < 0) { rows.push({ graph: line.replace(/\s+$/, ''), commit: null }); continue }
    const f = line.slice(at + 1).split(US)
    if (f.length < 7) continue
    const [oid, parents, author, email, time, decoration, ...subject] = f
    rows.push({
      graph: line.slice(0, at).replace(/\s+$/, ''),
      commit: {
        oid, parents: parents ? parents.split(' ') : [], author, email, time: Number(time) * 1000,
        refs: parseRefs(decoration), subject: subject.join(US),
      },
    })
  }
  return rows
}

// git draws two columns per lane.
const GLYPH = { '*': '●', '|': '│', '/': '╱', '\\': '╲', '-': '─', '.': '·' }
export function graphCells(graph) {
  return [...String(graph ?? '')].map((ch, i) => ({ ch: GLYPH[ch] ?? ch, lane: Math.floor(i / 2) }))
}

export function parseSearch(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  let kind = 'message'
  let text = s
  if (s.startsWith('\\@') || s.startsWith('\\:')) text = s.slice(1)
  else if (s[0] === '@') { kind = 'author'; text = s.slice(1).trim() }
  else if (s[0] === ':') { kind = 'path'; text = s.slice(1).trim() }
  if (!text) throw new Error(kind === 'author' ? 'Type a name after @' : 'Type a path after :')
  if (text.length > 200) throw new Error('Search is limited to 200 characters')
  if (/[\0\r\n]/.test(text)) throw new Error('Search must be one line')
  return { kind, text }
}
```

Write the rest from the interfaces and tests:
- `historyQuery` repeats main's checks (Task 2) except the ref list. That needs main's fresh `for-each-ref`.
- `parseRefList` splits the `refs` output on `\0` fields, four per record and newline-separated. `head` is `%(HEAD) === '*'`.
- `parseCommitDetails` splits on `\0`, ten fields; the tenth (`%B`) keeps any `\0`-free text as is.
- `parseNameStatus` reads `-z` records: `R`/`C` take two paths, everything else one.

Export everything from `modules/git/index.js` and `packages/core/src/index.js`, and add the names to `public-api.test.js`. Add the five methods to `IGitAdapter`, with one-line shape comments:

```js
  // Stage 3 (read-only). query = { ref, filter, base, search, limit } (historyQuery)
  refs:          async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.refs not implemented')),
  log:           async (repo, worktreePath, registered, query) => Promise.reject(new Error('IGitAdapter.log not implemented')),
  commitDetails: async (repo, worktreePath, registered, oid) => Promise.reject(new Error('IGitAdapter.commitDetails not implemented')),
  commitFiles:   async (repo, worktreePath, registered, oid, parent) => Promise.reject(new Error('IGitAdapter.commitFiles not implemented')),
  commitDiff:    async (repo, worktreePath, registered, oid, parent, paths) => Promise.reject(new Error('IGitAdapter.commitDiff not implemented')),
```

- [ ] **Step 5: Run the core suite.** All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/git/history.js packages/core/src/modules/git/history.test.js packages/core/src/modules/git/fixtures/log-*.txt packages/core/src/modules/git/fixtures/name-status-renames.bin packages/core/src/modules/git/index.js packages/core/src/index.js packages/core/src/adapters/index.js packages/core/tests/public-api.test.js
git commit -m "feat(git): stage 3 history parsers and query model"
```

---

### Task 2: Main — `refs` and `log`

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs`, `apps/desktop/electron/ipc/git.test.js`
- Modify: `apps/desktop/electron/preload.cjs` (the `git:` block), `apps/desktop/src/adapters/git.js`

**Interfaces:**
- Consumes: `git()`, `requireExactWorktree` (accepts a bare entry; check `requireListed` reads `worktree <path>` for bare entries too, which it does), `requirePaths`, `isInside`.
- Produces:
  - `HISTORY_CONFIG = ['-c', 'log.showSignature=false', '-c', 'i18n.logOutputEncoding=UTF-8', '-c', 'color.ui=never']`. `git()` gains an `extraConfig` option that is inserted after `-c core.fsmonitor=false`.
  - `git:refs(repo, worktreePath, registered) → { refs, originHead, shallow }`.
  - `git:log(repo, worktreePath, registered, query) → { text, tip, unpushed, truncated, limit }`.
  - Internal: `readRefs(wt) → { list: [{ ref, oid }], raw }`, `checkQuery(query, refs, worktreePath) → query`, `logArgs(query) → argv`.

`logArgs` (exact):

```js
const LOG_FORMAT = '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s';
function logArgs(q) {
  const args = ['log', '--graph', '--topo-order', '--decorate=full', `--max-count=${q.limit + 1}`, '--no-color', '--no-ext-diff', '--no-textconv', LOG_FORMAT];
  if (q.search?.kind === 'message') args.push('--fixed-strings', '--regexp-ignore-case', `--grep=${q.search.text}`);
  if (q.search?.kind === 'author') args.push('--fixed-strings', '--regexp-ignore-case', `--author=${q.search.text}`);
  // After --end-of-options every word is a revision, so exclusions go first and the second --not
  // switches exclusion off again before the ref (verified against git 2.43).
  if (q.filter === 'unpushed') args.push('--not', '--remotes', '--not');
  args.push('--end-of-options', q.filter === 'sinceBase' ? `${q.base}..${q.ref}` : q.ref);
  if (q.search?.kind === 'path') args.push('--', q.search.text);
  return args;
}
```

The `log` handler, in order:
1. `requireExactWorktree`.
2. `readRefs` (`for-each-ref --format=%(refname)%00%(objectname) refs/heads/ refs/remotes/`).
3. `checkQuery`. A `ref` other than `HEAD` must be exactly a listed `refs/heads/…`; `base` must be a listed `refs/heads/…` or `refs/remotes/…`. Otherwise throw `That branch no longer exists.`
4. `tip` = `rev-parse --verify --quiet --end-of-options <ref>^{commit}`. Exit ≠ 0 → return `{ text: '', tip: null, unpushed: [], truncated: false, limit }` (unborn).
5. `remotes` = `remote`. No output → `unpushed: null`; otherwise `rev-list --max-count=<limit> --not --remotes --not --end-of-options <ref>`.
6. Run `log` with `logArgs`.
   - A timeout rejects with `History took too long - narrow it with a search or a filter.`
   - Output over 8 MB is cut after the last `\n` before the cap, and `truncated` is set.
   - Otherwise `truncated` = more than `limit` commit lines.
   - When truncated by count, drop everything from the `limit + 1`-th commit line on.

`refs` runs `for-each-ref --format=%(refname)%00%(objectname)%00%(upstream)%00%(HEAD) refs/heads/ refs/remotes/ refs/tags/`, then `symbolic-ref --quiet refs/remotes/origin/HEAD` (exit 1 → `null`), then `rev-parse --is-shallow-repository`.

- [ ] **Step 1: Write the failing tests** (append to `git.test.js`, reusing `setup`/`reads`):

| Test | Expect |
|---|---|
| `log` default query | argv equals `logArgs` for `all`, `--max-count=201`, and `HISTORY_CONFIG` present after the fsmonitor pair |
| `log` unpushed | `… --not --remotes --not --end-of-options HEAD` |
| `log` sinceBase | `--end-of-options refs/remotes/origin/main..HEAD` |
| `log` message search `--all` | the argv has `--grep=--all` as **one** element, and no bare `--all` |
| `log` author search `a.b` | `--fixed-strings --regexp-ignore-case --author=a.b` |
| `log` path search `-x [1].txt` | ends `-- -x [1].txt`; the env has `GIT_LITERAL_PATHSPECS=1` |
| refusals, nothing spawned after the ref read | ref `refs/heads/gone`; ref `-x`; base `refs/tags/v1`; limit 300; limit 5200; search with `\n`; path `../x`; path absolute; filter `weird` |
| unborn | `rev-parse` exit 1 → `tip: null`, no `log` spawned |
| no remotes | `remote` prints nothing → `unpushed: null`, no `rev-list` |
| count truncation | 202 records for limit 200 → `truncated: true`, 200 commit lines kept |
| size truncation | a 9 MB stdout → cut at a line end, `truncated: true` |
| timeout | the hanging `log` child is tree-killed; rejects with the exact timeout copy |
| `refs` | `originHead` null on `symbolic-ref` exit 1; `shallow: true` on `true\n` |
| unregistered repo / not-a-worktree path | throws, nothing spawned (stage 2 behaviour) |

- [ ] **Step 2: Run and watch them fail.** `… npm -w apps/desktop test -- git.test`

- [ ] **Step 3: Implement**, then add the preload channels and adapter methods (same pattern as stage 2):

```js
    refs:          (repo, worktreePath, registered) => ipcRenderer.invoke('git:refs', repo, worktreePath, registered),
    log:           (repo, worktreePath, registered, query) => ipcRenderer.invoke('git:log', repo, worktreePath, registered, query),
    commitDetails: (repo, worktreePath, registered, oid) => ipcRenderer.invoke('git:commitDetails', repo, worktreePath, registered, oid),
    commitFiles:   (repo, worktreePath, registered, oid, parent) => ipcRenderer.invoke('git:commitFiles', repo, worktreePath, registered, oid, parent),
    commitDiff:    (repo, worktreePath, registered, oid, parent, paths) => ipcRenderer.invoke('git:commitDiff', repo, worktreePath, registered, oid, parent, paths),
```

Add these to `preload.test.js`'s channel assertions.

- [ ] **Step 4: Run the desktop suite**, then **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/git.js
git commit -m "feat(git): history refs and log reads with validated queries"
```

---

### Task 3: Main — commit details, files and diffs

**Files:** `git.cjs`, `git.test.js`

**Interfaces (produced):**
- `requireOid(oid)` matches `/^([0-9a-f]{40}|[0-9a-f]{64})$/`.
- `commitParents(wt, oid) → [oid] | null`. It runs `rev-list --parents --max-count=1 --end-of-options <oid>`; `null` when the commit is gone.
- `git:commitDetails(…, oid)` → `{ details }` | `{ missing: true }`.
  1. `rev-parse --verify --quiet --end-of-options <oid>^{commit}`.
  2. `show -s --decorate=full --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B --end-of-options <oid>`.
- `git:commitFiles(…, oid, parent)` → `{ files }` | `{ missing: true }`.
  - `parent` must be `null` with zero parents, or one of `commitParents`. Otherwise throw `Not a parent of that commit`.
  - Root: `diff-tree --no-commit-id --root -r -z -M --name-status --no-ext-diff --no-textconv --end-of-options <oid>`.
  - Otherwise: `diff-tree --no-commit-id -r -z -M --name-status --no-ext-diff --no-textconv --end-of-options <parent> <oid>`.
  - `--no-commit-id` matters for the root: without it, `--root` prints the commit id as an extra first record (seen while planning).
- `git:commitDiff(…, oid, parent, paths)` → `{ text, truncated, binary, size }` | `{ missing: true }`.
  - Same parent rule; `requirePaths` against the worktree root.
  - Root: `show --format= --no-color --no-ext-diff --no-textconv -M -U3 --end-of-options <oid> -- <paths>`.
  - Otherwise: `diff --no-color --no-ext-diff --no-textconv -M -U3 --end-of-options <parent> <oid> -- <paths>`.
  - Stage 2's 1 MB cap and binary regex apply.

- [ ] **Step 1: Failing tests:**
  - exact argv for root and non-root, for each of the three operations;
  - `HISTORY_CONFIG` on each;
  - refusals that spawn nothing past the parent read: oid `HEAD`; oid with uppercase; oid of 39 characters; a parent not in the list; `parent: null` on a non-root commit; a path outside the worktree;
  - `missing: true` when `rev-list` exits 128;
  - the 1 MB cap.
- [ ] **Step 2: Watch them fail. Step 3: Implement. Step 4: Run the desktop suite.**
- [ ] **Step 5: Commit** — `feat(git): commit details, files and diffs for the history`

---

### Task 4: Real-git integration test

**Files:** create `apps/desktop/electron/ipc/git.history.integration.test.js`. Follow `git.writes.integration.test.js` for temp repos, the isolated `GIT_CONFIG_GLOBAL` and skipping when git is missing.

Build the Task 1 fixture repo (a bare remote, three commits with one pushed, a tag, a merge from `side`), plus:
- a `.bare` layout with one branch;
- a repo config with `log.showSignature=true` and `gpg.program` pointing at a script that writes a marker file.

| Test | Expect |
|---|---|
| `all` | the merge, `side`, `c3`, `c2`, `c1` in topo order; refs parsed by core's `parseLog` match the repo |
| `unpushed` | exactly `Merge side`, `side`, `c3`; `unpushed` oids match the same set |
| `sinceBase` with `refs/remotes/origin/main` | equals `git rev-list origin/main..HEAD` |
| message search `[x]` | only `c3 [x] ünïcode` (a regex would match more) |
| message search `a.b` | `c1 a.b`, `c2 a.b` only, not a commit whose subject is `axb` (add one) |
| author search `Ñ` | all commits (unicode name) |
| path search `s` | only `side` and the merge |
| merge files: parent 1 vs parent 2 | parent 1 lists `s` added; parent 2 lists `f` modified |
| commit diff of the root | an all-added diff of `f` |
| `.bare` layout | branch history from the bare entry |
| `log.showSignature=true` in repo config | no gpg marker file afterwards |
| a branch deleted after `refs` | `log` with that ref throws `That branch no longer exists.` |

- [ ] Steps: write → run (`… npm -w apps/desktop test -- git.history.integration`) → fix → commit `test(git): stage 3 history against real repositories`.

---

### Task 5: Renderer history data — cache, queue and hooks

**Files:**
- Create: `apps/desktop/src/views/git/history-cache.js`, `use-history.js`, `use-commit.js` and their tests
- Modify: `apps/desktop/src/git-config.js` (`view.panel`: `'changes' | 'history'`, default `'changes'`; anything else normalises to `'changes'`), plus its test

**Interfaces (produced):**
- `createLru(max) → { get, set, delete, clear, size }`.
- `createQueue(concurrency = 2) → { run(key, fn, { priority }) → Promise, cancelBelow(priority) }`.
  - The same key in flight returns the same promise.
  - `priority: 'focus'` jumps ahead of `'prefetch'`.
  - Moving focus cancels pending (not running) prefetches.
- A module-level `historyCache = { details: createLru(500), files: createLru(500), diffs: createLru(200), pages: createLru(50), queue: createQueue(2) }`, so the cache survives switching worktrees and tabs.
- `useHistory({ adapter, repo, cwd, registered, target, version })`:
  - `target` is `{ ref: 'HEAD' }` or `{ ref: 'refs/heads/x' }`;
  - it returns `{ refs, shallow, originHead, query, setFilter, setBase, setSearch(input), loadMore, rows, unpushed: Set|null, tip, truncated, loading, error, searchError, refresh }`;
  - the page key is `JSON.stringify(query) + tip`;
  - a new `version` (snapshot) whose tree head differs from `tip` re-reads the page and keeps the old `rows` until the answer comes.
- `useCommit({ adapter, repo, cwd, registered, oid, parentIndex, focusedPaths, nextOids })`:
  - it returns `{ details, files, diff, missing, error, loading }`;
  - focus requests go first; after the focused commit loads, it prefetches details and files for `nextOids` (up to 5).

- [ ] **Step 1: Failing tests:**

| Test | Expect |
|---|---|
| queue | never more than 2 `fn` running; a focus request jumps the queue; `cancelBelow('focus')` drops pending prefetches; duplicate keys share a promise |
| 50 rapid focus changes | at most 2 + 1 `commitDetails` calls in flight at once; the last focused oid is the one shown |
| cache | a second focus on the same oid makes no adapter call |
| `setSearch('@')` | `searchError: 'Type a name after @'`, no `log` call |
| `loadMore` | the limit goes 200 → 400; the focused oid is kept |
| new snapshot with the same head | no new `log` call |
| new snapshot with a new head | one new `log` call; old rows stay until it resolves |
| `log` rejects with `That branch no longer exists.` | `refs` is re-read and the error is shown |
| `view.panel` normalising | `'history'` kept; `'x'` → `'changes'` |

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(git): history cache, request queue and hooks`

---

### Task 6: History pane and commit detail

**Files:**
- Create: `apps/desktop/src/views/git/history-pane.jsx`, `commit-detail.jsx` and their tests
- Modify: `apps/desktop/src/views/git/diff-pane.jsx` (`sides`, `readOnly`), `diff-pane.test.jsx`

**Layout and behaviour:** exactly as the spec's **Screens (stage 3)**. Details the spec leaves open:
- **Rows** are a `role="listbox"` of `role="option"` commit rows. Connector rows are `aria-hidden` and not options, so ↑/↓ and screen readers skip them.
- **Lane colours** cycle through 6 CSS variables (`--graph-0` … `--graph-5`), with fallbacks to the existing `--accent`, `--success`, `--warning`, `--danger` and `--text-muted` *(check against gws)*.
- **Ref chips:**
  - `HEAD` is bold;
  - a branch is filled;
  - a remote is outlined;
  - a tag is plain text with a `tag:` prefix (no icon font).
- **Relative dates** use `Intl.RelativeTimeFormat`; the absolute date is in `title`.
- **`↑`** has `aria-label="Not pushed"`.
- **The commit detail's diff** is `<DiffPane change={{ id, area: 'commit', path }} diff={…} sides={{ old: shortId(parent) ?? 'empty', new: shortId(oid), staging: null }} readOnly />`.
- **Copy** uses `navigator.clipboard.writeText` and shows "Copied" for 2 s.

- [ ] **Step 1: Failing tests:**

| File | Tests |
|---|---|
| `history-pane.test.jsx` | renders graph glyphs, ref chips and `↑` from the merge fixture; ↑/↓ skip connector rows; `/` focuses search; Enter in search runs it, Esc clears; a search error shows under the box with no adapter call; `Unpushed` disabled with `No remotes`; `Since` opens the base picker when there's no default; Load more visible only while truncated; shallow and unborn notes |
| `commit-detail.test.jsx` | header fields; parents as buttons that call `onJump(oid)`; a merge shows `Compare with parent` and switching it reloads files; focusing a file loads its diff once; a missing commit shows the exact copy; Copy writes the full oid |
| `diff-pane.test.jsx` (additions) | `sides` overrides the legend; `readOnly` hides hunk buttons and the binary note reads `Binary file (…).` without "Stage or discard" |

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(git): history pane with graph, search, filters and commit drill-down`

---

### Task 7: Wire it into the view

**Files:**
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (`Changes | History` buttons with `aria-pressed`, stored in `view.panel`), `view-git.jsx`
- Modify: their tests (`view-git.test.jsx`, `view-git-actions.test.jsx` if a selector changes)

Behaviour:
- **Selecting a worktree** shows the panel with the stored `view.panel`.
- **Selecting an inactive branch row** shows History for `branch.ref`, using the repo's first non-prunable worktree (bare included) as the cwd. With none, it shows stage 1's `WorktreeDetail` with the repo error.
- **Keyboard:** the stage 2 changes-pane keys (`s`, `u`, `c`) are active only in Changes; History owns `/`, ↑/↓, Enter and Esc.
- **Polling:** the snapshot `version` is passed to `useHistory`, so a moved HEAD re-reads the page.

- [ ] **Step 1: Failing tests:**
  - switching to History sets `view.panel` and survives re-render;
  - an inactive branch row opens History with `ref: 'refs/heads/<name>'`;
  - Changes keys don't fire in History;
  - stage 2 tests still pass unchanged.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(git): Changes | History switch and branch history`

---

### Task 8: Spec amendments and full verification

- [ ] **Step 1:** Append `## Amendments made during stage 3 planning` to the spec with the five planning decisions listed under Global Constraints. Set the status line to `Stage 1 implemented; stage 2 implemented (2026-10-14); stage 3 implemented (<date>).`
- [ ] **Step 2: Full suites**
  - `npm -w packages/core test`: PASS.
  - `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test`: PASS. The Jira test `src/jira-create-form.test.jsx > loads types and fields…` is known to be flaky under full-suite load; if it alone fails, re-run it on its own and report both results.
  - `npm -w apps/desktop run build`: succeeds.
- [ ] **Step 3: Smoke test.** `npm -w apps/desktop run e2e`. In a headless shell, report it as "blocked" (per `WRITING_MODULES.md` and `apps/desktop/.claude/skills/verify`), not passed.
- [ ] **Step 4: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Select a worktree → History | Graph, refs, `↑` on unpushed commits, relative dates |
| 2 | Type `@yourname`, Enter | Only your commits; Esc restores |
| 3 | Type `:` + a file path | Only commits touching it |
| 4 | Unpushed; then Since `origin/main` | The commits `git log origin/main..HEAD` lists |
| 5 | Select a merge → parent 2 | A different file list |
| 6 | Select a file | Read-only diff, legend `− old: <parent>` / `+ new: <commit>` |
| 7 | Commit something in a terminal | Within 10 s the new commit appears at the top; focus doesn't jump |
| 8 | Click an inactive branch row | That branch's history |
| 9 | Load more on a large repo | More rows, graph lanes continuous |
| 10 | Switch back to Changes | Stage 2 works as before |

- [ ] **Step 5: Commit** — `docs(git): record stage 3 planning amendments`
