# Git Workspace Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a conflicted rebase, merge, cherry-pick or revert entirely in the Git Workspace: see progress, compare both sides under clear labels, take one or both per conflict or hand-edit, mark resolved, undo, Skip, Continue.

**Architecture:** Pure conflict logic (marker parsing, region rewrites, side labels, conflict kinds) lives in `packages/core/src/modules/git/conflicts.js`. Main gains operation details in `git:status`, a `git:conflict` read, `git:resolveConflict` / `git:unresolve` writes (in a new `electron/ipc/git-conflicts.cjs`), a `skip` action, and a remembered rebase base. The renderer replaces `OperationBanner` with an `OperationBar` and shows a `ResolvePane` (two sides above, editable result below) or `NonTextConflict` for a focused conflicted file.

**Tech Stack:** Electron (CJS main), React 18, CodeMirror 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-git-workspace-editing-and-conflicts-design.md` (Part 2). **Depends on** `2026-10-19-git-workspace-file-editor.md` (shared `CodeEditor` with `readOnly`/`line`, `safe-file.cjs`, `git-files.cjs` path checks, `confirmDiscard` and the lower-pane mode in `WorktreePanel`).

## Global Constraints

- Sides are always labelled by meaning, never "ours"/"theirs"/"current"/"incoming". Left = git's stage 2, right = stage 3, in every operation.
- Exact label copy (`{name}` = branch short name, `{oid}` = 7-char id, `{subject}` = commit subject). Each side has `title` (pane heading) / `take` (per-conflict button) / `version` (used in other copy):
  - Rebase — left: `{onto} (already applied)` / `Take {onto}'s` / `{onto}'s version`; base name unknown: `The new base ({oid})` / `Take the base's` / `the base's version`. Right: `Your commit {oid} "{subject}"` / `Take mine` / `my version`.
  - Merge — left: `Your branch ({branch})` / `Take mine` / `my version`. Right: `{merging} (being merged)` / `Take {merging}'s` / `{merging}'s version`; name unknown: `The merged commit ({oid})` / `Take the merged version` / `the merged version`.
  - Cherry-pick — left as merge. Right: `Picked commit {oid} "{subject}"` / `Take the picked version` / `the picked version`.
  - Revert — left as merge. Right: `Reverting {oid} "{subject}"` / `Take the reverted version` / `the reverted version`.
  - Both: `Both ({left.version} first)` / `Both ({right.version} first)`. Whole-file confirm: `Use {version} for the whole of {path}?`. Non-text keep button: `Keep {version}` (first letter as written, e.g. `Keep my version`).
- The base branch name is shown only when certain: remembered by NexusMD when it started the rebase, or exactly one branch (`refs/heads/*` or `refs/remotes/*`, excluding `*/HEAD`) points at the commit. Otherwise the neutral wording. Never a guessed name.
- Bar copy: rebase `Rebasing {branch} onto {onto} · commit {step} of {total} · {oid} "{subject}"`; merge `Merging {merging} into {branch}`; cherry-pick `Cherry-picking {oid} "{subject}"`; revert `Reverting {oid} "{subject}"`. Buttons **Continue** (enabled when no conflicted files remain), **Skip** (rebase, cherry-pick, revert only), **Abort**.
- No conflict is resolved silently: whole-file shortcuts, Mark resolved, Skip and Undo resolution are explicit clicks; Abort and Skip keep their existing preview dialog (Skip's note: `Drops this commit from the result.`).
- Stale checks as elsewhere: every write takes the stamp from the read and runs under `withRepoLock`.
- Out of scope: auto-resolving clashing blocks, "resolve all files", stash-pop conflicts beyond what naturally works.

## Review Focus

1. **Labels during a rebase** — the commit being replayed is the user's own work and is stage 3; swapping them is the failure the spec calls out. (Task 1 `rebase puts the replayed commit on the right as mine`; Task 6 integration `stage 3 is the replayed commit`.)
2. **Marker styles** — users with `merge.conflictStyle=diff3` or `zdiff3` get a `|||||||` base section; CRLF files carry `\r` on marker lines. (Task 1 `parses diff3 and CRLF markers`.)
3. **Typing in the result while conflicts remain** — buttons must act on the region the user sees, not a stale index. (Task 1 `regions are re-read from the current text`; Task 7 `Take mine after editing above the region`.)
4. **Delete/modify and binary conflicts** — no markers; resolving is `git rm` / `git add`. (Task 3 integration `keeps my version of a file main deleted`; `accepts the deletion`; `binary takes one side`.)
5. **Undo after Mark resolved** — the file must come back with its markers. (Task 3 `unresolve restores the conflict after add`.)

---

### Task 1: Core conflict logic

**Files:**
- Create: `packages/core/src/modules/git/conflicts.js` (+ export from `modules/git/index.js`)
- Test: `packages/core/src/modules/git/conflicts.test.js`

**Interfaces:**
- Produces:
  - `parseConflicts(text: string): Array<{ start: number, end: number, left: string, base: string | null, right: string }>` — `start`/`end` are character offsets of the whole block (from `<<<<<<<` line start to the end of the `>>>>>>>` line incl. its newline); `left`/`right`/`base` are the inner texts. Accepts `\n` and `\r\n`; marker lines are exactly 7 chars + optional ` label`.
  - `resolveRegion(text: string, index: number, choice: 'left'|'right'|'leftFirst'|'rightFirst'): string` — replaces block `index` (as parsed from `text` now) with left, right, left+right, or right+left.
  - `hasMarkers(text: string): boolean` — any line starting `<<<<<<< ` / `=======` alone / `>>>>>>> `.
  - `conflictKind(xy: string): 'both-modified'|'both-added'|'deleted-by-left'|'deleted-by-right'|'added-by-left'|'added-by-right'|'both-deleted'` — from porcelain `UU AA DU UD AU UA DD` (`DU` = left/stage 2 deleted it).
  - `conflictLabels(op: OperationInfo, branch: string): { left: { title, take, version }, right: { title, take, version } }` — the Global Constraints copy. `OperationInfo` is Task 2's shape.
  - `operationText(op: OperationInfo, branch: string): string` — the bar copy.
- [ ] **Step 1: Write failing tests:** `parses two blocks with offsets`; `parses diff3 and CRLF markers` (base captured; `\r` kept inside sides, not in labels); `resolveRegion takes left, right and both in either order`; `regions are re-read from the current text` (insert a line above block 0, then `resolveRegion(text, 0, 'right')` still replaces the right block); `hasMarkers ignores ======= inside a longer line`; `conflictKind maps each XY`; `rebase puts the replayed commit on the right as mine` (`conflictLabels({ kind:'rebase', onto:{ oid:'a'.repeat(40), name:'main' }, replaying:{ oid:'b'.repeat(40), subject:'Fix login' } }, 'feat/x')` → left.title `main (already applied)`, left.take `Take main's`, right.title `Your commit bbbbbbb "Fix login"`, right.take `Take mine`, right.version `my version`); `unknown base uses neutral wording` (`name: null` → `The new base (aaaaaaa)`, `Take the base's`); one test per merge / cherry-pick / revert label set; `operationText` for each kind.
- [ ] **Step 2: Run** `npx vitest run src/modules/git/conflicts.test.js` in `packages/core`. Expected: FAIL.
- [ ] **Step 3: Implement** `conflicts.js`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): conflict markers, regions and meaning-based side labels`.

