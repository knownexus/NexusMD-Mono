# PR Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approve, Wait for author, Reject and Merge buttons in the PR drawer, working the same way for ADO and GitHub pull requests.

**Architecture:** Headless provider calls in core (`ado/pr-actions.js`, `github/pr-actions.js`) behind one dispatcher (`workitems/pr-actions.js` → `makePRActions`) that picks the provider by `pr.source`. A shared `PRActions` component in `packages/ui` renders the buttons, the merge dialog and the reject confirmation and reports a patch. The Work module's detail drawer wires it to the ADO http adapter, `ME.adoId` and the GitHub adapter, patches the open drawer and refreshes.

**Tech Stack:** JS/JSX (ESM), React, vitest + Testing Library. ADO REST `api-version=7.0`; GitHub REST v3 through `makeGithubClient`.

**Spec:** `docs/superpowers/specs/2026-10-28-pr-actions-design.md`

## Global Constraints

- Button labels exactly: `Approve`, `Wait for author`, `Reject`, `Merge`. Same for ADO and GitHub.
- Shown only when `pr.status` is `active` or `draft`. `Merge` hidden when `pr.status === 'draft'`.
- ADO votes: Approve = `10`, Wait for author = `-5`. PUT `{project}/_apis/git/repositories/{repoId}/pullRequests/{id}/reviewers/{ME.adoId}?api-version=7.0` with `{ vote }`.
- ADO Reject = PATCH the PR `{ status: 'abandoned' }`. ADO Merge = GET the PR, then PATCH `{ status: 'completed', lastMergeSourceCommit: { commitId }, completionOptions: { mergeStrategy, deleteSourceBranch } }`.
- ADO merge strategies offered, in order: `noFastForward` "Merge", `squash` "Squash", `rebase` "Rebase and fast-forward", `rebaseMerge` "Semi-linear".
- GitHub Approve = POST `repos/{r}/pulls/{n}/reviews { event: 'APPROVE' }`. Wait for author = `{ event: 'REQUEST_CHANGES', body: 'Waiting for author — sent from NexusMD' }`.
- GitHub Reject = PATCH `repos/{r}/pulls/{n} { state: 'closed' }`. Merge = PUT `repos/{r}/pulls/{n}/merge { merge_method }`; methods offered are the repo's allowed ones (`allow_merge_commit` → `merge` "Merge", `allow_squash_merge` → `squash` "Squash", `allow_rebase_merge` → `rebase` "Rebase"), in that order, default the first.
- "Delete source branch" tick box defaults to on. GitHub deletes `repos/{headRepo}/git/refs/heads/{branch}` only when `headRepo === repo`; a failed delete after a merge is a warning (`Merged, but the branch could not be deleted: <message>`), not a failure.
- Reject confirm text: GitHub `Reject and close this pull request?`; ADO `Reject and abandon this pull request?`. Merge goes through its dialog; Approve and Wait for author act at once.
- Errors: toast `'<Action> failed: ' + message`, where message is the provider's own reason; PR left unchanged.
- After success: the drawer's PR is patched at once and a data refresh is started.

## Review Focus

1. **Approving your own GitHub PR** — GitHub answers 422; the toast must say `You can't review your own pull request`, not "GitHub request failed (422)". (Task 2 test.)
2. **ADO with no `ME.adoId`** (connectionData failed at load) — Approve/Wait for author must fail with `Your Azure DevOps identity is not known yet — refresh and try again`, not PUT to `reviewers/undefined`. (Task 1 test.)
3. **GitHub PR from a fork** — Merge with delete ticked must not try to delete a branch in the base repo. (Task 2 test.)
4. **Double click / clicking again while a request is running** — buttons disable while any action runs; one request per click. (Task 4 test.)
5. **A repo that allows no GitHub merge method the token can use** (all `allow_*` false) — the dialog says `This repository allows no merge methods` and Merge is disabled. (Task 4 test.)

---

### Task 1: ADO PR actions

**Files:**
- Create: `packages/core/src/modules/ado/pr-actions.js`
- Modify: `packages/core/src/modules/ado/index.js` (export), `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/ado/pr-actions.test.js`

**Interfaces:**
- Produces:
  `ADO_MERGE_STRATEGIES: Array<{ id, label }>` (values from Global Constraints).
  `voteAdoPR(http, { project, repoId, prId, reviewerId }, vote: number): Promise<void>` — throws `Error('Your Azure DevOps identity is not known yet — refresh and try again')` when `reviewerId` is empty.
  `abandonAdoPR(http, { project, repoId, prId }): Promise<void>`.
  `completeAdoPR(http, { project, repoId, prId }, { mergeStrategy, deleteSourceBranch }): Promise<void>`.
  Failures throw `Error(<ADO response .message, or 'HTTP <status>'>)`.

