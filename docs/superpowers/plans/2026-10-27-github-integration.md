# GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub becomes a peer of Jira and Azure DevOps: issues as work items, pull requests, Actions runs as builds, and repo discovery/selection, per profile with a PAT.

**Architecture:** Headless logic goes in a new `packages/core/src/modules/github/` (config, REST client, discovery, mappers, loader, issue operations, work-item source), mirroring `ado/` and `jira/`. Its cache merges into the snapshot beside ADO and Jira (`workitems/snapshot.js`, `workitems/merge.js`). The Work module binds it in `modules/work/src/renderer/` (client, settings card, refresh, routed source, create form). Shared UI gets small source-awareness changes only where it hard-codes `ado`/`jira`.

**Tech Stack:** JS/JSX (ESM), React, vitest, GitHub REST v3 (`X-GitHub-Api-Version: 2022-11-28`), no GraphQL.

**Spec:** `docs/superpowers/specs/2026-10-27-github-integration-design.md`

## Global Constraints

- Auth is a PAT stored per profile via `getProfileKey('github.' + name)` raw-string storage, the same way `ado-client.js` does. The PAT is never logged and never written into the cache object.
- github.com only (`https://api.github.com`). No GraphQL.
- Selected repos are `owner/name` strings. Maximum selected repos: `MAX_GITHUB_REPOS = 50`; saving more throws `Error('Select at most 50 repositories')`.
- A selected repo is the "project" for filtering, grouping and create target. Milestones are the sprint equivalent (`iterationPath` = milestone title).
- Item ids are `gh:owner/name#123`, `source: 'github'`, `displayId: 'owner/name#123'`.
- Boards show two states only: `Open` and `Closed`. No label-driven status columns.
- Default label to type convention: `bug`, `enhancement`/`feature`, `documentation`, `question`, otherwise `Issue`; native GitHub issue type wins when present.
- Write-back: close, reopen (with `state_reason` `completed` or `not_planned`), edit title, body, labels, assignees; add comments; create issues.
- A "Load GitHub issues" switch (`issues`, default on). Off: issues are not fetched or shown, GitHub drops out of the work-item providers and create form; PRs and runs still load.
- 401 fires the existing `nexusmd:github-401` event. 403 is classified into `scope`, `rate-limit`, `sso`, each with its own message. SSO-blocked orgs are listed in discovery as "needs SSO authorization".
- "Me" is the login from `GET /user`; the team is built from logins seen as authors, assignees and reviewers.
- Tests live beside the existing ones: core in `packages/core/tests/github/*.test.js`, renderer in `modules/work/src/renderer/*.test.js(x)`. Run with `npx vitest run <path>` from the repo root.

## Review Focus

1. **Issues endpoint returns PRs.** `GET /repos/{r}/issues` includes pull requests (they carry a `pull_request` key). They must not appear as work items.
2. **One bad repo must not fail the load.** A selected repo that is gone, archived, has issues disabled (410), or has Actions disabled/404 yields a `REPO_ERRORS` entry; every other repo still loads.
3. **Over the cap.** Saving 51 repos throws and nothing is saved; the card shows the message.
4. **Number collisions across repos.** Issue `#12` in two repos are two items with distinct ids, and the PR link index keys by the full string id.
5. **403 is three different problems.** Missing scope, secondary rate limit (`x-ratelimit-remaining: 0` or `retry-after`) and SAML SSO (`x-github-sso` header) each get a distinct message, not "auth failed".

---

### Task 1: IDs and connection config

**Files:**
- Modify: `packages/core/src/modules/workitems/ids.js`, `packages/core/src/modules/workitems/index.js`
- Create: `packages/core/src/modules/github/config.js`, `packages/core/src/modules/github/index.js`
- Modify: `packages/core/src/index.js` (add `export * from './modules/github/index.js'`)
- Test: `packages/core/tests/github/config.test.js`, extend the existing ids test if one exists (else add `packages/core/tests/github/ids.test.js`)

**Interfaces:**
- Produces (ids): `GITHUB_ID_PREFIX = 'gh:'`, `isGithubId(id): boolean`, `toGithubId(repo: string, number: number): string` → `gh:owner/name#123`, `parseGithubId(id): { repo: string, number: number } | null`. `sourceOfId(id)` now returns `'github'` for gh ids; `displayIdOf(item)` returns `owner/name#123` for gh ids.
- Produces (config): `makeGithubConfig({ storage, key })` → `{ getGithubConfig, saveGithubConfig, isGithubConfigured, usesGithubWorkItems }`. `getGithubConfig()` → `{ pat: string, repos: string[], issues: boolean, login: string, refreshSecs: number }` (`refreshSecs` default 60). `saveGithubConfig(partial)`. `isGithubConfigured()` = pat and at least one repo. `usesGithubWorkItems()` = configured and `issues`. Exports `MAX_GITHUB_REPOS = 50` and `repoListFromStub({ owner, repos }): string[]`.

