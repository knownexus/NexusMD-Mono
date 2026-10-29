# Git Workspace GitHub Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `GitHub · N repos` tab in Git Workspace showing the repos ticked in Work's GitHub Connection, with Pull requests, Issues, Branches (create/delete), History and Files for each, opening Work's drawers for PRs and issues.

**Architecture:** Headless GitHub calls for branches, commits and contents in core (`github/repo-browse.js`). Work provides three capabilities (`work.github`, `work.openPR`, `work.openItem`) so the separate Git app can reach Work's GitHub connection and drawers. The Git app adds the tab and its panes in `modules/git/src/renderer/github/`, fetching live through Work's adapter.

**Tech Stack:** JS/JSX (ESM), React, vitest + Testing Library, GitHub REST v3 via `makeGithubClient`.

**Spec:** `docs/superpowers/specs/2026-10-29-git-workspace-github-tab-design.md`

## Global Constraints

- Tab label: `GitHub` with count `N repos` (same `GroupTabs` look as group tabs). Shown only when `host.capabilities.has('work.github')` and `host.capabilities.call('work.github')` is non-null.
- Right-pane tab labels exactly: `Pull requests`, `Issues`, `Branches`, `History`, `Files`. Repo links: `Open on GitHub`, `Open local copy`.
- `work.github()` → `{ repos: string[], http, cached: { prs, issues } } | null` (null when no PAT or no ticked repos). `cached.prs` = snapshot PRs with `source === 'github'`; `cached.issues` = snapshot work items with `source === 'github'`.
- `work.openPR(pr)` / `work.openItem(item)` open Work's drawers with those objects.
- Delete branch confirm text: `Delete branch <name> on GitHub?`. Never offered for the default branch or a protected branch.
- New branch: `POST repos/{r}/git/refs { ref: 'refs/heads/<name>', sha: <head sha of the chosen branch> }`.
- History: `GET repos/{r}/commits?sha=<branch>&per_page=50`. Commit detail: `GET repos/{r}/commits/{sha}`.
- Files: `GET repos/{r}/contents/{path}?ref=<branch>`; dirs first, then files, each alphabetical; files over 1 MB (`size > 1048576`) or binary show `Open on GitHub` instead of content.
- Branch picker for History and Files defaults to the repo's default branch.
- Errors: the GitHub error's own message (existing `GithubError` classes), shown in the right pane; other repos unaffected.

## Review Focus

1. **Remote URL forms** — `https://github.com/Acme/Web.git`, `git@github.com:acme/web.git`, `ssh://git@github.com/acme/web`, and a non-GitHub remote must match/not match `acme/web` correctly, case-insensitively. (Task 1 test.)
2. **Branch names with slashes** (`feature/x`) in create, delete, commits `sha=` and contents `ref=` must be encoded per segment / as a query value, not break the path. (Task 1 test.)
3. **Work not installed or GitHub not connected** — Git Workspace renders as today with no GitHub tab and no error. (Task 3 test.)
4. **A repo the token can no longer see** (404) — that repo's pane shows the not-found message; switching to another repo works. (Task 4 test.)
5. **Deleting the branch currently picked in History/Files** — the picker falls back to the default branch instead of erroring. (Task 5 test.)

---

### Task 1: Core GitHub repo browsing

**Files:**
- Create: `packages/core/src/modules/github/repo-browse.js`
- Modify: `packages/core/src/modules/github/index.js`, `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/github/repo-browse.test.js`

