# Git Workspace — Stage 2 (Changes and diffs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Git Workspace view show each worktree's changed files and their diffs, and stage, unstage, discard, delete untracked files and commit (across several worktrees), always after a review.

**Architecture:**
- **Main process.** `electron/ipc/git.cjs` gains named read operations (`diff`, `stamp`) and write operations (`stage`, `unstage`, `stageHunk`, `unstageHunk`, `discard`, `deleteUntracked`, `commit`).
  - Each write carries the `expected` stamp of what the renderer showed. Main recomputes the stamp under a per-repository lock and refuses the write on a mismatch.
  - The renderer never supplies git arguments or patch text.
- **Core.** `@nexusmd/core` gains three pure modules:
  - `diff.js`: a diff parser, ported from gws `DiffView.Parse`;
  - `selection.js`: the selection model;
  - `review.js`: builds what each review dialog shows.
- **Renderer.** The view becomes three panes:
  - the worktree list;
  - a changes pane with a toolbar;
  - a diff pane with old/new gutters and hunk buttons.

  It adds a review dialog, a typed-confirmation gate and a multi-worktree commit dialog.

**Tech Stack:**
- Electron 43 (CommonJS main);
- React 18 + Vite renderer (ESM);
- `@nexusmd/core` (ESM, no build);
- Vitest 4 + Testing Library (no jest-dom);
- the git CLI.

**Spec:** `docs/superpowers/specs/2026-10-13-git-workspace-design.md`. The **Stage 2 — Changes and diffs** section is the contract. Read Decisions, "Decisions made during stage 1 implementation" and Stage 2 in full before starting.

## Global Constraints

- **Branch and staging:**
  - Work on branch `feature/git-workspace-stage2`; Task 1 creates it from `master`.
  - Never commit unrelated files. Stage only the paths each task names.
- **Code style** (`WRITING_MODULES.md`):
  - no semicolons in `.js`/`.jsx` ESM files; semicolons in `.cjs` files;
  - new files under `apps/desktop/electron/` must be `.cjs`;
  - minimal comments, and only ones that explain *why*;
  - JSDoc on exported functions whose parameters aren't obvious.
- **Core boundaries:** `packages/core` never imports from any app. Core is ESM-only and is consumed as source. Electron main can't `require()` core, so main keeps its own small hunk splitter (Task 5).
- **Module registration:** the module stays desktop-only (`requiredAdapters: ['git']`, `defaultEnabled: false`), and `createNoOpAdapters()` must not gain a `git` key.
- **Git process rules (main):**
  - argv arrays only (never a shell string);
  - `windowsHide: true`;
  - git is spawned by absolute path;
  - every call starts `--no-pager -c core.fsmonitor=false`;
  - the env adds `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` and (new in stage 2) `GIT_LITERAL_PATHSPECS=1`, and removes the inherited `GIT_*` location variables;
  - timeout is 30 000 ms, except `commit`, which gets 120 000 ms; on timeout, `taskkill /PID <pid> /T /F`;
  - at most 6 concurrent git processes.
- **Diff flags:** `diff --no-color --no-ext-diff --no-textconv -M -U3`. Paths always go after `--` or on stdin.
- **Forbidden:** no force flags anywhere, and no command that touches remotes, branches or HEAD (other than `commit`). Stage 4 owns those.
- **Diff cap:** 1 MB (`1024 * 1024` bytes). Larger diffs or untracked files come back truncated, with their size.
- **Exact copy (verbatim):**
  - Stale: `Changed since you reviewed it. Refresh and review again.`
  - Lock hint: `Another git process is using this repo; close it or remove the stale lock.`
  - Commit note: `Each worktree commits separately; if one fails the others are not undone.`
  - Typed words: `DISCARD` and `DELETE`.
- **Change ids:** these are the existing `${area}\0${path}` ids from `parseStatus`. Don't invent new ones.
- **Test commands** (run from `C:\repos\NexusMD-Mono`):
  - core: `npm -w packages/core test -- <path-or-name-filter>`
  - desktop: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- <path-or-name-filter>`
  - full: `npm -w packages/core test` and `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test`
- **Commit messages** end with your session's Co-Authored-By attribution line.

**Deviations from the spec, decided while planning** (Task 12 records them in the spec):
- **Signatures:** every new adapter method takes `(repo, worktreePath, registered, …)`, like stage 1's `status`, rather than `(worktree, registered, …)`. `repo` is `{ name, path }`.
- **`diff` input:** `diff` takes `change = { area, paths }`. Hunk operations take `paths` (an array, so a staged rename can pass both names) rather than `path`.
- **`stamp` operation:** a new read operation, `stamp(repo, worktreePath, registered, request)`. `request` is `{ kind: 'files', paths }` or `{ kind: 'commit' }`. The review dialog uses it to get the `expected` value for whole-file actions and commits.
- **Whole-file stamps** use HEAD + the paths' `ls-files --stage` entries + their `status --porcelain=v2` records, not diff text. This scales to hundreds of files without long argv. The review for whole-file actions lists files, not content.
- **Hunk stamps** are `sha256(fileStamp, diffText)`, the value `diff` returns as `stamp`.
- **Literal pathspecs:** set through the `GIT_LITERAL_PATHSPECS=1` environment variable rather than the `--literal-pathspecs` flag, so stage 1's argv is unchanged.
- **Delete check:** `deleteUntracked`'s "still untracked" check uses the `?` records from `status --porcelain=v2 --untracked-files=all` (the same untracked set as `ls-files --others --exclude-standard`).
- **Hunk scope:** hunk operations need a diff with exactly one file section. Otherwise they are refused ("stage the whole file"), and the UI hides hunk buttons.
- **Diff refresh:** the focused file's diff re-loads whenever a new snapshot arrives (every poll), as well as when the focus changes. Porcelain v2 has no working-tree content hash, so a snapshot can't tell whether an unstaged edit changed. The previous diff stays on screen while it reloads.
- **Signature changes in core:**
  - `fileReview(action, changes, selectedIds)` takes the selection explicitly.
  - `commitTargets(worktrees, selectedTreeId)` takes the scoped worktree list, not the snapshot plus group.
- **Write failures:** results are `{ ok, detail, stale? }`. Refusals and git failures return `ok: false`. Bad paths or an unregistered repo still throw, as in stage 1.

## Review Focus

1. **Odd file names.** A file named `-x [1].txt` next to an untracked `-x 1.txt` → staging, unstaging and discarding touch exactly that file; the `[1]` glob class and the leading dash are taken literally (Task 7 integration test).
2. **Files with CRLF line endings.** Staging a single hunk applies cleanly and leaves the other hunk unstaged (Task 5 unit test for `\r` preservation; Task 7 integration test).
3. **Double-clicking Run or Commit.** The write runs once: buttons disable while a write is in flight (Task 10 and Task 11 UI tests).
4. **A poll arriving while a review dialog is open.** The dialog keeps the file list it opened with; the stamp still guards what runs (Task 10 UI test).
5. **Selected files that vanish on refresh** (e.g. staged in a terminal). They drop out of the selection, toolbar counts update, and no action names them (Task 8 view test).

---

## File Structure

**Core (`packages/core/src/modules/git/`)**
- `diff.js` (new): `parseDiff`, `diffSides`.
- `selection.js` (new):
  - change paths and submodule check: `changePaths`, `isSubmodule`;
  - action rules: `FILE_ACTIONS`, `actionsFor`;
  - list order: `groupChanges`;
  - selection helpers: `toggleSelection`, `rangeSelection`, `pruneSelection`.
- `review.js` (new): `fileReview`, `commitTargets`, `commitReview`, `COMMIT_NOTE`.
- `fixtures/three-hunks.diff` (new): shared with the main-process hunk splitter test.
- `index.js`, `../../index.js`, `../../adapters/index.js` (`IGitAdapter`), `tests/public-api.test.js`: exports.

**Main (`apps/desktop/electron/`)**
- `ipc/git.cjs`:
  - `git()` gains `input`/`timeout` options;
  - new helpers: `requireWorktree`, `requirePaths`, stamps, the lock, `extractHunk`;
  - the new handlers.
- `ipc/git.test.js`: unit tests with injected spawn/probe.
- `ipc/git.writes.integration.test.js` (new): real git.
- `preload.cjs`: the new `git:*` channels.

**Renderer (`apps/desktop/src/`)**
- `adapters/git.js`: the new methods.
- `git-config.js`: `view.split`.
- `views/git/`:
  - `worktree-detail.jsx`: adds `WorktreeHeader`;
  - `changes-pane.jsx` (new): toolbar, grouped list, selection and keys;
  - `use-diff.js` (new): on-demand diff loading;
  - `diff-pane.jsx` (new): legend, gutters, hunk buttons;
  - `worktree-panel.jsx` (new): header strip + changes + divider + diff;
  - `use-git-actions.js` (new): reviews, writes, status line;
  - `review-dialog.jsx` (new);
  - `commit-dialog.jsx` (new);
  - `view-git.jsx`: wires everything in.

---

### Task 1: Branch and core diff parser

**Files:**
- Create: `packages/core/src/modules/git/diff.js`
- Create: `packages/core/src/modules/git/fixtures/three-hunks.diff`
- Test: `packages/core/src/modules/git/diff.test.js`

**Interfaces:**
- Produces:
  - `parseDiff(text: string) → { files: DiffFile[] }`, where:
    - `DiffFile = { oldPath: string|null, newPath: string|null, path: string, status: 'modified'|'added'|'deleted'|'renamed'|'copied', binary: boolean, combined: boolean, meta: string[], hunks: Hunk[] }`;
    - `Hunk = { header: string, oldStart: number, newStart: number, columns: number, lines: Line[] }`;
    - `Line = { kind: 'context'|'add'|'del'|'meta', text: string, oldNo: number|null, newNo: number|null }`.
    - Hunks are numbered by their index in `file.hunks`.
  - `diffSides(change) → { old: string|null, new: string, staging: 'stage'|'unstage'|null } | null`.

- [ ] **Step 1: Create the branch**

```bash
git switch master
git switch -c feature/git-workspace-stage2
```

- [ ] **Step 2: Write the shared fixture**

Create `packages/core/src/modules/git/fixtures/three-hunks.diff` with exactly this content (LF line endings, a trailing newline, and a single space at the start of each context line):

```
diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@ function tail() {
 ten
+ten and a half
 eleven
@@ -20,2 +21,2 @@
-twenty
+TWENTY
 twenty-one
```

- [ ] **Step 3: Write the failing tests**

Create `packages/core/src/modules/git/diff.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseDiff, diffSides } from './diff.js'

const fixture = fs.readFileSync(new URL('./fixtures/three-hunks.diff', import.meta.url), 'utf8')
const lines = (...l) => l.join('\n') + '\n'

describe('parseDiff', () => {
  it('reads hunks with old and new line numbers', () => {
    const { files } = parseDiff(fixture)
    expect(files).toHaveLength(1)
    const f = files[0]
    expect([f.path, f.oldPath, f.newPath, f.status, f.binary, f.combined]).toEqual(['src/app.js', 'src/app.js', 'src/app.js', 'modified', false, false])
    expect(f.hunks.map(h => [h.oldStart, h.newStart])).toEqual([[1, 1], [10, 10], [20, 21]])
    expect(f.hunks[1].header).toBe('@@ -10,2 +10,3 @@ function tail() {')
    expect(f.hunks[0].lines).toEqual([
      { kind: 'context', text: 'one', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'two', oldNo: 2, newNo: null },
      { kind: 'add', text: 'TWO', oldNo: null, newNo: 2 },
      { kind: 'context', text: 'three', oldNo: 3, newNo: 3 },
    ])
    expect(f.hunks[1].lines.map(l => [l.kind, l.oldNo, l.newNo])).toEqual([['context', 10, 10], ['add', null, 11], ['context', 11, 12]])
  })

  it('parses CRLF output the same as LF', () => {
    expect(parseDiff(fixture.replace(/\n/g, '\r\n'))).toEqual(parseDiff(fixture))
  })

  it('reads renames, including the tab git adds after names with spaces', () => {
    const { files } = parseDiff(lines(
      'diff --git a/old name.txt b/new name.txt', 'similarity index 90%', 'rename from old name.txt', 'rename to new name.txt',
      'index 3333333..4444444 100644', '--- a/old name.txt\t', '+++ b/new name.txt\t', '@@ -1 +1 @@', '-hello', '+hello world'))
    expect([files[0].status, files[0].oldPath, files[0].newPath, files[0].path]).toEqual(['renamed', 'old name.txt', 'new name.txt', 'new name.txt'])
    expect(files[0].hunks[0].lines.map(l => l.kind)).toEqual(['del', 'add'])
  })

  it('reads new and deleted files', () => {
    const added = parseDiff(lines('diff --git a/added.txt b/added.txt', 'new file mode 100644', 'index 0000000..5555555',
      '--- /dev/null', '+++ b/added.txt', '@@ -0,0 +1,2 @@', '+first', '+second')).files[0]
    expect([added.status, added.oldPath, added.path]).toEqual(['added', null, 'added.txt'])
    expect(added.hunks[0].lines.map(l => l.newNo)).toEqual([1, 2])
    const gone = parseDiff(lines('diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', 'index 6666666..0000000',
      '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye')).files[0]
    expect([gone.status, gone.newPath, gone.path]).toEqual(['deleted', null, 'gone.txt'])
  })

  it('keeps mode changes as meta lines and takes the path from the diff line', () => {
    const f = parseDiff(lines('diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755')).files[0]
    expect([f.path, f.status, f.meta, f.hunks]).toEqual(['run.sh', 'modified', ['old mode 100644', 'new mode 100755'], []])
  })

  it('marks no-newline notes as meta lines', () => {
    const f = parseDiff(lines('diff --git a/end.txt b/end.txt', 'index 7777777..8888888 100644', '--- a/end.txt', '+++ b/end.txt',
      '@@ -1 +1 @@', '-last', '\\ No newline at end of file', '+last line', '\\ No newline at end of file')).files[0]
    expect(f.hunks[0].lines.map(l => [l.kind, l.text])).toEqual([
      ['del', 'last'], ['meta', 'No newline at end of file'], ['add', 'last line'], ['meta', 'No newline at end of file'],
    ])
  })

  it('flags binary files', () => {
    const f = parseDiff(lines('diff --git a/logo.png b/logo.png', 'index 9999999..aaaaaaa 100644', 'Binary files a/logo.png and b/logo.png differ')).files[0]
    expect([f.path, f.binary, f.hunks]).toEqual(['logo.png', true, []])
  })

  it('unquotes octal-escaped unicode paths', () => {
    const q = '"a/caf\\303\\251 \\"q\\".txt"'
    const f = parseDiff(lines(`diff --git ${q} ${q.replace('a/', 'b/')}`, 'index bbbbbbb..ccccccc 100644',
      `--- ${q}`, `+++ ${q.replace('a/', 'b/')}`, '@@ -1 +1 @@', '-a', '+b')).files[0]
    expect(f.path).toBe('café "q".txt')
  })

  it('reads combined conflict diffs with result line numbers only', () => {
    const f = parseDiff(lines('diff --cc both.txt', 'index ddddddd,eeeeeee..0000000', '--- a/both.txt', '+++ b/both.txt',
      '@@@ -1,1 -1,1 +1,5 @@@', '++<<<<<<< ours', ' +mine', '++=======', '+ theirs', '++>>>>>>> theirs')).files[0]
    expect([f.path, f.combined, f.hunks[0].columns]).toEqual(['both.txt', true, 2])
    expect(f.hunks[0].lines.map(l => [l.kind, l.text, l.oldNo, l.newNo])).toEqual([
      ['add', '<<<<<<< ours', null, 1], ['add', 'mine', null, 2], ['add', '=======', null, 3], ['add', 'theirs', null, 4], ['add', '>>>>>>> theirs', null, 5],
    ])
  })

  it('reads the synthetic diff main builds for untracked files', () => {
    const f = parseDiff(lines('--- /dev/null', '+++ b/notes.md', '@@ -0,0 +1,2 @@', '+one', '+two')).files[0]
    expect([f.path, f.status, f.hunks[0].lines.length]).toEqual(['notes.md', 'added', 2])
  })

  it('returns no files for empty output', () => {
    expect(parseDiff('')).toEqual({ files: [] })
  })
})

describe('diffSides', () => {
  it('labels each side by where the change lives', () => {
    expect(diffSides({ area: 'unstaged' })).toEqual({ old: 'index', new: 'working tree', staging: 'stage' })
    expect(diffSides({ area: 'staged' })).toEqual({ old: 'HEAD', new: 'index', staging: 'unstage' })
    expect(diffSides({ area: 'untracked' })).toEqual({ old: null, new: 'new file', staging: null })
    expect(diffSides({ area: 'conflict' })).toEqual({ old: 'ours', new: 'theirs', staging: null })
    expect(diffSides({ area: 'other' })).toBeNull()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm -w packages/core test -- src/modules/git/diff.test.js`
Expected: FAIL, because `./diff.js` can't be resolved.

- [ ] **Step 5: Implement `diff.js`**

Create `packages/core/src/modules/git/diff.js`:

```js
// Unified diff parsing for the Git Workspace diff viewer. Ported from gws DiffView.Parse:
// one entry per file section, hunks with old/new line numbers, combined (conflict) diffs read-only.
// Hunks are numbered by their order within a file; main's hunk splitter counts the same way.

const HUNK = /^(@@+) -(\d+)(?:,\d+)? (?:-\d+(?:,\d+)? )*\+(\d+)(?:,\d+)? @@+/
const ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }

// git quotes unusual paths C-style, with non-ASCII bytes as octal escapes of their UTF-8 bytes.
function unquote(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const body = s.slice(1, -1)
  const bytes = []
  const encoder = new TextEncoder()
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) {
      const next = body[i + 1]
      if (/[0-7]/.test(next)) { bytes.push(parseInt(body.slice(i + 1, i + 4), 8)); i += 3; continue }
      if (next in ESCAPES) { bytes.push(ESCAPES[next]); i++; continue }
    }
    const cp = body.codePointAt(i)
    if (cp > 0xffff) i++
    bytes.push(...encoder.encode(String.fromCodePoint(cp)))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// git appends a tab to ---/+++ names containing spaces.
function sidePath(raw, prefix) {
  const p = unquote(raw.replace(/\t$/, ''))
  if (p === '/dev/null') return null
  return p.startsWith(prefix) ? p.slice(prefix.length) : p
}

function closingQuote(s) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '"') return i
  }
  return -1
}

// "diff --git a/X b/Y": the only place a mode-only change names its file.
function gitLinePaths(rest) {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest)
    if (end < 0) return [null, null]
    return [sidePath(rest.slice(0, end + 1), 'a/'), sidePath(rest.slice(end + 2), 'b/')]
  }
  if ((rest.length - 5) % 2 === 0) {
    const p = rest.slice(2, 2 + (rest.length - 5) / 2)
    if (rest === `a/${p} b/${p}`) return [p, p]
  }
  const i = rest.indexOf(' b/')
  return i < 0 ? [null, null] : [rest.slice(2, i), rest.slice(i + 3)]
}

function newFile() {
  return { oldPath: null, newPath: null, path: '', status: 'modified', binary: false, combined: false, meta: [], hunks: [] }
}