- [ ] **Step 1: Write failing tests**
  - ids: `toGithubId('acme/web', 12) === 'gh:acme/web#12'`; `parseGithubId('gh:acme/web#12')` → `{ repo: 'acme/web', number: 12 }`; `parseGithubId('jira:A-1')` and `parseGithubId(5)` → `null`; `sourceOfId('gh:a/b#1') === 'github'`, `sourceOfId('jira:A-1') === 'jira'`, `sourceOfId(5) === 'ado'`; `displayIdOf({ id: 'gh:a/b#1' }) === 'a/b#1'`.
  - config (in-memory storage like `ado-config.test.js`): defaults are `{ pat: '', repos: [], issues: true, login: '', refreshSecs: 60 }`; save/get round-trip for each field; `issues: false` persists as off; `isGithubConfigured()` false without pat or without repos; `usesGithubWorkItems()` false when `issues` off; `saveGithubConfig({ repos: <51 names> })` throws `Select at most 50 repositories` and leaves stored repos unchanged; `repoListFromStub({ owner: 'acme', repos: ['web', 'api'] })` → `['acme/web', 'acme/api']`, `repoListFromStub({ owner: 'acme', repos: ['other/x', 'web'] })` → `['other/x', 'acme/web']`, `repoListFromStub(undefined)` → `[]`, duplicates removed.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github` and expect FAIL (modules missing).
- [ ] **Step 3:** Implement the ids helpers in `ids.js` (export through `workitems/index.js`) and `config.js` per the Interfaces block, following `makeAdoConfig` (raw strings, `repos` JSON, `issues` as `'1'`/`'0'`). `github/index.js` re-exports config only for now.
- [ ] **Step 4:** Run the same command and expect PASS; also `npx vitest run packages/core/tests/jira packages/core/tests/ado` to confirm nothing regressed.
- [ ] **Step 5:** Commit `feat(github): ids and per-profile connection config`.

---

### Task 2: REST client, error classification, repo discovery

**Files:**
- Create: `packages/core/src/modules/github/client.js`, `packages/core/src/modules/github/repos.js`
- Modify: `packages/core/src/modules/github/index.js`, `packages/core/src/modules/workitems/status.js`
- Test: `packages/core/tests/github/client.test.js`, `packages/core/tests/github/repos.test.js`

**Interfaces:**
- Consumes: an `http` adapter `{ fetch(path, options) → { ok, status, headers: { get(name) }, json(), text() } }` where `path` is relative to `https://api.github.com/`.
- Produces: `class GithubError extends Error { status: number, kind: 'auth'|'scope'|'rate-limit'|'sso'|'not-found'|'gone'|'other', ssoUrl?: string }`.
  `classifyGithubError(status, headers, bodyText): { kind, message, ssoUrl? }`.
  `makeGithubClient(http)` → `{ get(path), getPaged(path, { max = 1000 } = {}), post(path, body), patch(path, body) }`. `getPaged` follows `Link: rel="next"` with `per_page=100`, concatenates arrays, stops at `max`.
  `discoverGithubRepos(client): Promise<{ repos: Array<{ fullName, owner, name, private, archived, hasIssues, org: string|null }>, ssoOrgs: Array<{ login: string, url: string }> }>`.
  `describeProviderError` (status.js) returns the GithubError's own message when `err.kind` is set.

- [ ] **Step 1: Write failing tests**
  - classify: 401 → `auth`; 403 with `x-github-sso: required; url=https://github.com/orgs/acme/sso?authorization_request=1` → `sso` with `ssoUrl` equal to that URL; 403 with `x-ratelimit-remaining: 0` → `rate-limit`; 403 with `retry-after: 30` → `rate-limit`; 403 with body `Resource not accessible by personal access token` → `scope`; 404 → `not-found`; 410 → `gone`; every message is distinct and non-empty.
  - client: sends `Authorization` is NOT set by the client (the adapter owns it); `get` throws `GithubError` on `!ok`; `getPaged` with two pages (Link header) returns both pages' items in order; `getPaged(..., { max: 3 })` returns 3 items.
  - discovery: `/user/repos` is requested with `affiliation=owner,collaborator,organization_member`; maps fields (`full_name`, `owner.login`, `has_issues`, `archived`, `private`, org set when `owner.type === 'Organization'`); an org from `/user/orgs` whose `/orgs/{org}/repos?per_page=1` returns the SSO 403 is returned in `ssoOrgs` and does not throw; results sorted by `fullName` case-insensitively.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/client.test.js packages/core/tests/github/repos.test.js`; expect FAIL.
- [ ] **Step 3:** Implement `client.js` and `repos.js` per Interfaces. Send `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28` from the client, and `Content-Type: application/json` on bodies.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat(github): REST client with error classes and repo discovery`.

---

### Task 3: Mappers (issue, PR, run)

**Files:**
- Create: `packages/core/src/modules/github/mappers.js`
- Modify: `packages/core/src/modules/github/index.js`
- Test: `packages/core/tests/github/mappers.test.js`

