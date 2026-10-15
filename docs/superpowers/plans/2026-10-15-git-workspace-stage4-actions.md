# Git Workspace — Stage 4 (Branch and sync actions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run branch and sync actions from the Git Workspace view, always previewed first and logged per target:
- fetch, pull, push;
- branch, checkout;
- worktree add and remove;
- stash, revert;
- continue / abort;
- interactive rebase.

**Architecture:**
- **Main** (`electron/ipc/git.cjs`): four new channels.
  - `remotes` and `stashes` are reads.
  - `preview(kind, options)` reads a target's state and returns eligibility, details, the repository programs that will run, and a stamp.
  - `run(kind, options, stamp)` recomputes the stamp under stage 2's per-repo lock, refuses on a mismatch, then runs the action's argv. Main builds every argv; `options` is checked against lists main reads itself.
- **Editor helper** (`electron/ipc/git-editor.cjs`): git's editor during interactive rebase only. Every other write uses `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:`, git's built-in no-op.
- **Core** gains three modules:
  - `actions.js`: targets, the preview model, devenv's worktree path rule, branch-name checks;
  - `rebase-plan.js`: the editable rebase rows, the todo and messages;
  - `activity.js`: the session activity log.
- **Renderer:**
  - Sync and Branch menus on the worktree panel;
  - Fetch all and Pull all on the group menu;
  - History context menu entries;
  - a preview dialog, a rebase dialog, an in-progress banner and an activity drawer.

**Tech Stack:**
- Electron 43 (CommonJS main);
- React 18 + Vite (ESM);
- `@nexusmd/core` (ESM);
- Vitest 4 + Testing Library;
- the git CLI (≥ 2.35.2 for the ownership check, ≥ 2.24 for `--end-of-options`).

**Spec:** `docs/superpowers/specs/2026-10-13-git-workspace-design.md`. The **Stage 4 — Branch and sync actions** section is the contract. Read Decisions, the stage 1–3 amendments and Stage 4 in full first.

**Verified while planning** (git 2.43, node 22):
- `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` are no-ops for merge, revert and `rebase -i`.
- An editor command of the form `ELECTRON_RUN_AS_NODE=1 "<exe>" "<helper path with spaces>" <mode>` runs. The variable reaches the helper but **not** the repository's hooks.
- The Task 2 helper code, driven by a real `rebase -i`:
  - reordered and dropped commits;
  - squashed a pair with the message keyed by the group's **last** commit;
  - reworded a commit.
- The stage 4 design's action argv table was run in full while designing.

## Global Constraints

- **Branch:**
  - Create `feature/git-workspace-stage4` from `claude/git-stage4-design` (or from `master` once stage 3 and the stage 4 design are merged).
  - **Rebase, never merge**, to update it.
  - Stage only the paths each task names.
- **Code style:** `WRITING_MODULES.md`:
  - no semicolons in ESM, semicolons in `.cjs`;
  - comments only for *why*;
  - JSDoc on non-obvious exported functions.
- **Module registration** is unchanged (desktop-only, `defaultEnabled: false`, no `git` key in `createNoOpAdapters()`).
- **Git process rules** are stage 1–3's. Stage 4 adds:
  - **Every stage 4 write** sets `GIT_EDITOR=:`, `GIT_SEQUENCE_EDITOR=:` and `GIT_MERGE_AUTOEDIT=no`. Interactive rebase replaces the two editors with the helper (Task 6).
  - **Timeouts:** 120 000 ms for `fetch`, `pull`, `push`, `checkout`, `worktreeAdd`, `revert`, `continue`, `rebaseInteractive`; 30 000 ms otherwise.
  - **Writes take stage 2's per-repo lock;** previews and reads don't.
- **Forbidden anywhere in stage 4 argv** (a test scans every argv built):
  - `--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `+<refspec>`;
  - `reset`, `clean`, `branch -D`, `branch -d`, `push --delete`, `push --mirror`, `push --all`, `push --tags`;
  - `worktree remove --force`;
  - `-c safe.directory`.
- **Refs, oids and paths** reach git only after `--end-of-options` or `--`, or inside a refspec main built itself. Each is matched first against a list main read: remotes, refs, stash oids, a commit's parents, the range main computed.
- **Exact copy (verbatim):**
  - Stale: `Changed since the preview. Preview again.`
  - Batch note: `Each repository runs separately; if one fails the others are not undone.`
  - Ownership: `Git refuses this repository because another user owns its folder. If you trust it, run git config --global --add safe.directory <path> yourself.`
  - Push rejected: `The remote has commits you don't have - pull first.`
  - Network timeout: `git timed out talking to <remote> - a credential or SSH prompt may be waiting. Run git fetch once in a terminal to set it up.`
  - Pushed range: `Interactive rebase only rewrites commits that haven't been pushed.`
  - Merges in range: `Interactive rebase only rewrites ranges without merge commits.`
  - Typed word: `DROP`.