function readHeader(file, line) {
  if (line.startsWith('new file mode')) file.status = 'added'
  else if (line.startsWith('deleted file mode')) file.status = 'deleted'
  else if (line.startsWith('rename from ')) { file.oldPath = unquote(line.slice(12)); file.status = 'renamed' }
  else if (line.startsWith('rename to ')) file.newPath = unquote(line.slice(10))
  else if (line.startsWith('copy from ')) { file.oldPath = unquote(line.slice(10)); file.status = 'copied' }
  else if (line.startsWith('copy to ')) file.newPath = unquote(line.slice(8))
  else if (line.startsWith('--- ')) {
    if (file.status !== 'renamed' && file.status !== 'copied') file.oldPath = sidePath(line.slice(4), 'a/')
    if (file.oldPath === null && file.status === 'modified') file.status = 'added'
  } else if (line.startsWith('+++ ')) {
    if (file.status !== 'renamed' && file.status !== 'copied') file.newPath = sidePath(line.slice(4), 'b/')
    if (file.newPath === null) file.status = 'deleted'
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true
  else if (line.startsWith('index ') || line.startsWith('similarity index') || line.startsWith('dissimilarity index')) { /* not shown */ }
  else file.meta.push(line)
}

function readLine(file, hunk, line, counters) {
  if (line.startsWith('\\')) {
    hunk.lines.push({ kind: 'meta', text: line.replace(/^\\\s*/, ''), oldNo: null, newNo: null })
    return
  }
  if (file.combined) {
    // One marker column per parent; only the result's line numbers mean anything.
    const marks = line.slice(0, hunk.columns)
    const text = line.slice(hunk.columns)
    if (marks.includes('-')) hunk.lines.push({ kind: 'del', text, oldNo: null, newNo: null })
    else hunk.lines.push({ kind: marks.includes('+') ? 'add' : 'context', text, oldNo: null, newNo: counters.newNo++ })
    return
  }
  const mark = line[0] ?? ' '
  const text = line.slice(1)
  if (mark === '+') hunk.lines.push({ kind: 'add', text, oldNo: null, newNo: counters.newNo++ })
  else if (mark === '-') hunk.lines.push({ kind: 'del', text, oldNo: counters.oldNo++, newNo: null })
  else if (mark === ' ') hunk.lines.push({ kind: 'context', text, oldNo: counters.oldNo++, newNo: counters.newNo++ })
  else hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
}

/** Parses `git diff` output (or main's synthetic untracked diff) into files, hunks and numbered lines. */
export function parseDiff(text) {
  const files = []
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (!source) return { files }
  let file = null
  let hunk = null
  const counters = { oldNo: 0, newNo: 0 }
  for (const line of source.split('\n')) {
    if (line.startsWith('diff --')) {
      file = newFile()
      files.push(file)
      hunk = null
      const combined = /^diff --(cc|combined) /.exec(line)
      if (combined) { file.combined = true; file.oldPath = file.newPath = unquote(line.slice(combined[0].length)) }
      else [file.oldPath, file.newPath] = gitLinePaths(line.slice(11))
      continue
    }
    if (!file) { file = newFile(); files.push(file) }
    const m = HUNK.exec(line)
    if (m && (hunk === null || line.startsWith('@@'))) {
      hunk = { header: line, oldStart: Number(m[2]), newStart: Number(m[3]), columns: m[1].length - 1, lines: [] }
      file.hunks.push(hunk)
      counters.oldNo = hunk.oldStart
      counters.newNo = hunk.newStart
      continue
    }
    if (hunk === null) readHeader(file, line)
    else readLine(file, hunk, line, counters)
  }
  for (const f of files) f.path = f.newPath ?? f.oldPath ?? ''
  return { files }
}

const SIDES = {
  unstaged: { old: 'index', new: 'working tree', staging: 'stage' },
  staged: { old: 'HEAD', new: 'index', staging: 'unstage' },
  untracked: { old: null, new: 'new file', staging: null },
  conflict: { old: 'ours', new: 'theirs', staging: null },
}

/** What the old and new sides of a change's diff are, and which hunk action applies. */
export function diffSides(change) {
  const s = SIDES[change?.area]
  return s ? { ...s } : null
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm -w packages/core test -- src/modules/git/diff.test.js`
Expected: PASS (12 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/git/diff.js packages/core/src/modules/git/diff.test.js packages/core/src/modules/git/fixtures/three-hunks.diff
git commit -m "feat(git): unified diff parser for the changes view"
```

---

### Task 2: Core selection and review models, and exports

**Files:**
- Create: `packages/core/src/modules/git/selection.js`, `packages/core/src/modules/git/review.js`
- Test: `packages/core/src/modules/git/selection.test.js`, `packages/core/src/modules/git/review.test.js`
- Modify: `packages/core/src/modules/git/index.js`, `packages/core/src/index.js:92-99`, `packages/core/src/adapters/index.js:162-175`, `packages/core/tests/public-api.test.js:73-78`

**Interfaces:**
- Consumes:
  - `GIT_AREAS`, `statusCode`, `worktreeId`, `worktreeName` and `branchLabel` from `parse.js`;
  - change objects `{ path, originalPath, xy, area, sub, id }`.
- Produces:
  - `changePaths(change) → string[]`;
  - `isSubmodule(change) → boolean`;
  - `FILE_ACTIONS = ['stage', 'unstage', 'discard', 'delete']`;
  - `actionsFor(changes, selectedIds) → { stage: Change[], unstage: Change[], discard: Change[], delete: Change[] }`;
  - `groupChanges(changes) → [{ area, title, changes }]`, with groups in the order conflict, staged, unstaged, untracked;
  - selection helpers:
    - `toggleSelection(ids, id) → ids`;
    - `rangeSelection(ordered, ids, anchorId, id) → ids`;
    - `pruneSelection(ids, changes) → ids`;
  - `fileReview(action, changes, selectedIds) → { action, title, files: [{ id, code, path, originalPath }], paths: string[], skipped: [{ id, path, reason }], warning: string|null, needsTyping: 'DISCARD'|'DELETE'|null }`;
  - `commitTargets(worktrees, selectedTreeId) → [{ id, tree, title, staged: Change[], unavailable: string|null, ticked: boolean }]`;
  - `commitReview(targets, { message, perTarget }) → { blocks: [{ id, title, files: string[], message }], note, error: string|null }`;
  - `COMMIT_NOTE`;
  - `IGitAdapter` gains `diff`, `stamp`, `stage`, `unstage`, `stageHunk`, `unstageHunk`, `discard`, `deleteUntracked` and `commit`.

- [ ] **Step 1: Write the failing selection tests**

Create `packages/core/src/modules/git/selection.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  changePaths, isSubmodule, FILE_ACTIONS, actionsFor, groupChanges, toggleSelection, rangeSelection, pruneSelection,
} from './selection.js'

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const changes = [
  c('untracked', 'new.txt'),
  c('staged', 'a.txt'),
  c('unstaged', 'a.txt'),
  c('conflict', 'both.txt', { xy: 'UU' }),
  c('unstaged', 'lib', { sub: 'SC..' }),
  c('staged', 'moved.txt', { originalPath: 'was.txt', xy: 'R.' }),
]
const ids = list => list.map(x => x.id)

describe('selection model', () => {
  it('names both paths of a rename', () => {
    expect(changePaths(changes[5])).toEqual(['moved.txt', 'was.txt'])
    expect(changePaths(changes[0])).toEqual(['new.txt'])
  })

  it('recognises submodule entries', () => {
    expect(isSubmodule(changes[4])).toBe(true)
    expect(isSubmodule(changes[2])).toBe(false)
  })

  it('splits a mixed selection by the action each change allows, never including submodules', () => {
    expect(FILE_ACTIONS).toEqual(['stage', 'unstage', 'discard', 'delete'])
    const a = actionsFor(changes, ids(changes))
    expect(ids(a.stage)).toEqual(['untracked\0new.txt', 'unstaged\0a.txt', 'conflict\0both.txt'])
    expect(ids(a.unstage)).toEqual(['staged\0a.txt', 'staged\0moved.txt'])
    expect(ids(a.discard)).toEqual(['unstaged\0a.txt'])
    expect(ids(a.delete)).toEqual(['untracked\0new.txt'])
    expect(actionsFor(changes, [])).toEqual({ stage: [], unstage: [], discard: [], delete: [] })
  })

  it('groups changes as Conflicts, Staged, Changes, Untracked and omits empty groups', () => {
    const groups = groupChanges(changes)
    expect(groups.map(g => [g.area, g.title, g.changes.length])).toEqual([
      ['conflict', 'Conflicts', 1], ['staged', 'Staged', 2], ['unstaged', 'Changes', 2], ['untracked', 'Untracked', 1],
    ])
    expect(groupChanges([changes[0]]).map(g => g.title)).toEqual(['Untracked'])
  })

  it('toggles, ranges and prunes ids', () => {
    expect(toggleSelection(['x'], 'y')).toEqual(['x', 'y'])
    expect(toggleSelection(['x', 'y'], 'x')).toEqual(['y'])
    const ordered = groupChanges(changes).flatMap(g => g.changes)
    expect(rangeSelection(ordered, ['keep'], ordered[1].id, ordered[3].id)).toEqual(['keep', ordered[1].id, ordered[2].id, ordered[3].id])
    expect(rangeSelection(ordered, [], ordered[3].id, ordered[1].id)).toEqual([ordered[1].id, ordered[2].id, ordered[3].id])
    expect(rangeSelection(ordered, [], 'missing', ordered[0].id)).toEqual([ordered[0].id])
    expect(pruneSelection(['untracked\0new.txt', 'gone'], changes)).toEqual(['untracked\0new.txt'])
  })
})
```

- [ ] **Step 2: Write the failing review tests**

Create `packages/core/src/modules/git/review.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { fileReview, commitTargets, commitReview, COMMIT_NOTE } from './review.js'

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: area === 'staged' ? 'M.' : '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const tree = (name, changes, extra = {}) => ({
  repo: 'App', repoRoot: 'C:/repos/App', path: name === 'checkout' ? 'C:/repos/App' : `C:/repos/App/${name}`,
  branch: 'main', rebasingBranch: null, operation: '', error: '', changes, ...extra,
})

describe('fileReview', () => {
  const changes = [c('unstaged', 'a.txt'), c('untracked', 'b.txt'), c('staged', 'moved.txt', { originalPath: 'was.txt', xy: 'R.' }), c('unstaged', 'lib', { sub: 'SC..' })]
  const all = changes.map(x => x.id)

  it('lists the files an action applies to and the ones it skips', () => {
    const r = fileReview('stage', changes, all)
    expect(r.title).toBe('Stage 2 files')
    expect(r.files.map(f => [f.code, f.path])).toEqual([[' M', 'a.txt'], ['??', 'b.txt']])
    expect(r.paths).toEqual(['a.txt', 'b.txt'])
    expect(r.skipped.map(s => [s.path, s.reason])).toEqual([
      ['moved.txt', 'not applicable to stage'], ['lib', 'submodule — manage it inside the submodule'],
    ])
    expect([r.warning, r.needsTyping]).toEqual([null, null])
  })

  it('includes both names of a renamed file in the paths', () => {
    expect(fileReview('unstage', changes, all).paths).toEqual(['moved.txt', 'was.txt'])
    expect(fileReview('unstage', changes, all).title).toBe('Unstage 1 file')
  })

  it('asks for a typed word before destructive actions', () => {
    const discard = fileReview('discard', changes, all)
    expect([discard.title, discard.needsTyping]).toEqual(['Discard changes in 1 file', 'DISCARD'])
    expect(discard.warning).toBe("Unstaged edits in these files will be lost. This can't be undone.")
    const del = fileReview('delete', changes, all)
    expect([del.title, del.needsTyping]).toEqual(['Delete 1 file', 'DELETE'])
    expect(del.warning).toBe("These untracked files will be deleted from disk. This can't be undone.")
  })
})

describe('commit targets and review', () => {
  const worktrees = [
    tree('checkout', [c('staged', 'a.txt'), c('unstaged', 'b.txt')]),
    tree('feature', [c('staged', 'c.txt')], { branch: 'feature' }),
    tree('clean', []),
    tree('merging', [c('staged', 'd.txt')], { operation: 'Merge in progress' }),
    tree('conflicted', [c('staged', 'e.txt'), c('conflict', 'f.txt', { xy: 'UU' })]),
    tree('broken', [c('staged', 'g.txt')], { error: 'boom' }),
  ]

  it('lists worktrees with staged changes, ticking only the selected one and explaining unavailable ones', () => {
    const t = commitTargets(worktrees, 'C:/repos/App')
    expect(t.map(x => [x.title, x.ticked, x.unavailable])).toEqual([
      ['App › checkout → main', true, null],
      ['App › feature → feature', false, null],
      ['App › merging → main', false, 'Merge in progress: continue or abort it first'],
      ['App › conflicted → main', false, 'Resolve conflicts first'],
    ])
    expect(t[0].staged.map(x => x.path)).toEqual(['a.txt'])
    expect(t[0].id).toBe('C:/repos/App')
  })

  it('builds one block per ticked target with the shared or per-target message', () => {
    const targets = commitTargets(worktrees, 'C:/repos/App').map(x => x.title.includes('feature') ? { ...x, ticked: true } : x)
    const shared = commitReview(targets, { message: '  Fix it  ' })
    expect(shared.blocks.map(b => [b.title, b.files, b.message])).toEqual([
      ['App › checkout → main', ['M  a.txt'], 'Fix it'], ['App › feature → feature', ['M  c.txt'], 'Fix it'],
    ])
    expect([shared.note, shared.error]).toEqual([COMMIT_NOTE, null])
    const per = commitReview(targets, { perTarget: { 'C:/repos/App': 'One' } })
    expect(per.blocks.map(b => b.message)).toEqual(['One', ''])
    expect(per.error).toBe('Enter a commit message.')
    expect(commitReview(targets.map(x => ({ ...x, ticked: false })), { message: 'x' }).error).toBe('Choose at least one worktree.')
  })

  it('keeps the exact note text', () => {
    expect(COMMIT_NOTE).toBe('Each worktree commits separately; if one fails the others are not undone.')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm -w packages/core test -- src/modules/git/selection.test.js src/modules/git/review.test.js`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 4: Implement `selection.js`**

Create `packages/core/src/modules/git/selection.js`:

```js
import { GIT_AREAS } from './parse.js'

/** Paths a change touches; a rename names both the new and the original path. */
export function changePaths(change) {
  return change.originalPath ? [change.path, change.originalPath] : [change.path]
}

/** Submodule changes are managed inside the submodule, never staged from here. */
export function isSubmodule(change) {
  return typeof change.sub === 'string' && change.sub.startsWith('S')
}

const APPLIES = {
  // Staging a conflicted file marks it resolved.
  stage: c => c.area === GIT_AREAS.UNSTAGED || c.area === GIT_AREAS.UNTRACKED || c.area === GIT_AREAS.CONFLICT,
  unstage: c => c.area === GIT_AREAS.STAGED,
  discard: c => c.area === GIT_AREAS.UNSTAGED,
  delete: c => c.area === GIT_AREAS.UNTRACKED,
}

export const FILE_ACTIONS = Object.freeze(Object.keys(APPLIES))

/** The selected changes each file action applies to. */
export function actionsFor(changes, selectedIds) {
  const chosen = changes.filter(c => selectedIds.includes(c.id))
  return Object.fromEntries(FILE_ACTIONS.map(a => [a, chosen.filter(c => !isSubmodule(c) && APPLIES[a](c))]))
}

const GROUPS = [
  [GIT_AREAS.CONFLICT, 'Conflicts'], [GIT_AREAS.STAGED, 'Staged'], [GIT_AREAS.UNSTAGED, 'Changes'], [GIT_AREAS.UNTRACKED, 'Untracked'],
]

/** Changes in display order, one group per area; empty groups are left out. */
export function groupChanges(changes) {
  return GROUPS.map(([area, title]) => ({ area, title, changes: changes.filter(c => c.area === area) })).filter(g => g.changes.length)
}

export function toggleSelection(ids, id) {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
}

/** Shift-click: adds every change from the anchor to `id` in display order, keeping the rest. */
export function rangeSelection(ordered, ids, anchorId, id) {
  const a = ordered.findIndex(c => c.id === anchorId)
  const b = ordered.findIndex(c => c.id === id)
  if (a < 0 || b < 0) return toggleSelection(ids, id)
  const [from, to] = a < b ? [a, b] : [b, a]
  const add = ordered.slice(from, to + 1).map(c => c.id).filter(x => !ids.includes(x))
  return [...ids, ...add]
}

/** Drops ids whose change is no longer in the snapshot. */
export function pruneSelection(ids, changes) {
  const live = new Set(changes.map(c => c.id))
  return ids.filter(id => live.has(id))
}
```

- [ ] **Step 5: Implement `review.js`**

Create `packages/core/src/modules/git/review.js`:

```js
import { GIT_AREAS, statusCode, worktreeId, worktreeName, branchLabel } from './parse.js'
import { actionsFor, changePaths, isSubmodule } from './selection.js'

export const COMMIT_NOTE = 'Each worktree commits separately; if one fails the others are not undone.'

const TEXT = {
  stage: { verb: 'Stage', warning: null, needsTyping: null },
  unstage: { verb: 'Unstage', warning: null, needsTyping: null },
  discard: { verb: 'Discard changes in', warning: "Unstaged edits in these files will be lost. This can't be undone.", needsTyping: 'DISCARD' },
  delete: { verb: 'Delete', warning: "These untracked files will be deleted from disk. This can't be undone.", needsTyping: 'DELETE' },
}

const files = n => `${n} file${n === 1 ? '' : 's'}`

/** What the review dialog shows for a file action on the selected changes. */
export function fileReview(action, changes, selectedIds) {
  const applicable = actionsFor(changes, selectedIds)[action]
  const t = TEXT[action]
  return {
    action,
    title: `${t.verb} ${files(applicable.length)}`,
    files: applicable.map(c => ({ id: c.id, code: statusCode(c), path: c.path, originalPath: c.originalPath })),
    paths: [...new Set(applicable.flatMap(changePaths))],
    skipped: changes.filter(c => selectedIds.includes(c.id) && !applicable.includes(c)).map(c => ({
      id: c.id, path: c.path, reason: isSubmodule(c) ? 'submodule — manage it inside the submodule' : `not applicable to ${action}`,
    })),
    warning: t.warning,
    needsTyping: t.needsTyping,
  }
}

/** Worktrees that could commit: those with staged changes. Only the selected one starts ticked. */
export function commitTargets(worktrees, selectedTreeId) {
  return worktrees.filter(t => !t.error && t.changes.some(c => c.area === GIT_AREAS.STAGED)).map(t => {
    const unavailable = t.operation ? `${t.operation}: continue or abort it first`
      : t.changes.some(c => c.area === GIT_AREAS.CONFLICT) ? 'Resolve conflicts first' : null
    return {
      id: worktreeId(t), tree: t, title: `${t.repo} › ${worktreeName(t)} → ${branchLabel(t)}`,
      staged: t.changes.filter(c => c.area === GIT_AREAS.STAGED), unavailable, ticked: !unavailable && worktreeId(t) === selectedTreeId,
    }
  })
}

/** One block per ticked, available target, with its staged files and message. */
export function commitReview(targets, { message = '', perTarget = null } = {}) {
  const chosen = targets.filter(t => t.ticked && !t.unavailable)
  const blocks = chosen.map(t => ({
    id: t.id, title: t.title, files: t.staged.map(c => `${statusCode(c)} ${c.path}`),
    message: String((perTarget ? perTarget[t.id] : message) ?? '').trim(),
  }))
  const error = !blocks.length ? 'Choose at least one worktree.' : blocks.some(b => !b.message) ? 'Enter a commit message.' : null
  return { blocks, note: COMMIT_NOTE, error }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm -w packages/core test -- src/modules/git/selection.test.js src/modules/git/review.test.js`
Expected: PASS.

- [ ] **Step 7: Export from the module and the package, and extend the adapter contract**

In `packages/core/src/modules/git/index.js`, add after the `group-draft.js` export line:

```js
export { parseDiff, diffSides } from './diff.js'
export {
  changePaths, isSubmodule, FILE_ACTIONS, actionsFor, groupChanges, toggleSelection, rangeSelection, pruneSelection,
} from './selection.js'
export { fileReview, commitTargets, commitReview, COMMIT_NOTE } from './review.js'
```

In `packages/core/src/index.js`, extend the `./modules/git/index.js` export block: add a line before `} from './modules/git/index.js'`:

```js
  parseDiff, diffSides, changePaths, isSubmodule, FILE_ACTIONS, actionsFor, groupChanges, toggleSelection, rangeSelection, pruneSelection,
  fileReview, commitTargets, commitReview, COMMIT_NOTE,
```

In `packages/core/tests/public-api.test.js`, after the `'GroupDraft', 'GroupSaveError',` line add:

```js
  'parseDiff', 'diffSides', 'changePaths', 'isSubmodule', 'FILE_ACTIONS', 'actionsFor', 'groupChanges',
  'toggleSelection', 'rangeSelection', 'pruneSelection', 'fileReview', 'commitTargets', 'commitReview', 'COMMIT_NOTE',
```

In `packages/core/src/adapters/index.js`, replace the `IGitAdapter` object with:

```js
export const IGitAdapter = {
  isAvailable: () => false,
  version:      async () => null,
  resolve:      async (dir) => Promise.reject(new Error('IGitAdapter.resolve not implemented')),
  worktrees:    async (repo, registered) => Promise.reject(new Error('IGitAdapter.worktrees not implemented')),
  // → { porcelain, operation, rebasingBranch, fetchedAt } | { missing: true } | { error }
  status:       async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.status not implemented')),
  branches:     async (repo, registered) => Promise.reject(new Error('IGitAdapter.branches not implemented')),
  discover:     async (roots, repos) => [],
  checkFolders: async (paths) => [],
  // Stage 2. change = { area, paths } → { text, truncated, binary, size, gone?, stamp }
  diff:         async (repo, worktreePath, registered, change) => Promise.reject(new Error('IGitAdapter.diff not implemented')),
  // request = { kind: 'files', paths } | { kind: 'commit' } → stamp string for a write's `expected`
  stamp:        async (repo, worktreePath, registered, request) => Promise.reject(new Error('IGitAdapter.stamp not implemented')),
  // Writes → { ok, detail, stale? }. `expected` is the stamp of what the user reviewed.
  stage:           async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.stage not implemented')),
  unstage:         async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.unstage not implemented')),
  discard:         async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.discard not implemented')),
  deleteUntracked: async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.deleteUntracked not implemented')),
  stageHunk:       async (repo, worktreePath, registered, paths, index, expected) => Promise.reject(new Error('IGitAdapter.stageHunk not implemented')),
  unstageHunk:     async (repo, worktreePath, registered, paths, index, expected) => Promise.reject(new Error('IGitAdapter.unstageHunk not implemented')),
  commit:          async (repo, worktreePath, registered, message, expected) => Promise.reject(new Error('IGitAdapter.commit not implemented')),
}
```

- [ ] **Step 8: Run the core suite**

Run: `npm -w packages/core test`
Expected: PASS, including `tests/public-api.test.js`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/modules/git/selection.js packages/core/src/modules/git/selection.test.js packages/core/src/modules/git/review.js packages/core/src/modules/git/review.test.js packages/core/src/modules/git/index.js packages/core/src/index.js packages/core/src/adapters/index.js packages/core/tests/public-api.test.js
git commit -m "feat(git): selection and review models for the changes view"
```

---

### Task 3: Main-process reads (diff and stamp) and the renderer bridge

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs`
- Test: `apps/desktop/electron/ipc/git.test.js`
- Modify: `apps/desktop/electron/preload.cjs:237-246`
- Modify: `apps/desktop/src/adapters/git.js`

**Interfaces:**
- Consumes: the stage 1 internals of `git.cjs`: `git()`, `requireRegistered`, `requireAbsolute`, `isInside`, `samePath`, `worktreeList`, `inProgress` and `probe`.
- Produces, in `git.cjs`:
  - **Internal helpers** (later tasks reuse them; keep the names):
    - `git(cwd, args, { input, timeout })` returns `{ code, stdout, stderr, bytes }`;
    - `requireWorktree(repo, worktreePath, registered)`;
    - `requirePaths(worktreePath, paths) → paths`;
    - `sha(...parts) → hex`;
    - `head(wt) → oid|''`;
    - `indexEntries(wt) → [{ mode, oid, stage, path, raw }]`;
    - `statusFor(wt, paths) → [{ kind, xy, path, orig, raw }]`;
    - `filesState(wt, paths) → { head, entries, records, stamp }`;
    - `commitState(wt) → { head, entries, stamp }`;
    - `diffText(wt, area, paths) → { text, truncated, binary, size, gone? }`;
    - `DIFF_CAP`.
  - **Channels:**
    - `git:diff(repo, worktreePath, registered, { area, paths }) → { text, truncated, binary, size, gone?, stamp }`;
    - `git:stamp(repo, worktreePath, registered, { kind: 'files', paths } | { kind: 'commit' }) → string`.
  - **Preload and adapter:** `diff`, `stamp`, `stage`, `unstage`, `discard`, `deleteUntracked`, `stageHunk`, `unstageHunk` and `commit` are all forwarded with the exact parameter lists from `IGitAdapter` (Task 2). The write channels are registered in Tasks 4–6.

- [ ] **Step 1: Give fake children a stdin, record them, and add the new probe defaults**

In `apps/desktop/electron/ipc/git.test.js`, edit `fakeChild`, adding these lines after `child.pid = pid`:

```js
  child.stdin = new PassThrough()
  child.input = ''
  child.stdin.on('data', c => { child.input += c })
```

In `setup`, replace the `spawn:` entry and the `probe:` entry with:

```js
    spawn: vi.fn((cmd, args, opts) => {
      const op = args.slice(1 + FSMON.length)
      const call = { cmd, args: op, raw: args, opts }
      calls.push(call)
      call.child = fakeChild(respond(op, opts), 1000 + calls.length)
      return call.child
    }),
```

```js
    probe: {
      isDirectory: () => true, isFile: () => false, exists: () => false, listDirectories: () => [], readText: () => null, mtime: () => null,
      isLink: () => false, size: () => null, readBytes: () => null, unlink: vi.fn(), ...probe,
    },
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/desktop/electron/ipc/git.test.js`:

```js
const WT = REPO.path
const REG = [REPO.path]
const HEAD = 'a'.repeat(40)
const LS = '100644 1111111111111111111111111111111111111111 0\ta b.txt\x00100644 2222222222222222222222222222222222222222 0\tother.txt\x00'
const STATUS = '1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 a b.txt\x00? new.txt\x00'
const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3']
// Answers the read commands stage 2 runs; `over` replaces answers by subcommand.
const reads = (over = {}) => args => {
  if (args[0] in over) return typeof over[args[0]] === 'function' ? over[args[0]](args) : over[args[0]]
  if (args[0] === 'rev-parse' && args.includes('HEAD')) return { stdout: `${HEAD}\n` }
  if (args[0] === 'rev-parse' && args[2] === '--git-common-dir') return { stdout: `${COMMON}\n` }
  if (args[0] === 'ls-files') return { stdout: LS }
  if (args[0] === 'status') return { stdout: STATUS }
  if (args[0] === 'diff') return { stdout: 'diff --git a/a b.txt b/a b.txt\n' }
  return { stdout: '' }
}
const unstaged = (paths = ['a b.txt']) => ({ area: 'unstaged', paths })

describe('stage 2 reads', () => {
  it('sets literal pathspecs for every git call', () => {
    expect(gitEnv({}).GIT_LITERAL_PATHSPECS).toBe('1')
  })

  it('diffs unstaged and staged changes with an exact argv', async () => {
    const a = setup(reads())
    await a.invoke('git:diff', REPO, WT, REG, unstaged())
    expect(a.calls.find(c => c.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--', 'a b.txt'])
    const b = setup(reads())
    await b.invoke('git:diff', REPO, WT, REG, { area: 'staged', paths: ['moved.txt', 'was.txt'] })
    expect(b.calls.find(c => c.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--cached', '--', 'moved.txt', 'was.txt'])
    const c = setup(reads())
    await c.invoke('git:diff', REPO, WT, REG, { area: 'conflict', paths: ['both.txt'] })
    expect(c.calls.find(x => x.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--', 'both.txt'])
  })

  it('returns the diff with a stamp that follows the diff text', async () => {
    const run = text => setup(reads({ diff: { stdout: text } })).invoke('git:diff', REPO, WT, REG, unstaged())
    const a = await run('one')
    expect([a.text, a.truncated, a.binary, a.size]).toEqual(['one', false, false, 3])
    expect(a.stamp).toMatch(/^[0-9a-f]{64}$/)
    expect((await run('one')).stamp).toBe(a.stamp)
    expect((await run('two')).stamp).not.toBe(a.stamp)
  })

  it('flags binary diffs and truncates diffs over 1 MB', async () => {
    const bin = await setup(reads({ diff: { stdout: 'diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n' } }))
      .invoke('git:diff', REPO, WT, REG, unstaged(['x.png']))
    expect(bin.binary).toBe(true)
    const big = await setup(reads({ diff: { stdout: 'x'.repeat(1024 * 1024 + 10) } })).invoke('git:diff', REPO, WT, REG, unstaged())
    expect([big.truncated, big.text.length, big.size]).toEqual([true, 1024 * 1024, 1024 * 1024 + 10])
  })

  it('builds untracked diffs from the file itself without running git diff', async () => {
    const { invoke, calls } = setup(reads(), { size: () => 9, readBytes: () => Buffer.from('one\r\ntwo\n') })
    const d = await invoke('git:diff', REPO, WT, REG, { area: 'untracked', paths: ['new.txt'] })
    expect(d.text).toBe('--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n')
    expect(calls.some(c => c.args[0] === 'diff')).toBe(false)
  })

  it('reports binary, oversized, empty, vanished and linked untracked files', async () => {
    const untracked = probe => setup(reads(), probe).invoke('git:diff', REPO, WT, REG, { area: 'untracked', paths: ['new.txt'] })
    const bin = await untracked({ size: () => 3, readBytes: () => Buffer.from([1, 0, 2]) })
    expect([bin.binary, bin.text]).toEqual([true, ''])
    const big = await untracked({ size: () => 2 * 1024 * 1024 })
    expect([big.truncated, big.size, big.text]).toEqual([true, 2 * 1024 * 1024, ''])
    const empty = await untracked({ size: () => 0, readBytes: () => Buffer.alloc(0) })
    expect([empty.text, empty.size]).toEqual(['', 0])
    expect((await untracked({ size: () => null })).gone).toBe(true)
    await expect(untracked({ isLink: () => true })).rejects.toThrow('Refusing to read a linked file: new.txt')
  })

  it('stamps only the requested paths for file actions, and the whole index for commits', async () => {
    const stamp = (over, request = { kind: 'files', paths: ['a b.txt'] }) => setup(reads(over)).invoke('git:stamp', REPO, WT, REG, request)
    const base = await stamp({})
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    const other = '1 .M N... 100644 100644 100644 3333333333333333333333333333333333333333 3333333333333333333333333333333333333333 other.txt\x00'
    expect(await stamp({ status: { stdout: STATUS + other } })).toBe(base)
    expect(await stamp({ 'ls-files': { stdout: LS.replace('1111111111111111111111111111111111111111', '9'.repeat(40)) } })).not.toBe(base)
    expect(await stamp({ status: { stdout: STATUS.replace('.M', 'MM') } })).not.toBe(base)
    const commit = await stamp({}, { kind: 'commit' })
    expect(await stamp({ 'ls-files': { stdout: LS.replace('2222222222222222222222222222222222222222', '8'.repeat(40)) } }, { kind: 'commit' })).not.toBe(commit)
  })

  it('rejects bad file paths, unknown areas and unregistered repos without spawning git', async () => {
    for (const bad of [['../x'], ['C:\\x'], ['C:x'], ['/x'], [], ['a\x00b'], [42]]) {
      const { invoke, deps } = setup(reads())
      await expect(invoke('git:diff', REPO, WT, REG, unstaged(bad))).rejects.toThrow()
      expect(deps.spawn).not.toHaveBeenCalled()
    }
    await expect(setup(reads()).invoke('git:diff', REPO, WT, REG, { area: 'weird', paths: ['a'] })).rejects.toThrow('Unknown change area: weird')
    await expect(setup(reads()).invoke('git:diff', REPO, WT, [], unstaged())).rejects.toThrow('Not a registered repository')
    await expect(setup(reads()).invoke('git:stamp', REPO, WT, REG, { kind: 'other' })).rejects.toThrow('Unknown stamp request')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: FAIL, because `GIT_LITERAL_PATHSPECS` is undefined and `handlers['git:diff']` is not a function. The existing tests still pass.

- [ ] **Step 4: Implement the reads in `git.cjs`**

1. Add `const crypto = require('crypto');` after the `fs` require.
2. In `gitEnv`, add `GIT_LITERAL_PATHSPECS: '1'` to the object literal, so it reads:

```js
  const env = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' };
```

3. In `defaultProbe()`, add these entries to the returned object:

```js
    isLink: p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } },
    size: p => { const s = stat(p); return s?.isFile() ? s.size : null; },
    readBytes: p => { try { return fs.readFileSync(p); } catch { return null; } },
