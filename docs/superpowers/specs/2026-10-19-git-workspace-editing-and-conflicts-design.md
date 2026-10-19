> the next step is an implementation plan (superpowers:writing-plans).

## Context and why

The user rebased onto main, hit a conflict with another developer's changes, and had to drop to a
terminal: the Git Workspace (apps/desktop/src/views/git/) can show that a file is conflicted but
can't open, compare or edit it. The pain, in their words: "not being able to easily compare the 2
changes and either select one or combine them. I had to do it manually." They also want to edit
code from the workspace generally, not only conflicted files.

Today: a conflicted file shows a read-only combined diff with "Resolve in your editor, then stage
the file" (`diff-pane.jsx:62`); the only resolution path is staging the whole file; the
`OperationBanner` (`operation-banner.jsx`) offers Continue (disabled while conflicts remain) and
Abort, no Skip, and no progress.

Success: a rebase or merge conflict is resolved end to end in the workspace — compare both sides,
take one, combine them or hand-edit, mark resolved, continue — without a terminal or another
editor. And any file in a worktree can be opened, edited and saved there.

## Two parts, in this order

1. **File editor** (built first; the conflict screen's result pane reuses it).
2. **Conflict resolution.**

### Part 1 — File editor

- **Where:** the details panel gets a **Diff | Edit** switch for the focused file (user's choice).
  The repo list and changes list stay visible. Edit shows the file in CodeMirror with syntax
  colours and undo, a "● unsaved" marker, **Save** and **Revert** (discard unsaved edits).
- **Ways in** (user chose 1 and 2; 3 is cheap and was recommended):
  1. Any changed file in the changes list → Edit.
  2. **Go to file** (button in the panel head + Ctrl+P): type-to-filter over the selected
     worktree's tracked files plus untracked, not-ignored files (`git ls-files -co --exclude-standard`).
     Opening a file not in the changes list still uses the Diff | Edit switch (Diff empty until it changes).
  3. Clicking a line in the diff opens Edit at that line.
- **After save:** the snapshot reloads so the changes list and diff reflect the edit.
- **Safety** (proposed, user confirmed "looks right"):
  - Saving checks the file is unchanged on disk since it was opened; if not, warn and offer
    reload or overwrite — never silently overwrite.
  - Switching file, worktree, panel or view with unsaved edits asks first.
  - Only files inside a registered worktree can be read or written (same path rules as the
    existing git IPC: relative, inside the worktree, no NUL/drive/device paths, symlink/junction
    escapes refused).
  - Binary files and very large files are not editable (say why). Line endings and a BOM are kept as found.
- **Out of scope for now:** creating, renaming or deleting files; find/replace beyond what
  CodeMirror gives by default; format on save; a folder-tree Files tab (possible later).

### Part 2 — Conflict resolution

- **Rebase bar** (replaces `OperationBanner`): what's happening and how far —
  "Rebasing feat/x onto main · commit 3 of 7 · abc123 *Fix login*" — with **Continue / Skip /
  Abort**. Continue is enabled once no conflicted files remain. Merge, cherry-pick and revert get
  the same bar with their own wording (no step count where git has none).
- **Conflicts first:** conflicted files are grouped at the top of the changes list with a count.
  Each has whole-file shortcuts **Use main's** / **Use mine** (wording follows the labels below).
- **Labels by meaning, never "ours/theirs"** (the swap during a rebase is the most common
  confusion across tools):
  - Rebase: "main (already applied)" vs "Your commit abc123 *Fix login*" (upstream name and the
    commit being replayed).
    Git records only the base *commit*, so (user's choice): a rebase started from the workspace
    remembers the branch name it was started onto; otherwise the label reads "the new base
    (abc123)", adding a branch name only when exactly one branch points at that commit. Never a
    confident wrong name.
  - Merge: "your branch (feat/x)" vs "branch being merged (main)".
  - Cherry-pick / revert: the current branch vs the commit being picked/reverted.
- **Resolve screen** (user's choice of layout), replacing Diff | Edit for a conflicted file:
  - Top: the two sides side by side, read-only, each headed by its label, with a
    **Take main's / Take mine** button on each conflict.
  - Bottom: the **Result**, editable (the Part 1 editor). It starts as git's own merge result, so
    everything that didn't clash is already in; only the clashing blocks need a decision.
  - Per conflict also: **Both (main first)** / **Both (mine first)**. Typing in the result is
    always allowed.
  - **"2 of 3 left"** counter with previous/next conflict.
  - **Mark resolved:** saves and stages the file; warns if conflict markers remain.
  - **Undo resolution:** puts the file back into its conflicted state.
  - **Show original:** toggle to see the version both sides started from (merge base).
  - Mockup:
    ```
    ┌ Resolve: auth.js ───────── 2 of 3 left  [↑][↓] ─────┐
    │ main (already applied)   │ Your commit abc123        │
    │ [Take main's]            │ "Fix login"  [Take mine]  │
    │ if (user.token) {        │ if (user && user.token) { │
    │   refresh(user)          │   login(user)             │
    │──────────────────────────┴───────────────────────────│
    │ Result (editable)     [Both: main first ▾]           │
    │ if (user && user.token) {                            │
    │   login(user)▌                                       │
    │                     [Undo resolution] [Mark resolved]│
    └──────────────────────────────────────────────────────┘
    ```
- **Conflicts with no text to merge** (user's choice: handle them, no terminal): delete/modify,
  rename/modify, add/add and binary conflicts. The resolve screen says what each side did
  ("main deleted this file; your commit changed it") and offers the matching choices — e.g.
  **Keep my version** / **Accept the deletion**, or for binaries **Use main's** / **Use mine**.
  Choosing resolves it (`git add` / `git rm` as appropriate); Undo resolution still applies.
  Add/add text conflicts with markers use the normal resolve screen.
- **Out of scope:** auto-resolving clashing blocks (no "magic wand" or AI); a bulk "resolve all
  files" action beyond the per-file shortcuts; conflicts outside a rebase/merge/cherry-pick/revert
  (e.g. stash pop) need only work as well as the resolve screen naturally allows.

## Goals, non-goals, anti-goals

- **Goals:** never need the terminal to finish a conflicted rebase; comparing the two sides and
  taking one or both is a click; editing any worktree file is quick.
- **Non-goals:** becoming a full IDE (no language servers, terminals, multi-file tabs, refactors).
- **Anti-goals (a failure even if it works):** losing someone's edits — an overwrite of a file
  changed elsewhere, or unsaved work discarded without asking; labels that leave the user unsure
  which side is theirs; writing outside a registered worktree.

## Constraints (from the existing code)

- Electron app; renderer talks to main only through named IPC operations
  (`apps/desktop/src/adapters/git.js` → `electron/preload.cjs` → `electron/ipc/git.cjs` /
  `git-actions.cjs`), each taking `(repo, worktreePath, registered, …)` and validated with
  `requireRegistered` / `requireExactWorktree` / `requirePaths` (`git.cjs:320-365`).
- Writes are stale-checked: `fileWrite()` (`git.cjs:518`) takes the repo lock (`withRepoLock`),
  recomputes the stamp, compares, then acts. New writes follow the same pattern.
- Continue/Abort are existing actions in `git-actions.cjs` (`continueOrAbort`, preview/run with a
  stamp); Skip should be added the same way.

## How it gets made (my calls, stated so they can be overruled)

- **Editor:** reuse `apps/desktop/src/views/devenv/code-editor.jsx` (`CodeEditor`), moved to
  `views/shared/` since two features now use it. Syntax colours: add JavaScript/TypeScript
  (incl. JSX), CSS, HTML and C# to the existing JSON, YAML, SQL, Markdown and PowerShell; other
  files open as plain text.
- **Remembered rebase base:** when the workspace starts a rebase, store the branch name it was
  started onto (e.g. alongside the repo in git config or app state); clear it when the rebase ends.
- **Read/write a worktree file:** new git IPC operations; reuse the confined, atomic,
  stamp-checked read/write from `electron/ipc/devenv-profile.cjs` (`resolveFile`, temp-file +
  rename with retries, BOM/size/binary checks) by extracting it to a shared module.
- **Conflict sides:** read git's stage blobs (`:1:` base, `:2:` ours, `:3:` theirs);
  `indexEntries` (`git.cjs:373`) already returns stage and oid. Map ours/theirs to the labels
  above per operation (rebase swaps them). Progress and the replayed commit come from
  `.git/rebase-merge/{msgnum,end}` and `REBASE_HEAD` (or the rebase-apply equivalents).
- **Undo resolution:** `git checkout -m -- <path>` (recreates the conflicted file).
- **Resolve UI:** add `@codemirror/merge`. It compares two documents only, so the top panes are a
  custom side-by-side of the two conflict sides, and the result is the CodeEditor with conflict
  regions found by parsing the markers in the working file; the buttons rewrite a region.
  Implementation details here are the builder's.
- **Tests:** follow the existing patterns — real-git integration tests for new IPC
  (`electron/ipc/git.*.integration.test.js`; `git.actions.integration.test.js:180-215` already
  builds a rebase conflict), mocked-adapter view tests beside each component, pure helpers in
  `packages/core/src/modules/git` with unit tests.

## Left to the builder

Component and module boundaries, IPC names and shapes, how conflict regions are tracked as the
user types, keyboard shortcuts beyond Ctrl+P, exact size limit for editable files, styling within
the existing `devenv-git.css` look.

## Verification

- `npx vitest run` in `apps/desktop` (new unit, view and real-git integration tests pass; the
  pre-existing jsdom `localStorage` failures are unrelated and noted).
- Real-git integration: create a rebase conflict, read the three stages, write a resolution,
  mark resolved, Skip, Continue to completion; Undo resolution restores markers; stale write is refused.
- In the running app (`electron .` from apps/desktop): edit and save a file via the changes list
  and via Ctrl+P; then rebase a test branch onto main with a conflict and resolve it entirely in
  the workspace — take mine on one block, both on another, mark resolved, continue.