**Interfaces:**
- Consumes: `toGithubId` (Task 1); `slugify`, `timeAgo` from `ado/helpers.js`.
- Produces:
  `githubTypeFromLabels(labels: string[], nativeType?: string|null): string` → one of `bug|feature|documentation|question|issue` (slug) — native type wins, else first matching label by the convention in Global Constraints.
  `mapGithubIssue(issue, repo: string, { nameToId = {} } = {}): WorkItem` with the same fields `jira/mappers.js#mapJiraIssue` produces plus: `id` = `toGithubId(repo, issue.number)`, `displayId`, `source: 'github'`, `state` `'Open'|'Closed'`, `stateCategory` (`Completed` when closed, `InProgress` when open with an assignee, else `Proposed`), `project: slugify(repo)`, `projectKey: repo`, `projectName: repo`, `assignee` (login slug), `tags` = label names, `iterationPath` = milestone title or `''`, `sprint` = milestone open, `comments` = `issue.comments`, `url` = `html_url`, `closeReason` = `state_reason` or null.
  `mapGithubPR(pr, repo, { reviews = [], meLogin = '' } = {}): PR` in the shape of `ado/mappers.js#mapPR` plus `source: 'github'`, `id: toGithubId(repo, pr.number)`, `displayId`, `number`, `repo`, `project: slugify(repo)`, `url: html_url`, `author`/`authorName` = login, `reviewerDetails: [{ name: login, vote, id }]` where latest review per reviewer maps `APPROVED` → 10, `CHANGES_REQUESTED` → -10, otherwise 0; requested reviewers without a review get vote 0; `needsMe` = meLogin is a vote-0 reviewer; `status` `merged` when `merged_at`, `abandoned` when closed unmerged, `draft` when `draft`, else `active`; `hasConflicts` = `mergeable_state === 'dirty'`.
  `mapGithubRun(run, repo): Build` in the shape of `mapBuild`: `status` from `conclusion` (`success` → success, `failure|timed_out|startup_failure` → failed, `cancelled` → cancelled, `neutral|skipped|action_required` → partial) and `run.status !== 'completed'` → running; `pipeline` = workflow name, `projectName` = repo, `project` = slugify(repo), `branch` = `head_branch`, `commit` = 7-char `head_sha`, `duration` formatted `Xm Ys` from `run_started_at` to `updated_at`, `url` = `html_url`, `source: 'github'`.

- [ ] **Step 1: Write failing tests** (one `it` per bullet below; assert exact values)
  - issue → item: open+unassigned issue in `acme/web` #12 has id `gh:acme/web#12`, state `Open`, stateCategory `Proposed`; open+assigned → `InProgress`; closed → state `Closed`, stateCategory `Completed`, `closeReason` `not_planned` passes through; labels `['bug','p1']` → type `bug`, tags `['bug','p1']`; native type `Task` beats label `bug`; no labels → `issue`; milestone `v2` open → `iterationPath: 'v2'`, `sprint: true`; no milestone → `iterationPath: ''`, `sprint: false`.
  - same number in two repos → different ids.
  - PR: draft → `draft`; `merged_at` → `merged`; closed unmerged → `abandoned`; reviews `[APPROVED by a, then CHANGES_REQUESTED by a]` → vote -10 for `a`; requested reviewer `b` with no review → vote 0 and `needsMe` true when `meLogin === 'b'`.
  - run: each conclusion mapping above; in-progress run → `running`; duration `125s` span → `2m 5s`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/mappers.test.js`; expect FAIL.
- [ ] **Step 3:** Implement the four functions in `mappers.js`.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat(github): map issues, PRs and Actions runs to the shared shapes`.

---

### Task 4: Issue reference extraction and PR-to-item links

**Files:**
- Create: `packages/core/src/modules/github/links.js`
- Modify: `packages/core/src/modules/ado/pr-links.js`, `packages/core/src/modules/github/index.js`
- Test: `packages/core/tests/github/links.test.js`, extend `packages/core/tests/ado/pr-links.test.js`

**Interfaces:**
- Produces: `extractIssueRefs(text: string, defaultRepo: string, knownRepos: string[]): string[]` returning unique `gh:` ids for `#123`, `owner/repo#123`, and closing keywords (`close[sd]?|fix(e[sd])?|resolve[sd]?` + ref); refs to repos not in `knownRepos` are dropped; `#123` resolves against `defaultRepo`.
  `indexPRsByWorkItem(prs)` (changed): keys are numbers for numeric ids as today, and the string id unchanged for non-numeric ids (`gh:...`, `jira:...`).

- [ ] **Step 1: Write failing tests**
  - `extractIssueRefs('Fixes #4 and acme/api#9, see other/x#1', 'acme/web', ['acme/web','acme/api'])` → `['gh:acme/web#4','gh:acme/api#9']`; text with no refs → `[]`; `'#4 #4'` → one id; `'issue #12abc'` and `'color #fff'` → `[]`.
  - `indexPRsByWorkItem` with a PR linking `{ id: 'gh:a/b#1' }` returns a Map where `.get('gh:a/b#1')` is that PR; numeric ADO ids still index as numbers (existing tests unchanged).
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/links.test.js packages/core/tests/ado/pr-links.test.js`; expect FAIL.
- [ ] **Step 3:** Implement `extractIssueRefs`; relax the `Number.isFinite` skip in `pr-links.js` so non-numeric string ids are kept as-is.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat(github): link PRs to issues from references and closing keywords`.