```

4. Add these top-level helpers after `isRemoteOrDevicePath`:

```js
const DIFF_CAP = 1024 * 1024;
const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3'];
const AREAS = ['unstaged', 'staged', 'untracked', 'conflict'];

const sha = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex');

// The rest of a porcelain v2 record after its n fixed fields (the path may contain spaces).
function afterFields(record, n) {
  let i = -1;
  for (let k = 0; k < n; k++) i = record.indexOf(' ', i + 1);
  return record.slice(i + 1);
}
```

5. Replace the whole `async function git(cwd, args) { … }` with:

```js
  async function git(cwd, args, { input = null, timeout = timeoutMs } = {}) {
    const exe = gitExecutable();
    if (!exe) throw new Error('Git not found');
    await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(exe, ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
          cwd, env: gitEnv(), windowsHide: true, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        });
        running.add(child);
        const out = [];
        const err = [];
        let settled = false;
        let timer = null;
        const done = fn => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(child);
          fn();
        };
        timer = setTimeout(() => done(() => {
          Promise.resolve(kill(child.pid)).catch(() => {});
          reject(new Error(`git ${args[0]} timed out after ${Math.round(timeout / 1000)}s`));
        }), timeout);
        child.stdout.on('data', c => out.push(Buffer.from(c)));
        child.stderr.on('data', c => err.push(Buffer.from(c)));
        child.on('error', e => done(() => reject(new Error(`Couldn't start git: ${e.message}`))));
        child.on('close', code => done(() => {
          const bytes = Buffer.concat(out);
          resolve({ code, stdout: bytes.toString('utf8'), stderr: Buffer.concat(err).toString('utf8').trim(), bytes: bytes.length });
        }));
        if (input != null) {
          // A write to a process that already exited must not crash main.
          child.stdin.on('error', () => {});
          child.stdin.end(input);
        }
      });
    } finally {
      release();
    }
  }