- **Test commands:** as stage 3.
  - Integration tests that need a second OS user skip unless running as root on Linux.
- **Commit messages** end with your session's Co-Authored-By line.

## Review Focus

1. **A force sneaking in.** No argv may contain a force flag or a `+` refspec, whatever the options. Pinned by the Task 3 argv scan, which builds every kind with hostile options.
2. **Preview/run drift.** A fetch by another tool, a commit in a terminal, or a stash pushed between preview and run must refuse with the stale copy and run nothing. Pinned in Task 3 (unit) and Task 7 (real git).
3. **Rewriting published history.** Interactive rebase over a range with any commit on a remote must be refused before git runs. Pinned in Task 6 and Task 7.
4. **Hanging on prompts.**
   - Credentials, SSH host keys and editors must fail or time out, never hang.
   - The helper's environment variable must not leak into hooks.
   - Pinned in Task 2 (helper), Task 3 (env) and Task 7 (hook sees no `ELECTRON_RUN_AS_NODE`).
5. **Worktree paths.** devenv's naming rule must hold, and a path outside the repository root, a UNC path or an existing folder must be refused. Pinned in Tasks 1 and 5.

---

## File Structure

**Core (`packages/core/src/modules/git/`)**
- `actions.js` (new): `ACTION_KINDS`, `BATCH_KINDS`, `BATCH_NOTE`, `actionTargets`, `previewModel`, `worktreeDefaultPath`, `checkBranchName`.
- `rebase-plan.js` (new): `rebasePlan`, `moveRow`, `setRowAction`, `setRowMessage`, `rebaseTodo`, `rebaseMessages`, `rebaseProblems`.
- `activity.js` (new): `ACTIVITY_MAX`, `addActivity`, `failedTargets`.
- `index.js`, `../../index.js`, `../../adapters/index.js` (`IGitAdapter`), `tests/public-api.test.js`.

**Main (`apps/desktop/electron/`)**
- `ipc/git-editor.cjs` (new) and `ipc/git-editor.test.js` (new).
- `ipc/git.cjs`: `writeEnv`, `targetState`, `programs`, `ACTIONS` table (`check`, `preview`, `argv`, `timeout`) and the four channels.
- `ipc/git.test.js`: argv, refusals, stamps, the force scan.
- `ipc/git.actions.integration.test.js` (new).
- `preload.cjs`, `preload.test.js`.

**Renderer (`apps/desktop/src/views/git/`)**
- `use-git-sync.js` (new): preview → confirm → run → activity, plus retry.
- `action-dialog.jsx` (new): the preview, with typed `DROP` and the options per kind.
- `rebase-dialog.jsx` (new).
- `activity-drawer.jsx` (new).
- `operation-banner.jsx` (new).
- `worktree-panel.jsx`: Sync and Branch menus, plus the banner.
- `group-menu.jsx`: Fetch all, Pull all.
- `history-pane.jsx`: a row context menu.
- `view-git.jsx`: wiring.
- `../../adapters/git.js`.

---

### Task 1: Core — actions, rebase plan, activity

**Files:** the core files above, plus `actions.test.js`, `rebase-plan.test.js`, `activity.test.js`.

**Interfaces (produced):**
- `ACTION_KINDS`: `fetch`, `pull`, `push`, `branch`, `checkout`, `worktreeAdd`, `worktreeRemove`, `stashPush`, `stashApply`, `stashPop`, `stashDrop`, `revert`, `continue`, `abort`, `rebaseInteractive`.
- `BATCH_KINDS = ['fetch', 'pull']`. A batch `pull` is always `mode: 'ff'`.
- `BATCH_NOTE`: the exact batch copy.
- `actionTargets(kind, worktrees, selectedId)` → `[{ id, repo, repoRoot, worktreePath, ticked, unavailable }]`.
  - Batch kinds list every worktree in `worktrees` (the scoped group), ticking all available ones.
  - Other kinds return the selected worktree only.
  - `unavailable` is the reason text: `'missing'`, `'error: …'`, or for `pull` `'no upstream'` / `'upstream gone'` / `'<operation> in progress'`.
