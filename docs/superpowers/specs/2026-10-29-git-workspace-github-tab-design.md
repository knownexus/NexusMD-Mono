# Git Workspace GitHub tab — design

## Intent

Git Workspace shows local repositories. The GitHub repos ticked in Work's GitHub Connection card are only visible through Work's screens, mixed in with ADO and Jira. The user wants one place, next to their local repos, to see what is happening on each GitHub repo, with the same abilities Git Workspace has for local repos where they make sense for a remote one, plus the PR actions (approve, wait for author, reject, merge) built in `2026-10-28-pr-actions-design.md`.

## Goals

- A **GitHub** tab in Git Workspace's top tab strip, after "All projects" and the user's groups, reading `GitHub · N repos`.
- It lists exactly the repos ticked in Work's GitHub Connection card. Nothing is typed in separately.
- Layout (chosen from mockups, option A): ticked repos down the left, each with open PR and issue counts and an **Open local copy** link when the same GitHub repo is registered in Git Workspace; the chosen repo on the right, read from GitHub, with tabs:
  - **Pull requests** — open PRs; clicking one opens Work's PR drawer (with the PR actions).
  - **Issues** — open issues; clicking one opens Work's work-item drawer.
  - **Branches** — every branch, with **New branch** (from a chosen branch, with a name) and **Delete** (asks first).
  - **History** — recent commits on a chosen branch; clicking one shows its changed files and diff.
  - **Files** — browse a chosen branch's folders and open a file read-only.
- An **Open on GitHub** link for the chosen repo.

## Non-goals

- Changes, staging, commit, push/pull, stash, conflict resolution, and the git command line — a remote repo has no working tree.
- Editing files, committing, or creating PRs from this tab.
- Repos not ticked in GitHub Connection; GitHub Enterprise.
- A second sign-in: the tab uses Work's GitHub connection.

## Anti-goals

- A second copy of Work's drawers or a GitHub-only PR view.
- Deleting a branch without confirmation, or being able to delete the default or a protected branch.

## Decided with the user

- Separate tab in Git Workspace; ticked repos only; layout A.
- Point at the remote repo; "Open local copy" link when it is also local in Git Workspace.
- Same functionality as Git Workspace where possible: branches (including create/delete), history, files; PRs and issues open Work's drawers with the full PR actions.

## My calls (not confirmed by the user)

- **How the Git app reaches Work.** The apps are separate (split build). Work provides capabilities to other apps, as Calendar and Planner already do (`host.capabilities.provide`):
  - `work.github` → `{ repos: string[], http, cached: { prs, issues } }` or `null` when GitHub is not connected (no PAT or no repos). `http` is Work's GitHub adapter (token per profile, `nexusmd:github-401` on 401). `cached` is Work's latest snapshot data for those repos (GitHub PRs and GitHub work items).
  - `work.openPR(pr)` and `work.openItem(item)` open Work's drawers.
  - The GitHub tab appears only when `host.capabilities.has('work.github')` and the call returns non-null. Without Work installed it does not appear.
- **Counts on the left** come from `cached` (no extra requests). The right side's lists are fetched live from GitHub when a repo or tab is chosen, and refetched when Work's data refreshes or the user clicks Refresh.
- **Local copy matching:** a registered Git Workspace repo matches when any of its `git remote -v` URLs points to `github.com/<owner>/<name>` (https or ssh, `.git` optional, case-insensitive). "Open local copy" switches to All projects and selects that repo.
- **Branches:** list with name, last commit time, default and protected badges. New branch: `POST repos/{r}/git/refs` with `refs/heads/<name>` at the chosen branch's head sha. Delete: confirm `Delete branch <name> on GitHub?`; `DELETE repos/{r}/git/refs/heads/<name>`; hidden for the default branch and protected branches.
- **History:** `GET repos/{r}/commits?sha=<branch>&per_page=50`; a commit's detail from `GET repos/{r}/commits/{sha}` (files with their `patch`), rendered like the PR drawer's GitHub Files tab.
- **Files:** `GET repos/{r}/contents/{path}?ref=<branch>`; folders first, then files; a file shows its decoded text read-only; binary or over 1 MB files show "Open on GitHub" instead.
- **Branch picker** for History and Files defaults to the repo's default branch.
- **Errors** use the existing GitHub error classes (auth, scope, rate limit, SSO, not found) and show in the right pane; one repo failing does not affect others.

## Left to the builder

- Where the GitHub tab's components live inside `modules/git/src/renderer/` and how they plug into `view-git.jsx`'s tab strip (the strip's existing `GroupTabs` is a candidate).
- File/commit diff rendering reuse (the PR drawer's GitHub Files tab in `packages/ui/src/views/pr-tabs-github.jsx` is the expected source).
- Caching/refresh details within "fetch on select, refetch on Work refresh or Refresh".