- [ ] **Step 1: Write the failing tests** (fake `http.fetch` recording calls, returning `{ ok, status, json(), text() }`)
  - `voteAdoPR(http, { project: 'My Proj', repoId: 'r1', prId: 5, reviewerId: 'u-1' }, 10)` → one call: `PUT`, path `My%20Proj/_apis/git/repositories/r1/pullRequests/5/reviewers/u-1?api-version=7.0`, body `{ vote: 10 }`, header `Content-Type: application/json`.
  - `voteAdoPR(..., { ..., reviewerId: '' }, -5)` rejects with the identity message and makes no call.
  - `abandonAdoPR` → `PATCH .../pullRequests/5?api-version=7.0` body `{ status: 'abandoned' }`.
  - `completeAdoPR(..., { mergeStrategy: 'squash', deleteSourceBranch: true })` → first `GET .../pullRequests/5?api-version=7.0` (returns `{ lastMergeSourceCommit: { commitId: 'abc' } }`), then `PATCH` body `{ status: 'completed', lastMergeSourceCommit: { commitId: 'abc' }, completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true } }`.
  - A 409 response with body `{ "message": "TF401181: The pull request cannot be completed due to policy" }` rejects with exactly that message; a 500 with a non-JSON body rejects with `HTTP 500`.
  - `ADO_MERGE_STRATEGIES.map(s => s.id)` equals `['noFastForward', 'squash', 'rebase', 'rebaseMerge']`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/ado/pr-actions.test.js`; expect FAIL (module missing).
- [ ] **Step 3:** Implement per Interfaces; build paths like `ado/pr-collab.js#repoBase`.
- [ ] **Step 4:** Run the same command; expect PASS. Add the four exports to the public-api test list; `npx vitest run packages/core/tests/public-api.test.js` PASS.
- [ ] **Step 5:** Commit `feat(ado): vote, abandon and complete pull requests`.

---

### Task 2: GitHub PR actions

**Files:**
- Create: `packages/core/src/modules/github/pr-actions.js`
- Modify: `packages/core/src/modules/github/mappers.js` (`mapGithubPR` adds `headRepo`), `packages/core/src/modules/github/index.js`, `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/github/pr-actions.test.js`, extend `packages/core/tests/github/mappers.test.js`

**Interfaces:**
- Consumes: `makeGithubClient` client (`get`, `post`, `patch`, plus a `put` and `del` this task adds to `client.js` if missing — same error handling as `patch`), `GithubError` (`status`, `kind`).
- Produces:
  `mapGithubPR(...).headRepo: string` = `pr.head?.repo?.full_name || repo`.
  `reviewGithubPR(client, { repo, number }, event: 'APPROVE'|'REQUEST_CHANGES'): Promise<void>` — REQUEST_CHANGES sends the fixed body; a 422 rethrows `Error("You can't review your own pull request")`.
  `closeGithubPR(client, { repo, number }): Promise<void>`.
  `githubMergeMethods(client, repo): Promise<Array<{ id, label }>>` (allowed only, fixed order).
  `mergeGithubPR(client, { repo, number, branch, headRepo }, { method, deleteBranch }): Promise<{ warnings: string[] }>`.

