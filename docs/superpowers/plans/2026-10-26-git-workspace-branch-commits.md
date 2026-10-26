# Git Workspace Branch Commits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each non-default branch knows its source branch. Unpublished rows show `N commits off <source>`. A branch's own commits show in a strip under its header. Unpushed commits can be reworded or squashed from a right-click menu. "Publish" buttons read "Push". Commit details in History scroll.

**Architecture:** The main process gets a new `git-source.cjs` module. It reads, detects and stores `branch.<name>.nexusBase` in the repo's `.git/config`, and counts commits off the source. `git:status` returns the result as `source`, so it rides the existing snapshot poll. Core gets the pure pieces: row text and the reword/squash plan builder. Reword and squash are just pre-built plans for the existing `rebaseInteractive` action. The renderer adds the strip, the source picker, the message dialog, and new History menu items.

**Tech Stack:** Electron (CommonJS main process), React 18 renderer, `@nexusmd/core` (ESM), Vitest 4, real `git` in integration tests.

**Spec:** `docs/superpowers/specs/2026-10-26-git-workspace-branch-commits-design.md`

## Global Constraints

- Source is stored only as `git config --local branch.<name>.nexusBase <full ref>`, and only `refs/heads/*` or `refs/remotes/*` values. Nothing else is written, committed or pushed.
- The repo's default branch never gets a source, a count, a strip or a picker. The default branch is `origin/HEAD`'s target, else `main`, else `master`.
- Poll cost: a branch with a stored source spawns no extra `git` process unless its count is needed and isn't cached. Detection (several spawns) runs at most once per branch, plus once more after its stored ref goes away.
- The count is only computed on the poll for unpublished worktrees and for the worktree on screen.
- Reword and squash only run on unpushed, non-merge commits, via `rebaseInteractive`. Never force-push and never stash automatically.
- Copy, exactly: row `3 commits off master · not published` (singular `1 commit off master · not published`). Strip title `3 commits off master`. Header `from master ▾`. Menu `Reword…`, `Squash into previous…`, `Squash selected…`. Reasons: `Already pushed`, `Merge commits can't be reworded here`, `Merge commits can't be squashed here`, `The previous commit is on master`, `The previous commit is already pushed`, `Pick commits that are next to each other`, `Clear the search first`.
- Buttons `Publish` / `Re-publish` / `Publish…` become `Push` / `Push` / `Push…`. State wording (`Not published` chip and card title, `not published` meta, `Not published yet`) stays.
- Work on branch `feat/git-branch-commits`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npx vitest run <file>` from `apps/desktop` or `packages/core`.

## Review Focus

1. **A fresh branch with no commits yet.** Its tip equals master's tip, so detection must not throw out master as a "descendant". Source = master, count 0, no strip. Test in Task 3.
2. **A branch renamed or deleted outside the app.** `git branch -m` carries the key over. A stored ref that no longer exists is detected again, not shown as a dead name. Test in Task 3.
3. **History with a search or the "Since" filter on.** The list is not contiguous, so reword/squash plans would be wrong. Edits are disabled with `Clear the search first`. Test in Task 7.
4. **Squash selected across a gap or over a merge.** It must be refused before any rebase starts. Test in Task 6.
5. **The rewrite stops on a conflict.** This uses the existing Continue/Abort banner, unchanged. After Abort the branch is untouched. Covered by the existing `rebaseInteractive` integration tests. Task 6 adds one plan-to-run integration test for reword to prove the plan shape is accepted.

---

### Task 1: Commit details scroll

**Files:**
- Modify: `apps/desktop/src/views/git/git-workspace.css:333`

- [ ] **Step 1:** Change `.nx-gw-history` to `{ display: grid; grid-template-rows: minmax(0, 1fr); height: 70vh; min-height: 320px; }`.
- [ ] **Step 2: Verify at runtime** with the `apps/desktop:verify` skill. Open History on a commit with a long body and many files. Expected: the details panel scrolls to its last file, and the commit list still scrolls separately. jsdom can't check layout, so there's no unit test.
- [ ] **Step 3: Commit** `fix(desktop): commit details in History scroll instead of clipping`.

### Task 2: Publish → Push labels

**Files:**
- Modify: `packages/core/src/modules/git/status-meta.js` (`primaryAction`)
- Modify: `apps/desktop/src/views/git/attention-overview.jsx` (the `local` category's `action`)
- Modify: `apps/desktop/src/views/git/branch-header.jsx` (More menu item)
- Test: the existing tests that assert these labels. Find them with `grep -rn "Publish\|Re-publish" --include=*.test.* apps packages`.

- [ ] **Step 1:** Update the tests to expect the new labels. `primaryAction` returns `{ kind: 'publish', label: 'Push' }` for both unpublished and upstream-gone. The overview card button reads `Push`. The header More item reads `Push…` whether or not the branch is published.
- [ ] **Step 2:** Run them. Expected: FAIL on the old labels.
- [ ] **Step 3:** Change the three labels. Keep `kind: 'publish'` and `setUpstream`.
- [ ] **Step 4:** Run `npx vitest run` in `packages/core` and `apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): call the Publish buttons Push`.

### Task 3: Source branch module (main process)

**Files:**
- Create: `apps/desktop/electron/ipc/git-source.cjs`
- Test: `apps/desktop/electron/ipc/git-source.test.js` (pure parsers) and `apps/desktop/electron/ipc/git.source.integration.test.js` (real repos; copy the setup of `git.history-actions.integration.test.js`)

**Interfaces:**
- Produces (all exported from `git-source.cjs`):
  - `readConfigSource(configText: string, branch: string): string|null`. Finds `[branch "<branch>"]` and its `nexusBase` key. Section and key names compare case-insensitively, the subsection (branch name) exactly. Values may be quoted.
  - `readRefOid(commonDir: string, ref: string, fsx = fs): string|null`. Reads the loose ref file, else the `packed-refs` line. Returns null if neither exists.
  - `defaultBranch(commonDir: string, fsx = fs): string|null`. Returns a short name. It reads `refs/remotes/origin/HEAD` (`ref: refs/remotes/origin/<name>`), else `main` if `refs/heads/main` exists, else `master` if it exists, else null.
  - `detectSource(run, branch: string, commonDir: string): Promise<string|null>`. `run(args) → Promise<{ code, stdout }>` runs git in the worktree. Returns a full ref.
  - `createSourceReader({ run, commonDir, fsx }): { get(branch, { head, count }): Promise<{ ref: string, count: number|null }|null>, write(branch, ref): Promise<void> }`. It reads `<commonDir>/config` with no spawn, detects and writes when the key is missing or the ref is gone, and returns null for the default branch or when detection finds nothing. With `count: true` it returns `rev-list --count <ref>..<head>`, cached in a module-level `Map` keyed `${commonDir}\0${branch}\0${head}\0${refOid}`.

- [ ] **Step 1: Write the failing tests.**
  - `git-source.test.js`:
    - `readConfigSource` finds `nexusBase` under `[branch "feat/x"]`, including a quoted value, and `NexusBase` spelled with other casing.
    - It returns null for a key in another branch's section.
    - `readRefOid` reads a loose ref, reads a packed ref, and returns null for a missing ref (use a temp dir).
  - Integration tests, each on a fresh repo with `main` and a few commits:
    - **branch reflog:** `git branch feat main`, then `get('feat')` → `refs/heads/main`.
    - **HEAD reflog:** on `dev`, `git switch -c feat` → `refs/heads/dev`. The branch reflog says `Created from HEAD`, so this proves step 2.
    - **nearest branch:** create `feat` with `git update-ref` (no reflog), 2 commits past `dev`, while `main` is 5 behind `dev`. Expect `refs/heads/dev`.
    - **fresh branch (Review Focus 1):** `feat` made by `update-ref` at main's tip → `refs/heads/main`, and `count: true` → `0`.
    - **descendant ignored:** `child` made from `feat` with commits → `feat`'s source is not `child`.
    - **tie goes to the default:** `main` and `other` at the same commit → `refs/heads/main`.
    - **default branch:** `get('main')` → null and writes nothing (`git config --get branch.main.nexusBase` exits 1).
    - **stored wins:** after `write('feat', 'refs/heads/other')`, `get` → `refs/heads/other` with no detection spawns (count the `run` calls).
    - **stale (Review Focus 2):** store `refs/heads/gone`, then `get` re-detects and overwrites. `git branch -m feat feat2` → `get('feat2')` returns the stored value.
    - **count:** 3 commits on `feat` → 3. A second `get` with the same head makes no `run` call.
- [ ] **Step 2:** Run both files. Expected: FAIL, because the module doesn't exist.
- [ ] **Step 3: Implement `git-source.cjs`.** Detection order:
  1. `reflog show --format=%gs refs/heads/<b>`, last line matching `^branch: Created from (.+)$`.
  2. `reflog show --format=%gs HEAD`, the oldest line matching `^checkout: moving from (\S+) to <b>$`.
  3. For each X from steps 1 and 2, run `rev-parse --symbolic-full-name --end-of-options X`. Accept it only if it starts with `refs/heads/` or `refs/remotes/`, isn't `refs/heads/<b>`, and still resolves.
  4. Nearest: candidates are `for-each-ref --format=%(refname) refs/heads` minus `<b>`, plus `refs/remotes/origin/<default>` if it exists. Drop a candidate only when its tip differs from `<b>`'s tip and `merge-base --is-ancestor <b> <cand>` succeeds. Distance is `rev-list --count <cand>..<b>`. Ties go to the default branch's local ref, then its remote ref, then alphabetical order.
  5. Write with `config --local branch.<b>.nexusBase <ref>`.
- [ ] **Step 4:** Run both test files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): work out and remember each branch's source branch`.