**Interfaces:**
- Consumes: `makeGithubClient` client (`get`, `getPaged`, `post`, `del`).
- Produces:
  `githubRepoFromRemote(url: string): string | null` — lowercased `owner/name` for github.com https/ssh/scp URLs, else null.
  `githubRepoInfo(client, repo): Promise<{ defaultBranch, htmlUrl }>`.
  `listGithubBranches(client, repo): Promise<Array<{ name, sha, protected: boolean, isDefault: boolean }>>` (default first, then alphabetical).
  `createGithubBranch(client, repo, { name, from }): Promise<{ name, sha }>` (reads `git/ref/heads/<from>` for the sha).
  `deleteGithubBranch(client, repo, name): Promise<void>`.
  `listGithubCommits(client, repo, branch): Promise<Array<{ sha, message, author, date }>>` (message first line).
  `getGithubCommit(client, repo, sha): Promise<{ sha, message, author, date, files: Array<{ path, changeType, additions, deletions, patch }> }>` (full message; changeType as in `pr-collab.js`).
  `listGithubContents(client, repo, { path = '', ref }): Promise<Array<{ name, path, type: 'dir'|'file', size }>>`.
  `getGithubFile(client, repo, { path, ref }): Promise<{ text: string|null, reason: null|'binary'|'too-large', url }>` (base64 decode; binary = contains a NUL byte).
  Paths: each path segment `encodeURIComponent`d; `sha=`/`ref=` query values `encodeURIComponent`d whole.

- [ ] **Step 1: Write the failing tests** (fake client with `vi.fn`s)
  - `githubRepoFromRemote`: the three URL forms in Review Focus 1 → `'acme/web'`; `https://gitlab.com/acme/web.git` → null; garbage → null.
  - `listGithubBranches` with `get('repos/acme/web')` → `{ default_branch: 'main' }` and branches `[{name:'zeta',...},{name:'main',protected:true},{name:'alpha'}]` → order `main, alpha, zeta`, `isDefault` only on main, `protected` from the API.
  - `createGithubBranch(c, 'acme/web', { name: 'feature/x', from: 'release/1' })` → `get('repos/acme/web/git/ref/heads/release/1')` then `post('repos/acme/web/git/refs', { ref: 'refs/heads/feature/x', sha: <its object.sha> })`.
  - `deleteGithubBranch(c, 'acme/web', 'feature/x y')` → `del('repos/acme/web/git/refs/heads/feature/x%20y')`.
  - `listGithubCommits(c, 'acme/web', 'feature/x')` → `getPaged`/`get` path `repos/acme/web/commits?sha=feature%2Fx&per_page=50`; maps first line of message, author login (else commit author name), date.
  - `getGithubCommit` maps files with `changeType` (`added`→`add`, `removed`→`delete`, `renamed`→`rename`, else `edit`).
  - `listGithubContents(c, 'acme/web', { path: 'src/lib', ref: 'main' })` → path `repos/acme/web/contents/src/lib?ref=main`; dirs before files, each alphabetical.
  - `getGithubFile`: base64 `aGk=` → `{ text: 'hi', reason: null }`; size 2_000_000 → `{ text: null, reason: 'too-large' }`; content decoding to a NUL byte → `reason: 'binary'`; `url` = `html_url`.
- [ ] **Step 2:** `npx vitest run packages/core/tests/github/repo-browse.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Same command → PASS; add exports to public-api list; `npx vitest run packages/core` → PASS.
- [ ] **Step 5:** Commit `feat(github): browse branches, commits and files of a repository`.

---

### Task 2: Work provides GitHub and its drawers to other apps

**Files:**
- Modify: `modules/work/src/renderer/work-provider.jsx`
- Test: extend `modules/work/src/renderer/work-provider.test.jsx`

**Interfaces:**
- Consumes: `host.capabilities.provide(name, fn) → unregister`, `githubHttp` (module-level in work-provider), `getGithubConfig`, `isGithubConfigured` from `./github-client.js`, `snapshot`, `openPR`, `openItem`.
- Produces: capabilities `work.github`, `work.openPR`, `work.openItem` per Global Constraints, registered in a `useEffect` and unregistered on unmount; `work.github` reads config and snapshot at call time (a ref to the latest snapshot), not at registration.

- [ ] **Step 1: Write the failing tests** (host gets a real `createCapabilities()` from `@nexusmd/shell-sdk`)
  - with GitHub configured (`saveGithubConfig({ pat, repos: ['acme/web'] })`) and a snapshot holding one GitHub PR, one ADO PR, one GitHub work item and one ADO work item: `call('work.github')` → `repos ['acme/web']`, `http.fetch` a function, `cached.prs` only the GitHub PR, `cached.issues` only the GitHub item.
  - not configured → `call('work.github')` returns null.
  - `call('work.openPR', { id: 'gh:a/b#1' })` opens the drawer mock with kind `pr`; `work.openItem` with kind `wi`.
  - after unmount, `has('work.github')` is false.
- [ ] **Step 2:** `npx vitest run modules/work/src/renderer/work-provider.test.jsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `npx vitest run modules/work` → PASS.
- [ ] **Step 5:** Commit `feat(work): offer GitHub and the item and PR drawers to other apps`.

