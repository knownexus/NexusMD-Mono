# Git Workspace: branch source, branch commits, reword and squash

Date: 2026-10-26 · Desktop app (`apps/desktop`), Git Workspace

## Why

An unpublished branch is hard to read from the Git Workspace today. Its row says only `not published`. Without an upstream there's no `↑N`, so the row can't tell you whether the branch has commits of its own, what it was branched from, or how many commits it has. Finding that out means opening History and reading the graph. Tidying those commits (fixing a message, folding a "fix typo" commit into the one before it) means opening the full Rebase dialog.

Success means: from the branch list you can see at a glance that an unpublished branch has N commits off its source branch, and which branch that is. Opening the branch shows those commits right away. A right-click rewords or squashes them.

## Goals

1. **Source branch, worked out and remembered.** The app works out the branch each branch was made from, and stores it in the repo's own `.git/config`. The user can change it.
2. **Commit count in the branch list.** An unpublished branch's row shows how many of its commits aren't on its source branch.
3. **Branch commits on open.** Opening a branch shows its own commits, newest first, without going to the History tab.
4. **Reword and squash from a right-click menu** on those commits.
5. **Rename "Publish" to "Push"** on the buttons.
6. **Fix scrolling in the commit details** opened from History. Long content is cut off today.

## Non-goals

- Reordering or dropping commits. The existing **Rebase from here…** dialog already does that.
- Rewording or squashing commits that are already pushed. The Git Workspace never force-pushes, and this doesn't change that.
- Stashing automatically to make a rewrite possible.
- Source-branch tracking for detached HEADs.

## Anti-goals (a failure even if it works)

- The overview poll gets noticeably slower. It runs often, and starting `git` is slow on Windows (see the comment in `git:status`, `apps/desktop/electron/ipc/git.cjs`).
- Anything gets written outside `.git/config`, or anything gets committed or pushed, just to remember a source branch.
- A rewrite runs on a dirty worktree, mid-operation, or over pushed commits.

## Existing pieces to build on

- `branchState` / `branchMeta` / `primaryAction` in `packages/core/src/modules/git/status-meta.js`. These make the row meta, the tones and the primary button (today `Publish` / `Re-publish`).
- `BranchHeader` (`apps/desktop/src/views/git/branch-header.jsx`) has a tracking line and a More menu, which has `Publish…`.
- `AttentionOverview` has a "Not published" card whose action is labelled `Publish` / `Re-publish`.
- `HistoryPanel` / `HistoryPane` already have a right-click commit menu (`commitMenu`), a `Since <base>` filter (`sinceBase`) and a set of unpushed oids (`history.unpushed`).
- The `rebaseInteractive` action (`apps/desktop/electron/ipc/git-actions.cjs`) already takes a row plan `{ oid, action, message }`. It supports `reword` and `squash` with messages supplied by the plan, and it refuses dirty worktrees, operations in progress, pushed commits and merges. It goes through the usual preview → run flow, including conflict stop / continue.
- `rememberBase` stores a rebase's onto-branch in a marker file under `.git`. That marker is temporary and unrelated: don't reuse it for the source branch.

## Design

### 1. Source branch

**Storage.** `git config --local branch.<name>.nexusBase <full ref>`, for example `refs/heads/master` or `refs/remotes/origin/main`. It lives in the common `.git/config`, so every worktree of the repo sees it. Git drops it when the branch is deleted with `git branch -d`, and carries it over on `git branch -m`. Only `refs/heads/` and `refs/remotes/` refs are stored.

**Which branches get one (agreed with the user).** Every branch except the repo's default branch, which is `origin/HEAD`'s target branch, else `main`, else `master`. That includes published branches, so a pushed feature branch keeps its source, its strip and its picker. The default branch never gets a source, a count, a strip or a picker.

**Recorded at creation (my call).** When the app itself creates a branch, it writes `nexusBase` right then. This covers the `branch` action and History's "New branch here…", which uses the same action. `worktreeAdd` only checks out an existing branch, or a local copy of a remote one, so it creates no new source, and detection covers it. The value written is the branch that was checked out in that worktree when the branch was made. If the start was a named branch ref, that ref is written instead. If the start was a detached HEAD or a raw oid with no branch checked out, nothing is written, and detection runs later. The existing actions and their tests are extended for this.

**Working it out**, for branches made outside the app, the first time one is seen with no stored value:

1. The branch's reflog. The oldest entry, `branch: Created from <X>`, gives X if X resolves to a branch (local or remote) other than the branch itself. `HEAD` and raw oids don't count.
2. HEAD's reflog (my call). The entry that first moved HEAD onto this branch, `checkout: moving from <X> to <branch>`, gives X if X is a branch other than this one. This catches `git switch -c` / `git checkout -b`, which log `Created from HEAD`. This only works for the worktree that created the branch, since each worktree has its own HEAD reflog. Otherwise fall through.
3. Otherwise, the nearest branch. Among the other local branches, plus the remote default branch (`origin/HEAD`'s target) if there is one, pick the one whose merge-base with this branch is closest to this branch's tip (fewest commits in `<candidate>..<branch>`). Ties go to the repo's default branch (`origin/HEAD`'s target, else `main`, else `master`), then to the alphabetically first. Ignore branches whose tip is a descendant of this branch's tip, because they were made *from* it.
4. Nothing qualifies (an orphan branch, or a repo with one branch): store nothing, and show no source.

The result is written once. Later the stored value wins. If it names a ref that no longer exists, it's worked out again and overwritten.