- `previewModel(kind, previews)` → `{ title, rows: [{ id, label, eligible, reason, details, programs }], note }`. `note` is `BATCH_NOTE` for batches.
- `worktreeDefaultPath(repoRoot, branch)` → `<repoRoot>/<short name>`.
  - The short name strips a leading `<remote>/` only when the caller passes a remote ref.
  - `\ / : * ? " < > |` become `-`.
  - It joins with `/` (main normalises).
- `checkBranchName(name)` → `null` or a message. It mirrors `git check-ref-format --branch`:
  - empty;
  - starts with `-` or `/`;
  - ends with `/`, `.` or `.lock`;
  - contains `..`, `@{`, `//`, a space, a control character, or `~ ^ : ? * [ \`;
  - is exactly `@`.
- `rebasePlan(commits)` → rows oldest first: `{ oid, subject, action: 'pick', message: null }`.
- `moveRow(rows, oid, delta)`, `setRowAction(rows, oid, action)` and `setRowMessage(rows, oid, text)` are immutable.
- `rebaseTodo(rows)` → `'<action> <oid>\n'` per row. `drop` rows are kept as `drop` lines, so git's own check sees them.
- `rebaseMessages(rows)` → `{ [oid]: message }`.
  - A `reword` row keys its own oid.
  - A squash group is a non-squash row followed by `squash`/`fixup` rows. It keys the **last** row of the group, and only when the group's first row's message or any squash row's message is set.
- `rebaseProblems(rows)` → messages:
  - `'The first commit can\'t be squashed or fixed up.'`
  - `'Keep at least one commit.'`
  - `'Give <short oid> a message.'` for an empty reword.
- `ACTIVITY_MAX = 200`.
- `addActivity(log, entry)` puts the newest first and caps the length.
- `failedTargets(log, runId)` returns the target ids that failed in that run.

- [ ] **Step 1: Create the branch** (see Global Constraints).
- [ ] **Step 2: Failing tests.**
  - The devenv examples: `feature/x` → `feature-x`; `a:b*c` → `a-b-c`; remote `origin/feature/x` → `feature-x`.
  - Every `checkBranchName` rule, against `git check-ref-format --branch` behaviour listed above.
  - `actionTargets` batch ticks and reasons.
  - `rebaseTodo` and `rebaseMessages`: a squash group of three keyed by its last oid; a reword; a drop.
  - `rebaseProblems`.
  - The activity cap and failures.
  - The public API.
- [ ] **Step 3: Implement. Step 4: core suite passes.**
- [ ] **Step 5: Commit** — `feat(git): stage 4 core: action targets, rebase plan and activity log`

---

### Task 2: Main — the editor helper

**Files:** create `apps/desktop/electron/ipc/git-editor.cjs` and `git-editor.test.js`.

This is the verified code; keep it as is.

```js
// electron/ipc/git-editor.cjs
//
// Git's editor during NexusMD's interactive rebase, run as
// `ELECTRON_RUN_AS_NODE=1 "<electron>" "git-editor.cjs" <mode>` (git appends the file). The plan (todo
// text and messages) comes from the JSON file named by NEXUSMD_REBASE_PLAN, written by main before
// the rebase starts. `sequence` replaces git's todo; `message` writes the message the user gave for
// the commit being edited, found from the last line of <git dir>/rebase-merge/done, and otherwise
// leaves git's text as it is. Any failure exits non-zero, which makes git stop the rebase.
'use strict';
const fs = require('fs');
const path = require('path');