---

### Task 3: The GitHub tab, repo list and local links

**Files:**
- Create: `modules/git/src/renderer/github/github-tab.jsx`, `modules/git/src/renderer/github/use-github.js`
- Modify: `modules/git/src/renderer/view-git.jsx` (tab strip entry; render the GitHub tab instead of the local panes when it is active)
- Test: `modules/git/src/renderer/github/github-tab.test.jsx`, extend the view-git test that covers the tab strip

**Interfaces:**
- Consumes: `host.capabilities` (`has`, `call('work.github')`, `call('work.openPR' | 'work.openItem')`), `makeGithubClient`, `githubRepoFromRemote`, the git adapter's `remotes(repo, worktreePath, registered)` (returns `git remote -v` text) for each registered repo's main worktree, and `core.on/off('data:updated')`.
- Produces:
  `useGithub(host) → { repos, client, cached, refreshKey } | null` (re-reads on `data:updated`; `refreshKey` increments each time).
  `GithubTab({ host, adapter, config, snapshot, onOpenLocal(repoName) })` — left list of `repos` with counts `N PRs · M issues` from `cached` (issues counted by `projectKey === repo`, PRs by `repo === repo`, case-insensitive), `Open local copy` link when a registered repo's remotes match, `Open on GitHub` for the selected repo; right pane placeholder for Task 4's tabs. Selected repo kept in the git view config like other view state.
  `onOpenLocal(repoName)` switches the view to All projects and selects that local repo.

- [ ] **Step 1: Write the failing tests**
  - view-git: with no `work.github` capability, the tab strip has no `GitHub` tab and nothing errors (Review Focus 3); with `work.github` returning null, same; with it returning two repos, a `GitHub` tab reading `2 repos`; clicking it shows `acme/web` and `acme/api` in the list.
  - github-tab: counts from `cached` (`2 PRs · 1 issue` for acme/web); a registered repo whose remotes text contains `origin  git@github.com:Acme/Web.git (fetch)` makes `Open local copy` appear on acme/web only; clicking it calls `onOpenLocal` with that local repo's name; `Open on GitHub` href `https://github.com/acme/web`.
  - a `data:updated` event re-reads `work.github` (counts change).
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement, following Git Workspace's existing list/panel styling (`nx-gw-*` classes) and `GroupTabs`.
- [ ] **Step 4:** Same → PASS; `npx vitest run modules/git` → PASS.
- [ ] **Step 5:** Commit `feat(git): a GitHub tab listing the ticked repositories`.

---

### Task 4: Pull requests and Issues panes

**Files:**
- Create: `modules/git/src/renderer/github/github-repo-pane.jsx`
- Modify: `modules/git/src/renderer/github/github-tab.jsx`
- Test: `modules/git/src/renderer/github/github-repo-pane.test.jsx`

**Interfaces:**
- Consumes: `useGithub`'s `client` and `refreshKey`; `mapGithubPR`, `mapGithubIssue` from `@nexusmd/core`; capabilities `work.openPR` / `work.openItem`.
- Produces: `GithubRepoPane({ repo, client, refreshKey, openPR, openItem, initialTab = 'prs' })` with the five tab buttons (Global Constraints); this task fills `Pull requests` (`getPaged('repos/{r}/pulls?state=open')`, each row `#N title · author · age`, click → `openPR(mapGithubPR(pr, repo))`) and `Issues` (`getPaged('repos/{r}/issues?state=open')` minus entries with `pull_request`, click → `openItem(mapGithubIssue(issue, repo))`); Branches/History/Files show their Task 5/6 components (placeholder text until then).

