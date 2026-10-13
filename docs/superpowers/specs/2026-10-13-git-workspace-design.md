# Git Workspace Module — Design

**Date:** 2026-10-13
**Status:** Approved design (stage 1 detailed), pending implementation plan
**Repos touched:** `NexusMD-Mono` (new module). Reference implementation: `gws` in `C:\repos\DotFiles\pwsh\GitWorkspace` (C#, terminal UI), which this module replaces.

## Goal

Manage many local Git repositories and their worktrees from NexusMD desktop, organised into project groups: see what changed where, review diffs, browse history, and run branch and sync operations, with the same safety rules as gws. NexusMD becomes the place repos are managed; gws is finished to a stable point and frozen.

## Decisions

| Topic | Decision |
|---|---|
| Relationship to gws | Replaces gws. gws is finished (its remaining docs/settings task) and frozen; no new gws features |
| Platform | Desktop (Electron) only, gated by a `git` adapter that only desktop provides (`requiredAdapters: ['git']`, `defaultEnabled: false`) |
| Git access | Named operations through a dedicated `IGitAdapter`. Main maps each operation to an exact `git` argv; the renderer never sends git arguments. Parsing lives in `packages/core` as pure JS |
| Git engine | The installed `git` CLI (not a JS git library), so worktrees, rebase and the user's git config behave exactly as in a terminal |
| Settings | NexusMD's own profile-scoped settings (`getProfileKey('git.config')`), independent of gws's `git-workspaces.json` |
| Groups | Same model as gws: whole repos (including future worktrees), specific worktree paths, and branches that follow their checkout |
| Discovery | Repos one level below configured search roots (default `C:/repos` when it exists); only folders with their own repo markers; de-duplicated by common Git directory |
| Overlap with devenv | devenv keeps its Start-tab branch/worktree flow. This module never runs devenv scripts; stage 4 actions are plain git and are reviewed against devenv's flow when stage 4 is specified |

## Phasing (one spec, implemented in order, each stage its own plan)

1. **Foundation and workspace overview** (detailed below). Adapter, IPC, core parsers and group model, Git Workspace view with group tabs, worktree status, detail panel, group editor with discovery, settings card. Read-only: no git write commands.
2. **Changes and diffs.** Changed-file list per worktree with selection; unified-diff viewer with an explicit old/new legend, `old`/`new` line-number gutters and coloured added/removed lines (port of gws `DiffView`); on-demand diff loading; stage/unstage (whole files, then hunks); commit (all staged changes per chosen worktree, shared or per-target message). Write operations take a per-repo lock and always show a preview before running. Discard and delete-untracked come later, with typed confirmation.
3. **Commits browser.** `git log --graph` rows with refs and unpushed markers, literal search (`words` message, `@name` author, `:path` file), filters (all / unpushed / since base), commit → files → file-diff drill-down, merge-parent selection, background-loaded and cached details.
4. **Branch and sync actions.** Fetch, pull (fast-forward by default; rebase/merge explicit), push (never force; explicit remote/ref; first push sets upstream), create/checkout branch, new worktree, remove clean worktree, stash/apply, revert, continue/abort, interactive rebase. Every action: preview → confirm → per-target result in an activity log; multi-repo batches are not atomic and say so; retry repeats only failures and refuses stale state. Its own spec section is written before stage 4 planning.

Stages 2–4 are summarised here so stage 1's interfaces leave room for them; each gets its detailed design appended to this document (or a linked spec) before its plan is written.

## Out of scope (all stages)

- Web and Capacitor app support.
- Sharing settings with gws.
- A JS git implementation, SSH/credential management UI (git uses the user's existing credential helper; `GIT_TERMINAL_PROMPT=0` means a missing credential fails instead of hanging).
- Recursive discovery below one level.
- Side-by-side diffs.

## Stage 1 — Foundation and workspace overview

### Architecture

```
renderer (sandboxed)                         main (Node)
┌──────────────────────────────┐   invoke    ┌─────────────────────────────────────┐
│ views/git/view-git.jsx        │ ──────────▶ │ electron/ipc/git.cjs                 │
│   use-git-snapshot (poll 10s) │  git:<op>   │   op table → exact argv              │
│   group-editor.jsx            │ ◀────────── │   path check vs registered repos     │
│ adapters/git.js (wrapper)     │   result    │   spawn('git', argv, {cwd, env})     │
└──────────────┬───────────────┘             │   30s timeout, taskkill /T on cancel  │
               │ pure functions              └─────────────────────────────────────┘
┌──────────────▼───────────────┐
│ @nexusmd/core modules/git     │  parse.js · snapshot.js · groups.js · discovery.js
└──────────────────────────────┘
```

| Layer | Path | Responsibility |
|---|---|---|
| Contract | `packages/core/src/adapters/index.js` | `IGitAdapter` typedef; not provided by `createNoOpAdapters()` |
| Core module | `packages/core/src/modules/git/index.js` | `registerModule({ id: 'git', name: 'Git Workspace', requiredAdapters: ['git'], defaultEnabled: false, init, load, dispose })`; `getGitAdapter()` |
| Parsers | `packages/core/src/modules/git/parse.js` | `parseStatus(porcelainV2Z)`, `parseWorktrees(porcelainZ)`, `parseBranches(forEachRef)` — ports of gws `Git.ParseStatus`, `Git.ParseWorktrees`, `History.Branches` |
| Snapshot | `packages/core/src/modules/git/snapshot.js` | `buildSnapshot(repos, results)` → `{ worktrees, branches, errors, takenAt }`; never reports a missing/errored worktree as clean |
| Groups | `packages/core/src/modules/git/groups.js` | Group record, `includes(group, worktree|branch)`, `GroupDraft` (members, tick, whole-repo toggle, branches shown, rows(search, folded), unavailable entries, `commit(config, name, existing, resolve)` atomic save with unique names) — port of gws `GroupDraft` |
| Discovery | `packages/core/src/modules/git/discovery.js` | `isRepositoryRoot(markers)`, `dedupeByCommonDir`, `uniqueName` — pure; filesystem probing happens in main |
| IPC | `apps/desktop/electron/ipc/git.cjs` | `register(ipcMain, deps)`; injectable `spawn`, `kill`, `fs`; returns `disposeAll()` |
| Preload | `apps/desktop/electron/preload.cjs` | `window.electronAPI.git.{ isAvailable, resolve, worktrees, status, branches, discover }` |
| Adapter | `apps/desktop/src/adapters/git.js` | Thin wrapper; added to `adapters` in `main.jsx` |
| Settings | `apps/desktop/src/git-config.js` | `getGitConfig()` / `setGitConfig(patch)` + `nexusmd:git-config` event; `use-git-config.js` hook |
| View | `apps/desktop/src/views/git/` | `view-git.jsx`, `group-tabs.jsx`, `worktree-list.jsx`, `worktree-detail.jsx`, `group-editor.jsx`, `use-git-snapshot.js` |
| Settings card | `apps/desktop/src/git-settings-card.jsx` | Enable, search roots, registered repos (add via folder picker, remove) |
| Nav | `apps/desktop/src/nav-config.js`, `main.jsx` | `{ id: 'git', label: 'Git Workspace', icon: 'branch' }` (add icon if missing) + view case |

### Adapter contract (stage 1)

All methods are async and take plain data. `repo` is a registered repo `{ name, path }`; `registered` is the full registered-path list, sent on every call so main stays stateless and can validate.

| Method | Main runs | Returns |
|---|---|---|
| `isAvailable()` | `git --version` (cached) | `boolean` |
| `resolve(path)` | `git rev-parse --path-format=absolute --git-common-dir` in `path`, then `.git-main`, then `.bare` | `{ commonDir }` or error |
| `worktrees(repo, registered)` | `git worktree list --porcelain -z` in the common dir | raw text |
| `status(worktreePath, registered)` | `git status --porcelain=v2 --branch -z --untracked-files=all`, plus `rev-parse --git-dir` and existence checks for rebase/merge/revert/cherry-pick state files and `FETCH_HEAD` mtime | `{ porcelain, operation, rebasingBranch, fetchedAt }` |
| `branches(repo, registered)` | `git for-each-ref --sort=refname --format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short) refs/heads/` | raw text |
| `discover(roots, registered)` | Enumerate one level under each root; probe markers (`.git` dir/file, `.git-main`, `.bare`, bare `HEAD`+`objects`); `resolve` each match | `[{ name, path, commonDir }]` |

**Main-process rules:** the operation table is the only source of argv. Every path must be absolute. A worktree path must lie inside a registered repo's root or appear in that repo's `worktree list`. Unknown operations and unregistered paths are rejected without spawning. The environment sets `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` and `LC_ALL=C`. It removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and the other inherited `GIT_*` location variables, mirroring gws `Git.StartInfo`. Commands use `windowsHide: true` and a 30 s timeout, with a `taskkill /PID /T /F` tree-kill on timeout. Stdout is decoded as UTF-8, and NUL-separated output is preserved.

### Settings shape

```js
{
  version: 1,
  repos:  [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }],
  groups: [{ name: 'Secure QR', repos: ['Joiners'], worktrees: ['C:/repos/mobileApp/qr'], branches: [{ repo: 'AccessControl', ref: 'refs/heads/feature/secure-qr' }] }],
  roots:  null,            // null = default (C:/repos if it exists); [] = no discovery
  view:   { group: 'All projects', collapsed: [], selected: null }
}
```

Repo names are unique, compared case-insensitively. "All projects" is reserved. Settings load tolerates missing fields and unknown versions are rejected with an error card.

### Screens

**Git Workspace view:**
- **Group tabs** (`All projects`, then saved groups) each show a change count and are followed by a `+` tab. Each tab's `⋯` menu (or right-click) offers Edit members, Rename, Duplicate and Delete. Delete uses the existing confirm dialog, and `All projects` has no menu. Overflowing tabs scroll horizontally, and the active tab always stays visible.
- **Worktree list:** one collapsible heading per repo, showing a changed-file total. Under each heading:
  - worktree rows: `name → branch`, ahead/behind, changed/staged counts, the in-progress operation, and "no upstream" / "upstream missing";
  - inactive branch rows (◇ "not checked out"), shown only when a branch member brought them in;
  - error rows in red.
- **Detail panel** (right side) for the selected row: path, upstream, last fetch, operation in progress, locked/prunable notes, and the changed-file list with two-letter status codes. Staged and unstaged sides are separate entries.
- **Refresh:** polls every 10 s while visible, skipping a poll if the previous one is still running. Only the newest response writes state. It also refreshes on window focus and when the settings change. A ⟳ button with a "last refreshed" time forces a refresh.
- **Unavailable states:** `git` missing → a "Git not found" card. Module disabled or not desktop → the standard "needs the desktop app" fallback.

**Group editor** (`PlModal`, wide):
- A Name field. New groups start as "New group", and names must be unique and not "All projects".
- A search-roots line with a Rescan button.
- A tree:
  - Registered repos come first, then discovered ones marked ★ "not registered".
  - Each repo's worktrees are listed under it. Branches appear only after "show branches".
  - The repo checkbox shows ☐ / ◩ / ☑. A "whole repo" toggle switches between whole-repo and individual entries.
  - Missing members show as "(unavailable)".
  - There's a filter box, and repos can be folded.
- Discovery runs in the background when the editor opens.
- **Save** registers ticked discovered repos (folder name, numeric suffix if it clashes) and saves the group in one settings write. If any registration fails, nothing is written and the failing row is focused and flagged.

**Settings card** (Desktop settings): enable/disable, search roots (semicolon-separated, absolute paths only; missing folders are allowed and listed as "not found"), and the registered repos list with Add (folder picker → `resolve` → unique name) and Remove (unregisters only; files untouched).

### Error handling

| Situation | Behaviour |
|---|---|
| `git` not on PATH | `isAvailable()` false; view shows "Git not found" with install hint; no polling |
| Repo path missing or not a repo | Repo heading shows the error in red; other repos load normally; settings card flags it |
| Worktree registered but folder missing | Row "Missing worktree · stale registration"; never shown as clean |
| Command exceeds 30 s | Process tree killed; that repo shows "timed out"; next poll retries |
| Unknown operation / unregistered or relative path | Rejected in main; nothing spawned; error returned |
| Poll overlaps a slow scan | Poll skipped; newest result wins |
| Group member no longer exists | Kept in settings; "(unavailable)" in the editor; ignored in the list |
| Discovery root missing or unreadable | Skipped silently; reported in the settings card as "not found" |
| Duplicate registration of the same repository (same common dir) | Refused with "already registered as <name>" |

### Testing

- **Core (vitest, node):**
  - Parser tests use recorded `git` output: renames (`2` records), conflicts (`u` records), untracked files, ignored submodule state, ahead/behind, detached HEAD, gone upstream, a rebase in progress, and locked/prunable/bare worktree entries. They also cover paths with spaces, brackets, unicode and leading dashes.
  - Group and draft rule tests: whole repo vs entries, branch membership following its checkout, unique names (case-insensitive), atomic save with no change on failure, and unavailable entries kept.
  - Discovery rule tests.
  - Add the module's new public exports to `packages/core/tests/public-api.test.js`.
- **IPC (`git.test.js`, node, `spawn` and `fs` injected):**
  - The exact argv for each operation.
  - Unknown operations rejected; relative or unregistered paths rejected.
  - The environment includes `GIT_TERMINAL_PROMPT=0` and drops inherited `GIT_DIR`.
  - Timeout leads to a tree-kill.
  - `disposeAll` kills running processes.
- **Integration (real git):** create temporary repos (a normal repo, a `.git-main` bare layout with an inner worktree and an external worktree, and a plain folder) with an isolated `GIT_CONFIG_GLOBAL`. Run the real handlers and core parsers and check the snapshot and discovery results.
- **UI (jsdom with Testing Library, fake adapter):**
  - Tabs filter rows and show counts.
  - Error rows render.
  - The poll hook skips overlapping calls and ignores stale responses.
  - The editor ticks, toggles whole repo, shows branches, saves atomically, and focuses the failing row.
- **E2E:** a smoke test that the nav entry opens the view. It's reported as "blocked" in headless shells, per `WRITING_MODULES.md`.