function main(argv, env) {
  const [mode, file] = argv;
  const plan = JSON.parse(fs.readFileSync(env.NEXUSMD_REBASE_PLAN, 'utf8'));
  if (mode === 'sequence') { fs.writeFileSync(file, plan.todo); return 0; }
  if (mode !== 'message') return 2;
  const done = path.join(path.dirname(file), 'rebase-merge', 'done');
  if (!fs.existsSync(done)) return 0;
  const last = fs.readFileSync(done, 'utf8').trim().split('\n').pop() || '';
  const oid = last.split(/\s+/)[1] || '';
  const message = Object.prototype.hasOwnProperty.call(plan.messages, oid) ? plan.messages[oid] : null;
  if (message != null) fs.writeFileSync(file, message.endsWith('\n') ? message : `${message}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2), process.env); } catch (e) { process.stderr.write(`nexusmd editor: ${e.message}\n`); process.exitCode = 1; }
}
module.exports = { main };
```

`COMMIT_EDITMSG` and `rebase-merge` both live in the worktree's own git dir, also for linked worktrees (`.git/worktrees/<name>`), so `dirname(file)` is right in every layout.

- [ ] **Step 1: Tests (node env, real temp files):**
  - `sequence` writes the todo.
  - `message` writes the keyed message, and leaves the file untouched with no key or no `done` file.
  - A missing plan file exits 1 with the message on stderr.
  - An unknown mode exits 2.
  - Spawned as a child with a path containing spaces, it behaves the same.
- [ ] **Step 2: Implement. Step 3: pass. Step 4: Commit** — `feat(git): interactive rebase editor helper`

---

### Task 3: Main — action framework, reads, stamps, the force scan

**Files:** `git.cjs`, `git.test.js`, `preload.cjs`, `preload.test.js`, `src/adapters/git.js`.

**Interfaces (produced):**
- `writeEnv(extra)` → stage 1–3's env plus:
  - `GIT_EDITOR: ':'`, `GIT_SEQUENCE_EDITOR: ':'`, `GIT_MERGE_AUTOEDIT: 'no'`;
  - `extra` (Task 6 only).
- `git()` gains an `env` option that replaces the env for one call.
- `targetState(wt)` → `{ head, symbolic, upstream, upstreamOid, status, operation }`, where:
  - `symbolic` is `symbolic-ref --quiet HEAD` or `null`;
  - `upstream` is `rev-parse --abbrev-ref --symbolic-full-name @{upstream}` or `null`;
  - `status` is stage 1's porcelain v2 text.
- `actionStamp(state, extra)` → `sha256` over the state and `extra`. `extra` is the stash oid, the push destination's tracking oid, or the rebase range.
- `programs(wt)` → `[string]`:
  - active hooks (non-`.sample`, regular files) in `core.hooksPath`, or else `<git common dir>/hooks`;
  - `config --local --get-regexp '^(filter\..*\.(clean|smudge|process)|core\.sshcommand|credential\..*helper)$'` keys, shown as `filter lfs`, `core.sshCommand`, `credential helper`.
- `ownershipMessage(stderr, path)` maps `detected dubious ownership` to the exact ownership copy.
- **Channels:**
  - `git:remotes(repo, wt, registered)` → `remote -v` raw;
  - `git:stashes(repo, wt, registered)` → `stash list --format=%H%x00%gd%x00%ct%x00%s` raw;
  - `git:preview(repo, wt, registered, kind, options)` → `{ eligible, reason, details, programs, stamp }`;
  - `git:run(repo, wt, registered, kind, options, stamp)` → `{ ok, detail, stale?, conflict?, operation? }`.
- **The `ACTIONS` table:** `{ [kind]: { check(options, ctx) → options, preview(wt, options, state) → details, argv(options, state) → [[args], ...], timeout, needsClean? } }`.
  - `run` validates with `check`, takes the lock, recomputes the stamp, then runs the argv steps in order, stopping at the first failure.
  - This task adds the table with `fetch` only. Tasks 4–6 add the rest.

- [ ] **Step 1: Failing tests:**
  - `writeEnv` has the three variables.
  - `targetState` reads on a fake child.
  - The stamp changes when any state part changes.
  - `programs` lists `pre-push` but not `pre-push.sample`, honours `core.hooksPath`, and names `filter lfs`.
  - A stale stamp spawns no write.
  - An unknown kind throws.
  - The ownership message.
  - **The force scan:** for every kind in `ACTION_KINDS` with options that try to inject a force (`dest: '+main'`, `branch: '--force'`, `remote: '-f'`, `oid: 'HEAD --force'`), either `check` throws or the built argv contains none of the forbidden flags. It runs over the table in Tasks 4–6 too, so a new kind is covered automatically.
- [ ] **Step 2–4:** fail → implement (including `fetch` = `fetch --all --prune`, timeout 120 s, no stamp check needed beyond state) → pass.
- [ ] **Step 5: Commit** — `feat(git): stage 4 action framework with previews, stamps and repository programs`

---

### Task 4: Main — pull and push

**Files:** `git.cjs`, `git.test.js`.

Behaviour (all argv from the design's table):
- **`pull` with `mode: 'ff' | 'rebase' | 'merge'`.**
  - `check`: an upstream is set and present; no operation in progress; `rebase` needs a clean status.
  - `preview`: `behind`/`ahead` counts and the incoming commit subjects (`log --format=%h%x00%s --max-count=20 HEAD..@{upstream}` after a `fetch <remote>` *in run only*; the preview uses the last-fetched state and says "as of the last fetch").
  - argv: `[['fetch', remote], ['merge', '--ff-only', '--end-of-options', upstream]]`, or the `rebase` / `merge --no-edit` forms.
- **`push` with `{ remote, dest, setUpstream }`.**
  - `check`: `remote` is in `remote` output; `dest` passes `check-ref-format --branch`; HEAD is a branch.
  - `preview`: commits in `<remote>/<dest>..HEAD` (or all of `HEAD --not --remotes` for a new branch) and whether this sets the upstream.
  - argv: `['push', '--porcelain', ...(setUpstream ? ['--set-upstream'] : []), remote, `refs/heads/${local}:refs/heads/${dest}`]`.
  - A `[rejected]` or `non-fast-forward` line maps to the exact rejected copy.

- [ ] **Step 1: Failing tests:**
  - exact argv per mode;
  - refusals (no upstream, gone, dirty for rebase, unknown remote, bad dest, detached HEAD);
  - rejected push mapping;
  - network timeout mapping, with the remote name in the copy;
  - the force scan still passes.
- [ ] **Step 2–4. Step 5: Commit** — `feat(git): pull and push actions`

---

### Task 5: Main — branch, checkout, worktrees, stash, revert, continue/abort

**Files:** `git.cjs`, `git.test.js`.

Per the design's table, plus:
- **`branch` `{ name, start, checkout }`.**
  - `start` is a ref from `for-each-ref` or a full oid that `cat-file -e <oid>^{commit}` accepts.
  - Name check: core's rule, then `check-ref-format --branch`, then "already exists" via `show-ref --verify --quiet refs/heads/<name>`.
- **`checkout` `{ branch }` or `{ oid }`.** The preview names the worktree that already has the branch, from `worktree list --porcelain`, and refuses.
- **`worktreeAdd` `{ ref, path }`.**
  - `path` defaults to `worktreeDefaultPath`.
  - It must be absolute and not UNC, must not exist, its parent must exist, and it must be inside the repository root.
  - An existing local branch → `worktree add <path> <branch>`; a remote ref → `worktree add --track -b <short> <path> <remoteRef>`.
- **`worktreeRemove` `{ path }`.** It must be a listed, non-main, unlocked worktree; git's own refusal is reported verbatim.
- **Stash:**
  - `stashApply` / `stashPop` / `stashDrop` take `{ oid, index? }`.
  - The oid must be in `stash list`.
  - `stashDrop` re-resolves `stash@{n}` → oid just before running and refuses if it moved.
  - `stashPop` = apply, then drop the same oid only if the apply exit code was 0 and `status` shows no conflicts.
- **`revert` `{ oid, parent? }`.** A merge needs `parent` (1-based), checked against `rev-list --parents`.
- **`continue` / `abort`.** The command comes from stage 1's operation detection (`rebase-merge`/`rebase-apply` → `rebase`, `MERGE_HEAD` → `merge`, `REVERT_HEAD` → `revert`, `CHERRY_PICK_HEAD` → `cherry-pick`). `continue` is refused while `u` records remain.

- [ ] **Step 1: Failing tests:** exact argv and every refusal above; the force scan.
- [ ] **Step 2–4. Step 5: Commit** — `feat(git): branch, checkout, worktree, stash, revert and continue/abort actions`

---

### Task 6: Main — interactive rebase

**Files:** `git.cjs`, `git.test.js`.

- **`rebaseInteractive` `{ base, rows }`.** `rows` is `[{ oid, action, message }]`, oldest first.
- **`check`:**
  - `base` is a full oid or a listed ref.
  - The range `rev-list --reverse --end-of-options <base>..HEAD` equals exactly the set of row oids (order may differ).
  - `rev-list <base>..HEAD --not --remotes` has the same count. Otherwise refuse with the exact pushed-range copy.
  - `rev-list --merges <base>..HEAD` is empty. Otherwise refuse with the exact merges copy.
  - No operation in progress; status clean (untracked files allowed).
- **Stamp extra:** the range oids in order.
- **Run:**
  1. Write `{ todo, messages }` to `os.tmpdir()/nexusmd-rebase-<random>.json` with mode `0o600`. `todo` and `messages` are built in **main** from `rows`, mirroring core's `rebaseTodo` / `rebaseMessages`; the shared fixtures keep both in step.
  2. Run `rebase -i --end-of-options <base>` with `writeEnv` extras:
     - `NEXUSMD_REBASE_PLAN=<file>`;
     - `GIT_SEQUENCE_EDITOR=ELECTRON_RUN_AS_NODE=1 "<process.execPath>" "<helper>" sequence`;
     - `GIT_EDITOR=ELECTRON_RUN_AS_NODE=1 "<process.execPath>" "<helper>" message`.

     Paths use forward slashes, because git runs the editor through `sh`.
  3. On success, or on `--abort`: delete the plan file.
  4. On a conflict stop: keep it, and record its path in the git dir (`<git dir>/nexusmd-rebase-plan`) so `continue` passes the same editors and plan. `abort` and a finished `continue` delete both.
- **Packaging:** in a packaged app the helper must be outside the asar archive. Add `electron/ipc/git-editor.cjs` to `build.asarUnpack` in `apps/desktop/package.json`, and resolve it with `.replace('app.asar', 'app.asar.unpacked')`.

- [ ] **Step 1: Failing tests:**
  - the refusals;
  - the env carries the helper commands, with forward slashes and quotes;
  - the plan file is `0600` and is deleted after success and after abort;
  - `continue` after a stop reuses the recorded plan;
  - the force scan.
- [ ] **Step 2–4. Step 5: Commit** — `feat(git): interactive rebase through the editor helper`

---

### Task 7: Real-git integration test

**Files:** create `apps/desktop/electron/ipc/git.actions.integration.test.js`. Follow `git.history.integration.test.js`, with a bare "remote" in the temp folder.

Cover the design's integration list:
- fetch;
- pull in each mode, plus ff refusal on divergence;
- first push sets the upstream, and a rejected push gets the exact copy;
- branch → checkout → back;
- worktree add (devenv path; reuse an existing local branch) → remove → refused when dirty;
- stash push / apply / pop / drop (and the drop refusal when the oid moved);
- revert, and revert a merge with `parent: 2`;
- interactive rebase that reorders, rewords and squashes, with messages checked;
- a rebase stopped by a conflict → stage the resolution with stage 2's `git:stage` → `continue` (later rewords still applied) → and a separate run with `abort`;
- refusal on a pushed range, and on a range with a merge;
- a `pre-push` hook that rejects;
- a `post-checkout` hook that records `ELECTRON_RUN_AS_NODE`: it must be empty;
- **stale preview:** commit in "a terminal" between preview and run → the stale copy, nothing changed;
- dubious ownership (root on Linux only: `chown` a repo to another user) → the ownership copy, nothing run.

To run the helper in tests, set `deps.editorCommand = { exe: process.execPath, helper }`. Under Node, `ELECTRON_RUN_AS_NODE` is ignored, so the same command line works.

- [ ] Steps: write → run → fix → commit `test(git): stage 4 actions against real repositories`

---

### Task 8: Renderer — the action flow, preview dialog and activity drawer

**Files:**
- `src/views/git/use-git-sync.js`, `action-dialog.jsx`, `activity-drawer.jsx`, and their tests;
- `src/git-config.js` (nothing persisted: the activity log is session-only).

**Interfaces:**
- `useGitSync({ adapter, registered, reload })` → `{ open(kind, targets, options), dialog, confirm(options), close, running, activity, retryFailed(runId) }`.
  - `open` previews every target, at most two at a time.
  - `confirm` runs eligible ticked targets one by one per repository, in parallel across repositories (at most two). It adds an activity entry per target, then reloads the snapshot once.
  - `retryFailed` re-previews only the failed targets of that run and opens the dialog with them.
- `ActionDialog`, per the design's preview dialog:
  - kind-specific option fields: pull mode; push remote/dest/set upstream; branch name/start/checkout; worktree path; stash message/include untracked/index; revert parent;
  - the typed `DROP`;
  - the batch note.
- `ActivityDrawer`: collapsible, newest first, expand for git's output, **Retry failed** per run, **Copy**.

- [ ] **Step 1: Failing tests:**
  - preview rows with skipped reasons and programs;
  - the batch note only for batches;
  - Run disabled until `DROP` is typed;
  - a double click runs once;
  - a stale result shows the copy and reloads;
  - Retry failed re-previews only failures;
  - the activity cap.
- [ ] **Step 2–4. Step 5: Commit** — `feat(git): action preview dialog, runner and activity log`

---

### Task 9: Renderer — menus, banner, History entries, rebase dialog

**Files:**
- `worktree-panel.jsx`, `group-menu.jsx`, `history-pane.jsx`, `view-git.jsx`;
- new `operation-banner.jsx` and `rebase-dialog.jsx`;
- their tests.

- **Worktree panel header:** **Sync** (`Fetch`, `Pull ▾`, `Push…`) and **Branch ▾** (New branch… / Check out… / New worktree… / Remove worktree… / Stash…).
- **Group menu:** **Fetch all** and **Pull all (fast-forward)**, from `actionTargets` over the scoped worktrees.
- **History rows:** a context menu (right-click, and a `⋯` button for keyboard users):
  - New branch here…
  - Check out (detached)…
  - Revert…
  - Rebase from here… (shown only when `history.unpushed` contains every commit from this row up to HEAD and none is a merge)
- **`OperationBanner`:** shown when `tree.operation` is set, with **Continue** (disabled while conflicts remain) and **Abort** (confirm).
- **`RebaseDialog`:**
  - rows from `rebasePlan` over the History page's commits from the base to HEAD;
  - an action select per row, ↑/↓ buttons, and a message field for `reword` and on the last row of each squash group;
  - `rebaseProblems` block Run;
  - Run goes through `useGitSync` with kind `rebaseInteractive`.

- [ ] **Step 1: Failing tests:**
  - each menu entry opens the right kind with the right target;
  - the rebase entry hides on pushed or merge ranges;
  - the banner appears for each operation, and Continue is disabled with conflicts;
  - the rebase dialog's moves, actions, messages and problems produce the expected `rows`;
  - stage 2 and stage 3 tests still pass.
- [ ] **Step 2–4. Step 5: Commit** — `feat(git): sync and branch menus, operation banner, history actions and rebase dialog`

---

### Task 10: Spec amendments and full verification

- [ ] **Step 1:** Append `## Amendments made during stage 4 planning` with:
  - `GIT_EDITOR=:` as the default no-op;
  - the env-prefixed helper command;
  - the plan file and its recorded path for `continue`;
  - `asarUnpack`;
  - `check-ref-format` in two layers;
  - previews using last-fetched state.

  Then set the status line to stage 4 implemented.
- [ ] **Step 2: Full suites and `vite build`** (as stage 3; the known Jira flake rule applies).
- [ ] **Step 3: Browser harness check:** as for stage 3, render the panel with a fake adapter in Chromium and look at the preview dialog, the rebase dialog and the activity drawer.
- [ ] **Step 4: Smoke test:** `npm -w apps/desktop run e2e`; report it as "blocked" headless.
- [ ] **Step 5: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Fetch on a worktree | Activity ✓; "Last fetch" updates |
| 2 | Pull (fast-forward) when behind | Preview lists incoming commits; ✓; ahead/behind clears |
| 3 | Push a new branch | Preview says "sets upstream"; ✓; upstream shown |
| 4 | Push when the remote moved | `The remote has commits you don't have - pull first.`; no force offered anywhere |
| 5 | New worktree from a remote branch | Folder `<repo>/<branch-with-dashes>`; devenv's Start picker lists it |
| 6 | Stash, then Pop | Changes back; Drop needs `DROP` |
| 7 | History → Rebase from here on 3 unpushed commits; squash two, reword one | Messages as typed; no terminal window |
| 8 | Same on a pushed commit | Entry not offered |
| 9 | A rebase with a conflict | Banner; resolve, stage, Continue completes |
| 10 | Group → Fetch all with one broken remote | Others ✓, that one ✗; Retry failed re-previews only it |
| 11 | Preview a pull, commit in a terminal, then Run | `Changed since the preview. Preview again.` |
| 12 | A repo with an LFS filter / pre-push hook | The preview lists them under "Runs" |

- [ ] **Step 6: Commit** — `docs(git): record stage 4 planning amendments`