- [ ] **Step 1: Write the failing tests** (fake client)
  - PRs tab lists two PRs; clicking one calls `openPR` with an object whose `id` is `gh:acme/web#7` and `source` `github`.
  - Issues tab omits a `pull_request` entry; clicking an issue calls `openItem` with `id` `gh:acme/web#4`.
  - a 404 `GithubError` on the PR list shows its message in the pane; re-rendering with another repo loads that repo (Review Focus 4).
  - a new `refreshKey` refetches.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx vitest run modules/git` → PASS.
- [ ] **Step 5:** Commit `feat(git): GitHub pull requests and issues open Work's drawers`.

---

### Task 5: Branches pane (list, create, delete)

**Files:**
- Create: `modules/git/src/renderer/github/github-branches.jsx`
- Modify: `modules/git/src/renderer/github/github-repo-pane.jsx`
- Test: `modules/git/src/renderer/github/github-branches.test.jsx`

**Interfaces:**
- Consumes: `listGithubBranches`, `createGithubBranch`, `deleteGithubBranch`.
- Produces: `GithubBranches({ repo, client, refreshKey, confirm = window.confirm, onBranchesChanged(branches) })` — list with `default` / `protected` badges; `New branch` form (from-branch select defaulting to the default branch, name input, `Create`); `Delete` on non-default, non-protected rows only, confirm text per Global Constraints; list reloads after create/delete; `onBranchesChanged` reports the current list (used by Task 6's picker).
  `GithubRepoPane` keeps the picked branch for History/Files; when `onBranchesChanged` no longer contains it, it falls back to the default branch (Review Focus 5).

- [ ] **Step 1: Write the failing tests**
  - lists branches with badges; no `Delete` on `main` (default) or a protected one.
  - New branch `feature/x` from `release/1` calls `createGithubBranch(client, 'acme/web', { name: 'feature/x', from: 'release/1' })`, then reloads.
  - Delete with confirm false → no call; true → `deleteGithubBranch(client, 'acme/web', 'old')` with confirm text `Delete branch old on GitHub?`.
  - repo-pane: picked branch `old` deleted → picker shows `main`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx vitest run modules/git` → PASS.
- [ ] **Step 5:** Commit `feat(git): list, create and delete GitHub branches`.

---

### Task 6: History and Files panes

**Files:**
- Create: `modules/git/src/renderer/github/github-history.jsx`, `modules/git/src/renderer/github/github-files.jsx`
- Modify: `modules/git/src/renderer/github/github-repo-pane.jsx`; `packages/ui/src/views/pr-tabs-github.jsx` (export its `Patch` component as `GithubPatch`), `packages/ui/src/index.js`
- Test: `modules/git/src/renderer/github/github-history.test.jsx`, `modules/git/src/renderer/github/github-files.test.jsx`

**Interfaces:**
- Consumes: `listGithubCommits`, `getGithubCommit`, `listGithubContents`, `getGithubFile`; `GithubPatch({ patch, url })` from `@nexusmd/ui`.
- Produces: `GithubHistory({ repo, client, branch, refreshKey })` — commits list (`message · author · age`, 7-char sha); clicking one shows its full message and files, each expandable to `GithubPatch`. `GithubFiles({ repo, client, branch })` — breadcrumb path, dirs then files; clicking a dir navigates in; clicking a file shows its text in a read-only `<pre>`, or `Open on GitHub` for binary/too-large.

- [ ] **Step 1: Write the failing tests**
  - History lists commits for `branch`; changing `branch` refetches; clicking a commit shows its files; expanding a file shows a `+new line` row from its patch.
  - Files: root listing dirs first; clicking `src` lists `src` and the breadcrumb shows `src`; clicking `a.js` shows its decoded text; a too-large file shows `Open on GitHub` linking to its `url`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx vitest run modules/git packages/ui` → PASS.
- [ ] **Step 5:** Commit `feat(git): GitHub commit history and file browsing`.

---

### Task 7: Verify

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` — all pass except the two known `modules/editor/src/main/editor-files.test.js` failures that also fail on master.
- [ ] **Step 2:** `npx vite build` in `apps/desktop`, then `npx playwright test e2e/git-layout.spec.js e2e/work.spec.js e2e/smoke.spec.js` → pass.
- [ ] **Step 3:** Report what was not verified against live GitHub (no credentials here).
