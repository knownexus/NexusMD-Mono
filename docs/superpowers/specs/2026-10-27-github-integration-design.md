# GitHub integration — design

## Intent

NexusMD already treats Jira and Azure DevOps (ADO) as first-class sources. GitHub is a stub: a profile has `github: { enabled, owner, repos }`, a PAT key (`nexusmd.github.pat.<id>`) is cleaned up on profile delete, and a GitHub OAuth token expiry banner exists. There is no client, loader, settings card, or data in any view.

Goal: GitHub becomes a peer of Jira/ADO. Users on GitHub-hosted teams get **issues as work items, pull requests, Actions workflow runs, and repo discovery/selection** in the same views the other sources feed.

## Goals

- **Issues as work items.** Same boards, list, detail drawer and create form as Jira/ADO items, routed through the existing work-item provider mechanism (`use-routed-work-item-source`, `work-provider`, `workitems/snapshot`).
- **Pull requests** feed the existing PR views (needs-me, team activity, PR links to work items, PR threads/commits/files like `ado/pr-collab.js`).
- **Actions workflow runs** appear where ADO builds do (status, branch, duration, link out).
- **Repo discovery and selection.** The settings card lists every repo the token can reach, including all orgs the user belongs to, and the user ticks which to include. Nothing is typed by hand.
- **Per-profile PAT**, stored exactly as ADO's PAT is (per profile, same storage adapter and key scheme pattern). A "Load GitHub issues" switch (per profile, default on) mirrors ADO's "Load Azure DevOps work items": off, issues are not fetched or shown, PRs and runs still are.
- GitHub can run alongside Jira and/or ADO in one profile.

## Non-goals

- OAuth-only sign-in. The existing OAuth flow stays as is; PAT is the supported path for this work.
- GitHub Projects (v2) boards, Discussions, Releases, Packages, code scanning.
- Test reporting from Actions runs in the first version (workflow runs only).
- GitHub Enterprise Server hosts (github.com only) — builder's call if the base URL is trivially configurable.

## Anti-goals

- Typing owner/repo lists by hand as the primary flow.
- A parallel UI: no GitHub-only issue view; no copy of the work-item drawer.
- Breaking profiles that already have the `github: { enabled, owner, repos }` stub; migrate or tolerate it.

## Constraints

- Follow the existing module layout: pure/headless logic in `packages/core/src/modules/github/` (config, client, loader, mappers, work-item-source, pr-collab equivalents), renderer pieces in `modules/work/src/renderer/` (`github-client.js`, `github-settings.jsx`, wired into `work-data.js`, `work-provider.jsx`, `create-work-item-drawer.jsx`), mirroring `ado/` and `jira/`. Config uses the injected-storage pattern of `makeAdoConfig` (`makeGithubConfig`, `usesGithubWorkItems`).
- Output of mappers must match the normalized shapes the views already consume (work item, PR, build) so views need no GitHub branches beyond labels/links.
- Tests alongside code in the repo's existing style (vitest; `*.test.js`/`*.test.jsx`), including snapshot tests for the issues-off switch as done for ADO.
- Token handling: PAT never logged, never written to the cached snapshot; Missing/expired/insufficient-scope tokens surface through the existing expired-token banner path (currently `nexusmd:github-401`).
- Discovery must cope with large accounts: paginated `/user/repos` (with org membership, `affiliation=owner,collaborator,organization_member`), and rate limits (conditional requests/ETags where cheap).

## Decisions made with the user

- Issues are work items "same as the others".
- PAT per profile, same as ADO.
- Scope: PRs, issues, Actions/workflows, project/repo selection and discovery.
- Repo picker lists every repo the token can reach, across all orgs.

- **Write-back (confirmed):** closing, reopening, and editing title, body, labels and assignees write back to GitHub, like Jira/ADO. Boards show open and closed columns only. Label-driven status columns are out of scope.
- **Scale (confirmed):** a few dozen selected repos at most per profile. Per-repo REST calls are fine; no GraphQL required for scale. Cap selected repos at a few dozen (builder picks the exact number, suggest 50) with a clear message when exceeded. The token may reach many more repos than are selected, so discovery must paginate.

## My calls (not yet confirmed — flagged for review)

- **Issue mapping:** open/closed → state (with `state_reason` `not_planned`/`completed` mapping to terminal categories); labels → type (a `bug`/`enhancement`/etc. label convention, falling back to a generic "Issue"); assignees, milestone → sprint-equivalent, comments via the issues comments API; board columns derived from state plus optional status-style labels. Native GitHub issue types (org feature) used when present.
- **Create form:** creates an issue in a chosen selected repo with title, body, labels, assignees, milestone.
- **Actions → builds:** `workflow_runs` per selected repo, limited to a recent window; run conclusion maps to the existing build status values.
- **PR data:** via REST (`pulls`, reviews, review comments, check status); review state maps to the vote concept used by `pr` module filters (approved / changes requested / none).
- **API:** REST v3 with a small client wrapper; GraphQL only if needed to avoid N+1 (e.g. PR review state), builder's call.
- **Selected repos stored** as `owner/name` strings per profile; replaces the stub's `owner` + `repos` (derive owner from the selection for display).

## More calls, from the builder check (mine, not confirmed)

- **Project equivalent:** a selected repo (`owner/name`) is the "project" everywhere views filter, group or pick a create target. Milestones are the sprint equivalent; a profile whose selected repos have no open milestones hides sprint UI for GitHub items instead of showing it empty.
- **PR-to-work-item links:** resolved within GitHub from `#123` references and closing keywords (`closes/fixes/resolves #123`) in PR title/body, including `owner/repo#123` across selected repos. If the existing `ado/pr-links.js` also matches Jira keys in titles, GitHub PRs get the same treatment. No timeline cross-reference API calls in v1.
- **Stub migration:** the stub's `repos` are read as bare names qualified by its `owner`, or as `owner/name` if they already contain a slash; converted at read time and written back as `owner/name` on first save. A stub that is enabled but has no PAT shows the card as not connected, not an error.
- **Errors:** 401 uses the existing expiry banner. 403 is split into missing scope, secondary rate limit, and SSO-not-authorized, each with its own message. Discovery lists orgs the PAT is not authorized for as "needs SSO authorization" rather than silently omitting them.
- **Identity:** "me" is the login from `GET /user`, stored per profile. The team roster is built from logins seen as authors, assignees and reviewers on selected repos, with no manual list in v1. Avatars and names come from the API; emails are never relied on.
- **Issue types and field visibility:** default label convention (`bug`, `enhancement`/`feature`, `documentation`, `question`, otherwise "Issue"), with native issue types used when the org has them. Making the mapping configurable is a later change.

## Left to the builder

- Exact caching/refresh intervals (reuse `refreshSecs` conventions), pagination caps, polling vs conditional requests.
- Required PAT scopes list and the in-app messaging for missing scopes (expect `repo`, `read:org`, `workflow` for read; classic vs fine-grained token guidance).
- Field-visibility config entries for GitHub-specific fields, following `ado/field-visibility.js`.
- Whether a shared source-agnostic abstraction should be extracted from `ado/` and `jira/` or GitHub simply follows the same pattern.