---

### Task 5: Loader and cache

**Files:**
- Create: `packages/core/src/modules/github/loader.js`
- Modify: `packages/core/src/modules/github/index.js`
- Test: `packages/core/tests/github/loader.test.js`

**Interfaces:**
- Consumes: `makeGithubClient`, mappers, `extractIssueRefs`.
- Produces: `GITHUB_CACHE_KEY = 'nexusmd.github.cache.v1'`; `loadCachedGithubData(config, { storage }): GithubData | null` (null when nothing is cached or the cache has no `WORK_ITEMS` array; otherwise the cached object as is); `loadGithubData(config, { http, storage }, { isRefresh = false, priorData = null, skip = {} } = {}): Promise<GithubData>` where `skip` is `{ workItems, prs, builds }` as in `loadAdoData`.
  `GithubData` = `{ WORK_ITEMS, PRS, BUILDS, ME: { login, name, avatarUrl }, PEOPLE: [{ login, avatarUrl }], PROJECTS, REPOS: string[], STATES: ['Open','Closed'], TYPES, WI_TYPE_STATES, MILESTONES: [{ repo, title, state }], PR_ERROR: string|null, REPO_ERRORS: [{ repo, kind, message }], loaded: true, configured: true }`.
  Per repo it fetches in parallel: open issues plus issues closed in the last 14 days (`/repos/{r}/issues?state=all&since=...&per_page=100`, PR entries dropped), open PRs (`/repos/{r}/pulls?state=open`) with `/pulls/{n}/reviews` per PR and `/pulls/{n}` for `mergeable_state`, and `/repos/{r}/actions/runs?per_page=15`. `ME` comes from `GET /user` (first load only; reused from `priorData` on refresh). `linkedWorkItems` on each PR = `extractIssueRefs(title + '\n' + body, repo, config.repos)` mapped to `{ id }`. The PAT is never present in the stored object. The result is stored under `GITHUB_CACHE_KEY` and `core._emit('github:loaded'|'github:updated', data)` is called like the ADO loader.

- [ ] **Step 1: Write failing tests** (fake `http` keyed by path, like `ado/loader.test.js`)
  - Two repos, issues endpoint returning one issue and one PR-shaped entry (has `pull_request`) → `WORK_ITEMS` has only the issue (Review Focus 1).
  - Repo A's issues call 410 and its runs call 404 → `REPO_ERRORS` has entries for A with kinds `gone` and `not-found`; repo B's items, PRs and runs still load (Review Focus 2); `loadGithubData` resolves.
  - `skip: { workItems: true }` → no `/issues` request is made and `WORK_ITEMS` is `[]`; `skip: { prs: true }` → no `/pulls` request; `skip: { builds: true }` → no `/actions` request.
  - Same issue number in both repos → two items with distinct ids (Review Focus 4).
  - PR body `Closes #4` → `linkedWorkItems` `[{ id: 'gh:acme/web#4' }]`.
  - `JSON.stringify(stored)` contains neither the PAT nor `Authorization`.
  - First failure on every PR list (401) with no PRs → `PR_ERROR` is a non-empty string; if every repo fails with 401, `loadGithubData` rejects with a `GithubError` of kind `auth` (so the provider records an error).
  - `isRefresh: true` with `priorData` does not call `GET /user`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/loader.test.js`; expect FAIL.
- [ ] **Step 3:** Implement `loadGithubData` and `loadCachedGithubData`. Use per-repo `try/catch` that records into `REPO_ERRORS`; fetch repos concurrently with `Promise.all`.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5:** Commit `feat(github): load issues, PRs and Actions runs per selected repo`.

---

### Task 6: Merge GitHub into the snapshot

**Files:**
- Modify: `packages/core/src/modules/workitems/merge.js`, `packages/core/src/modules/workitems/snapshot.js`
- Test: extend `packages/core/tests/workitems/snapshot.test.js` (the file added with ADO's work-items switch) and the merge test beside it

**Interfaces:**
- Consumes: `loadCachedGithubData`, `GithubData`.
- Produces: `PROVIDER_LABELS.github = 'GitHub'`. `mergeWorkItemData({ ado, jira, github, status, configured })` gains `github`, with `configured.github`; `WORK_ITEMS` = ado + jira + github items; `WORK_ITEMS_BY_SOURCE.github`; `WORK_ITEM_PROVIDERS` includes `{ id: 'github', ... }` with `warning` = `github.PR_ERROR` and `warningDetail` = repo error summary when any `REPO_ERRORS`; `STATES`/`TYPES`/`WI_TYPE_STATES(_BY_SOURCE)`/`STATE_CATEGORIES_BY_SOURCE.github` include GitHub's; `TEAM` gains logins from `github.PEOPLE`/`github.ME` (members `{ id: slugify(login), name: login, source: 'github', avatarUrl }`); `PROJECTS` gain one entry per selected repo with `source: 'github'`.
  `buildSnapshot({ ..., githubConfig, githubActive, githubWorkItems = true })`: `githubActive` is `isGithubConfigured()`; with `githubWorkItems: false` GitHub's `WORK_ITEMS`, `TYPES`, `PROJECTS` are dropped and GitHub is not in the providers, while `PRS`, `BUILDS` stay. The snapshot's `PRS` = ado PRs + github PRs; `BUILDS` = ado builds + github runs; `GITHUB_ME` = `github.ME`.

- [ ] **Step 1: Write failing tests**
  - Only GitHub configured: `WORK_ITEMS` are the GitHub items, `WORK_ITEM_PROVIDERS` is `[{ id: 'github', label: 'GitHub', status: 'ok', ... }]`.
  - ADO + Jira + GitHub: `WORK_ITEMS_BY_SOURCE` has all three keys; providers list has three in order ado, jira, github.
  - Provider status error with cached data → `stale`; without → `error`.
  - `githubWorkItems: false` (mirror the ADO switch test): no GitHub items in `WORK_ITEMS`, no `github` provider, but `PRS` and `BUILDS` still include GitHub's.
  - A GitHub login equal to an ADO member's name does not duplicate the member.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/workitems`; expect FAIL.