### Task 2: Operation details in status, and the remembered rebase base

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs` (`git:status` adds `operationInfo`), `apps/desktop/electron/ipc/git-actions.cjs` (write/clear the marker), `packages/core/src/modules/git/snapshot.js` (`applyStatus` copies `operationInfo` onto the tree, default `null`)
- Test: `apps/desktop/electron/ipc/git.conflicts.integration.test.js` (new; harness as `git.actions.integration.test.js`), `packages/core/src/modules/git/snapshot.test.js`

**Interfaces:**
- Produces: `tree.operationInfo: OperationInfo | null` where
  `OperationInfo = { kind: 'rebase'|'merge'|'cherry-pick'|'revert', step: number|null, total: number|null, onto: { oid, name: string|null } | null, replaying: { oid, subject } | null, merging: { oid, name: string|null } | null, picked: { oid, subject } | null }`.
  - rebase: `step`/`total` from `rebase-merge/msgnum`+`end` (or `rebase-apply/next`+`last`); `onto.oid` from `onto`; `replaying` from `REBASE_HEAD` + its subject; `onto.name` = marker file `<gitDir>/nexusmd-rebase-onto` (a full ref name, shown short) if present and its target still equals `onto.oid`, else the single branch from `for-each-ref --points-at <oid> refs/heads refs/remotes` excluding `*/HEAD`, else `null`.
  - merge: `merging.oid` = `MERGE_HEAD`; `name` by the same single-branch rule.
  - cherry-pick / revert: `picked` from `CHERRY_PICK_HEAD` / `REVERT_HEAD`.
  - In `git-actions.cjs`: before running a `pull` with `mode: 'rebase'` write the upstream ref (`state.upstream`, as a full `refs/remotes/...` name) and before `rebaseInteractive` write `o.base` when it is a ref name, to `<gitDir>/nexusmd-rebase-onto`; delete it in `finish` when no operation remains and on abort (alongside `cleanupPlan`).
- [ ] **Step 1: Write failing tests:** `status describes a stopped rebase` (two branches editing one line; `git rebase main` from the test → `operationInfo` `{ kind:'rebase', step:1, total:1, onto:{ name:'main' }, replaying:{ subject:'feature edit' } }`); `base name is null when two branches point at it`; `a rebase NexusMD started remembers its base` (create `origin/main` and `main` at the same commit; pull with rebase via the `run` action → `onto.name === 'origin/main'`; after abort the marker is gone); `status describes a merge and a cherry-pick`; `applyStatus copies operationInfo`.
- [ ] **Step 2: Run** `npx vitest run electron/ipc/git.conflicts.integration.test.js` (apps/desktop) and the snapshot test (packages/core). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both, plus `electron/ipc/git.actions.integration.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): describe in-progress operations and remember a rebase's base`.