- [ ] **Step 1: Write the failing tests** (fake client with `vi.fn` methods)
  - mapper: a PR with `head: { ref: 'f', repo: { full_name: 'fork/web' } }` in `acme/web` → `headRepo: 'fork/web'`; no `head.repo` → `'acme/web'`.
  - `reviewGithubPR(c, { repo: 'acme/web', number: 7 }, 'APPROVE')` → `post('repos/acme/web/pulls/7/reviews', { event: 'APPROVE' })`; `'REQUEST_CHANGES'` → body `{ event: 'REQUEST_CHANGES', body: 'Waiting for author — sent from NexusMD' }`.
  - post rejecting with `new GithubError('x', { status: 422 })` → rejects with `You can't review your own pull request`.
  - `closeGithubPR` → `patch('repos/acme/web/pulls/7', { state: 'closed' })`.
  - `githubMergeMethods` with repo `{ allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true }` → `[{ id: 'squash', label: 'Squash' }, { id: 'rebase', label: 'Rebase' }]`; all false → `[]`.
  - `mergeGithubPR(c, { repo: 'acme/web', number: 7, branch: 'f', headRepo: 'acme/web' }, { method: 'squash', deleteBranch: true })` → `put('repos/acme/web/pulls/7/merge', { merge_method: 'squash' })` then `del('repos/acme/web/git/refs/heads/f')`; returns `{ warnings: [] }`.
  - same with `headRepo: 'fork/web'` → no `del` call (Review Focus 3).
  - `del` rejecting `new Error('Reference does not exist')` → resolves `{ warnings: ['Merged, but the branch could not be deleted: Reference does not exist'] }`.
  - a `put` rejection rejects with its message, and no `del` is made.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/pr-actions.test.js packages/core/tests/github/mappers.test.js`; expect FAIL.
- [ ] **Step 3:** Implement; branch names with `/` are kept as path segments (`refs/heads/feature/x`), each segment `encodeURIComponent`d.
- [ ] **Step 4:** Run the same command plus `npx vitest run packages/core/tests/github`; expect PASS. Add exports to the public-api list.
- [ ] **Step 5:** Commit `feat(github): review, close and merge pull requests`.

---

### Task 3: One dispatcher for both providers

**Files:**
- Create: `packages/core/src/modules/workitems/pr-actions.js`
- Modify: `packages/core/src/modules/workitems/index.js`, `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/workitems/pr-actions.test.js`

**Interfaces:**
- Consumes: Task 1 and Task 2 functions.
- Produces: `makePRActions({ adoHttp, adoMeId, githubClient }): { approve(pr), waitForAuthor(pr), reject(pr), merge(pr, { method, deleteBranch }), mergeOptions(pr) }`.
  Each of approve/waitForAuthor/reject/merge returns `Promise<{ patch: object, warnings: string[] }>`:
  approve → `patch: { myVote: 10 }`; waitForAuthor → `{ myVote: -5 }`; reject → `{ status: 'abandoned' }`; merge → `{ status: 'merged' }`.
  `mergeOptions(pr)` → `Promise<{ methods: Array<{ id, label }>, rejectConfirm: string }>` (ADO: `ADO_MERGE_STRATEGIES` and the abandon text; GitHub: `githubMergeMethods` and the close text).
  For ADO PRs it passes `{ project: pr.project, repoId: pr.repoId, prId: pr.id }`; for GitHub `{ repo: pr.repo, number: pr.number, branch: pr.branch, headRepo: pr.headRepo }`. A GitHub PR with no `githubClient` rejects with `GitHub is not configured`.

- [ ] **Step 1: Write the failing tests** (fake adoHttp and githubClient)
  - ADO PR `{ source: 'ado', id: 5, project: 'P', repoId: 'r1' }`: `approve` PUTs vote 10 to `reviewers/me-1` (with `adoMeId: 'me-1'`) and resolves `{ patch: { myVote: 10 }, warnings: [] }`; `reject` PATCHes abandoned and resolves `{ patch: { status: 'abandoned' }, warnings: [] }`.
  - PR with no `source` is treated as ADO.
  - GitHub PR `{ source: 'github', repo: 'acme/web', number: 7, branch: 'f', headRepo: 'acme/web' }`: `waitForAuthor` posts REQUEST_CHANGES and patches `{ myVote: -5 }`; `merge(pr, { method: 'merge', deleteBranch: false })` puts the merge, no delete, patch `{ status: 'merged' }`.
  - `mergeOptions` for GitHub returns the repo's methods and `rejectConfirm: 'Reject and close this pull request?'`; for ADO the four strategies and `'Reject and abandon this pull request?'`.
  - GitHub PR with `githubClient: null` → `approve` rejects `GitHub is not configured`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/workitems/pr-actions.test.js`; expect FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the same command and `npx vitest run packages/core`; expect PASS.
- [ ] **Step 5:** Commit `feat(prs): one set of PR actions for ADO and GitHub`.

---

### Task 4: PRActions component (buttons, merge dialog, reject confirm)

**Files:**
- Create: `packages/ui/src/views/pr-actions.jsx`
- Modify: `packages/ui/src/index.js` (export `PRActions`)
- Test: `packages/ui/src/views/pr-actions.test.jsx`

**Interfaces:**
- Consumes: the object `makePRActions` returns (Task 3), passed as a prop so tests fake it.
- Produces: `PRActions({ pr, actions, onChanged, confirm = window.confirm })` — renders nothing unless `pr.status` is `active` or `draft`. Buttons per Global Constraints. Merge opens an in-drawer dialog (`role="dialog"`, `aria-label="Merge pull request"`) with a `Merge type` select from `mergeOptions(pr).methods`, a `Delete source branch` checkbox (checked), and `Merge` / `Cancel`. `onChanged(patch)` after each success; toast success text `Approved`, `Marked as waiting for author`, `Pull request rejected`, `Merged` (plus any warnings as a second warning toast); failure toast per Global Constraints.