```

6. After `requireRegistered`, add:

```js
  async function requireWorktree(repo, worktreePath, registered) {
    requireRegistered(repo, registered);
    requireAbsolute(worktreePath, 'Worktree path');
    if (!isInside(worktreePath, repo.path)) {
      const listed = (await worktreeList(repo.path)).split('\0').filter(f => f.startsWith('worktree ')).map(f => f.slice(9));
      if (!listed.some(p => samePath(p, worktreePath))) throw new Error(`Not a worktree of ${repo.path}: ${worktreePath}`);
    }
  }

  // File paths come from the renderer: relative, inside the worktree, never the worktree itself.
  function requirePaths(worktreePath, paths) {
    if (!Array.isArray(paths) || !paths.length) throw new Error('Choose at least one file');
    const root = path.resolve(worktreePath);
    for (const p of paths) {
      const bad = typeof p !== 'string' || !p || p.includes('\0') || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || isRemoteOrDevicePath(p);
      const full = bad ? null : path.resolve(root, p);
      if (bad || !isInside(full, root) || samePath(full, root)) throw new Error(`Invalid file path: ${p}`);
    }
    return paths;
  }

  async function head(wt) {
    const r = await git(wt, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : '';
  }

  // `ls-files --stage -z` entries: "<mode> <oid> <stage>\t<path>".
  async function indexEntries(wt) {
    const r = await git(wt, ['ls-files', '--stage', '-z']);
    if (r.code !== 0) throw new Error(r.stderr || 'git ls-files failed');
    return r.stdout.split('\0').filter(Boolean).map(raw => {
      const tab = raw.indexOf('\t');
      const [mode, oid, stage] = raw.slice(0, tab).split(' ');
      return { mode, oid, stage, path: raw.slice(tab + 1), raw };
    });
  }

  // Porcelain v2 records for the given paths (a rename matches on either name).
  async function statusFor(wt, paths) {
    const r = await git(wt, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
    if (r.code !== 0) throw new Error(r.stderr || 'git status failed');
    const want = new Set(paths);
    const records = r.stdout.split('\0');
    const found = [];
    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const kind = raw[0];
      let p = null;
      let orig = null;
      if (kind === '?') p = raw.slice(2);
      else if (kind === '1') p = afterFields(raw, 8);
      else if (kind === '2') { p = afterFields(raw, 9); orig = records[++i]; }
      else if (kind === 'u') p = afterFields(raw, 10);
      if (p !== null && (want.has(p) || (orig && want.has(orig)))) {
        found.push({ kind, xy: kind === '?' ? '??' : raw.slice(2, 4), path: p, orig, raw: orig ? `${raw}\0${orig}` : raw });
      }
    }
    return found;
  }

  // What a whole-file review promises: HEAD, the paths' index entries and their status records.
  async function filesState(wt, paths) {
    const want = new Set(paths);
    const [h, entries, records] = await Promise.all([head(wt), indexEntries(wt), statusFor(wt, paths)]);
    const mine = entries.filter(e => want.has(e.path));
    return { head: h, entries: mine, records, stamp: sha(h, ...mine.map(e => e.raw), ...records.map(r => r.raw)) };
  }

  async function commitState(wt) {
    const [h, entries] = await Promise.all([head(wt), indexEntries(wt)]);
    return { head: h, entries, stamp: sha(h, ...entries.map(e => e.raw)) };
  }

  // Untracked files have no git diff; build an all-added one so they share the viewer.
  function untrackedDiff(wt, rel) {
    const full = path.resolve(wt, rel);
    if (probe.isLink(full)) throw new Error(`Refusing to read a linked file: ${rel}`);
    const size = probe.size(full);
    if (size == null) return { text: '', truncated: false, binary: false, size: 0, gone: true };
    if (size > DIFF_CAP) return { text: '', truncated: true, binary: false, size };
    const bytes = probe.readBytes(full);
    if (!bytes) return { text: '', truncated: false, binary: false, size: 0, gone: true };
    if (bytes.subarray(0, 8000).includes(0)) return { text: '', truncated: false, binary: true, size };
    if (!bytes.length) return { text: '', truncated: false, binary: false, size: 0 };
    const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return {
      text: `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}\n`).join('')}`,
      truncated: false, binary: false, size,
    };
  }

  async function diffText(wt, area, paths) {
    if (!AREAS.includes(area)) throw new Error(`Unknown change area: ${area}`);
    if (area === 'untracked') return untrackedDiff(wt, paths[0]);
    const r = await git(wt, [...DIFF_ARGS, ...(area === 'staged' ? ['--cached'] : []), '--', ...paths]);
    if (r.code !== 0) throw new Error(r.stderr || `git diff failed (exit ${r.code})`);
    const truncated = r.bytes > DIFF_CAP;
    const text = truncated ? r.stdout.slice(0, DIFF_CAP) : r.stdout;
    return { text, truncated, binary: /^(Binary files |GIT binary patch)/m.test(text), size: r.bytes };
  }
```

7. In the `git:status` handler, replace its first five lines (from `requireRegistered(repo, registered);` up to and including the closing `}` of the `if (!isInside(...))` block) with:

```js
    await requireWorktree(repo, worktreePath, registered);
```

8. After the `git:status` handler, add:

```js
  handle('git:diff', async (_e, repo, worktreePath, registered, change) => {
    await requireWorktree(repo, worktreePath, registered);
    if (!AREAS.includes(change?.area)) throw new Error(`Unknown change area: ${change?.area}`);
    const paths = requirePaths(worktreePath, change.paths);
    const d = await diffText(worktreePath, change.area, paths);
    const { stamp } = await filesState(worktreePath, paths);
    return { ...d, stamp: sha(stamp, d.text) };
  });

  handle('git:stamp', async (_e, repo, worktreePath, registered, request) => {
    await requireWorktree(repo, worktreePath, registered);
    if (request?.kind === 'commit') return (await commitState(worktreePath)).stamp;
    if (request?.kind === 'files') return (await filesState(worktreePath, requirePaths(worktreePath, request.paths))).stamp;
    throw new Error('Unknown stamp request');
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: PASS, including every stage 1 test.

- [ ] **Step 6: Forward the new operations through preload and the renderer adapter**

In `apps/desktop/electron/preload.cjs`, inside the `git: { … }` object after `checkFolders`, add:

```js
    diff:            (repo, worktreePath, registered, change) => ipcRenderer.invoke('git:diff', repo, worktreePath, registered, change),
    stamp:           (repo, worktreePath, registered, request) => ipcRenderer.invoke('git:stamp', repo, worktreePath, registered, request),
    stage:           (repo, worktreePath, registered, paths, expected) => ipcRenderer.invoke('git:stage', repo, worktreePath, registered, paths, expected),
    unstage:         (repo, worktreePath, registered, paths, expected) => ipcRenderer.invoke('git:unstage', repo, worktreePath, registered, paths, expected),
    discard:         (repo, worktreePath, registered, paths, expected) => ipcRenderer.invoke('git:discard', repo, worktreePath, registered, paths, expected),
    deleteUntracked: (repo, worktreePath, registered, paths, expected) => ipcRenderer.invoke('git:deleteUntracked', repo, worktreePath, registered, paths, expected),
    stageHunk:       (repo, worktreePath, registered, paths, index, expected) => ipcRenderer.invoke('git:stageHunk', repo, worktreePath, registered, paths, index, expected),
    unstageHunk:     (repo, worktreePath, registered, paths, index, expected) => ipcRenderer.invoke('git:unstageHunk', repo, worktreePath, registered, paths, index, expected),
    commit:          (repo, worktreePath, registered, message, expected) => ipcRenderer.invoke('git:commit', repo, worktreePath, registered, message, expected),
```

In `apps/desktop/src/adapters/git.js`, add these methods after `checkFolders`:

```js
  diff(repo, worktreePath, registered, change) { return api().diff(repo, worktreePath, registered, change) },
  stamp(repo, worktreePath, registered, request) { return api().stamp(repo, worktreePath, registered, request) },
  stage(repo, worktreePath, registered, paths, expected) { return api().stage(repo, worktreePath, registered, paths, expected) },
  unstage(repo, worktreePath, registered, paths, expected) { return api().unstage(repo, worktreePath, registered, paths, expected) },
  discard(repo, worktreePath, registered, paths, expected) { return api().discard(repo, worktreePath, registered, paths, expected) },
  deleteUntracked(repo, worktreePath, registered, paths, expected) { return api().deleteUntracked(repo, worktreePath, registered, paths, expected) },
  stageHunk(repo, worktreePath, registered, paths, index, expected) { return api().stageHunk(repo, worktreePath, registered, paths, index, expected) },
  unstageHunk(repo, worktreePath, registered, paths, index, expected) { return api().unstageHunk(repo, worktreePath, registered, paths, index, expected) },
  commit(repo, worktreePath, registered, message, expected) { return api().commit(repo, worktreePath, registered, message, expected) },
```

- [ ] **Step 7: Run the desktop IPC and integration tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/`
Expected: PASS. The stage 1 integration test still passes with `GIT_LITERAL_PATHSPECS=1`.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js apps/desktop/electron/preload.cjs apps/desktop/src/adapters/git.js
git commit -m "feat(git): diff and review-stamp reads in the main process"
```

---

### Task 4: Main-process writes: stage, unstage, discard and commit, under a per-repo lock

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs`
- Test: `apps/desktop/electron/ipc/git.test.js`

**Interfaces:**
- Consumes: from Task 3, `requireWorktree`, `requirePaths`, `filesState`, `commitState`, `resolveCommon`, `inProgress` and `git(cwd, args, { input, timeout })`.
- Produces:
  - **Internal helpers:**
    - `withRepoLock(repo, fn)`;
    - `result(r) → { ok, detail }`;
    - `refuse(detail)`;
    - `STALE`;
    - `nul(paths)`;
    - `PATHSPEC_STDIN`;
    - `gitDirOf(wt)`.
  - **Write channels**, each returning `{ ok: boolean, detail: string, stale?: true }`:
    - `git:stage(repo, worktreePath, registered, paths, expected)`;
    - `git:unstage(…)` and `git:discard(…)`, with the same parameters;
    - `git:commit(repo, worktreePath, registered, message, expected)`.
  - **New dep:** `register(ipcMain, { commitTimeoutMs = 120000 })`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/electron/ipc/git.test.js`:

```js
const stampOf = async (s, request) => s.invoke('git:stamp', REPO, WT, REG, request)
const files = (paths = ['a b.txt']) => ({ kind: 'files', paths })

describe('stage 2 writes', () => {
  it('stages paths through stdin after checking the stamp', async () => {
    const s = setup(reads())
    const expected = await stampOf(s, files(['a b.txt', '-x [1].txt']))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt', '-x [1].txt'], expected)
    expect(r).toEqual({ ok: true, detail: 'Done' })
    const add = s.calls.find(c => c.args[0] === 'add')
    expect(add.args).toEqual(['add', '--pathspec-from-file=-', '--pathspec-file-nul'])
    expect(add.opts.stdio[0]).toBe('pipe')
    expect(add.child.input).toBe('a b.txt\x00-x [1].txt\x00')
  })

  it('refuses a stale review without running the write', async () => {
    const s = setup(reads())
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], 'not-the-stamp')
    expect(r).toEqual({ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' })
    expect(s.calls.some(c => c.args[0] === 'add')).toBe(false)
  })

  it('refuses submodule paths', async () => {
    const s = setup(reads({ 'ls-files': { stdout: '160000 3333333333333333333333333333333333333333 0\tlib\x00' } }))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['lib'], await stampOf(s, files(['lib'])))
    expect(r).toEqual({ ok: false, detail: 'Submodule changes need to be managed inside the submodule.' })
    expect(s.calls.some(c => c.args[0] === 'add')).toBe(false)
  })

  it('unstages with restore --staged, or rm --cached on an unborn branch', async () => {
    const s = setup(reads())
    await s.invoke('git:unstage', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))
    expect(s.calls.find(c => c.args[0] === 'restore').args).toEqual(['restore', '--staged', '--pathspec-from-file=-', '--pathspec-file-nul'])
    const u = setup(reads({ 'rev-parse': args => (args.includes('HEAD') ? { code: 1 } : { stdout: `${COMMON}\n` }) }))
    await u.invoke('git:unstage', REPO, WT, REG, ['a b.txt'], await stampOf(u, files()))
    expect(u.calls.find(c => c.args[0] === 'rm').args).toEqual(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'])
  })

  it('discards only tracked files with unstaged changes', async () => {
    const s = setup(reads())
    expect(await s.invoke('git:discard', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))).toEqual({ ok: true, detail: 'Done' })
    expect(s.calls.find(c => c.args[0] === 'restore').args).toEqual(['restore', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'])
    const t = setup(reads())
    const r = await t.invoke('git:discard', REPO, WT, REG, ['new.txt'], await stampOf(t, files(['new.txt'])))
    expect(r).toEqual({ ok: false, detail: 'Discard only accepts tracked files with unstaged changes: new.txt' })
    expect(t.calls.some(c => c.args[0] === 'restore')).toBe(false)
  })

  it('returns git failures with output, adding a hint for a held index lock', async () => {
    const s = setup(reads({ add: { code: 128, stderr: "fatal: Unable to create 'C:/repos/App/.git/index.lock': File exists." } }))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))
    expect(r.ok).toBe(false)
    expect(r.detail).toBe("fatal: Unable to create 'C:/repos/App/.git/index.lock': File exists.\nAnother git process is using this repo; close it or remove the stale lock.")
  })

  it('commits the message through stdin with the longer timeout', async () => {
    const s = setup(reads({ diff: { code: 1 }, commit: { stdout: '[main abc1234] Fix it\n' } }))
    const r = await s.invoke('git:commit', REPO, WT, REG, 'Fix it\n\nBody', await stampOf(s, { kind: 'commit' }))
    expect(r).toEqual({ ok: true, detail: '[main abc1234] Fix it' })
    const commit = s.calls.find(c => c.args[0] === 'commit')
    expect(commit.args).toEqual(['commit', '-F', '-'])
    expect(commit.child.input).toBe('Fix it\n\nBody')
    expect(s.calls.find(c => c.args[0] === 'diff').args).toEqual(['diff', '--cached', '--quiet', '--no-ext-diff'])
  })

  it('refuses empty messages, nothing staged, conflicts and operations in progress', async () => {
    const commit = async (over, message = 'Fix', probe = {}) => {
      const s = setup(reads(over), probe)
      const r = await s.invoke('git:commit', REPO, WT, REG, message, await stampOf(s, { kind: 'commit' }))
      return [r, s.calls.some(c => c.args[0] === 'commit')]
    }
    expect(await commit({ diff: { code: 1 } }, '  ')).toEqual([{ ok: false, detail: 'Enter a commit message.' }, false])
    expect(await commit({ diff: { code: 0 } })).toEqual([{ ok: false, detail: 'No staged changes.' }, false])
    expect(await commit({ diff: { code: 1 }, 'ls-files': { stdout: '100644 1111111111111111111111111111111111111111 1\tboth.txt\x00' } }))
      .toEqual([{ ok: false, detail: 'Resolve conflicts before committing.' }, false])
    const merging = await commit(
      { diff: { code: 1 }, 'rev-parse': args => args.includes('HEAD') ? { stdout: `${HEAD}\n` } : { stdout: `${COMMON}\n${COMMON}\n` } },
      'Fix', { exists: p => p === path.join(COMMON, 'MERGE_HEAD') })
    expect(merging).toEqual([{ ok: false, detail: 'Merge in progress. Continue or abort it first.' }, false])
  })

  it('reports a commit that outlives its timeout', async () => {
    const s = setup(reads({ diff: { code: 1 }, commit: 'hang' }), {}, { commitTimeoutMs: 30 })
    const r = await s.invoke('git:commit', REPO, WT, REG, 'Fix', await stampOf(s, { kind: 'commit' }))
    expect(r).toEqual({ ok: false, detail: 'git commit timed out after 0s. Hooks may have left partial output in the worktree.' })
    expect(s.deps.kill).toHaveBeenCalled()
  })

  it('runs one write at a time per repository while reads carry on', async () => {
    const s = setup(reads({ add: 'hang' }), {}, { timeoutMs: 5000 })
    const expected = await stampOf(s, files())
    const first = s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], expected)
    await vi.waitFor(() => expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(1))
    const second = s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], expected)
    await s.invoke('git:diff', REPO, WT, REG, unstaged())
    await new Promise(r => setTimeout(r, 20))
    expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(1)
    s.calls.find(c => c.args[0] === 'add').child.emit('close', 0)
    expect((await first).ok).toBe(true)
    await vi.waitFor(() => expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(2))
    s.calls.filter(c => c.args[0] === 'add')[1].child.emit('close', 0)
    expect((await second).ok).toBe(true)
  })
})
```

Notes for the implementer:
- `fakeChild` treats a response of `'hang'` as never closing; the test emits `close` itself.
- `reads({ add: 'hang' })` relies on `respond` returning `'hang'`.
- In the timeout test, `Math.round(30 / 1000)` is `0`, hence "after 0s".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: FAIL, because `handlers['git:stage']` is not a function.

- [ ] **Step 3: Implement the writes**

1. In `register`'s deps destructuring, add `commitTimeoutMs = 120000,`.

2. Add these top-level constants after `AREAS`:

```js
const STALE = 'Changed since you reviewed it. Refresh and review again.';
const LOCK_HINT = 'Another git process is using this repo; close it or remove the stale lock.';
const SUBMODULE = 'Submodule changes need to be managed inside the submodule.';
const PATHSPEC_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];
const nul = paths => paths.map(p => `${p}\0`).join('');
const refuse = detail => ({ ok: false, detail });