### Task 3: Read and resolve a conflicted file in main

**Files:**
- Create: `apps/desktop/electron/ipc/git-conflicts.cjs` (registered from `git.cjs` with the same deps as `git-files.cjs` plus `filesState`)
- Modify: preload git section, `src/adapters/git.js`, `IGitAdapter`
- Test: `apps/desktop/electron/ipc/git.conflicts.integration.test.js`

**Interfaces:**
- Consumes: `safe-file.cjs` (`readText`, `writeAtomic`, `sha256`, `BOM`); `git-files.cjs` path check (export it as `requireWorktreeFile(wt, rel)` from Plan 1's module).
- Produces:
  - `git:conflict` → `adapter.conflict(repo, wt, registered, rel): Promise<{ kind, binary: boolean, stages: { base, left, right }, working: { text, bom, stamp } | null, stamp }>` — each stage is `{ text, bom } | null` (absent stage) from `git cat-file blob <oid>` using `indexEntries`; `binary` when any stage or the working file has a NUL in its first 8 KB (then stage texts are `null`); `stamp` = `filesState(wt, [rel]).stamp`. Refuses a path with no stage 1–3 entries: `Not conflicted any more: ${rel}`.
  - `git:resolveConflict` → `adapter.resolveConflict(repo, wt, registered, rel, resolution, expected): Promise<{ ok: true } | { ok: false, stale: true, detail } | { ok: false, detail }>` with `resolution` one of `{ take: 'text', text, bom }` (write working file atomically, then `git add`), `{ take: 'left' }` / `{ take: 'right' }` (`git checkout --ours|--theirs -- rel` then `git add`; if that stage is absent, `git rm -- rel`), `{ take: 'delete' }` (`git rm -- rel`). Text writes refuse when `hasMarkers(text)` unless `resolution.force === true`.
  - `git:unresolve` → `adapter.unresolve(repo, wt, registered, rel, expected)` → `git checkout -m -- rel`.
- [ ] **Step 1: Write failing tests:** `stage 3 is the replayed commit` (rebase conflict: `stages.left.text` is main's line, `stages.right.text` the feature line); `resolves with text and stages it` (status no longer `u`); `refuses text that still has markers unless forced`; `take left and take right`; `keeps my version of a file main deleted` (delete on main, modify on feature, rebase → kind `deleted-by-left`; `{ take: 'right' }` → file present and staged); `accepts the deletion` (`{ take: 'delete' }` → gone and staged); `binary takes one side`; `unresolve restores the conflict after add` (markers back, status `u` again); `refuses a stale resolve`.
- [ ] **Step 2: Run** the test file. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): read and resolve conflicted files over IPC`.

### Task 4: Skip action

**Files:**
- Modify: `apps/desktop/electron/ipc/git-actions.cjs` (`skip` in `ACTIONS`, using `continueOrAbort(wt, command, 'skip')` for `rebase`, `cherry-pick`, `revert`; refuse merge with `A merge can't skip; continue or abort it.`), `packages/core/src/modules/git/actions.js` (`'skip'` in `ACTION_KINDS`, title `Skip`), `apps/desktop/src/views/git/action-dialog.jsx` (`VERB.skip = 'Skip'`)
- Test: `git.actions.integration.test.js`, `packages/core/src/modules/git/actions.test.js`

**Interfaces:** Produces the `skip` action kind for `sync.open('skip', targets)`; preview note `Drops this commit from the result.`
- [ ] **Step 1: Write failing tests:** `skip drops the stopped commit and the rebase finishes`; `skip is refused during a merge`; core `ACTION_KINDS includes skip`.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.** `continueOrAbort` treats `skip` like `continue` for plan/marker cleanup (clean up when the operation ends).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): skip the stopped commit of a rebase, cherry-pick or revert`.

### Task 5: OperationBar and conflicts-first changes list

**Files:**
- Create: `apps/desktop/src/views/git/operation-bar.jsx` (replaces `operation-banner.jsx`; delete the old file and update its imports/tests)
- Modify: `apps/desktop/src/views/git/changes-pane.jsx` (conflict group first, heading `Conflicts ({n})`; per conflicted row two small buttons from `conflictLabels(...).left.take` / `.right.take` — whole-file, confirm first with the Global Constraints copy), `apps/desktop/src/views/git/worktree-panel.jsx`, `apps/desktop/src/views/git/view-git.jsx` (whole-file resolve calls `adapter.resolveConflict` with `{ take:'left'|'right' }` and the stamp from `adapter.stamp({kind:'files'})`, then `reload`)
- Test: `apps/desktop/src/views/git/operation-bar.test.jsx`, `changes-pane.test.jsx`, `stage4-ui.test.jsx`

**Interfaces:** Consumes Task 1 `operationText`, `conflictLabels`; Task 2 `tree.operationInfo`; Task 4 `skip`. `OperationBar({ tree, onAction })` — `onAction('continue'|'skip'|'abort', {})`, Continue disabled with title `Resolve every conflicted file first` while any change has `area === 'conflict'`; Skip hidden for merges; falls back to `tree.operation` text when `operationInfo` is null.
- [ ] **Step 1: Write failing tests:** `shows rebase progress and the replayed commit` (exact `operationText` copy); `Continue waits for the last conflict`; `Skip is offered for a rebase, not a merge`; changes pane `lists conflicts first with whole-file choices`; `whole-file choice asks first and resolves`.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): operation bar with progress and Skip; conflicts first in the changes list`.