*Builder's call:* whether this runs inside `git:status` or as its own IPC call that's cached. Either way it must not add process spawns to every poll. Once the value is stored, reading it each poll should cost one `git config --get` at most. Better still, read `.git/config` directly, the way `gitDirsFromDotGit` avoids a spawn.

**Changing it.** The branch header's tracking line gets `from master ▾`. It opens a picker of local and remote branches (reusing the existing branch switcher's search if that fits). Picking one writes `nexusBase`. The new action follows the usual action pattern: `check` validates that the ref exists and is a branch ref, and the run is a single `git config`. It needs no preview dialog, because it's just a setting.

### 2. Commit count in the branch list

For a branch with a source, compute `rev-list --count <source>..HEAD`.

- **Unpublished branch:** the row meta's `not published` becomes `3 commits off master · not published`. With 0 commits it stays `not published`. The source is shown by its short name (`master`, `origin/main`).
- **Published branch:** unchanged (`↑N to push` and so on).
- The "Not published" card on the overview shows the same `3 commits off master` text in its description.

*Agreed with the user:* on the overview poll, the count is only computed for unpublished rows. Published branches get theirs only when their detail page is open, for the strip. *My call:* the count is cached against (HEAD oid, source oid) and only recomputed when one of them changes.

### 3. Branch commits on open

When a branch with a source has commits off it, the branch detail page shows a **"N commits off master"** strip directly under the header, above the Changes / History tabs:

- It's collapsible, with the collapsed state remembered per viewer in `localStorage`, defaulting to open. It lists up to 10 commits, newest first, and each row shows the subject, short hash, age and a `↑` marker if unpushed (same as History).
- If there are more than 10, the last row is "Show all in History", which switches to the History tab with the `Since <source>` filter set to the source branch.
- Clicking a commit switches to the History tab focused on that commit, with its details open.
- With 0 commits off the source, or no source, the strip doesn't appear.

*My call:* placement under the header rather than a third tab, because the point is seeing the commits without a click.

### 4. Reword and squash from the right-click menu

The menu is available on the strip's rows and is also added to History's existing `commitMenu` (only when History is the worktree's own HEAD, same as today's actions).

| Selection | Menu item | Available when |
|---|---|---|
| One commit | **Reword…** | the commit is unpushed and not a merge |
| One commit | **Squash into previous…** | it and its parent are both unpushed, neither is a merge, and the parent is still on this branch (not on the source) |
| 2+ commits (Ctrl/Shift-click, strip and History) | **Squash selected…** | they're adjacent in first-parent history, all unpushed, no merges |

If an item doesn't apply, it's shown disabled with a reason, matching how `PopoverMenu` items already carry `reason`. Reasons: "Already pushed", "Merge commits can't be reworded here", "The previous commit is on master", "Pick commits that are next to each other".

**Reword…** opens a small dialog with the full message (subject + body) prefilled, in a multi-line field. Save is disabled while the subject is empty or the message hasn't changed.

**Squash…** opens the same dialog, prefilled with the messages of the commits being combined, oldest first, separated by blank lines.

**Both run as `rebaseInteractive`.** The base is the parent of the oldest commit touched, and the rows are every commit in `base..HEAD`: `pick` everywhere except `reword` (with `message`) on the reworded commit, or `pick` on the oldest of a squash group and `squash` on the rest. The final message goes on the group's last row, which is where `rebaseMessages` looks for it. This goes through the existing preview → run flow and the existing refusals (dirty worktree → "stash first", operation in progress, pushed, merges). It also gets the existing conflict handling for free.

*Builder's call:* whether the dialog's Save goes straight to run or shows the usual action preview first. Follow whichever the other history actions do.

### 5. Publish → Push

- `primaryAction` label: `Publish` → `Push`, and `Re-publish` → `Push`. The kind stays `publish`, so it still sets the upstream.
- `AttentionOverview` "Not published" card action: same labels.
- `BranchHeader` More menu: `Publish…` → `Push…`.
- State wording that describes the branch rather than a button stays as it is: the `Not published` filter chip and card title, the `not published` row meta, and "Not published yet".
- Update the tests that assert these labels.

### 6. Commit details scrolling

`.nx-gw-history` (`apps/desktop/src/views/git/git-workspace.css`) is a 70vh grid with no row template, so its single implicit row grows to fit the content. `.nx-gw-cdetail`'s own `overflow: auto` therefore never applies, and the bottom is clipped. Add `grid-template-rows: minmax(0, 1fr)` (and check the history list still scrolls). Verify in the running app with a commit that has a long body and many files.

## Tests

- **Core:** the new row-meta text (unpublished with N > 0, N = 0, no source), the renamed labels, and the plan building for reword / squash-into-previous / squash-selected, including which menu items are disabled and why.
- **Electron:** recording the source at creation (`branch`, `worktreeAdd`, from a branch / from a detached HEAD), detecting the source (the branch-reflog case, the HEAD-reflog `checkout: moving from` case, the default branch never getting one, the nearest-branch fallback, ties to the default branch, descendants ignored, orphan → none, a stale stored ref worked out again), writing and reading `nexusBase`, and the set-source action's `check`. Use integration tests on real temp repos, like `git.history-actions.integration.test.js`.
- **UI:** the strip (shown/hidden, max 10 + "Show all", click focuses History), the context menu items and their disabled reasons, the reword/squash dialog validation, and the header's source picker.
- **Runtime:** the scroll fix and the strip, checked in the app (see `apps/desktop:verify`).

## Left to the builder

- Where the source detection and count run (in `git:status` or a separate call), as long as the poll stays cheap.
- Exact visual styling of the strip and the dialog, within the existing Git Workspace CSS.
- Whether the reword/squash dialog's Save shows the action preview.