- [ ] **Step 3:** Extend `merge.js` and `snapshot.js`; keep the existing ADO-only and Jira call sites working (all new params optional).
- [ ] **Step 4:** Run `npx vitest run packages/core/tests`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): merge GitHub issues, PRs and runs into the snapshot`.

---

### Task 7: Issue operations and work-item source

**Files:**
- Create: `packages/core/src/modules/github/issues.js`, `packages/core/src/modules/github/work-item-source.js`
- Modify: `packages/core/src/modules/github/index.js`, `packages/core/src/modules/workitems/snapshot.js` (`defaultCreateProvider`)
- Test: `packages/core/tests/github/issues.test.js`, `packages/core/tests/github/work-item-source.test.js`

**Interfaces:**
- Consumes: `makeGithubClient`, `parseGithubId`.
- Produces (issues.js):
  `loadGithubDetail(client, id): Promise<{ description: string|null }>` (body as HTML-safe text; same shape the detail view reads).
  `loadGithubComments(client, id): Promise<Array<{ id, author, text, createdDate }>>` (returns `[]` on failure).
  `addGithubComment(client, id, text): Promise<{ id, author, text, createdDate }>`.
  `updateGithubIssue(client, id, patch: { title?, body?, state?, state_reason?, labels?, assignees?, milestone? }): Promise<void>` (`PATCH /repos/{r}/issues/{n}`).
  `githubPatchFromAdoField(field: string, value: any): patch` mapping `System.Title` → `title`, `System.Description` → `body`, `System.State` → `state` (`Closed|Done|Completed` → closed with `state_reason: 'completed'`, `Removed` → closed with `not_planned`, else `open`), `System.AssignedTo` → `assignees` (`[login]` or `[]`), `System.Tags` (`;`-separated) → `labels`; unknown field throws `Error('Editing <field> is not supported for GitHub issues')`.
  `fetchGithubCreateMeta(client, repo): Promise<{ labels: string[], assignees: string[], milestones: Array<{ number, title }> }>`.
  `createGithubIssue(client, { repo, title, body, labels, assignees, milestone }): Promise<{ id: string, url: string, warnings: string[] }>`.
- Produces (work-item-source.js): `makeGithubWorkItemSource({ http, getLogin }): source` with `loadDetail(id)`, `loadComments(id)`, `addComment(id, _project, html)`, `saveField(id, field, value)`, `loadRawFields(id)` (returns the issue JSON), `moveToCategory(id, category)` (`Completed` → close `completed`; any other → reopen), `availableTargetStates(id)` → `['Open','Closed']`, `webUrl(item)` → `https://github.com/owner/name/issues/N`, `getCreateMeta(repo)`, `createIssue(input)`.
- `defaultCreateProvider({ readJson, adoAvailable, jiraAvailable, githubAvailable = false })`: returns `'github'` when preferred is `'github'` and available; fallback order ado, jira, github.

- [ ] **Step 1: Write failing tests**
  - `githubPatchFromAdoField('System.State', 'Closed')` → `{ state: 'closed', state_reason: 'completed' }`; `'Removed'` → `not_planned`; `'Open'` → `{ state: 'open' }`; `System.Tags` `'bug; p1'` → `{ labels: ['bug','p1'] }`; `System.AssignedTo` `''` → `{ assignees: [] }`; unknown field throws.
  - `updateGithubIssue` sends `PATCH repos/acme/web/issues/12` with exactly the patch body.
  - `addGithubComment` POSTs `{ body }` to `.../issues/12/comments` and returns the mapped comment.
  - `moveToCategory('gh:a/b#1', 'Completed')` PATCHes `{ state: 'closed', state_reason: 'completed' }`; `'InProgress'` PATCHes `{ state: 'open' }`.
  - `createGithubIssue` POSTs to `repos/acme/web/issues` with `{ title, body, labels, assignees, milestone }` and returns `id: 'gh:acme/web#N'`.
  - `webUrl({ id: 'gh:acme/web#12' })` → `https://github.com/acme/web/issues/12`.
  - `defaultCreateProvider` with only github available → `'github'`; with `readJson` preferring `'github'` and it available → `'github'`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/issues.test.js packages/core/tests/github/work-item-source.test.js`; expect FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the same command plus `npx vitest run packages/core/tests/workitems`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): issue write-back, comments, create, and work-item source`.