### Task 6: `useConflict` hook

**Files:**
- Create: `apps/desktop/src/views/git/use-conflict.js`
- Test: `apps/desktop/src/views/git/use-conflict.test.js`

**Interfaces:**
- Consumes: Task 3 adapter methods; Task 1 `parseConflicts`, `resolveRegion`, `hasMarkers`; `detectEol`/`toLf`/`fromLf`.
- Produces: `useConflict({ adapter, repo, worktreePath, registered, path }) → { status, data /* git:conflict result */, text, setText, regions /* parseConflicts(text) */, current: number, setCurrent(i), take(index, choice), markResolved({ force = false } = {}): Promise<'ok'|'markers'|'stale'|false>, takeWhole('left'|'right'|'delete'), unresolve(), error, saving }`. `text` starts as the working file (LF); `take` = `setText(resolveRegion(text, index, choice))`; `markResolved` returns `'markers'` without writing when `hasMarkers(text)` and not forced; writes with the file's eol/BOM.
- [ ] **Step 1: Write failing tests:** `loads sides and working text`; `take rewrites the region and the counter drops`; `markResolved warns about markers, then forces`; `markResolved keeps CRLF`; `stale resolve reports stale`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): useConflict hook`.

### Task 7: ResolvePane and NonTextConflict

**Files:**
- Create: `apps/desktop/src/views/git/resolve-pane.jsx`, `apps/desktop/src/views/git/non-text-conflict.jsx`
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (a focused `conflict` change shows `ResolvePane` — or `NonTextConflict` when `kind` isn't `both-modified`/`both-added` or `data.binary` — instead of the Diff | Edit switch; the `confirmDiscard` guard covers unsaved result edits), `apps/desktop/src/views/git/diff-pane.jsx` (remove `Resolve in your editor, then stage the file.`), `apps/desktop/src/views/devenv-git.css`
- Test: `resolve-pane.test.jsx`, `non-text-conflict.test.jsx`, `stage4-ui.test.jsx`

**Interfaces:**
- Consumes: Task 6 `useConflict`; Task 1 `conflictLabels`; Plan 1 `CodeEditor` (`line`, `readOnly`).
- `ResolvePane({ adapter, repo, tree, registered, change, onResolved, onDirtyChange })` — **my call on layout detail:** the top row shows the *current conflict region* side by side (left/right inner texts, read-only, each headed by its label title and with its `take` button), not whole files — this keeps the panes aligned with the counter. Header: `Resolve: {path}`, `{n} of {total} left` (`total` = regions at load), ↑/↓ buttons (and Alt+↑/↓) set `current` and scroll the result to that region (`line`). A `Both` menu with the two `Both (… first)` choices. Bottom: `CodeEditor` on `text`. **Show original** toggles a read-only `CodeEditor` of `stages.base.text` (disabled when absent). Footer: **Undo resolution** (shown once the file is staged — i.e. after Mark resolved, while still in the operation) and **Mark resolved**; a `'markers'` result shows `This file still has conflict markers. Mark it resolved anyway?` with **Mark resolved anyway**. After `'ok'` call `onResolved()` (panel reloads the snapshot).
- `NonTextConflict({ kind, labels, binary, onTake })` — sentence per kind: `deleted-by-left` → `{left.title} deleted this file; {right.title} changed it.` with **Keep {right.version}** / **Accept the deletion**; `deleted-by-right` mirrored; `added-by-*`/`both-added` binary or `binary` → **Use {left.version}** / **Use {right.version}**; `both-deleted` → **Accept the deletion**.
- [ ] **Step 1: Write failing tests:** `shows both sides of the current conflict under their labels`; `Take mine after editing above the region` (type a line at the top of the result, click right take → the region's right text replaces the block); `Both (main's first) orders the sides`; `counter and next/previous`; `Mark resolved warns while markers remain`; `Show original shows the base`; `delete/modify offers keep or accept`; `binary offers one side or the other`.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): resolve conflicts in the Git Workspace`.

### Task 8: End-to-end verification

- [ ] **Step 1:** `npx vitest run` in `apps/desktop` and `packages/core`. Expected: all new tests pass; list any failures that also fail on `master`.
- [ ] **Step 2: Integration story** — add `full rebase resolved in the workspace` to `git.conflicts.integration.test.js`: two conflicting commits replayed; first resolved by text through `git:resolveConflict`, the second by `{ take: 'right' }`; Continue via the `continue` action → rebase finished, log has both commits. Run it; expected PASS.
- [ ] **Step 3: In the running app** (`npx vite build && npx electron .` in `apps/desktop`): on a scratch repo, rebase a branch onto main with a conflict on two blocks and a delete/modify file. Confirm: the bar shows `Rebasing … commit 1 of N`; labels read `main (already applied)` / `Your commit …`; Take mine on one block, Both on the other, Mark resolved; Keep my version on the deleted file; Undo resolution brings markers back; resolve again; Continue finishes.
- [ ] **Step 4: Commit** fixes found, each with its own test.