### Task 4: `git:status` returns the source; core carries it

**Files:**
- Modify: `apps/desktop/electron/ipc/git.cjs` (the `git:status` handler, around line 692)
- Modify: `packages/core/src/modules/git/snapshot.js` (`applyStatus`, `loadRepo`)
- Modify: `packages/core/src/adapters/index.js` (IGitAdapter `status` options doc)
- Test: `apps/desktop/electron/ipc/git.source.integration.test.js` (add cases), `packages/core/src/modules/git/snapshot.test.js` (or wherever `applyStatus` is tested)

**Interfaces:**
- Consumes: `createSourceReader` (Task 3).
- Produces:
  - `git:status` result gains `source: { ref: string, count: number|null } | null`. Options gain `countSource?: boolean`.
  - In core, `tree.source` is the same object or null.
  - `loadRepo` passes `countSource: all`, where `all` is the worktree on screen.
  - Exported from core `index.js`: `sourceName(ref: string): string`, which strips `refs/heads/` or `refs/remotes/`.

- [ ] **Step 1: Write the failing tests.**
  - Integration:
    - The status of an unpublished `feat` worktree has `source.ref === 'refs/heads/main'` and `source.count === 2`.
    - Published `feat` with `countSource` off → `source.count === null`. With `{ countSource: true }` → a number.
    - Detached HEAD → `source === null`. `main` → `source === null`.
  - Core:
    - `applyStatus(tree, { porcelain, source: { ref: 'refs/heads/main', count: 2 } }).source` deep-equals that object, and is null when absent.
    - `sourceName('refs/remotes/origin/main') === 'origin/main'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In the handler, take the branch from porcelain `# branch.head`, skipping `(detached)`. `unpublished` = no `# branch.upstream`, or no `# branch.ab`. Call `reader.get(branch, { head: <# branch.oid>, count: unpublished || !!options?.countSource })`.
  - Build the reader once per handler call from `commonDir`, which the handler already resolves. Wrap it in try/catch so a source failure never fails status; it becomes `source: null`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): branch status carries its source branch and commits off it`.

### Task 5: Record the source at creation, and change it by hand

**Files:**
- Modify: `apps/desktop/electron/ipc/git-actions.cjs` (`branch` action; new `setSource` action; `runSteps` gets an `after` hook)
- Test: `apps/desktop/electron/ipc/git.source.integration.test.js` (add cases)

**Interfaces:**
- Consumes: `createSourceReader(...).write` (Task 3).
- Produces:
  - An `after(wt, o, state)` hook on actions. `runSteps` awaits it after all steps succeed. Unlike `before`, it doesn't trigger `forgetBaseIfIdle`.
  - `branch.after` writes the source:
    - when `o.start` is a `refs/heads/` or `refs/remotes/` ref other than the new branch: `o.start`;
    - otherwise, if `state.symbolic` starts with `refs/heads/`: `state.symbolic`;
    - otherwise nothing.
    - It never writes when the new branch is the default branch.
  - New action `setSource`: `check(wt, { branch, ref })` requires `branch` to be a local branch other than the default, and `ref` to be an existing `refs/heads/*` or `refs/remotes/*` ref other than `refs/heads/<branch>`. It returns `{ branch, ref }`. `steps` → `[['config', '--local', `branch.${branch}.nexusBase`, ref]]`. `stamp: () => 'setSource'`.
  - `worktreeAdd` is unchanged. It only checks out an existing branch, or a local copy of a remote one, so no new source is made. *(Deviation from the spec, which listed it. Detection covers it, and the remote branch is never a candidate.)*

- [ ] **Step 1: Write the failing tests** (via `git:preview` then `git:run`, like the `act()` helper):
  - On `dev`, `branch { name: 'feat', checkout: true }` → `branch.feat.nexusBase` = `refs/heads/dev`.
  - `branch { name: 'f2', start: 'refs/heads/main' }` → `refs/heads/main`.
  - `branch { name: 'f3', start: <oid> }` while on `dev` → `refs/heads/dev`.
  - From a detached HEAD with an oid start → no key.
  - `setSource { branch: 'feat', ref: 'refs/heads/main' }` writes it.
  - `setSource` refuses `refs/tags/v1`, a missing ref, `refs/heads/feat` itself, and `branch: 'main'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `after` in `runSteps`, `branch.after`, and `setSource`.
- [ ] **Step 4:** Run, plus the existing `git.actions.integration.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): new branches remember their source; setSource action`.

### Task 6: Core: row text and the reword/squash plans

**Files:**
- Modify: `packages/core/src/modules/git/status-meta.js` (`branchMeta`)
- Create: `packages/core/src/modules/git/commit-edit.js`, exported from `packages/core/src/modules/git/index.js` and `packages/core/src/index.js`
- Modify: `apps/desktop/src/views/git/attention-overview.jsx` (the `local` card's `desc`)
- Test: `packages/core/src/modules/git/status-meta.test.js`, `packages/core/src/modules/git/commit-edit.test.js`, `apps/desktop/electron/ipc/git.source.integration.test.js` (one run)

**Interfaces:**
- Consumes: `tree.source`, `sourceName` (Task 4). `rebasePlan`, `setRowAction`, `setRowMessage` (existing, `rebase-plan.js`).
- Produces (`commit-edit.js`). `commits` is always newest-first `[{ oid, subject, parents }]`, starting at HEAD and contiguous. `unpushed` is a `Set<oid>`. `own` is the `Set<oid>` of `source..HEAD`, or null.
  - `rewordProblem(commit, unpushed): string|null`
  - `squashPreviousProblem(commits, index, unpushed, own, source: string|null): string|null`
  - `squashSelectedProblem(commits, oids: string[], unpushed): string|null`. Requires 2+ oids, all unpushed and non-merge, and each selected commit's `parents[0]` must be the next selected one in list order.
  - `editPlan(commits, edit): { base: string, rows: [{ oid, subject, action, message }] }`, where `edit` is `{ kind: 'reword', oid, message }` or `{ kind: 'squash', oids, message }`.
  - `squashMessage(messages: string[]): string`. Takes messages oldest first, trims each, and joins them with a blank line.

- [ ] **Step 1: Write the failing tests.**
  - `branchMeta`:
    - unpublished with `source { ref: 'refs/heads/master', count: 3 }` → contains `{ text: '3 commits off master · not published', tone: 'muted' }`;
    - `count: 1` → `1 commit off master · not published`;
    - `count: 0` or no source → `not published`;
    - published with a source → unchanged (`↑2 to push`).
  - The overview card desc for the same tree → `3 commits off master · Only exists on this machine`.
  - `commit-edit`:
    - `rewordProblem` → `Already pushed` for a pushed commit, the merge reason for 2 parents, else null.
    - `squashPreviousProblem`:
      - the oldest own commit with `own` set → `The previous commit is on master`;
      - previous not unpushed → `The previous commit is already pushed`;
      - a merge → `Merge commits can't be squashed here`.
    - **Review Focus 4:** `squashSelectedProblem` returns `Pick commits that are next to each other` for a gap, and the merge reason when any selected commit is a merge.
    - `editPlan` reword of the 2nd-newest commit of 3:
      - `base` = its `parents[0]`;
      - rows oldest-first = [reword(target, message), pick(newest)].
    - `editPlan` squash of the 2nd and 3rd newest of 4:
      - `base` = the 3rd's parent;
      - rows = [pick(3rd), squash(2nd, message), pick(newest)];
      - the message is on the group's last row (2nd). That matches `rebaseMessages`, which keys a squash group's message on its last commit.
  - Integration (Review Focus 5): run `rebaseInteractive` with `editPlan`'s output for a reword on a 3-commit unpublished branch. Expect the subject changed, the newer commit kept, and the tree identical.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `branchMeta` replaces the `not published` text when `tree.source?.count > 0`. `editPlan` throws on an oid that isn't in `commits`.
- [ ] **Step 4:** Run `npx vitest run` in `packages/core`, plus the integration file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): commits-off-source row text and reword/squash plans`.

### Task 7: History: menu items, disabled reasons, multi-select, focus requests

**Files:**
- Create: `apps/desktop/src/views/git/commit-message-dialog.jsx`
- Modify: `apps/desktop/src/views/git/history-pane.jsx` (menu items honour `disabled`/`reason`; Ctrl/Shift-click selection)
- Modify: `apps/desktop/src/views/git/history-panel.jsx` (new items; `request` prop)
- Test: `apps/desktop/src/views/git/commit-message-dialog.test.jsx`, `apps/desktop/src/views/git/history-pane.test.jsx`, `apps/desktop/src/views/git/view-git-history.test.jsx`

**Interfaces:**
- Consumes: Task 6's `commit-edit` functions. `adapter.commitDetails(...)` gives `.message`, the full message.
- Produces:
  - `CommitMessageDialog({ title: string, initial: string, onSave(message: string), onClose() })`. It's a `PlModal` with a multi-line field. Save is disabled while the first line is blank or the text equals `initial`.
  - `HistoryPane` gains `selected: Set<oid>` and `onSelect(oid, { additive, range })`. Menu items are now `{ label, onSelect, disabled?, reason? }`; a disabled item renders `disabled` with `title={reason}`.
  - `HistoryPanel` gains `request: { oid?: string, sinceBase?: string, nonce: number } | null`. On a new nonce it sets the filter to `sinceBase` with base `sinceBase`, if given, and focuses `oid`, pinned, if given.
  - It also gains `own: Set<oid>|null` and `source: string|null`, which feed `squashPreviousProblem`.
  - `buildEditItems({ commits, index, selected, unpushed, own, source, searching, onEdit })` in a new `apps/desktop/src/views/git/commit-edit-items.js` returns the three menu items. `onEdit(edit)` receives Task 6's `edit` shape *without* `message`; the caller opens the dialog.

- [ ] **Step 1: Write the failing tests.**
  - The dialog:
    - Save is disabled at first;
    - after a change it calls `onSave` with the text;
    - a blank subject disables Save.
  - `HistoryPane`:
    - a disabled item renders `disabled` with its reason as the title;
    - Ctrl-click adds to the selection and Shift-click selects a range.
  - `view-git-history`, through the existing history test harness:
    - right-click an unpushed commit → `Reword…` enabled;
    - choose it → the dialog is prefilled from `commitDetails`;
    - save → `onAction('rebaseInteractive', editPlan(...))`.
    - With 2 adjacent selected → `Squash selected…` enabled, and the dialog is prefilled with `squashMessage` of both.
    - **Review Focus 3:** with a search active, all three items are disabled with `Clear the search first`. The `sinceBase` filter keeps edits enabled, because that list is still contiguous from HEAD.
    - A pushed commit shows `Reword…` disabled with `Already pushed`.
    - `request` with `sinceBase` and `oid` sets the filter and focuses the commit.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Save goes through `onAction('rebaseInteractive', plan)`, so the usual action preview appears. That's the same path `RebaseDialog` uses, and it settles the spec's open question about whether Save previews. Keep the existing items as they are.
- [ ] **Step 4:** Run `npx vitest run src/views/git` in `apps/desktop`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): reword and squash unpushed commits from History`.

### Task 8: Commits strip and source picker

**Files:**
- Create: `apps/desktop/src/views/git/branch-commits.jsx` (the strip, plus the `useBranchCommits` hook)
- Create: `apps/desktop/src/views/git/source-picker.jsx`
- Modify: `apps/desktop/src/views/git/branch-header.jsx` (`from <source> ▾` on the tracking line)
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (render the strip above the tabs; turn a click into a `request` for `HistoryPanel` and switch `onPanel('history')`)
- Modify: `apps/desktop/src/views/git/git-workspace.css` (strip styles in the existing `nx-gw-` idiom)
- Test: `apps/desktop/src/views/git/branch-commits.test.jsx`, `apps/desktop/src/views/git/source-picker.test.jsx`, `apps/desktop/src/views/git/branch-header.test.jsx`

**Interfaces:**
- Consumes: `tree.source` and `sourceName` (Task 4), `setSource` (Task 5), `buildEditItems` and `CommitMessageDialog` (Task 7), `historyQuery` and `parseLog` (core).
- Produces:
  - `useBranchCommits({ adapter, repo, cwd, registered, sourceRef, head }) → { commits, unpushed, truncated, error }`. It calls `adapter.log` with `historyQuery({ ref: 'HEAD', filter: 'sinceBase', base: sourceRef, limit: 10 })` and re-reads when `head` changes. Its `commits` also serve as `own`.
  - `BranchCommits({ tree, adapter, repo, registered, onOpenCommit(oid), onShowAll(), onAction })`. It renders nothing when `!tree.source?.count`. The collapsed flag lives in `localStorage` key `nx-gw-branch-commits-collapsed`, with every read and write in try/catch, defaulting to open. Rows have the same right-click items, built with `buildEditItems`.
  - `SourcePicker({ adapter, repo, cwd, registered, branch, current, onClose, onPicked })`. It's a `PlModal` listing `adapter.refs` heads and remotes, minus the branch itself, with filter-as-you-type by word starts (`filterByWords`). Picking runs `adapter.preview` then `adapter.run` with `setSource` directly, with no action dialog, and shows the error inline if it fails.
  - `BranchHeader` gains `onSource()`. It shows `from <name> ▾` only when `tree.source`.

- [ ] **Step 1: Write the failing tests.**
  - The strip:
    - with `source.count: 3` it shows the title `3 commits off master` and 3 rows;
    - with 0 it renders nothing;
    - with 12 commits (`truncated`) it shows 10 rows and `Show all in History` calls `onShowAll`;
    - clicking a row calls `onOpenCommit(oid)`;
    - collapsing persists across a remount and survives `localStorage` throwing.
  - The picker:
    - lists refs without the current branch;
    - typing filters the list;
    - picking calls preview then run with `('setSource', { branch, ref })`;
    - an ineligible preview shows its reason.
  - The header shows `from master ▾` only with a source, and clicking it calls `onSource`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it into `worktree-panel.jsx`. Call `useBranchCommits` there once, and pass its oids as `own` and `sourceName(tree.source.ref)` as `source` to both the strip and `HistoryPanel`. `onShowAll` sends `request { sinceBase: tree.source.ref, nonce }`, and `onOpenCommit` sends `request { oid, nonce }`. Both switch to History.
- [ ] **Step 4:** Run `npx vitest run src/views/git`. Expected: PASS.
- [ ] **Step 5: Verify at runtime** with `apps/desktop:verify`. Check each of these:
  - an unpublished branch shows the row text and the strip;
  - clicking a commit opens it in History;
  - Reword… on it rewrites the subject;
  - `from master ▾` changes the source and the count updates on the next poll;
  - `master` shows none of it.
- [ ] **Step 6: Commit** `feat(desktop): branch commits strip and source branch picker`.

### Task 9: Full suite

- [ ] **Step 1:** Run `npx vitest run` in `packages/core` and in `apps/desktop`. Expected: everything passes. Report any failure with its output, don't paper over it.