---

### Task 8: Routing and shared UI source-awareness

**Files:**
- Modify: `packages/ui/src/views/work-item-source.js` (`createRoutedWorkItemSource`), `packages/ui/src/views/view-workitems.jsx`, `packages/ui/src/views/work-item-detail.jsx`, `modules/work/src/renderer/detail-drawer.jsx`, `modules/work/src/renderer/use-routed-work-item-source.js`, `packages/core/src/modules/workitems/classify.js`
- Test: `packages/ui/tests/work-item-source-routing.test.js` (extend), `packages/ui/tests/workitems-providers.test.jsx` (extend), `modules/work/src/renderer/use-routed-work-item-source.test.js` (extend)

**Interfaces:**
- Consumes: `isGithubId`, `sourceOfId`.
- Produces: `createRoutedWorkItemSource({ ado, jira = null, github = null })`: `pick(id)` returns github for `gh:` ids and throws `Error('GitHub is not configured')` when `github` is null; `routed.github = github`; `createWorkItem` stays ADO. `useRoutedWorkItemSource(ado, jira, github = null)`. In `view-workitems.jsx` the source tab list is built from `WORK_ITEM_PROVIDERS` (a `github` tab appears like `jira`), the lanes for `activeSource === 'github'` are `['Open','Closed']`, `laneMode` for a GitHub-only profile is `'state'`, and `boardProjects` for multi-provider boards excludes `source !== 'ado'` as it does for Jira. `work-item-detail.jsx` treats `source === 'github'` items as non-ADO: no ADO-only fields, description edited as plain text. `detail-drawer.jsx` "Open in" label is `GitHub` for `source === 'github'`. `classify.js` treats GitHub items by `stateCategory` like Jira (`isGithub`).

- [ ] **Step 1: Write failing tests**
  - Routed source: `loadDetail('gh:a/b#1')` calls the github source; with `github: null` it rejects with `GitHub is not configured`; `webUrl` for a gh item uses github; ADO and Jira routing unchanged.
  - Providers test (copy the structure of the Jira cases): with `WORK_ITEM_PROVIDERS` containing github, the source tabs render a GitHub tab; selecting it shows only `source: 'github'` items and board lanes `Open`/`Closed`.
  - `isDoneItem`/`isActiveItem` classify a GitHub item `{ source: 'github', state: 'Open', stateCategory: 'InProgress' }` as active and a `Closed`/`Completed` one as done.
- [ ] **Step 2:** Run the three test files; expect FAIL.
- [ ] **Step 3:** Make the changes above. Where a place only special-cases `jira`, add `github` rather than restructuring.
- [ ] **Step 4:** Run `npx vitest run packages/ui modules/work`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): route GitHub items through the shared work-item views`.

---

### Task 9: Renderer binding and refresh

**Files:**
- Create: `modules/work/src/renderer/github-client.js`
- Modify: `modules/work/src/renderer/work-data.js`, `modules/work/src/renderer/work-provider.jsx`, `modules/work/src/renderer/work-settings.jsx` (clear-cache only)
- Test: `modules/work/src/renderer/github-client.test.js`, `modules/work/src/renderer/work-provider.test.jsx` (extend)

**Interfaces:**
- Consumes: `makeGithubConfig`, `loadGithubData`, `loadCachedGithubData`, `makeGithubWorkItemSource`.
- Produces (github-client.js): `{ getGithubConfig, saveGithubConfig, isGithubConfigured, usesGithubWorkItems } = makeGithubConfig({ storage: rawStorage, key: n => getProfileKey('github.' + n) })`; `createGithubHttpAdapter({ getConfig = getGithubConfig, fetchImpl = window.fetch } = {})` → `{ fetch(path, options) }` calling `https://api.github.com/${path}` with `Authorization: Bearer <pat>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; throws `Error('GitHub token not configured — open Settings first.')` when there is no PAT; on a 401 response it dispatches `window.dispatchEvent(new Event('nexusmd:github-401'))` and still returns the response. `desktopGithubSource = makeGithubWorkItemSource({ http: createGithubHttpAdapter(), getLogin: () => getGithubConfig().login })`.
- `work-data.js`: `makeRefreshAllData` adds provider `github: { configured: isGithubConfigured(), run }` calling `loadGithubData(getGithubConfig(), { http, storage }, { isRefresh, priorData, skip: { ...skippedFetches(), workItems: !usesGithubWorkItems() } })`; `useNexusSnapshot` passes `githubConfig`, `githubActive: isGithubConfigured()`, `githubWorkItems: usesGithubWorkItems()`. `work-provider.jsx` passes `desktopGithubSource` (only when `usesGithubWorkItems()`) to `useRoutedWorkItemSource`. Clear cache also removes `GITHUB_CACHE_KEY`. The existing OAuth token health check stays untouched.