function result(r) {
  const detail = [r.stdout.trim(), r.stderr].filter(Boolean).join('\n');
  if (r.code === 0) return { ok: true, detail: detail || 'Done' };
  return { ok: false, detail: /index\.lock/.test(r.stderr) ? `${detail}\n${LOCK_HINT}` : detail || `git exited with code ${r.code}` };
}
```

3. Inside `register`, after `const commonDirs = new Map();`, add `const locks = new Map();`.

4. Inside `register`, after `inProgress`, add:

```js
  // Writes to one repository run one at a time; reads never wait.
  async function withRepoLock(repo, fn) {
    const key = normalise(await resolveCommon(repo.path));
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (locks.get(key) === tail) locks.delete(key);
    }
  }

  async function gitDirOf(wt) {
    const r = await git(wt, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
    return r.code === 0 ? r.stdout.split(/\r?\n/)[0].trim() : '';
  }

  // Shared shape of a whole-file write: validate, lock, re-check the reviewed state, then act.
  function fileWrite(channel, act) {
    handle(channel, async (_e, repo, worktreePath, registered, paths, expected) => {
      await requireWorktree(repo, worktreePath, registered);
      const rel = requirePaths(worktreePath, paths);
      return withRepoLock(repo, async () => {
        const state = await filesState(worktreePath, rel);
        if (state.stamp !== expected) return { ok: false, stale: true, detail: STALE };
        if (state.entries.some(e => e.mode === '160000')) return refuse(SUBMODULE);
        return act(worktreePath, rel, state);
      });
    });
  }
```

5. After the `git:stamp` handler, add:

```js
  fileWrite('git:stage', async (wt, rel) => result(await git(wt, ['add', ...PATHSPEC_STDIN], { input: nul(rel) })));

  fileWrite('git:unstage', async (wt, rel, state) => result(await git(wt,
    state.head ? ['restore', '--staged', ...PATHSPEC_STDIN] : ['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...PATHSPEC_STDIN],
    { input: nul(rel) })));

  fileWrite('git:discard', async (wt, rel, state) => {
    const tracked = new Set(state.entries.filter(e => e.stage === '0').map(e => e.path));
    const unstaged = new Set(state.records.filter(r => (r.kind === '1' || r.kind === '2') && r.xy[1] !== '.').map(r => r.path));
    const bad = rel.find(p => !tracked.has(p) || !unstaged.has(p));
    if (bad) return refuse(`Discard only accepts tracked files with unstaged changes: ${bad}`);
    return result(await git(wt, ['restore', '--worktree', ...PATHSPEC_STDIN], { input: nul(rel) }));
  });

  handle('git:commit', async (_e, repo, worktreePath, registered, message, expected) => {
    await requireWorktree(repo, worktreePath, registered);
    if (typeof message !== 'string' || !message.trim()) return refuse('Enter a commit message.');
    return withRepoLock(repo, async () => {
      const state = await commitState(worktreePath);
      if (state.stamp !== expected) return { ok: false, stale: true, detail: STALE };
      if (state.entries.some(e => e.stage !== '0')) return refuse('Resolve conflicts before committing.');
      const { operation } = await inProgress(await gitDirOf(worktreePath));
      if (operation) return refuse(`${operation}. Continue or abort it first.`);
      const staged = await git(worktreePath, ['diff', '--cached', '--quiet', '--no-ext-diff']);
      if (staged.code === 0) return refuse('No staged changes.');
      if (staged.code !== 1) return refuse(staged.stderr || `git diff failed (exit ${staged.code})`);
      try {
        return result(await git(worktreePath, ['commit', '-F', '-'], { input: message, timeout: commitTimeoutMs }));
      } catch (e) {
        return refuse(`${e.message}. Hooks may have left partial output in the worktree.`);
      }
    });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js
git commit -m "feat(git): stage, unstage, discard and commit with review stamps and a per-repo lock"
```

---

### Task 5: Hunk staging in the main process

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs`
- Test: `apps/desktop/electron/ipc/git.test.js`

**Interfaces:**
- Consumes:
  - from Tasks 3–4: `filesState`, `diffText`, `sha`, `withRepoLock`, `result`, `refuse`, `STALE`, `SUBMODULE`;
  - the core fixture `packages/core/src/modules/git/fixtures/three-hunks.diff` (Task 1);
  - `parseDiff` from `@nexusmd/core` (test only).
- Produces:
  - `extractHunk(text, index) → patch string`, exported from `git.cjs`;
  - channels `git:stageHunk(repo, worktreePath, registered, paths, index, expected)` and `git:unstageHunk(…)`, which return `{ ok, detail, stale? }`.
  - `expected` is the `stamp` that `git:diff` returned for the same change.

- [ ] **Step 1: Write the failing tests**

At the top of `apps/desktop/electron/ipc/git.test.js`:
- change the `git.cjs` import to `import { register, gitEnv, isRepositoryRoot, findGit, extractHunk } from './git.cjs'`;
- add `import fs from 'fs'` and `import { parseDiff } from '@nexusmd/core'`.

Then append:

```js
const THREE = fs.readFileSync(new URL('../../../../packages/core/src/modules/git/fixtures/three-hunks.diff', import.meta.url), 'utf8')

describe('extractHunk', () => {
  it('keeps the file header and the chosen hunk, numbered as core numbers them', () => {
    const patch = extractHunk(THREE, 1)
    const lines = patch.split('\n')
    expect(lines.slice(0, 4)).toEqual(['diff --git a/src/app.js b/src/app.js', 'index 1111111..2222222 100644', '--- a/src/app.js', '+++ b/src/app.js'])
    expect(lines[4]).toBe(parseDiff(THREE).files[0].hunks[1].header)
    expect(lines.slice(5)).toEqual([' ten', '+ten and a half', ' eleven', ''])
    expect(extractHunk(THREE, 2).split('\n')[4]).toBe(parseDiff(THREE).files[0].hunks[2].header)
  })

  it('preserves CRLF content lines', () => {
    expect(extractHunk(THREE.replace(/\n/g, '\r\n'), 0)).toContain('-two\r\n+TWO\r\n')
  })

  it('refuses a missing hunk or a diff with more than one file', () => {
    expect(() => extractHunk(THREE, 3)).toThrow('That hunk no longer exists. Refresh and review again.')
    expect(() => extractHunk(THREE, -1)).toThrow('That hunk no longer exists. Refresh and review again.')
    expect(() => extractHunk(THREE + THREE, 0)).toThrow('This diff covers more than one file. Stage the whole file instead.')
  })
})

describe('git:stageHunk and git:unstageHunk', () => {
  const hunkSetup = (over = {}) => setup(reads({ diff: { stdout: THREE }, ...over }))
  const diffStamp = async (s, area = 'unstaged') => (await s.invoke('git:diff', REPO, WT, REG, { area, paths: ['a b.txt'] })).stamp

  it('applies one hunk to the index from stdin', async () => {
    const s = hunkSetup()
    const r = await s.invoke('git:stageHunk', REPO, WT, REG, ['a b.txt'], 1, await diffStamp(s))
    expect(r.ok).toBe(true)
    const apply = s.calls.find(c => c.args[0] === 'apply')
    expect(apply.args).toEqual(['apply', '--cached', '--whitespace=nowarn', '-'])
    expect(apply.child.input).toBe(extractHunk(THREE, 1))
  })

  it('reverses a staged hunk out of the index', async () => {
    const s = hunkSetup()
    await s.invoke('git:unstageHunk', REPO, WT, REG, ['a b.txt'], 0, await diffStamp(s, 'staged'))
    expect(s.calls.find(c => c.args[0] === 'apply').args).toEqual(['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'])
    expect(s.calls.filter(c => c.args[0] === 'diff').at(-1).args).toContain('--cached')
  })

  it('refuses stale, missing, untracked, conflicted and binary hunks without applying', async () => {
    const attempt = async (over, index = 0, stamp = null) => {
      const s = hunkSetup(over)
      const r = await s.invoke('git:stageHunk', REPO, WT, REG, ['a b.txt'], index, stamp ?? await diffStamp(s))
      return [r, s.calls.some(c => c.args[0] === 'apply')]
    }
    expect(await attempt({}, 0, 'old')).toEqual([{ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' }, false])
    expect(await attempt({}, 7)).toEqual([{ ok: false, detail: 'That hunk no longer exists. Refresh and review again.' }, false])
    expect(await attempt({ 'ls-files': { stdout: '' } })).toEqual([{ ok: false, detail: 'Untracked files are staged whole.' }, false])
    expect(await attempt({ 'ls-files': { stdout: '100644 1111111111111111111111111111111111111111 2\ta b.txt\x00' } }))
      .toEqual([{ ok: false, detail: 'Conflicted files are staged whole, after resolving them.' }, false])
    expect(await attempt({ diff: { stdout: 'diff --git a/a b.txt b/a b.txt\nBinary files a/a b.txt and b/a b.txt differ\n' } }))
      .toEqual([{ ok: false, detail: 'Binary or truncated diffs are staged whole.' }, false])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: FAIL, because `extractHunk` is not a function.

- [ ] **Step 3: Implement `extractHunk` and the handlers**

Add the top-level function after `result`:

```js
// Cuts one hunk out of a single-file diff: the file header plus the index-th "@@" hunk.
// Numbering matches parseDiff in @nexusmd/core. Lines keep any "\r", so CRLF files apply cleanly.
function extractHunk(text, index) {
  const lines = String(text).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.filter(l => l.startsWith('diff --')).length > 1) throw new Error('This diff covers more than one file. Stage the whole file instead.');
  const starts = [];
  lines.forEach((l, i) => { if (l.startsWith('@@')) starts.push(i); });
  if (!Number.isInteger(index) || index < 0 || index >= starts.length) throw new Error('That hunk no longer exists. Refresh and review again.');
  const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
  return [...lines.slice(0, starts[0]), ...lines.slice(starts[index], end)].join('\n') + '\n';
}
```

Inside `register`, after the `git:commit` handler, add:

```js
  function hunkWrite(channel, area, reverse) {
    handle(channel, async (_e, repo, worktreePath, registered, paths, index, expected) => {
      await requireWorktree(repo, worktreePath, registered);
      const rel = requirePaths(worktreePath, paths);
      return withRepoLock(repo, async () => {
        const state = await filesState(worktreePath, rel);
        if (!state.entries.length) return refuse('Untracked files are staged whole.');
        if (state.entries.some(e => e.stage !== '0')) return refuse('Conflicted files are staged whole, after resolving them.');
        if (state.entries.some(e => e.mode === '160000')) return refuse(SUBMODULE);
        const d = await diffText(worktreePath, area, rel);
        if (sha(state.stamp, d.text) !== expected) return { ok: false, stale: true, detail: STALE };
        if (d.binary || d.truncated) return refuse('Binary or truncated diffs are staged whole.');
        let patch;
        try { patch = extractHunk(d.text, index); } catch (e) { return refuse(e.message); }
        return result(await git(worktreePath, ['apply', '--cached', ...(reverse ? ['--reverse'] : []), '--whitespace=nowarn', '-'], { input: patch }));
      });
    });
  }

  hunkWrite('git:stageHunk', 'unstaged', false);
  hunkWrite('git:unstageHunk', 'staged', true);
```

Change the exports line to:

```js
module.exports = { register, gitEnv, isRepositoryRoot, findGit, extractHunk };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js
git commit -m "feat(git): stage and unstage single hunks"
```

---

### Task 6: Delete untracked files

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs`
- Test: `apps/desktop/electron/ipc/git.test.js`

**Interfaces:**
- Consumes: from Tasks 3–4, `fileWrite`, `requirePaths`, `isInside`, `samePath` and `probe`.
- Produces:
  - channel `git:deleteUntracked(repo, worktreePath, registered, paths, expected) → { ok, detail, stale? }`;
  - `probe.unlink(path)` in `defaultProbe()`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/electron/ipc/git.test.js`:

```js
describe('git:deleteUntracked', () => {
  const STATUS_U = '? new.txt\x00? sub/deep.txt\x00' + STATUS.split('\x00')[0] + '\x00'
  // The default fake probe calls everything a directory; here only non-.txt paths are folders.
  const del = async (paths, probe = {}, stamp = null) => {
    const s = setup(reads({ status: { stdout: STATUS_U } }), { isDirectory: p => !p.endsWith('.txt'), ...probe })
    const r = await s.invoke('git:deleteUntracked', REPO, WT, REG, paths, stamp ?? await s.invoke('git:stamp', REPO, WT, REG, { kind: 'files', paths }))
    return [r, s.deps.probe.unlink.mock.calls.map(c => c[0])]
  }

  it('deletes each untracked file after checking them all', async () => {
    expect(await del(['new.txt', 'sub/deep.txt'])).toEqual([
      { ok: true, detail: 'Deleted 2 untracked files.' }, [path.join(WT, 'new.txt'), path.join(WT, 'sub', 'deep.txt')],
    ])
  })

  it('deletes nothing when any path is tracked, a directory, or under a linked folder', async () => {
    expect(await del(['new.txt', 'a b.txt'])).toEqual([{ ok: false, detail: 'Not an untracked file any more: a b.txt' }, []])
    expect(await del(['new.txt'], { isDirectory: p => p.endsWith('new.txt') || !p.endsWith('.txt') }))
      .toEqual([{ ok: false, detail: 'Refusing a directory: new.txt' }, []])
    expect(await del(['new.txt', 'sub/deep.txt'], { isLink: p => p === path.join(WT, 'sub') }))
      .toEqual([{ ok: false, detail: 'Refusing a path through a linked folder: sub/deep.txt' }, []])
  })

  it('refuses a stale review and paths outside the worktree', async () => {
    expect(await del(['new.txt'], {}, 'old')).toEqual([{ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' }, []])
    await expect(del(['../outside.txt'])).rejects.toThrow('Invalid file path: ../outside.txt')
  })

  it('reports a file that could not be deleted part-way', async () => {
    const unlink = vi.fn(p => { if (p.endsWith('deep.txt')) throw new Error('EBUSY: resource busy') })
    const [r] = await del(['new.txt', 'sub/deep.txt'], { unlink })
    expect(r).toEqual({ ok: false, detail: 'Deleted 1 of 2 files; could not delete sub/deep.txt: EBUSY: resource busy' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: FAIL, because `handlers['git:deleteUntracked']` is not a function.

- [ ] **Step 3: Implement**

In `defaultProbe()`, add `unlink: p => fs.unlinkSync(p),`.

Inside `register`, after the `git:discard` registration, add:

```js
  // Files only: never a directory, never through a linked folder, and only while still untracked.
  // Every path is checked before anything is deleted.
  fileWrite('git:deleteUntracked', async (wt, rel, state) => {
    const untracked = new Set(state.records.filter(r => r.kind === '?').map(r => r.path));
    const root = path.resolve(wt);
    for (const p of rel) {
      const full = path.resolve(root, p);
      if (!untracked.has(p)) return refuse(`Not an untracked file any more: ${p}`);
      if (probe.isDirectory(full)) return refuse(`Refusing a directory: ${p}`);
      for (let dir = path.dirname(full); isInside(dir, root) && !samePath(dir, root); dir = path.dirname(dir)) {
        if (probe.isLink(dir)) return refuse(`Refusing a path through a linked folder: ${p}`);
      }
    }
    let deleted = 0;
    for (const p of rel) {
      try {
        probe.unlink(path.resolve(root, p));
        deleted++;
      } catch (e) {
        return refuse(`Deleted ${deleted} of ${rel.length} files; could not delete ${p}: ${e.message}`);
      }
    }
    return { ok: true, detail: `Deleted ${deleted} untracked file${deleted === 1 ? '' : 's'}.` };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js
git commit -m "feat(git): delete untracked files, files only, after checking every path"
```

---

### Task 7: Real-git integration test for every write

**Files:**
- Create: `apps/desktop/electron/ipc/git.writes.integration.test.js`

**Interfaces:**
- Consumes: the channels from Tasks 3–6, called through `register`'s handlers, and `parseDiff` from `@nexusmd/core`.
- Produces: nothing new. This task proves the writes against real git and real files.

- [ ] **Step 1: Write the test**

Create `apps/desktop/electron/ipc/git.writes.integration.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { parseDiff } from '@nexusmd/core'
import { register } from './git.cjs'

const STALE = 'Changed since you reviewed it. Refresh and review again.'
let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const call = (channel, ...args) => handlers[channel](null, ...args)
const repo = name => ({ name, path: path.join(root, name) })
const REG = () => ['Work', 'Fresh', 'Hooked'].map(n => path.join(root, n))
const story = changed => Array.from({ length: 30 }, (_, i) => `line ${i + 1}${changed.includes(i + 1) ? ' changed' : ''}`).join('\n') + '\n'
const CRLF = 'a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\nj\r\n'
const write = (r, file, text) => fs.writeFileSync(path.join(r.path, file), text)
const filesStamp = (r, wt, paths) => call('git:stamp', r, wt, REG(), { kind: 'files', paths })
const commitStamp = (r, wt) => call('git:stamp', r, wt, REG(), { kind: 'commit' })
const failWorktree = () => path.join(root, 'Hooked-fail-marker')

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-gitw-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'

  const work = repo('Work')
  fs.mkdirSync(work.path)
  run(work.path, 'init', '-b', 'main')
  write(work, 'story.txt', story([]))
  write(work, '-x [1].txt', 'odd\n')
  write(work, 'crlf.txt', CRLF)
  run(work.path, 'add', '.')
  run(work.path, 'commit', '-m', 'Initial')

  fs.mkdirSync(repo('Fresh').path)
  run(repo('Fresh').path, 'init', '-b', 'main')

  const hooked = repo('Hooked')
  fs.mkdirSync(hooked.path)
  run(hooked.path, 'init', '-b', 'main')
  write(hooked, 'base.txt', 'base\n')
  run(hooked.path, 'add', '.')
  run(hooked.path, 'commit', '-m', 'Base')
  run(hooked.path, 'worktree', 'add', '-b', 'side', failWorktree(), 'main')
  const hook = path.join(hooked.path, '.git', 'hooks', 'pre-commit')
  fs.writeFileSync(hook, '#!/bin/sh\ncase "$PWD" in *fail-marker*) echo "hook says no" >&2; exit 1;; esac\nexit 0\n')
  fs.chmodSync(hook, 0o755)

  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

describe('git workspace writes against real repositories', () => {
  it('stages and unstages single hunks, then discards the file', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([2, 15, 28]))
    const d = await call('git:diff', r, r.path, REG(), { area: 'unstaged', paths: ['story.txt'] })
    expect(parseDiff(d.text).files[0].hunks).toHaveLength(3)
    expect(await call('git:stageHunk', r, r.path, REG(), ['story.txt'], 1, d.stamp)).toMatchObject({ ok: true })
    const cached = run(r.path, 'diff', '--cached')
    expect(cached).toContain('+line 15 changed')
    expect(cached).not.toContain('line 2 changed')
    expect(cached).not.toContain('line 28 changed')
    const s = await call('git:diff', r, r.path, REG(), { area: 'staged', paths: ['story.txt'] })
    expect(await call('git:unstageHunk', r, r.path, REG(), ['story.txt'], 0, s.stamp)).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached')).toBe('')
    expect(await call('git:discard', r, r.path, REG(), ['story.txt'], await filesStamp(r, r.path, ['story.txt']))).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, 'story.txt'), 'utf8')).toBe(story([]))
  }, 60000)

  it('takes glob characters and leading dashes in names literally', async () => {
    const r = repo('Work')
    write(r, '-x [1].txt', 'odd changed\n')
    write(r, '-x 1.txt', 'decoy\n')
    expect(await call('git:stage', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached', '--name-only')).toBe('-x [1].txt\n')
    expect(run(r.path, 'ls-files', '--others', '--exclude-standard')).toBe('-x 1.txt\n')
    expect(await call('git:unstage', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'diff', '--cached', '--name-only')).toBe('')
    expect(await call('git:discard', r, r.path, REG(), ['-x [1].txt'], await filesStamp(r, r.path, ['-x [1].txt']))).toMatchObject({ ok: true })
    expect(fs.readFileSync(path.join(r.path, '-x [1].txt'), 'utf8')).toBe('odd\n')
    expect(fs.existsSync(path.join(r.path, '-x 1.txt'))).toBe(true)
    expect(await call('git:deleteUntracked', r, r.path, REG(), ['-x 1.txt'], await filesStamp(r, r.path, ['-x 1.txt'])))
      .toEqual({ ok: true, detail: 'Deleted 1 untracked file.' })
    expect(fs.existsSync(path.join(r.path, '-x 1.txt'))).toBe(false)
  }, 60000)

  it('stages one hunk of a CRLF file without touching the other', async () => {
    const r = repo('Work')
    write(r, 'crlf.txt', CRLF.replace('a\r\n', 'A\r\n').replace('j\r\n', 'J\r\n'))
    const d = await call('git:diff', r, r.path, REG(), { area: 'unstaged', paths: ['crlf.txt'] })
    expect(parseDiff(d.text).files[0].hunks).toHaveLength(2)
    expect(await call('git:stageHunk', r, r.path, REG(), ['crlf.txt'], 0, d.stamp)).toMatchObject({ ok: true })
    expect(run(r.path, 'show', ':crlf.txt')).toBe(CRLF.replace('a\r\n', 'A\r\n'))
    run(r.path, 'reset', '-q')
    run(r.path, 'checkout', '--', 'crlf.txt')
  }, 60000)

  it('refuses a write whose reviewed state changed', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([3]))
    const reviewed = await filesStamp(r, r.path, ['story.txt'])
    run(r.path, 'add', 'story.txt')
    expect(await call('git:stage', r, r.path, REG(), ['story.txt'], reviewed)).toEqual({ ok: false, stale: true, detail: STALE })
    run(r.path, 'reset', '-q')
    run(r.path, 'checkout', '--', 'story.txt')
  }, 60000)

  it('commits the staged changes with the given message', async () => {
    const r = repo('Work')
    write(r, 'story.txt', story([5]))
    await call('git:stage', r, r.path, REG(), ['story.txt'], await filesStamp(r, r.path, ['story.txt']))
    expect(await call('git:commit', r, r.path, REG(), 'Change line 5', await commitStamp(r, r.path))).toMatchObject({ ok: true })
    expect(run(r.path, 'log', '-1', '--format=%s')).toBe('Change line 5\n')
    expect(await call('git:commit', r, r.path, REG(), 'Again', await commitStamp(r, r.path))).toEqual({ ok: false, detail: 'No staged changes.' })
  }, 60000)

  it('stages and unstages on a branch with no commits', async () => {
    const r = repo('Fresh')
    write(r, 'a.txt', 'first\n')
    expect(await call('git:stage', r, r.path, REG(), ['a.txt'], await filesStamp(r, r.path, ['a.txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'status', '--porcelain')).toBe('A  a.txt\n')
    expect(await call('git:unstage', r, r.path, REG(), ['a.txt'], await filesStamp(r, r.path, ['a.txt']))).toMatchObject({ ok: true })
    expect(run(r.path, 'status', '--porcelain')).toBe('?? a.txt\n')
  }, 60000)

  it('commits each worktree separately: a failing hook in one does not stop the other', async () => {
    const r = repo('Hooked')
    for (const [wt, file] of [[r.path, 'ok.txt'], [failWorktree(), 'no.txt']]) {
      fs.writeFileSync(path.join(wt, file), 'x\n')
      await call('git:stage', r, wt, REG(), [file], await filesStamp(r, wt, [file]))
    }
    const ok = await call('git:commit', r, r.path, REG(), 'Works', await commitStamp(r, r.path))
    const no = await call('git:commit', r, failWorktree(), REG(), 'Blocked', await commitStamp(r, failWorktree()))
    expect(ok.ok).toBe(true)
    expect(no.ok).toBe(false)
    expect(no.detail).toContain('hook says no')
    expect(run(r.path, 'log', '-1', '--format=%s')).toBe('Works\n')
    expect(run(failWorktree(), 'log', '-1', '--format=%s')).toBe('Base\n')
  }, 60000)
})
```

- [ ] **Step 2: Run the test**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.writes.integration.test.js`
Expected: PASS (7 tests).

If a test fails, the bug is in the Task 3–6 code, not in the test. Fix the handler and keep the test as written. If git itself behaves differently from what a test assumes (for example the exact `git status --porcelain` text), confirm it by running the same git commands by hand in a scratch repo. Only then adjust that one expectation, and say so in your report.

- [ ] **Step 3: Run all main-process tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/ipc/git.writes.integration.test.js
git commit -m "test(git): stage 2 writes against real repositories"
```

---

### Task 8: Changes pane, selection and the worktree panel

**Files:**
- Create: `apps/desktop/src/views/git/changes-pane.jsx`, `apps/desktop/src/views/git/worktree-panel.jsx`
- Test: `apps/desktop/src/views/git/changes-pane.test.jsx`
- Modify:
  - `apps/desktop/src/views/git/worktree-detail.jsx`;
  - `apps/desktop/src/views/git/view-git.jsx`;
  - `apps/desktop/src/views/git/view-git.test.jsx`;
  - `apps/desktop/src/git-config.js`;
  - `apps/desktop/src/git-config.test.js`.

**Interfaces:**
- Consumes, from core: `groupChanges`, `actionsFor`, `toggleSelection`, `rangeSelection`, `pruneSelection`, `isSubmodule`, `statusCode` and `worktreeId`.
- Produces:
  - `ChangesPane({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy, status })`:
    - `onAction(action)` gets an action name from `FILE_ACTIONS`;
    - `status` is `{ ok, text } | null`.
  - `WorktreeHeader({ tree })`, exported from `worktree-detail.jsx`.
  - `WorktreePanel` (this task's version): `{ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy, status }`. Task 9 replaces it with a version that also takes `adapter`, `repo`, `registered`, `version`, `onHunk`, `split` and `onSplit`.
  - `getGitConfig().view.split`: a number from 0.2 to 0.8, default `0.45`.

- [ ] **Step 1: Write the failing changes-pane tests**

Create `apps/desktop/src/views/git/changes-pane.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ChangesPane } from './changes-pane.jsx'

afterEach(cleanup)

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: area === 'staged' ? 'M.' : '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const A = c('staged', 'a.txt')
const B = c('unstaged', 'b.txt')
const LIB = c('unstaged', 'lib', { sub: 'SC..' })
const NEW = c('untracked', 'new.txt')
const tree = { path: 'C:/repos/A', changes: [A, B, NEW, LIB] }

function renderPane(props = {}) {
  const handlers = { onSelectionChange: vi.fn(), onFocus: vi.fn(), onAction: vi.fn(), onCommit: vi.fn() }
  render(<ChangesPane tree={tree} selected={[]} focusId={null} {...handlers} {...props} />)
  return handlers
}
const button = name => screen.getByRole('button', { name })

describe('ChangesPane', () => {
  it('groups files as Staged, Changes and Untracked with coloured status codes', () => {
    renderPane()
    expect(screen.getByRole('group', { name: 'Staged (1)' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Changes (2)' })).getByText('b.txt')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Untracked (1)' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Conflicts/ })).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Changes (2)' })).getByText('submodule')).toBeTruthy()
  })

  it('counts what each action would touch and runs it', () => {
    const h = renderPane({ selected: [A.id, B.id, NEW.id, LIB.id] })
    expect(button('Stage 2').disabled).toBe(false)
    expect(button('Unstage 1').disabled).toBe(false)
    expect(button('Discard 1…').disabled).toBe(false)
    expect(button('Delete 1…').disabled).toBe(false)
    fireEvent.click(button('Stage 2'))
    expect(h.onAction).toHaveBeenCalledWith('stage')
    fireEvent.click(button('Commit…'))
    expect(h.onCommit).toHaveBeenCalled()
  })

  it('disables actions that do not apply, with a reason', () => {
    renderPane()
    expect(button('Stage').disabled).toBe(true)
    expect(button('Stage').title).toBe('Select changes that can be staged')
    expect(button('Discard…').title).toBe('Select unstaged changes to tracked files')
    expect(button('Commit…').disabled).toBe(false)
  })

  it('selects with checkboxes, shift-click ranges and group checkboxes, skipping submodules', () => {
    const h = renderPane({ focusId: A.id })
    fireEvent.click(screen.getByLabelText('Select b.txt'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
    fireEvent.click(screen.getByLabelText('Select new.txt'), { shiftKey: true })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([A.id, B.id, LIB.id, NEW.id])
    fireEvent.click(screen.getByLabelText('Select all Changes'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
    expect(screen.getByLabelText('Select lib').disabled).toBe(true)
  })

  it('focuses a file when its row is clicked', () => {
    const h = renderPane()
    fireEvent.click(screen.getByText('b.txt'))
    expect(h.onFocus).toHaveBeenCalledWith(B.id)
  })

  it('moves focus with the arrows, selects with Space and runs s, u and c', () => {
    const h = renderPane({ selected: [B.id, A.id], focusId: B.id })
    const list = screen.getByLabelText('Changed files')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(h.onFocus).toHaveBeenLastCalledWith(LIB.id)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(h.onFocus).toHaveBeenLastCalledWith(A.id)
    fireEvent.keyDown(list, { key: ' ' })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([A.id])
    fireEvent.keyDown(list, { key: 's' })
    expect(h.onAction).toHaveBeenLastCalledWith('stage')
    fireEvent.keyDown(list, { key: 'u' })
    expect(h.onAction).toHaveBeenLastCalledWith('unstage')
    fireEvent.keyDown(list, { key: 'c' })
    expect(h.onCommit).toHaveBeenCalled()
  })

  it('locks the toolbar while a write runs and shows the last result', () => {
    renderPane({ selected: [B.id], busy: true, status: { ok: false, text: 'fatal: nope' } })
    expect(button('Stage 1').disabled).toBe(true)
    expect(button('Commit…').disabled).toBe(true)
    expect(screen.getByText('Working…')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('fatal: nope')
  })

  it('says when there are no changes', () => {
    renderPane({ tree: { path: 'C:/repos/A', changes: [] } })
    expect(screen.getByText('No changes.')).toBeTruthy()
    expect(button('Commit…').disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Write the failing config and view tests**

Append inside `describe('git config', …)` in `apps/desktop/src/git-config.test.js` (its `beforeEach` clears localStorage, and it already imports `getGitConfig` and `setGitConfig`):

```js
  it('keeps a valid diff split and replaces an invalid one with the default', () => {
    setGitConfig({ view: { ...getGitConfig().view, split: 0.6 } })
    expect(getGitConfig().view.split).toBe(0.6)
    setGitConfig({ view: { ...getGitConfig().view, split: 5 } })
    expect(getGitConfig().view.split).toBe(0.45)
  })
```

Add to `apps/desktop/src/views/git/view-git.test.jsx`, inside `describe('ViewGit', …)`:

```jsx
  it('drops selected files that vanish on refresh', async () => {
    configure()
    let now = porcelain
    const a = adapter({ status: vi.fn(async () => ({ porcelain: now, operation: '', rebasingBranch: null, fetchedAt: null })) })
    render(<ViewGit adapters={{ git: a }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    expect(screen.getByRole('button', { name: 'Stage 1' })).toBeTruthy()
    now = '# branch.oid a\0# branch.head main\0'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stage' }).disabled).toBe(true))
    expect(screen.getByText('No changes.')).toBeTruthy()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git src/git-config.test.js`
Expected: FAIL, because `./changes-pane.jsx` can't be resolved, the split is `undefined`, and there's no "Select f.txt" label.

- [ ] **Step 4: Add `view.split` to settings**

In `apps/desktop/src/git-config.js`, set the default view to:

```js
  view: Object.freeze({ group: 'All projects', collapsed: [], selected: null, split: 0.45 }),
```

`fresh()` spreads the default view, so it picks up `split` without changes.

In `normalise`, add this as the last property of the returned `view` object:

```js
      split: typeof view.split === 'number' && view.split >= 0.2 && view.split <= 0.8 ? view.split : DEFAULT_GIT_CONFIG.view.split,
```

- [ ] **Step 5: Add `WorktreeHeader`**

In `apps/desktop/src/views/git/worktree-detail.jsx`, add after `Field`:

```jsx
/** Where a worktree is and how it tracks its upstream; shown above its changes. */
export function WorktreeHeader({ tree }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Field label="Path" value={tree.path} />
      <Field label="Upstream" value={tree.upstream ? `${tree.upstream}${tree.upstreamGone ? ' (missing)' : ''}` : 'None'} />
      <Field label="Last fetch" value={tree.fetchedAt ? new Date(tree.fetchedAt).toLocaleString() : 'Unknown'} />
      <Field label="In progress" value={tree.operation} />
      <Field label="Locked" value={tree.locked} />
      <Field label="Stale" value={tree.prunable} />
      {tree.error && <div role="alert" style={{ color: 'var(--danger)' }}>{tree.error}</div>}
    </div>
  )
}
```

In `WorktreeDetail`'s worktree branch, replace the six `<Field …/>` lines and the `{tree.error && …}` line with `<WorktreeHeader tree={tree} />`.

- [ ] **Step 6: Implement `ChangesPane`**

Create `apps/desktop/src/views/git/changes-pane.jsx`:

```jsx
import React from 'react'
import { statusCode, groupChanges, actionsFor, toggleSelection, rangeSelection, isSubmodule } from '@nexusmd/core'

const AREA_COLOUR = { staged: 'var(--success)', unstaged: 'var(--warning)', untracked: 'var(--warning)', conflict: 'var(--danger)' }
const VERB = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard', delete: 'Delete' }
const DESTRUCTIVE = new Set(['discard', 'delete'])
const NONE = {
  stage: 'Select changes that can be staged',
  unstage: 'Select staged changes',
  discard: 'Select unstaged changes to tracked files',
  delete: 'Select untracked files',
}

function ChangeGroup({ group, selected, focusId, onFocus, onSelect, onSelectionChange }) {
  const ids = group.changes.filter(c => !isSubmodule(c)).map(c => c.id)
  const chosen = ids.filter(id => selected.includes(id)).length
  const box = React.useRef(null)
  React.useEffect(() => { if (box.current) box.current.indeterminate = chosen > 0 && chosen < ids.length }, [chosen, ids.length])
  const toggleAll = () => onSelectionChange(chosen === ids.length
    ? selected.filter(id => !ids.includes(id))
    : [...selected, ...ids.filter(id => !selected.includes(id))])
  const title = `${group.title} (${group.changes.length})`
  return (
    <div role="group" aria-label={title}>
      <label style={{ display: 'flex', gap: 6, fontWeight: 600, padding: '4px 0' }}>
        <input ref={box} type="checkbox" aria-label={`Select all ${group.title}`} checked={ids.length > 0 && chosen === ids.length}
          disabled={!ids.length} onChange={toggleAll} />
        {title}
      </label>
      {group.changes.map(c => (
        <div key={c.id} aria-current={c.id === focusId ? 'true' : undefined}
          onClick={e => (e.shiftKey ? onSelect(c.id, true) : onFocus(c.id))}
          style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 4px', cursor: 'pointer', background: c.id === focusId ? 'var(--accent-soft)' : undefined }}>
          <input type="checkbox" aria-label={`Select ${c.path}`} checked={selected.includes(c.id)} disabled={isSubmodule(c)}
            onClick={e => e.stopPropagation()} onChange={e => onSelect(c.id, e.nativeEvent.shiftKey)} />
          <span style={{ color: AREA_COLOUR[c.area], whiteSpace: 'pre' }}>{statusCode(c)}</span>
          <span>{c.path}</span>
          {c.originalPath && <span style={{ color: 'var(--text-muted)' }}>{`← ${c.originalPath}`}</span>}
          {isSubmodule(c) && <span style={{ color: 'var(--text-muted)' }}>submodule</span>}
        </div>
      ))}
    </div>
  )
}

/** A worktree's changed files with selection, the file-action toolbar and the last result. */
export function ChangesPane({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy = false, status = null }) {
  const groups = groupChanges(tree.changes)
  const ordered = groups.flatMap(g => g.changes)
  const actions = actionsFor(tree.changes, selected)
  const canCommit = tree.changes.some(c => c.area === 'staged')
  const select = (id, shift) => onSelectionChange(shift && focusId ? rangeSelection(ordered, selected, focusId, id) : toggleSelection(selected, id))
  const run = action => { if (!busy && actions[action].length) onAction(action) }
  const commit = () => { if (!busy && canCommit) onCommit() }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = ordered.findIndex(c => c.id === focusId)
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) onFocus(next.id)
    } else if (e.key === ' ' && focusId) {
      e.preventDefault()
      select(focusId, e.shiftKey)
    } else if (e.key === 's') run('stage')
    else if (e.key === 'u') run('unstage')
    else if (e.key === 'c') commit()
  }
  return (
    <section aria-label="Changes" style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', gap: 8, minHeight: 0 }}>
      <div role="toolbar" aria-label="File actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.keys(VERB).map(a => {
          const n = actions[a].length
          return (
            <button key={a} className={`btn sm${DESTRUCTIVE.has(a) ? ' danger' : ''}`} disabled={busy || !n} title={n ? undefined : NONE[a]}
              onClick={() => run(a)}>
              {`${VERB[a]}${n ? ` ${n}` : ''}${DESTRUCTIVE.has(a) ? '…' : ''}`}
            </button>
          )
        })}
        <button className="btn sm" disabled={busy || !canCommit} title={canCommit ? undefined : 'Stage changes to commit'} onClick={commit}>Commit…</button>
        {busy && <span aria-live="polite" style={{ color: 'var(--text-muted)' }}>Working…</span>}
      </div>
      <div>
        {status && (
          <div role={status.ok ? 'status' : 'alert'} style={{ color: status.ok ? 'var(--text-muted)' : 'var(--danger)', whiteSpace: 'pre-wrap' }}>
            {status.text}
          </div>
        )}
      </div>
      {!groups.length
        ? <div style={{ color: 'var(--text-muted)' }}>No changes.</div>
        : (
          <div tabIndex={0} aria-label="Changed files" onKeyDown={onKeyDown} style={{ overflow: 'auto', minHeight: 0, fontFamily: 'var(--font-mono, monospace)' }}>
            {groups.map(g => (
              <ChangeGroup key={g.area} group={g} selected={selected} focusId={focusId} onFocus={onFocus} onSelect={select} onSelectionChange={onSelectionChange} />
            ))}
          </div>
        )}
    </section>
  )
}
```

- [ ] **Step 7: Implement the first `WorktreePanel`**

Create `apps/desktop/src/views/git/worktree-panel.jsx`:

```jsx
import React from 'react'
import { WorktreeHeader } from './worktree-detail.jsx'
import { ChangesPane } from './changes-pane.jsx'

/** The selected worktree: where it is, then its changes. Task 9 adds the diff pane below. */
export function WorktreePanel({ tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, busy, status }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WorktreeHeader tree={tree} />
      <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
        onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
    </div>
  )
}
```

- [ ] **Step 8: Wire the panel into the view**

In `apps/desktop/src/views/git/view-git.jsx`:

1. Add these imports:

```jsx
import { pruneSelection } from '@nexusmd/core'
import { WorktreePanel } from './worktree-panel.jsx'
```

Add `pruneSelection` to the existing `@nexusmd/core` import rather than as a second import line.

2. In `GitWorkspace`, after `const [editing, setEditing] = React.useState(null)`, add:

```jsx
  // Per worktree, for this session: which changes are ticked and which one shows its diff.
  const [selections, setSelections] = React.useState({})
  const [focus, setFocus] = React.useState({})
```

3. After `const selectedBranch = …`, add:

```jsx
  const treeKey = selectedTree ? worktreeId(selectedTree) : null
  const selectedIds = selectedTree ? pruneSelection(selections[treeKey] ?? [], selectedTree.changes) : []
  const focusId = selectedTree && selectedTree.changes.some(c => c.id === focus[treeKey]) ? focus[treeKey] : null
```

4. Change the two-column grid's `gridTemplateColumns` from `'minmax(0, 3fr) minmax(0, 2fr)'` to `'minmax(0, 2fr) minmax(0, 3fr)'`. Replace the `<aside aria-label="Details" …>…</aside>` element with:

```jsx
        <aside aria-label="Details" className="card" style={{ padding: 12, minWidth: 0 }}>
          {selectedTree
            ? (
              <WorktreePanel tree={selectedTree} selected={selectedIds} focusId={focusId}
                onSelectionChange={ids => setSelections(s => ({ ...s, [treeKey]: ids }))}
                onFocus={id => setFocus(f => ({ ...f, [treeKey]: id }))}
                onAction={() => {}} onCommit={() => {}} busy={false} status={null} />
            )
            : <WorktreeDetail tree={null} branch={selectedBranch} />}
        </aside>
```

`onAction` and `onCommit` stay no-ops until Tasks 10 and 11 replace them.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git src/git-config.test.js`
Expected: PASS. The stage 1 test "shows worktree details with status codes when a row is selected" still passes: the header shows the path, and the list shows ` M` and `f.txt`.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/views/git/changes-pane.jsx apps/desktop/src/views/git/changes-pane.test.jsx apps/desktop/src/views/git/worktree-panel.jsx apps/desktop/src/views/git/worktree-detail.jsx apps/desktop/src/views/git/view-git.jsx apps/desktop/src/views/git/view-git.test.jsx apps/desktop/src/git-config.js apps/desktop/src/git-config.test.js
git commit -m "feat(git): changes pane with selection, toolbar counts and keys"
```

---

### Task 9: Diff pane, on-demand loading and the divider

**Files:**
- Create: `apps/desktop/src/views/git/use-diff.js`, `apps/desktop/src/views/git/diff-pane.jsx`
- Test: `apps/desktop/src/views/git/use-diff.test.js`, `apps/desktop/src/views/git/diff-pane.test.jsx`
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (full replacement), `apps/desktop/src/views/git/view-git.jsx`

**Interfaces:**
- Consumes:
  - from core: `parseDiff`, `diffSides` and `changePaths`;
  - `adapter.diff` (Task 3);
  - `ChangesPane` and `WorktreeHeader` (Task 8).
- Produces:
  - `useDiff({ adapter, repo, worktreePath, registered, change, version })` returns `{ key, result, files, error, loading }`. `result` is the `git:diff` value; `files` is `parseDiff(result.text).files`.
  - `DiffPane({ change, diff, onHunk, busy })`, which calls `onHunk(index, stamp)`.
  - The full `WorktreePanel({ adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onHunk, busy, status, split, onSplit })`, which calls `onHunk(change, index, stamp)`.

- [ ] **Step 1: Write the failing hook tests**

Create `apps/desktop/src/views/git/use-diff.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useDiff } from './use-diff.js'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const change = (path, area = 'unstaged', extra = {}) => ({ path, originalPath: null, area, xy: '.M', sub: 'N...', id: `${area}\0${path}`, ...extra })
const TEXT = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('useDiff', () => {
  it('loads nothing until a change is focused', () => {
    const adapter = { diff: vi.fn() }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: null, version: 1 }))
    expect(adapter.diff).not.toHaveBeenCalled()
    expect(result.current.files).toEqual([])
  })

  it('loads the focused change once, with its area and both rename paths', async () => {
    const adapter = { diff: vi.fn(async () => ({ text: TEXT, stamp: 's1', truncated: false, binary: false, size: 10 })) }
    const moved = change('moved.txt', 'staged', { originalPath: 'was.txt' })
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: p.change, version: 1 }), { initialProps: { change: moved } })
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    expect(adapter.diff).toHaveBeenCalledWith(repo, repo.path, registered, { area: 'staged', paths: ['moved.txt', 'was.txt'] })
    expect(result.current.files[0].hunks).toHaveLength(1)
    rerender({ change: { ...moved } })
    expect(adapter.diff).toHaveBeenCalledTimes(1)
  })

  it('reloads on a new snapshot while keeping the last diff on screen', async () => {
    const next = deferred()
    let calls = 0
    const adapter = { diff: vi.fn(() => (++calls === 1 ? Promise.resolve({ text: TEXT, stamp: 's1' }) : next.promise)) }
    const f = change('f.txt')
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: f, version: p.version }), { initialProps: { version: 1 } })
    await waitFor(() => expect(result.current.result?.stamp).toBe('s1'))
    rerender({ version: 2 })
    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.result.stamp).toBe('s1')
    await act(async () => { next.resolve({ text: TEXT, stamp: 's2' }) })
    expect(result.current.result.stamp).toBe('s2')
  })

  it('keeps only the newest response when the focus moves quickly', async () => {
    const slow = deferred()
    const adapter = { diff: vi.fn(async (_r, _w, _g, ch) => (ch.paths[0] === 'slow.txt' ? slow.promise : { text: TEXT, stamp: 'fast' })) }
    const { result, rerender } = renderHook(p => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: p.change, version: 1 }), { initialProps: { change: change('slow.txt') } })
    rerender({ change: change('fast.txt') })
    await waitFor(() => expect(result.current.result?.stamp).toBe('fast'))
    await act(async () => { slow.resolve({ text: TEXT, stamp: 'slow' }) })
    expect(result.current.result.stamp).toBe('fast')
  })

  it('reports a failed load', async () => {
    const adapter = { diff: vi.fn(async () => { throw new Error('boom') }) }
    const { result } = renderHook(() => useDiff({ adapter, repo, worktreePath: repo.path, registered, change: change('f.txt'), version: 1 }))
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })
})
```

- [ ] **Step 2: Write the failing diff-pane tests**

Create `apps/desktop/src/views/git/diff-pane.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { parseDiff } from '@nexusmd/core'
import { DiffPane } from './diff-pane.jsx'