- [ ] **Step 1: Write the failing tests** (mock `../toast.jsx` as in `packages/ui/tests/workitems-providers.test.jsx`; `actions` is `vi.fn`s)
  - active PR shows the four buttons; `status: 'draft'` shows three (no `Merge`); `status: 'merged'` and `'abandoned'` show none.
  - clicking `Approve` calls `actions.approve(pr)` once and `onChanged({ myVote: 10 })`; while its promise is pending all four buttons are disabled and a second click makes no call (Review Focus 4).
  - `Reject` with `confirm` returning false makes no call; true calls `actions.reject(pr)` and `onChanged({ status: 'abandoned' })`; the confirm text is `mergeOptions(pr).rejectConfirm`.
  - `Merge` opens the dialog listing the methods' labels, `Delete source branch` checked; choosing `Squash`, unticking delete, clicking the dialog's `Merge` calls `actions.merge(pr, { method: 'squash', deleteBranch: false })` and closes the dialog.
  - `mergeOptions` resolving `{ methods: [] }` shows `This repository allows no merge methods` and the dialog's `Merge` is disabled (Review Focus 5).
  - `actions.approve` rejecting `new Error("You can't review your own pull request")` toasts `Approve failed: You can't review your own pull request` and does not call `onChanged`.
  - a merge resolving `{ patch, warnings: ['Merged, but the branch could not be deleted: x'] }` toasts `Merged` and the warning.
- [ ] **Step 2:** Run `npx vitest run packages/ui/src/views/pr-actions.test.jsx`; expect FAIL.
- [ ] **Step 3:** Implement with the drawer's existing button classes (`btn sm`, `btn sm primary` for Merge, `btn sm ghost danger` for Reject).
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat(ui): PR action buttons, merge dialog and reject confirmation`.

---

### Task 5: Wire into the detail drawer

**Files:**
- Modify: `modules/work/src/renderer/detail-drawer.jsx`, `modules/work/src/renderer/work-provider.jsx`
- Test: `modules/work/src/renderer/detail-drawer-pr.test.jsx` (new), extend `modules/work/src/renderer/work-provider.test.jsx`

**Interfaces:**
- Consumes: `makePRActions` (Task 3), `PRActions` (Task 4), `makeGithubClient`, `githubHttp` and `data.ME` from `useNexusData()`.
- Produces: `DetailDrawer` gains prop `onPRChanged(patch)`; for `kind === 'pr'` it renders `<PRActions>` in `actions` before "Open in", with `actions = useMemo(() => makePRActions({ adoHttp: http, adoMeId: data.ME?.adoId || '', githubClient: githubHttp ? makeGithubClient(githubHttp) : null }), [http, data.ME?.adoId, githubHttp])`. `WorkProvider` passes `onPRChanged={patch => { setDrawer(dr => dr && dr.kind === 'pr' ? { ...dr, data: { ...dr.data, ...patch } } : dr); refreshAllData() }}`.

- [ ] **Step 1: Write the failing tests**
  - drawer test (mock `./ado-client.js` as `detail-drawer.test.js` does; render inside `NexusDataProvider` with `data: { ME: { adoId: 'me-1' } }`, `workItemSource: { webUrl: () => null }`, `githubHttp` fake): an open ADO PR drawer shows `Approve`; clicking it PUTs to `reviewers/me-1` through the mocked ADO adapter and calls `onPRChanged({ myVote: 10 })`. A `merged` PR shows no `Approve`.
  - work-provider test: extend the `DetailDrawer` mock to capture `onPRChanged`; after `openPR({ id: 1, status: 'active' })`, calling `onPRChanged({ status: 'merged' })` makes the drawer mock receive `data.status === 'merged'` and calls `refreshSpy` once.
- [ ] **Step 2:** Run `npx vitest run modules/work/src/renderer/detail-drawer-pr.test.jsx modules/work/src/renderer/work-provider.test.jsx`; expect FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `npx vitest run modules/work packages/ui`; expect PASS.
- [ ] **Step 5:** Commit `feat(work): approve, reject and merge from the PR drawer`.

---

### Task 6: Verify

- [ ] **Step 1:** `npx vitest run` — all pass except the two known `modules/editor/src/main/editor-files.test.js` failures that also fail on master.
- [ ] **Step 2:** `npx vite build` in `apps/desktop`, then `npx playwright test e2e/work.spec.js e2e/smoke.spec.js`; expect pass.
- [ ] **Step 3:** Report what was not verified against live ADO/GitHub (no credentials in this environment).