- [ ] **Step 1: Write failing tests**
  - `github-client.test.js`: adapter sets the three headers and the right URL; throws without a PAT; a 401 dispatches `nexusmd:github-401`; a 200 does not.
  - `work-provider.test.jsx`: with a configured GitHub (PAT, one repo) refresh runs the `github` provider; with `issues` off the routed source has no github source.
- [ ] **Step 2:** Run `npx vitest run modules/work/src/renderer/github-client.test.js modules/work/src/renderer/work-provider.test.jsx`; expect FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `npx vitest run modules/work`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): bind GitHub config, refresh and source in the Work module`.

---

### Task 10: Settings card with repo discovery

**Files:**
- Create: `modules/work/src/renderer/github-settings.jsx`
- Modify: `modules/work/src/renderer/work-settings.jsx` (render `<GithubConnectionCard onRefreshData={refreshAllData} />` after the Jira card)
- Test: `modules/work/src/renderer/github-settings.test.jsx`

**Interfaces:**
- Consumes: `getGithubConfig`, `saveGithubConfig`, `createGithubHttpAdapter`, `makeGithubClient`, `discoverGithubRepos`, `MAX_GITHUB_REPOS`, `repoListFromStub`; `CardFrame`, `SettField` from `@nexusmd/ui` like `ado-settings.jsx`.
- Produces: `GithubConnectionCard({ onRefreshData })`. Fields: PAT (password input, left blank keeps the saved one, as in the ADO card), "Load GitHub issues" switch, a **Discover repositories** button that fills a searchable checklist of every reachable repo grouped by owner/org (archived repos labelled, repos with issues disabled labelled), selected-count text `N of 50 selected`, and an "Orgs needing SSO authorization" list with a link for each from `ssoUrl`. Save persists PAT, repos, `issues`, and the login from `GET /user`, then calls `onRefreshData`. Exceeding the cap shows `Select at most 50 repositories` and disables Save. A missing-scope, rate-limit or auth failure shows the matching `GithubError` message in the status line. When saved repos are empty, the checklist is seeded from `repoListFromStub` of the profile's `modules.github` if the profile is readable from the renderer (find the accessor the shell uses with `grep -rn "modules\\." apps/desktop/src`); if it is not reachable from the renderer, skip seeding.

- [ ] **Step 1: Write failing tests** (model on `ado-settings.test.jsx`)
  - Renders blank with no config; saving with PAT + two ticked repos calls `saveGithubConfig({ pat, repos: [...], issues: true, login })` and then `onRefreshData`.
  - Switching "Load GitHub issues" off saves `issues: false`.
  - Discover with a faked client renders repos grouped by owner, filtered by the search box; archived repo shows an "archived" label; an SSO org renders its authorize link.
  - Ticking a 51st repo shows `Select at most 50 repositories` and Save is disabled (Review Focus 3).
  - A faked 403 `scope` error shows the scope message, not a generic one (Review Focus 5).
  - Blank PAT on save keeps the stored PAT.
- [ ] **Step 2:** Run `npx vitest run modules/work/src/renderer/github-settings.test.jsx`; expect FAIL.
- [ ] **Step 3:** Implement the card, reusing `settInputStyle` and the layout of `AdoConnectionCard`.
- [ ] **Step 4:** Run `npx vitest run modules/work`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): settings card with PAT, repo discovery and picker`.

---

### Task 11: Create form

**Files:**
- Create: `modules/work/src/renderer/github-create-form.jsx`
- Modify: `modules/work/src/renderer/create-work-item-drawer.jsx`, `modules/work/src/renderer/work-provider.jsx`
- Test: `modules/work/src/renderer/github-create-form.test.jsx`, `modules/work/src/renderer/create-work-item-drawer.test.jsx` (extend)

**Interfaces:**
- Consumes: `desktopGithubSource.getCreateMeta(repo)`, `desktopGithubSource.createIssue(input)`.
- Produces: `GithubCreateForm({ source, repos, defaultTitle, onCreated, onCancel })`: repo select (default first selected repo), title (required), body, labels multi-select, assignees multi-select, milestone select; submit calls `source.createIssue({ repo, title, body, labels, assignees, milestone })`, then `onCreated(result)`. The drawer provider switch lists `GitHub` when `github` is passed; `CreateWorkItemDrawer` takes `github: { source, repos } | null` and `adoAvailable`/`jira` rules extend so GitHub shows when it is the only provider. `work-provider.jsx` passes `github` when `usesGithubWorkItems()` and routes `onJiraCreated`-style refresh after creation.

- [ ] **Step 1: Write failing tests**
  - Form loads create meta on repo change and re-fetches for the new repo; title empty disables submit; submit calls `createIssue` with exactly `{ repo, title, body, labels, assignees, milestone }`.
  - Drawer: with only GitHub available it opens on the GitHub form; with ADO + GitHub the provider switch shows both and switching preserves the title.
  - `createIssue` rejection shows the error text and keeps the input.