afterEach(cleanup)

const TWO = [
  'diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt',
  '@@ -1,2 +1,2 @@', ' keep', '-old line', '+new line',
  '@@ -10 +10,2 @@', ' ten', '+added',
].join('\n') + '\n'
const change = (area, path = 'f.txt') => ({ path, originalPath: null, area, xy: '.M', sub: 'N...', id: `${area}\0${path}` })
const loaded = (text, extra = {}) => ({ key: 'k', result: { text, stamp: 's1', truncated: false, binary: false, size: text.length, ...extra }, files: parseDiff(text).files, error: null, loading: false })

describe('DiffPane', () => {
  it('labels which side is old and which is new, with line-number gutters and +/− signs', () => {
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={vi.fn()} />)
    const legend = screen.getByLabelText('Diff legend')
    expect(within(legend).getByText('− old: index')).toBeTruthy()
    expect(within(legend).getByText('+ new: working tree')).toBeTruthy()
    const rows = screen.getAllByTestId('diff-line')
    expect(rows.map(r => [r.dataset.kind, r.textContent])).toEqual([
      ['context', '11 keep'], ['del', '2−old line'], ['add', '2+new line'], ['context', '1010 ten'], ['add', '11+added'],
    ])
  })

  it('offers Stage hunk per hunk for unstaged changes and Unstage hunk for staged ones', () => {
    const onHunk = vi.fn()
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={onHunk} />)
    const buttons = screen.getAllByRole('button', { name: 'Stage hunk' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onHunk).toHaveBeenCalledWith(1, 's1')
    cleanup()
    render(<DiffPane change={change('staged')} diff={loaded(TWO)} onHunk={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Unstage hunk' })).toHaveLength(2)
    expect(screen.getByText('− old: HEAD')).toBeTruthy()
  })

  it('disables hunk buttons while a write runs', () => {
    render(<DiffPane change={change('unstaged')} diff={loaded(TWO)} onHunk={vi.fn()} busy />)
    expect(screen.getAllByRole('button', { name: 'Stage hunk' }).every(b => b.disabled)).toBe(true)
  })

  it('shows untracked files as new with no hunk buttons', () => {
    render(<DiffPane change={change('untracked', 'n.txt')} diff={loaded('--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1 @@\n+hi\n')} onHunk={vi.fn()} />)
    expect(screen.getByText('+ new file')).toBeTruthy()
    expect(screen.queryByText(/old:/)).toBeNull()
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })

  it('explains binary, oversized, conflicted, empty and vanished files', () => {
    const notes = (area, diff) => { cleanup(); render(<DiffPane change={change(area)} diff={diff} onHunk={vi.fn()} />); return screen.getAllByRole('note').map(n => n.textContent) }
    expect(notes('unstaged', loaded('Binary files a/f.txt and b/f.txt differ\n', { binary: true, size: 2048 }))).toEqual(['Binary file (2 KB). Stage or discard it as a whole.'])
    expect(notes('unstaged', loaded('', { truncated: true, size: 3 * 1024 * 1024 }))).toEqual(['This diff is too large to show (3.0 MB). Stage or discard the file as a whole.'])
    expect(notes('conflict', loaded(''))).toEqual(['Resolve in your editor, then stage the file.'])
    expect(notes('untracked', loaded(''))).toEqual(['Empty file.'])
    expect(notes('unstaged', loaded('', { gone: true }))).toEqual(['No longer changed.'])
    expect(screen.queryByRole('button', { name: /hunk/ })).toBeNull()
  })

  it('asks for a file when none is focused and shows load errors', () => {
    render(<DiffPane change={null} diff={{ result: null, files: [], error: null, loading: false }} onHunk={vi.fn()} />)
    expect(screen.getByText('Select a file to see its diff.')).toBeTruthy()
    cleanup()
    render(<DiffPane change={change('unstaged')} diff={{ result: null, files: [], error: 'boom', loading: false }} onHunk={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('boom')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/use-diff.test.js src/views/git/diff-pane.test.jsx`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 4: Implement `useDiff`**

Create `apps/desktop/src/views/git/use-diff.js`:

```js
import React from 'react'
import { parseDiff, changePaths } from '@nexusmd/core'

const EMPTY = { key: null, result: null, files: [], error: null, loading: false }

// Loads the focused change's diff on demand. A new snapshot (`version`) reloads it, because porcelain
// status can't tell whether an unstaged edit changed; the last diff stays on screen meanwhile.
// Only the newest response is kept.
export function useDiff({ adapter, repo, worktreePath, registered, change, version }) {
  const [state, setState] = React.useState(EMPTY)
  const seq = React.useRef(0)
  const key = change ? `${worktreePath}\0${change.id}` : null
  const request = change ? JSON.stringify({ repo: { name: repo.name, path: repo.path }, registered, change: { area: change.area, paths: changePaths(change) } }) : null
  React.useEffect(() => {
    const id = ++seq.current
    if (!request) { setState(EMPTY); return undefined }
    let live = true
    const r = JSON.parse(request)
    setState(s => (s.key === key ? { ...s, loading: true, error: null } : { ...EMPTY, key, loading: true }))
    adapter.diff(r.repo, worktreePath, r.registered, r.change).then(
      result => { if (live && id === seq.current) setState({ key, result, files: parseDiff(result.text).files, error: null, loading: false }) },
      e => { if (live && id === seq.current) setState({ ...EMPTY, key, error: e?.message || 'Could not load the diff' }) },
    )
    return () => { live = false }
  }, [adapter, worktreePath, key, request, version])
  return state
}
```

- [ ] **Step 5: Implement `DiffPane`**

Create `apps/desktop/src/views/git/diff-pane.jsx`:

```jsx
import React from 'react'
import { diffSides } from '@nexusmd/core'

const LINE_STYLE = {
  add: { background: 'color-mix(in srgb, var(--success) 18%, transparent)' },
  del: { background: 'color-mix(in srgb, var(--danger) 18%, transparent)' },
  context: {},
  meta: { color: 'var(--text-muted)', fontStyle: 'italic' },
}
const SIGN = { add: '+', del: '−', context: ' ', meta: ' ' }
const GRID = { display: 'grid', gridTemplateColumns: '5ch 5ch 2ch 1fr', columnGap: 4 }
const size = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`)
const note = text => <div role="note" style={{ color: 'var(--text-muted)', padding: 8 }}>{text}</div>

/** A change's unified diff: a legend naming the old and new sides, line numbers, and hunk buttons. */
export function DiffPane({ change, diff, onHunk, busy = false }) {
  if (!change) return <div style={{ color: 'var(--text-muted)' }}>Select a file to see its diff.</div>
  const sides = diffSides(change)
  const { result, files, error, loading } = diff
  const hunkLabel = sides?.staging === 'stage' ? 'Stage hunk' : sides?.staging === 'unstage' ? 'Unstage hunk' : null
  const showHunks = !!hunkLabel && !!result && !result.binary && !result.truncated && files.length === 1
  const plain = result && !result.gone && !result.binary && !result.truncated && !result.text
  return (
    <section aria-label="Diff" style={{ minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
      <div aria-label="Diff legend" style={{ display: 'flex', gap: 16, padding: '4px 0', position: 'sticky', top: 0, background: 'var(--surface, var(--bg))' }}>
        {sides?.old && <span style={{ color: 'var(--danger)' }}>{`− old: ${sides.old}`}</span>}
        {sides && <span style={{ color: 'var(--success)' }}>{sides.old ? `+ new: ${sides.new}` : `+ ${sides.new}`}</span>}
        <span style={{ marginLeft: 'auto' }}>{change.path}</span>
        {loading && <span style={{ color: 'var(--text-muted)' }}>Loading…</span>}
      </div>
      {sides?.old && <div aria-hidden="true" style={{ ...GRID, color: 'var(--text-muted)' }}><span>old</span><span>new</span></div>}
      {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      {result?.gone && note('No longer changed.')}
      {result?.binary && note(`Binary file${result.size ? ` (${size(result.size)})` : ''}. Stage or discard it as a whole.`)}
      {result?.truncated && note(`This diff is too large to show (${size(result.size)}). Stage or discard the file as a whole.`)}
      {change.area === 'conflict' && note('Resolve in your editor, then stage the file.')}
      {plain && change.area !== 'conflict' && note(change.area === 'untracked' ? 'Empty file.' : 'No textual changes (mode change or submodule).')}
      {files.map((f, fi) => (
        <div key={fi}>
          {files.length > 1 && <div style={{ fontWeight: 600, paddingTop: 6 }}>{f.path}</div>}
          {f.meta.map((m, i) => <div key={i} style={LINE_STYLE.meta}>{m}</div>)}
          {f.hunks.map((h, hi) => (
            <div key={hi} role="group" aria-label={`Hunk ${hi + 1}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', paddingTop: 6 }}>
                <span>{h.header}</span>
                {showHunks && (
                  <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => onHunk(hi, result.stamp)}>{hunkLabel}</button>
                )}
              </div>
              {h.lines.map((l, li) => (
                <div key={li} data-testid="diff-line" data-kind={l.kind} style={{ ...GRID, ...LINE_STYLE[l.kind] }}>
                  <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.oldNo ?? ''}</span>
                  <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{l.newNo ?? ''}</span>
                  <span>{SIGN[l.kind]}</span>
                  <span style={{ whiteSpace: 'pre' }}>{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
```

The gutter test reads `textContent`, which joins the four spans: `'1' + '1' + ' ' + 'keep'` gives `'11 keep'`, and `'2' + '' + '−' + 'old line'` gives `'2−old line'`.

The conflict case also runs its `plain` check, so its notes are exactly the conflict note. That's why `plain` excludes conflicts.

- [ ] **Step 6: Replace `WorktreePanel` with the full version**

Replace `apps/desktop/src/views/git/worktree-panel.jsx` with:

```jsx
import React from 'react'
import { WorktreeHeader } from './worktree-detail.jsx'
import { ChangesPane } from './changes-pane.jsx'
import { DiffPane } from './diff-pane.jsx'
import { useDiff } from './use-diff.js'

const clamp = v => Math.min(0.8, Math.max(0.2, v))

/** The selected worktree: where it is, its changes, and the focused file's diff below a divider. */
export function WorktreePanel({
  adapter, repo, registered, version, tree, selected, onSelectionChange, focusId, onFocus, onAction, onCommit, onHunk,
  busy, status, split, onSplit,
}) {
  const change = tree.changes.find(c => c.id === focusId) ?? null
  const diff = useDiff({ adapter, repo, worktreePath: tree.path, registered, change, version })
  const box = React.useRef(null)
  const drag = e => {
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    const move = ev => onSplit(clamp((ev.clientY - rect.top) / rect.height))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = e => {
    if (e.key === 'ArrowUp') onSplit(clamp(split - 0.05))
    if (e.key === 'ArrowDown') onSplit(clamp(split + 0.05))
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WorktreeHeader tree={tree} />
      <div ref={box} style={{ display: 'grid', gridTemplateRows: `minmax(0, ${split}fr) 6px minmax(0, ${1 - split}fr)`, height: '70vh', minHeight: 320 }}>
        <ChangesPane tree={tree} selected={selected} onSelectionChange={onSelectionChange} focusId={focusId} onFocus={onFocus}
          onAction={onAction} onCommit={onCommit} busy={busy} status={status} />
        <div role="separator" aria-orientation="horizontal" aria-label="Resize changes and diff" aria-valuenow={Math.round(split * 100)}
          tabIndex={0} onPointerDown={drag} onKeyDown={nudge} style={{ cursor: 'row-resize', background: 'var(--border)' }} />
        <DiffPane change={change} diff={diff} busy={busy} onHunk={(index, stamp) => onHunk(change, index, stamp)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Pass the new props from the view**

In `apps/desktop/src/views/git/view-git.jsx`:

1. After `const config = useGitConfig()`, add:

```jsx
  const registered = React.useMemo(() => config.repos.map(r => r.path), [config.repos])
```

2. Replace the `<WorktreePanel … />` element with:

```jsx
              <WorktreePanel adapter={adapter} repo={{ name: selectedTree.repo, path: selectedTree.repoRoot }} registered={registered}
                version={snapshot?.takenAt} tree={selectedTree} selected={selectedIds} focusId={focusId}
                onSelectionChange={ids => setSelections(s => ({ ...s, [treeKey]: ids }))}
                onFocus={id => setFocus(f => ({ ...f, [treeKey]: id }))}
                onAction={() => {}} onCommit={() => {}} onHunk={() => {}} busy={false} status={null}
                split={view.split} onSplit={split => setView({ split })} />
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git`
Expected: PASS. Stage 1's view tests don't focus a file, so they never call `adapter.diff`.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/views/git/use-diff.js apps/desktop/src/views/git/use-diff.test.js apps/desktop/src/views/git/diff-pane.jsx apps/desktop/src/views/git/diff-pane.test.jsx apps/desktop/src/views/git/worktree-panel.jsx apps/desktop/src/views/git/view-git.jsx
git commit -m "feat(git): diff pane with old/new legend, gutters and hunk buttons"
```

---

### Task 10: Review dialog and running file writes

**Files:**
- Create: `apps/desktop/src/views/git/use-git-actions.js`, `apps/desktop/src/views/git/review-dialog.jsx`
- Test: `apps/desktop/src/views/git/view-git-actions.test.jsx`
- Modify: `apps/desktop/src/views/git/view-git.jsx`

**Interfaces:**
- Consumes:
  - from core: `fileReview`, `changePaths` and `worktreeName`;
  - adapter `stamp`, `stage`, `unstage`, `discard`, `deleteUntracked`, `stageHunk` and `unstageHunk`;
  - `refresh` from `useGitSnapshot`.
- Produces:
  - `useGitActions({ adapter, registered, refresh })` returns `{ review, openReview(action, tree, selectedIds), closeReview(), confirm(), hunk(tree, change, index, stamp), busy: { [treePath]: true }, status: { [treePath]: { ok, text } } }`;
  - `ReviewDialog({ state, onClose, onConfirm })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/views/git/view-git-actions.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); clearGitSnapshotCache() })

const DIRTY = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\x001 .M N... 100644 100644 100644 a a f.txt\0? new.txt\0'
const TWO = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-i\n+I\n'
const STALE = 'Changed since you reviewed it. Refresh and review again.'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function setupView(over = {}) {
  setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], groups: [] })
  const state = { porcelain: DIRTY }
  const a = {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain: state.porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    diff: vi.fn(async () => ({ text: TWO, stamp: 'd1', truncated: false, binary: false, size: TWO.length })),
    stamp: vi.fn(async () => 'stamp-1'),
    stage: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    unstage: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    discard: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    deleteUntracked: vi.fn(async () => ({ ok: true, detail: 'Deleted 1 untracked file.' })),
    stageHunk: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    unstageHunk: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    ...over,
  }
  render(<ViewGit adapters={{ git: a }} />)
  return { a, state }
}

async function openWorktree() {
  const region = await screen.findByRole('region', { name: 'A' })
  fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
  await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
}

const REPO = { name: 'A', path: 'C:/repos/A' }
const REG = ['C:/repos/A']

describe('file actions', () => {
  it('reviews, then stages the selected files and refreshes', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Stage 1 file')).toBeTruthy()
    expect(within(dialog).getByText('f.txt', { exact: false })).toBeTruthy()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Stage' }).disabled).toBe(false))
    expect(a.stamp).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, { kind: 'files', paths: ['f.txt'] })
    const statusCalls = a.status.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(a.stage).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 'stamp-1'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done'))
    await waitFor(() => expect(a.status.mock.calls.length).toBeGreaterThan(statusCalls))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('requires typing DISCARD before discarding', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard 1…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert').textContent).toBe("Unstaged edits in these files will be lost. This can't be undone.")
    const run = within(dialog).getByRole('button', { name: 'Discard' })
    await waitFor(() => expect(a.stamp).toHaveBeenCalled())
    expect(run.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type DISCARD to confirm'), { target: { value: 'discard' } })
    expect(run.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type DISCARD to confirm'), { target: { value: 'DISCARD' } })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    await waitFor(() => expect(a.discard).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 'stamp-1'))
  })

  it('requires typing DELETE before deleting untracked files', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select new.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1…' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(a.stamp).toHaveBeenCalled())
    fireEvent.change(within(dialog).getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(a.deleteUntracked).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['new.txt'], 'stamp-1'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Deleted 1 untracked file.'))
  })

  it('shows the stale message when the files changed after review', async () => {
    setupView({ stage: vi.fn(async () => ({ ok: false, stale: true, detail: STALE })) })
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Stage' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(STALE))
  })

  it('keeps the reviewed file list when a poll arrives while the dialog is open', async () => {
    const { state } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    state.porcelain = '# branch.oid a\0# branch.head main\0'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('No changes.')).toBeTruthy())
    expect(within(screen.getByRole('dialog')).getByText('f.txt', { exact: false })).toBeTruthy()
  })

  it('runs a confirmed write once even when Run is clicked twice', async () => {
    const pending = deferred()
    const { a } = setupView({ stage: vi.fn(() => pending.promise) })
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const run = within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    fireEvent.click(run)
    await act(async () => { pending.resolve({ ok: true, detail: 'Done' }) })
    expect(a.stage).toHaveBeenCalledTimes(1)
  })

  it('stages one hunk from the diff pane, once, with the diff stamp', async () => {
    const pending = deferred()
    const { a } = setupView({ stageHunk: vi.fn(() => pending.promise) })
    await openWorktree()
    fireEvent.click(screen.getByText('f.txt'))
    const buttons = await screen.findAllByRole('button', { name: 'Stage hunk' })
    fireEvent.click(buttons[1])
    fireEvent.click(buttons[1])
    await act(async () => { pending.resolve({ ok: true, detail: 'Done' }) })
    expect(a.stageHunk).toHaveBeenCalledTimes(1)
    expect(a.stageHunk).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 1, 'd1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/view-git-actions.test.jsx`
Expected: FAIL, because no dialog opens (`onAction` is still a no-op).

- [ ] **Step 3: Implement `useGitActions`**

Create `apps/desktop/src/views/git/use-git-actions.js`:

```js
import React from 'react'
import { fileReview, changePaths } from '@nexusmd/core'

const METHOD = { stage: 'stage', unstage: 'unstage', discard: 'discard', delete: 'deleteUntracked' }
const repoOf = tree => ({ name: tree.repo, path: tree.repoRoot })
const message = e => e?.message || String(e)

// Reviews and runs file writes. One write per worktree at a time here (main also locks per repo),
// so a double click can never run a write twice. The last result is kept per worktree.
export function useGitActions({ adapter, registered, refresh }) {
  const [review, setReview] = React.useState(null)
  const [busy, setBusy] = React.useState({})
  const [status, setStatus] = React.useState({})
  const running = React.useRef(new Set())
  const reviews = React.useRef(0)

  const guard = async (tree, write) => {
    if (running.current.has(tree.path)) return
    running.current.add(tree.path)
    setBusy(b => ({ ...b, [tree.path]: true }))
    let r
    try { r = await write() } catch (e) { r = { ok: false, detail: message(e) } }
    running.current.delete(tree.path)
    setBusy(b => { const next = { ...b }; delete next[tree.path]; return next })
    setStatus(s => ({ ...s, [tree.path]: { ok: !!r.ok, text: r.detail } }))
    refresh()
  }

  const openReview = (action, tree, selectedIds) => {
    const r = fileReview(action, tree.changes, selectedIds)
    if (!r.files.length) return
    const id = ++reviews.current
    setReview({ id, tree, review: r, stamp: null, error: null })
    adapter.stamp(repoOf(tree), tree.path, registered, { kind: 'files', paths: r.paths }).then(
      stamp => setReview(cur => (cur?.id === id ? { ...cur, stamp } : cur)),
      e => setReview(cur => (cur?.id === id ? { ...cur, error: message(e) } : cur)),
    )
  }

  const confirm = () => {
    const cur = review
    if (!cur?.stamp) return
    setReview(null)
    guard(cur.tree, () => adapter[METHOD[cur.review.action]](repoOf(cur.tree), cur.tree.path, registered, cur.review.paths, cur.stamp))
  }

  const hunk = (tree, change, index, stamp) => guard(tree, () =>
    adapter[change.area === 'staged' ? 'unstageHunk' : 'stageHunk'](repoOf(tree), tree.path, registered, changePaths(change), index, stamp))

  return { review, openReview, closeReview: () => setReview(null), confirm, hunk, busy, status }
}
```

- [ ] **Step 4: Implement `ReviewDialog`**

Create `apps/desktop/src/views/git/review-dialog.jsx`:

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { worktreeName } from '@nexusmd/core'

const VERB = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard', delete: 'Delete' }

/** Shows exactly what a file action will touch; destructive actions need their word typed. */
export function ReviewDialog({ state, onClose, onConfirm }) {
  const [typed, setTyped] = React.useState('')
  const [sent, setSent] = React.useState(false)
  if (!state) return null
  const { review, stamp, error } = state
  const ready = !!stamp && !sent && (!review.needsTyping || typed === review.needsTyping)
  const submit = () => {
    if (!ready) return
    setSent(true)
    onConfirm()
  }
  return (
    <PlModal open onClose={onClose} title={review.title} sub={`${state.tree.repo} › ${worktreeName(state.tree)}`} icon="git-branch"
      footer={(
        <>
          <button className="btn sm ghost" onClick={onClose}>Cancel</button>
          <button className={`btn sm${review.needsTyping ? ' danger' : ''}`} disabled={!ready} autoFocus={!review.needsTyping} onClick={submit}>
            {VERB[review.action]}
          </button>
        </>
      )}>
      <form onSubmit={e => { e.preventDefault(); submit() }} style={{ display: 'grid', gap: 8 }}>
        {review.warning && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{review.warning}</div>}
        <ul aria-label="Files" style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono, monospace)', maxHeight: 280, overflow: 'auto' }}>
          {review.files.map(f => (
            <li key={f.id}><span style={{ whiteSpace: 'pre' }}>{f.code}</span>{` ${f.path}${f.originalPath ? ` ← ${f.originalPath}` : ''}`}</li>
          ))}
        </ul>
        {review.skipped.length > 0 && (
          <div style={{ color: 'var(--text-muted)' }}>{`Skipped: ${review.skipped.map(s => `${s.path} (${s.reason})`).join('; ')}`}</div>
        )}
        {review.needsTyping && (
          <label style={{ display: 'grid', gap: 4 }}>
            {`Type ${review.needsTyping} to confirm`}
            <input aria-label={`Type ${review.needsTyping} to confirm`} value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
          </label>
        )}
        {!stamp && !error && <div style={{ color: 'var(--text-muted)' }}>Checking the current state…</div>}
        {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      </form>
    </PlModal>
  )
}
```

- [ ] **Step 5: Wire actions into the view**

In `apps/desktop/src/views/git/view-git.jsx`:

1. Add these imports:

```jsx
import { useGitActions } from './use-git-actions.js'
import { ReviewDialog } from './review-dialog.jsx'
```

2. After the `useGitSnapshot(...)` line (and before any early `return`), add:

```jsx
  const actions = useGitActions({ adapter, registered, refresh })
```

3. In the `<WorktreePanel … />` element, replace `onAction={() => {}}`, `onHunk={() => {}}`, `busy={false}` and `status={null}` with:

```jsx
                onAction={action => actions.openReview(action, selectedTree, selectedIds)}
                onHunk={(change, index, stamp) => actions.hunk(selectedTree, change, index, stamp)}
                busy={!!actions.busy[selectedTree.path]} status={actions.status[selectedTree.path] ?? null}
```

4. Just before the closing `</div>` of the component's root element, add:

```jsx
      <ReviewDialog key={actions.review?.id ?? 'none'} state={actions.review} onClose={actions.closeReview} onConfirm={actions.confirm} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/git/use-git-actions.js apps/desktop/src/views/git/review-dialog.jsx apps/desktop/src/views/git/view-git-actions.test.jsx apps/desktop/src/views/git/view-git.jsx
git commit -m "feat(git): review dialog with typed confirmation, file writes and hunk staging"
```

---

### Task 11: Multi-worktree commit dialog

**Files:**
- Create: `apps/desktop/src/views/git/commit-dialog.jsx`
- Test: `apps/desktop/src/views/git/commit-dialog.test.jsx`
- Modify: `apps/desktop/src/views/git/view-git.jsx`

**Interfaces:**
- Consumes:
  - from core: `commitTargets` and `commitReview`;
  - adapter `stamp` and `commit`;
  - `refresh` from `useGitSnapshot`, which returns a promise or `undefined`.
- Produces:
  - `CommitDialog({ targets, adapter, registered, initialMessages, onClose, onDone, onRetry })`, where:
    - `targets` comes from `commitTargets`, with `ticked` already applied;
    - `onRetry(failedIds, { shared, perTarget })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/views/git/commit-dialog.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { commitTargets } from '@nexusmd/core'
import { CommitDialog } from './commit-dialog.jsx'

afterEach(cleanup)

const staged = path => ({ path, originalPath: null, xy: 'M.', area: 'staged', sub: 'N...', id: `staged\0${path}` })
const tree = (name, extra = {}) => ({
  repo: 'App', repoRoot: 'C:/repos/App', path: name === 'checkout' ? 'C:/repos/App' : `C:/repos/App/${name}`,
  branch: name === 'checkout' ? 'main' : name, rebasingBranch: null, operation: '', error: '', changes: [staged(`${name}.txt`)], ...extra,
})
const TREES = [tree('checkout'), tree('feature'), tree('merging', { operation: 'Merge in progress' })]
const REG = ['C:/repos/App']
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function renderDialog({ ticked = ['C:/repos/App'], adapter: over = {}, ...props } = {}) {
  const adapter = {
    stamp: vi.fn(async (_repo, path) => `stamp:${path}`),
    commit: vi.fn(async () => ({ ok: true, detail: '[main abc] msg' })),
    ...over,
  }
  const targets = commitTargets(TREES, null).map(t => ({ ...t, ticked: ticked.includes(t.id) && !t.unavailable }))
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onRetry: vi.fn() }
  render(<CommitDialog targets={targets} adapter={adapter} registered={REG} {...handlers} {...props} />)
  return { adapter, ...handlers }
}
const commitButton = () => screen.getByRole('button', { name: 'Commit' })

describe('CommitDialog', () => {
  it('lists worktrees with staged changes and explains unavailable ones', async () => {
    renderDialog()
    expect(screen.getByLabelText('App › checkout → main').checked).toBe(true)
    expect(screen.getByLabelText('App › feature → feature').checked).toBe(false)
    expect(screen.getByLabelText('App › merging → merging').disabled).toBe(true)
    expect(screen.getByText('— Merge in progress: continue or abort it first')).toBeTruthy()
    expect(screen.getByText('Each worktree commits separately; if one fails the others are not undone.')).toBeTruthy()
  })

  it('waits for a message and the review stamps before committing', async () => {
    const { adapter } = renderDialog()
    expect(commitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    expect(adapter.stamp).toHaveBeenCalledWith({ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App', REG, { kind: 'commit' })
  })

  it('commits each ticked worktree in turn with the shared message and shows per-target results', async () => {
    const { adapter, onDone } = renderDialog({
      ticked: ['C:/repos/App', 'C:/repos/App/feature'],
      adapter: { commit: vi.fn(async (_r, path) => (path.endsWith('feature') ? { ok: false, detail: 'hook says no' } : { ok: true, detail: '[main abc] Fix it' })) },
    })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    const results = await screen.findByRole('list', { name: 'Commit results' })
    expect(adapter.commit.mock.calls).toEqual([
      [{ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App', REG, 'Fix it', 'stamp:C:/repos/App'],
      [{ name: 'App', path: 'C:/repos/App' }, 'C:/repos/App/feature', REG, 'Fix it', 'stamp:C:/repos/App/feature'],
    ])
    expect(within(results).getByText('✓ App › checkout → main')).toBeTruthy()
    expect(within(results).getByText('✗ App › feature → feature')).toBeTruthy()
    expect(within(results).getByText('hook says no')).toBeTruthy()
    expect(onDone).toHaveBeenCalled()
  })

  it('uses a message per worktree when asked', async () => {
    const { adapter } = renderDialog({ ticked: ['C:/repos/App', 'C:/repos/App/feature'] })
    fireEvent.click(screen.getByLabelText('Message per worktree'))
    fireEvent.change(screen.getByLabelText('Message for App › checkout → main'), { target: { value: 'One' } })
    expect(commitButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Message for App › feature → feature'), { target: { value: 'Two' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    await screen.findByRole('list', { name: 'Commit results' })
    expect(adapter.commit.mock.calls.map(c => c[3])).toEqual(['One', 'Two'])
  })

  it('commits once when Commit is clicked twice, and Ctrl+Enter commits too', async () => {
    const pending = deferred()
    const { adapter } = renderDialog({ adapter: { commit: vi.fn(() => pending.promise) } })
    const box = screen.getByLabelText('Commit message')
    fireEvent.change(box, { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /Commit/ }))
    await act(async () => { pending.resolve({ ok: true, detail: 'ok' }) })
    expect(adapter.commit).toHaveBeenCalledTimes(1)
  })

  it('offers Retry failed with only the failed worktrees and the messages typed so far', async () => {
    const { onRetry } = renderDialog({
      ticked: ['C:/repos/App', 'C:/repos/App/feature'],
      adapter: { commit: vi.fn(async (_r, path) => ({ ok: !path.endsWith('feature'), detail: 'x' })) },
    })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix it' } })
    await waitFor(() => expect(commitButton().disabled).toBe(false))
    fireEvent.click(commitButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Retry failed' }))
    expect(onRetry).toHaveBeenCalledWith(['C:/repos/App/feature'], { shared: 'Fix it', perTarget: {} })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/commit-dialog.test.jsx`
Expected: FAIL, because `./commit-dialog.jsx` can't be resolved.

- [ ] **Step 3: Implement `CommitDialog`**

Create `apps/desktop/src/views/git/commit-dialog.jsx`:

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { commitReview } from '@nexusmd/core'

const repoOf = tree => ({ name: tree.repo, path: tree.repoRoot })
const message = e => e?.message || String(e)

/**
 * Commits the staged changes of each ticked worktree, one after another. Stamps are taken when the
 * dialog opens, so a worktree whose index changed afterwards is refused rather than committed.
 */
export function CommitDialog({ targets, adapter, registered, initialMessages = {}, onClose, onDone, onRetry }) {
  const [ticked, setTicked] = React.useState(() => Object.fromEntries(targets.map(t => [t.id, t.ticked])))
  const [perTarget, setPerTarget] = React.useState(false)
  const [shared, setShared] = React.useState(initialMessages.shared ?? '')
  const [messages, setMessages] = React.useState(initialMessages.perTarget ?? {})
  const [stamps, setStamps] = React.useState({})
  const [phase, setPhase] = React.useState('edit')
  const [results, setResults] = React.useState([])
  const started = React.useRef(false)

  React.useEffect(() => {
    let live = true
    for (const t of targets) {
      if (t.unavailable) continue
      adapter.stamp(repoOf(t.tree), t.tree.path, registered, { kind: 'commit' }).then(
        stamp => { if (live) setStamps(m => ({ ...m, [t.id]: { stamp } })) },
        e => { if (live) setStamps(m => ({ ...m, [t.id]: { error: message(e) } })) },
      )
    }
    return () => { live = false }
  }, [])

  const view = targets.map(t => ({ ...t, ticked: !!ticked[t.id] && !t.unavailable }))
  const review = commitReview(view, perTarget ? { perTarget: messages } : { message: shared })
  const stampError = review.blocks.map(b => stamps[b.id]?.error).find(Boolean)
  const waiting = review.blocks.some(b => !stamps[b.id])
  const canRun = phase === 'edit' && !review.error && !waiting && !stampError

  const run = async () => {
    if (!canRun || started.current) return
    started.current = true
    setPhase('running')
    const out = []
    for (const b of review.blocks) {
      const t = targets.find(x => x.id === b.id)
      try {
        const r = await adapter.commit(repoOf(t.tree), t.tree.path, registered, b.message, stamps[b.id].stamp)
        out.push({ id: b.id, title: b.title, ok: !!r.ok, detail: r.detail })
      } catch (e) {
        out.push({ id: b.id, title: b.title, ok: false, detail: message(e) })
      }
    }
    setResults(out)
    setPhase('results')
    onDone()
  }
  const failed = results.filter(r => !r.ok).map(r => r.id)

  const footer = phase === 'results'
    ? (
      <>
        {failed.length > 0 && <button className="btn sm" onClick={() => onRetry(failed, { shared, perTarget: messages })}>Retry failed</button>}
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </>
    )
    : (
      <>
        <button className="btn sm ghost" onClick={onClose} disabled={phase === 'running'}>Cancel</button>
        <button className="btn sm" disabled={!canRun} onClick={run}>{phase === 'running' ? 'Committing…' : 'Commit'}</button>
      </>
    )

  return (
    <PlModal open wide onClose={onClose} title="Commit" icon="git-branch" footer={footer} closeOnBackdrop={phase !== 'running'}>
      {phase === 'results'
        ? (
          <ul aria-label="Commit results" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {results.map(r => (
              <li key={r.id} style={{ color: r.ok ? undefined : 'var(--danger)' }}>
                <strong>{`${r.ok ? '✓' : '✗'} ${r.title}`}</strong>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.detail}</pre>
              </li>
            ))}
          </ul>
        )
        : (
          <div style={{ display: 'grid', gap: 10 }} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}>
            <fieldset aria-label="Worktrees" style={{ display: 'grid', gap: 4, border: 0, padding: 0, margin: 0 }}>
              {targets.map(t => (
                <label key={t.id} style={{ display: 'flex', gap: 6, color: t.unavailable ? 'var(--text-muted)' : undefined }}>
                  <input type="checkbox" aria-label={t.title} checked={!!ticked[t.id] && !t.unavailable} disabled={!!t.unavailable || phase !== 'edit'}
                    onChange={() => setTicked(m => ({ ...m, [t.id]: !m[t.id] }))} />
                  <span>{`${t.title} · ${t.staged.length} staged`}</span>
                  {t.unavailable && <span>{`— ${t.unavailable}`}</span>}
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'flex', gap: 6 }}>
              <input type="checkbox" aria-label="Message per worktree" checked={perTarget} onChange={e => setPerTarget(e.target.checked)} />
              Message per worktree
            </label>
            {!perTarget && (
              <textarea aria-label="Commit message" rows={4} value={shared} onChange={e => setShared(e.target.value)} autoFocus />
            )}
            {review.blocks.map(b => (
              <div key={b.id} role="group" aria-label={b.title} className="card" style={{ padding: 8 }}>
                <strong>{b.title}</strong>
                <ul style={{ margin: '4px 0', padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono, monospace)' }}>
                  {b.files.map(f => <li key={f} style={{ whiteSpace: 'pre' }}>{f}</li>)}
                </ul>
                {perTarget && (
                  <textarea aria-label={`Message for ${b.title}`} rows={3} value={messages[b.id] ?? ''}
                    onChange={e => setMessages(m => ({ ...m, [b.id]: e.target.value }))} />
                )}
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)' }}>{review.note}</div>
            {stampError
              ? <div role="alert" style={{ color: 'var(--danger)' }}>{stampError}</div>
              : review.error && <div style={{ color: 'var(--text-muted)' }}>{review.error}</div>}
          </div>
        )}
    </PlModal>
  )
}
```

`started` blocks a second run even before React re-renders. That covers Ctrl+Enter followed by a click in the same tick.

- [ ] **Step 4: Wire the dialog into the view**

In `apps/desktop/src/views/git/view-git.jsx`:

1. Add the imports `import { CommitDialog } from './commit-dialog.jsx'` and `commitTargets` (in the existing `@nexusmd/core` import).
2. After the `focus` state, add:

```jsx
  // An open commit dialog: which worktrees start ticked (null = the selected one) and messages kept for a retry.
  const [committing, setCommitting] = React.useState(null)
  const commits = React.useRef(0)
```

3. Before the `return (`, add:

```jsx
  const openCommit = (tickedIds = null, messages = {}) => setCommitting({ id: ++commits.current, tickedIds, messages })
  const commitList = committing
    ? commitTargets(scoped.worktrees, view.selected).map(t => (committing.tickedIds ? { ...t, ticked: !t.unavailable && committing.tickedIds.includes(t.id) } : t))
    : []
```

4. In the `<WorktreePanel … />` element, replace `onCommit={() => {}}` with `onCommit={() => openCommit()}`.

5. Next to the `<ReviewDialog … />`, add:

```jsx
      {committing && (
        <CommitDialog key={committing.id} targets={commitList} adapter={adapter} registered={registered} initialMessages={committing.messages}
          onClose={() => setCommitting(null)} onDone={refresh}
          onRetry={async (failedIds, messages) => { setCommitting(null); await refresh(); openCommit(failedIds, messages) }} />
      )}
```

- [ ] **Step 5: Add a view-level test for opening the dialog**

Append inside `describe('file actions', …)` in `apps/desktop/src/views/git/view-git-actions.test.jsx`:

```jsx
  it('opens the commit dialog from the toolbar with the selected worktree ticked', async () => {
    const STAGED = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\x001 M. N... 100644 100644 100644 a b f.txt\0'
    const { state, a } = setupView({ commit: vi.fn(async () => ({ ok: true, detail: 'ok' })) })
    state.porcelain = STAGED
    await openWorktree()
    fireEvent.click(screen.getByRole('button', { name: 'Commit…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('A › checkout → main').checked).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Commit' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(a.commit).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'Ship it', 'stamp-1'))
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/git/commit-dialog.jsx apps/desktop/src/views/git/commit-dialog.test.jsx apps/desktop/src/views/git/view-git.jsx apps/desktop/src/views/git/view-git-actions.test.jsx
git commit -m "feat(git): multi-worktree commit dialog with per-target results and retry"
```

---

### Task 12: Spec amendments and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-git-workspace-design.md`

**Interfaces:** none.

- [ ] **Step 1: Record the planning decisions in the spec**

Append this section to the end of the spec:

```markdown
## Amendments made during stage 2 planning

- Every stage 2 adapter method takes `(repo, worktreePath, registered, …)`, like `status`. `diff` takes `change = { area, paths }`. The hunk operations take `paths` (both names of a staged rename) rather than `path`.
- New read operation: `stamp(repo, worktreePath, registered, { kind: 'files', paths } | { kind: 'commit' })`. It returns the `expected` value for whole-file actions and commits.
- Whole-file stamps cover HEAD plus the paths' `ls-files --stage` entries and their porcelain v2 status records. They don't cover diff text: that scales to many files without long argv, and the review lists files rather than content. Hunk stamps are `sha256(fileStamp, diffText)`, which is the `stamp` that `diff` returns.
- Literal pathspecs come from `GIT_LITERAL_PATHSPECS=1` in the git environment rather than the `--literal-pathspecs` flag.
- `deleteUntracked` checks "still untracked" with porcelain v2 `?` records. This is the same set as `ls-files --others --exclude-standard`.
- Hunk operations need a diff with exactly one file section; otherwise they are refused and the hunk buttons are hidden.
- The focused file's diff reloads on every new snapshot as well as on a focus change, because porcelain v2 has no working-tree content hash. The last diff stays on screen while it reloads.
- Core signatures: `fileReview(action, changes, selectedIds)` and `commitTargets(worktrees, selectedTreeId)`.
- Write results are `{ ok, detail, stale? }`. Bad paths and unregistered repos still throw, as in stage 1.
```

Also change the `**Status:**` line to: `**Status:** Approved design. Stage 1 implemented; stage 2 implemented (2026-10-14).`

- [ ] **Step 2: Run the full suites**

Run: `npm -w packages/core test`
Expected: PASS.

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test`
Expected: PASS. The Jira test `src/jira-create-form.test.jsx > loads types and fields…` is known to be flaky under full-suite load and isn't touched by this work. If it alone fails, re-run that file on its own and record both results in your report.

Run: `npm -w apps/desktop run build`
Expected: the Vite build succeeds.

- [ ] **Step 3: Smoke test**

Run: `npm -w apps/desktop run e2e`
Expected: the existing Git Workspace smoke test passes. In a headless shell with no display, report it as "blocked" (per `WRITING_MODULES.md`) instead of failing the task.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-13-git-workspace-design.md
git commit -m "docs(git): record stage 2 planning amendments"
```