- [ ] **Step 2:** Run the two test files; expect FAIL.
- [ ] **Step 3:** Implement, following `jira-create-form.jsx`'s structure and keeping the source identity stable (memoised, as the Jira source is) so meta isn't refetched on every snapshot.
- [ ] **Step 4:** Run `npx vitest run modules/work`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): create issues from the work-item drawer`.

---

### Task 12: Pull request views and PR drawer tabs

**Files:**
- Create: `packages/core/src/modules/github/pr-collab.js`, `packages/core/tests/github/pr-collab.test.js`
- Modify: `packages/ui/src/views/view-prs.jsx`, `packages/ui/src/views/pr-tabs.jsx`, `packages/core/src/modules/github/index.js`
- Test: `packages/ui/src/views/pr-tabs.test.jsx` (extend), `packages/ui/src/views/view-prs.test.jsx` (extend)

**Interfaces:**
- Produces (pr-collab.js), all taking `client` from `makeGithubClient`:
  `fetchGithubPRFiles(client, { repo, number }): Promise<Array<{ path, changeType, additions, deletions }>>`,
  `fetchGithubPRCommits(client, { repo, number }): Promise<Array<{ id, message, author, date }>>`,
  `fetchGithubPRThreads(client, { repo, number }): Promise<Array<{ id, path, line, comments: Array<{ id, author, text, createdDate }> }>>` (review comments grouped by `in_reply_to_id`),
  `postGithubPRComment(client, { repo, number }, text): Promise<{ id, author, text, createdDate }>` (an issue comment on the PR).
- `view-prs.jsx` shows `pr.displayId` when present instead of `#{pr.id}` (line ~420). `pr-tabs.jsx` dispatches on `pr.source === 'github'`: files, commits and threads use the functions above with a client built from `createGithubHttpAdapter` via the NexusData context (add `githubHttp` beside `buildSource` in `nexusDataValue` in `work-provider.jsx`); posting is limited to the PR comment; thread status changes and description edits are hidden for GitHub PRs.

- [ ] **Step 1: Write failing tests**
  - pr-collab: files, commits, threads (two review comments, one reply → one thread with two comments), comment post, each against a faked client.
  - `pr-tabs`: a GitHub PR loads its files/commits/threads from the GitHub functions, never calls the ADO ones; thread-status and description-edit controls are absent.
  - `view-prs`: a GitHub PR shows `acme/web#7`, not `#gh:acme/web#7`.
- [ ] **Step 2:** Run `npx vitest run packages/core/tests/github/pr-collab.test.js packages/ui/src/views/pr-tabs.test.jsx packages/ui/src/views/view-prs.test.jsx`; expect FAIL.
- [ ] **Step 3:** Implement. Where `pr-tabs.jsx` takes `http` from ADO, take the github adapter for GitHub PRs only.
- [ ] **Step 4:** Run `npx vitest run packages/ui packages/core`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): pull request views and drawer tabs for GitHub PRs`.

---

### Task 13: Builds view for Actions runs

**Files:**
- Modify: `packages/ui/src/views/view-builds.jsx`, `packages/ui/src/views/build-detail.jsx`, `modules/work/src/renderer/desktop-build-source.js`
- Test: `modules/work/src/renderer/desktop-build-source.test.jsx` (extend), a new case in an existing builds view test or `packages/ui/tests/builds-github.test.jsx`

**Interfaces:**
- `desktopBuildSource.loadTimeline(project, id, build)`: when `build?.source === 'github'` it returns `{ failedRecords: [] }` without calling ADO. `view-builds.jsx` and `build-detail.jsx` open `build.url` for GitHub runs where they build an ADO URL, label it "Open in GitHub", and hide ADO-only actions (queue/retry).

- [ ] **Step 1: Write failing tests**
  - `loadTimeline('acme/web', 1, { source: 'github' })` resolves `{ failedRecords: [] }` and makes no ADO request.
  - A GitHub run in the builds view shows its pipeline (workflow name), branch, status, and an open link equal to `html_url`; no ADO URL is produced for it.
- [ ] **Step 2:** Run the new/extended tests; expect FAIL.
- [ ] **Step 3:** Implement. If `BuildDetail` does not currently receive the build object when calling `loadTimeline`, pass it as the third argument.
- [ ] **Step 4:** Run `npx vitest run packages/ui modules/work`; expect PASS.
- [ ] **Step 5:** Commit `feat(github): show Actions runs as builds`.

---

### Task 14: Verify end to end

**Files:**
- Modify: none expected (fixes only); docs line in `README.md` integrations list if one exists.

- [ ] **Step 1:** Run the whole suite: `npx vitest run`. Expected: all pass, no snapshot changes outside GitHub additions.
- [ ] **Step 2:** Run the desktop e2e that covers Work (`apps/desktop/e2e/work.spec.js`) per `apps/desktop/package.json` scripts; expected: passes with GitHub unconfigured (no regression).
- [ ] **Step 3:** Launch the desktop app with the `run` skill, create a profile, paste a real PAT on the GitHub card, discover repos, tick two, save, and confirm: issues on the board and in the table, a PR in Pull Requests with its drawer tabs, runs in Builds, closing an issue from the drawer reflected on GitHub, creating an issue from the drawer, "Load GitHub issues" off hides issues but keeps PRs and runs. Report anything not verified.
- [ ] **Step 4:** Commit any fixes `fix(github): <what>`; do not push.
