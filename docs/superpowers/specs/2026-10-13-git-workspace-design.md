# Git Workspace Module — Design

**Date:** 2026-10-13
**Status:** Approved design. Stage 1 implemented; stage 2 implemented (2026-10-14); stage 3 designed, pending its plan.
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
2. **Changes and diffs.** Changed-file list per worktree with selection; unified-diff viewer with an explicit old/new legend, `old`/`new` line-number gutters and coloured added/removed lines (port of gws `DiffView`); on-demand diff loading; stage/unstage (whole files, then hunks); commit (all staged changes per chosen worktree, shared or per-target message). Write operations take a per-repo lock and always show a preview before running. Discard and delete-untracked are included, with typed confirmation (detailed below).
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
| `resolve(path)` | `git rev-parse --path-format=absolute --git-common-dir` in `path`, then `.git-main`, then `.bare` (layout folders first when `path` has no `.git`); cached per folder for 5 s | `{ commonDir }` or error |
| `worktrees(repo, registered)` | `git worktree list --porcelain -z` in the common dir | raw text |
| `status(worktreePath, registered)` | `git status --porcelain=v2 --branch -z --untracked-files=all`, plus one `rev-parse --path-format=absolute --git-dir --git-common-dir` and existence checks for rebase/merge/revert/cherry-pick state files and `FETCH_HEAD` mtime | `{ porcelain, operation, rebasingBranch, fetchedAt }` |
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

## Amendments made during stage 1 planning

- Discovery marker rules and de-duplication live in `apps/desktop/electron/ipc/git.cjs`; Electron main is CommonJS and cannot `require()` the ESM-only `@nexusmd/core`, so there is no `packages/core/src/modules/git/discovery.js`. `uniqueName` lives in `groups.js`.
- `discover(roots, repos)` takes registered repos as `{ name, path }` so it can report `registeredAs`.
- New read-only operation `checkFolders(paths)` → `[{ path, exists }]`, used by the settings card to list missing search folders.
- `IGitAdapter.version()` (async) reports whether git runs (`null` = not found); `isAvailable()` stays the synchronous desktop-bridge check, as for devenv.
- No enable/disable toggle on the settings card: like devenv, the module is gated by the adapter and its nav entry is always present on desktop.
- Group rename/duplicate/delete and repo registration are pure functions in `groups.js`; the group editor model is `group-draft.js`.

## Decisions made during stage 1 implementation

- git is spawned only by absolute path, resolved from PATH (absolute entries only; `git.exe` then `git.com`), and main sets `NoDefaultCurrentDirectoryInExePath=1` — a bare `git` with a cwd would run a `git.exe` planted in the target folder on Windows.
- Every git call passes `-c core.fsmonitor=false` so repo-local fsmonitor commands can't run.
- UNC and device paths (`\server\share`, `\?\`, `//server/share`) are rejected for repos and roots, reported as missing by folder checks, and skipped by discovery (avoids outbound SMB authentication).
- `.git` files pointing at network paths are skipped during discovery; `include.path` to a network path remains in the accepted residual-risk class alongside filter drivers.
- A gone upstream is detected from porcelain v2 omitting `# branch.ab` while `# branch.upstream` is present, so `status` needs no `@{upstream}` spawn. git is looked up again on PATH (quoted entries unquoted) until found, so installing it and reopening the screen works.
- The `registered` list is supplied by the renderer; it guards against renderer bugs and is not an authorisation boundary — the boundary is the fixed, read-only argv.
- Accepted residual risk for stage 1: repo-local `filter.<driver>.clean/process` can still run during `git status` for stat-dirty files; stage 2's design should consider ownership / `safe.directory` checks before running status in discovered folders.
- Settings saved by a newer NexusMD version are never overwritten (`setGitConfig` is a no-op while unsupported).

## Stage 2 — Changes and diffs

Scope:
- changed-file list with selection;
- unified diff viewer;
- whole-file stage/unstage;
- hunk stage/unstage;
- discard unstaged;
- delete untracked;
- multi-worktree commit.

Everything in stage 4's list stays out of scope.

### Architecture

Stage 2 uses named write operations with a review stamp. Three options were considered; option A was chosen. Main-held plan objects and renderer-built patches were rejected.

The flow:
1. The renderer reads a diff and shows it.
2. It sends a write naming the files (or a hunk index), plus the `expected` stamp of what it showed.
3. Main recomputes the stamp just before running and refuses on a mismatch, as gws `Plan.Run` does.

Main stays stateless apart from a per-repo write lock. The renderer never supplies patch text or git arguments.

### Adapter contract (stage 2)

Every call runs `git --no-pager -c core.fsmonitor=false --literal-pathspecs …` under stage 1's environment and process rules. The timeout is 30 s, except `commit`, which gets 120 s for hooks. Paths always go after `--` or on stdin.

| Method | Main runs | Returns |
|---|---|---|
| `diff(worktree, registered, change)` | **Unstaged:** `diff --no-color --no-ext-diff --no-textconv -M -U3 -- <path(s)>`. **Staged:** the same plus `--cached`. **Untracked:** main reads the file (1 MB cap, binary detection) and builds an all-added diff. **Conflict:** `diff` (combined, read-only). | `{ text, truncated, binary, stamp }` |
| `stage(worktree, registered, paths, expected)` | `add --pathspec-from-file=- --pathspec-file-nul` (NUL-separated paths on stdin) | `{ ok, detail }` |
| `unstage(…)` | `restore --staged --pathspec-from-file=- --pathspec-file-nul`. On an unborn branch: `rm --cached -r --ignore-unmatch` with the same pathspec input. | `{ ok, detail }` |
| `stageHunk(worktree, registered, path, index, expected)` | 1. Re-read the unstaged diff for `path`. 2. Check the stamp. 3. Cut out the file header plus hunk `index` (0-based count of `@@` headers in that file). 4. Run `apply --cached --whitespace=nowarn -` with the patch on stdin. | `{ ok, detail }` |
| `unstageHunk(…)` | The same, from the staged diff, with `apply --cached --reverse --whitespace=nowarn -` | `{ ok, detail }` |
| `discard(worktree, registered, paths, expected)` | `restore --worktree --pathspec-from-file=- --pathspec-file-nul`. Accepts tracked files with unstaged changes only. | `{ ok, detail }` |
| `deleteUntracked(worktree, registered, paths, expected)` | Checks every path first. If any check fails, nothing is deleted; only then is each file removed with `fs.unlink`. See the checks below. | `{ ok, detail }` |
| `commit(worktree, registered, message, expected)` | `commit -F -` with the message on stdin. Hooks run as they would in a terminal. | `{ ok, detail }` |

`deleteUntracked` checks each path is:
- resolved inside the worktree root;
- not a directory;
- free of any parent folder that is a reparse point or symlink;
- still untracked (`ls-files --others --exclude-standard -z`).

**Stamps.** Main computes a SHA-256 stamp:
- **File actions and hunks:** HEAD oid + each path's `ls-files --stage -z` entry + its diff text. For untracked files, the file bytes.
- **Commit:** HEAD oid + the whole of `ls-files --stage -z`.

On a mismatch nothing is spawned, and the call returns "Changed since you reviewed it. Refresh and review again."

**Refusals.** These are refused before anything is spawned:
- submodule entries;
- hunk operations on binary, truncated, untracked or conflicted files;
- discard of anything other than tracked files with unstaged changes;
- commit with no staged changes or an empty message;
- commit while a merge, rebase, revert or cherry-pick is in progress, or while conflicts remain.

Staging during a conflict is allowed, because staging marks the file resolved.

**Lock.** Writes are serialised per common dir. A second write to the same repo queues behind the first. Reads are never locked.

**Residual risk.**
- `--no-ext-diff --no-textconv` stops repo-configured diff programs from running.
- Clean/smudge filters still run on `add` and `restore`, as they do in a terminal. This is the class of risk accepted in stage 1, now extended to writes.
- No force flags are used anywhere.

### Core (`packages/core/src/modules/git`, pure ESM)

**`diff.js`**
- `parseDiff(text)` returns:
  ```
  { files: [{ oldPath, newPath, status, binary,
      hunks: [{ header, oldStart, newStart,
        lines: [{ kind: 'context'|'add'|'del'|'meta', text, oldNo, newNo }] }] }] }
  ```
- It handles renames and copies, new and deleted files, mode changes, `\ No newline at end of file`, binary markers, CRLF, and quoted-path unescaping. It is a port of gws `DiffView.Parse`.
- Hunk numbering matches main's splitter. Main is CommonJS and keeps its own small splitter; both are tested against the same recorded diffs.

**`diffSides(change)`** returns the legend for each area:

| Area | Legend |
|---|---|
| Unstaged | `− old: index` / `+ new: working tree` |
| Staged | `− old: HEAD` / `+ new: index` |
| Untracked | `+ new file` |
| Conflict | `ours` / `theirs`, no staging |

**`selection.js`**
- Per-worktree selection, keyed by change id (`area:path`), with `toggle`, `range`, `all` and `none`.
- Ids that are no longer in the snapshot are pruned.
- `actionsFor(changes, selectedIds)` returns the applicable actions, with a file count for each. A mixed selection runs each action on the files it applies to, and the review lists the skipped files.

**`review.js`**
- `fileReview(action, changes)` returns `{ title, files, warning, skipped, needsTyping }`. `needsTyping` is `'DISCARD'`, `'DELETE'` or `null`.
- `commitReview(targets, message | perTarget)` returns one block per worktree: `repo › worktree → branch`, its staged files and its message. It also carries the note "Each worktree commits separately; if one fails the others are not undone."
- `commitTargets(snapshot, group, selectedTreeId)` returns the worktrees in the current group that have staged changes.
  - Only the selected worktree is ticked at first.
  - Worktrees with an in-progress operation or conflicts are listed as unavailable, with the reason.

All new exports are added to `public-api.test.js`.

### Screens (stage 2)

**Layout.** Three panes. The worktree list stays on the left. The right side, from top to bottom:
1. **Header strip:** stage 1's detail fields, in compact form.
2. **Changes pane:**
   - A toolbar: `Stage` `Unstage` `Discard…` `Delete…` `Commit…`. Each shows how many files it applies to, and is disabled with a tooltip when it doesn't apply.
   - The file list, grouped under *Conflicts*, *Staged*, *Changes* and *Untracked*. Each row has a checkbox, a coloured status code and the path, plus `← old` for renames.
3. **Diff pane:**
   - a legend bar;
   - `old` and `new` line-number gutters;
   - red and green line backgrounds, plus `−` and `+` signs;
   - a `Stage hunk` or `Unstage hunk` button on each hunk header;
   - notices for binary files, truncated files (with the size), conflicted files ("Resolve in your editor, then stage the file") and "No longer changed".

A draggable divider sits between the changes and diff panes. Its ratio is stored in `view.split`.

**Interaction.**
- Clicking a row focuses it and loads its diff.
- The checkbox, Space or Shift-click selects. A group heading's checkbox selects or clears its whole group.
- Keys: ↑/↓ move the focus, Space selects, `s`/`u` stage or unstage the selection, and `c` opens Commit.
- Diffs load on demand, for the focused file only. They are cached per (worktree, change id, stamp) and re-fetched only when a snapshot shows the file changed.
- Selections persist per worktree for the session.

**Review before running.**
- Stage, Unstage and Commit open a `PlModal` review; Enter or the button runs it.
- Discard and Delete add a red warning and a field that requires typing `DISCARD` or `DELETE`.
- Hunk buttons run directly. The hunk on screen is the preview, and the stamp guarantees that what runs is what was shown.

**Commit dialog** (`PlModal`, wide):
- A target checklist and one shared message, with a "Message per worktree" switch.
- Ctrl+Enter or the button commits.
- Results are shown per target: ✓ or ✗ with git's output.
- **Retry failed** takes a fresh snapshot and re-reviews only the failures. It never re-runs blindly.

**After any write.** A quiet snapshot refresh runs at once. A status line under the toolbar shows the result, or git's error in red. The activity log comes in stage 4.

### Error handling (stage 2)

| Situation | Behaviour |
|---|---|
| Stamp mismatch | Nothing runs. Shows "Changed since you reviewed it. Refresh and review again." and refreshes. |
| Second write to a busy repo | Queues; its button shows a spinner. |
| Git write fails (a hook rejects, `index.lock`, a patch does not apply) | Shows git's stderr verbatim. For `index.lock`, adds: "Another git process is using this repo; close it or remove the stale lock." The module never deletes the lock. |
| Commit takes longer than 120 s | The process tree is killed and the target is reported as "timed out". The result notes that hooks may have left partial output. |
| Diff over 1 MB, or binary | Shows a truncated or binary notice with the size. Hunk buttons are hidden; whole-file actions still work. |
| File gone between the list and the diff | Shows "No longer changed" and refreshes the list. |
| A delete-untracked check fails | Nothing in that worktree is deleted. The refused path and the reason are reported. |
| A multi-target commit fails part-way | The other targets still run. Results are per target, with Retry failed. |

### Testing (stage 2)

**Core:**
- `parseDiff` on recorded diffs: renames, new and deleted files, mode change, no-newline, binary, CRLF, quoted unicode paths, multiple hunks.
- `diffSides`.
- Selection, including pruning and mixed selections.
- Review builders: `needsTyping`, skipped files, commit blocks.
- `commitTargets`, including ticks and unavailable reasons.
- Public API.

**IPC (injected spawn and fs):**
- Exact argv and stdin for every new operation.
- A stamp mismatch spawns no write.
- The lock serialises writes to the same repo, without blocking reads or other repos.
- The hunk splitter matches core's numbering on the shared fixtures.
- Delete refusals: traversal, a directory, a linked parent, a file that is now tracked.
- The submodule, commit-during-conflict and empty-message refusals.

**Integration (real git, temporary repos):**
- The full sequence: stage → unstage → stage hunk 2 of 3 → unstage hunk → discard → delete untracked → commit. Each step is checked with `git status` and the index.
- Unstage on an unborn branch.
- A stale review is refused.
- A two-worktree commit where one hook fails and the other still commits.

**UI (jsdom, fake adapter):**
- Focusing a file loads its diff once, and the legend matches its area.
- Toolbar counts and disabled states.
- Typed-confirmation gating.
- The stamp-mismatch message.
- A hunk button sends the right index.
- Commit dialog: shared vs per-target message, per-target results, and Retry failed re-reviewing only the failures.

## Amendments made during stage 2 planning

- Every stage 2 adapter method takes `(repo, worktreePath, registered, …)`, like `status`. `diff` takes `change = { area, paths }`. The hunk operations take `paths` (both names of a staged rename) rather than `path`.
- New read operation: `stamp(repo, worktreePath, registered, { kind: 'files', paths } | { kind: 'commit' })`. It returns the `expected` value for whole-file actions and commits.
- Whole-file stamps cover HEAD plus the paths' `ls-files --stage` entries, their porcelain v2 status records, and each path's working-tree `size` and `mtimeMs` (empty when the path is missing). The stat part means an edit made after the review is refused even when its status code doesn't change, which matters most for Discard. They don't cover diff text: that scales to many files without long argv. Hunk stamps are `sha256(fileStamp, diffText)`, which is the `stamp` that `diff` returns.
- Literal pathspecs come from `GIT_LITERAL_PATHSPECS=1` in the git environment rather than the `--literal-pathspecs` flag. It is set for every call except `commit`: commits run without it, so hooks see git's normal pathspec behaviour, as in a terminal (`commit -F -` takes no pathspecs itself).
- Every stage 2 read and write (`diff`, `stamp`, the file and hunk writes, `commit`) requires `worktreePath` to be exactly a `worktree` entry of `git worktree list --porcelain` for that repo, because their checks assume the worktree root. Stage 1's `status` keeps its looser rule.
- Hunk operations are refused for renamed, copied or mode-changed files ("Renamed, copied or mode-changed files are staged whole."), and the diff pane hides their hunk buttons. A staged deletion is unstaged whole.
- An untracked nested repository (`? nested/`) is never staged: core skips it ("nested repository — manage it on its own") and main refuses it ("Nested repositories are managed on their own."). Delete refuses it as a directory.
- Hunks are cut from the raw diff bytes (decoded as latin1 in main) and written back byte for byte, so non-UTF-8 files work. The renderer still gets UTF-8 text, and both `diff` and the hunk handlers stamp that text.
- `deleteUntracked` checks "still untracked" with porcelain v2 `?` records. This is the same set as `ls-files --others --exclude-standard`.
- Hunk operations need a diff with exactly one file section; otherwise they are refused and the hunk buttons are hidden.
- The focused file's diff reloads on every new snapshot as well as on a focus change, because porcelain v2 has no working-tree content hash. The last diff stays on screen while it reloads.
- Core signatures: `fileReview(action, changes, selectedIds)` and `commitTargets(worktrees, selectedTreeId)`.
- Write results are `{ ok, detail, stale? }`. Bad paths and unregistered repos still throw, as in stage 1.
- The commit dialog labels each worktree's block "Staged files in <title>" so it doesn't duplicate the worktree checkbox's label.

## Stage 3 — Commits browser

Scope:
- commit history for a worktree's HEAD, or for any local branch;
- a graph with refs and unpushed markers;
- literal search (`words` in the message, `@name` author, `:path` file);
- filters: all / unpushed / since a base;
- drill-down: commit → its files → a file's diff, with a choice of parent for merges;
- commit details and file lists loaded in the background and cached.

Stage 3 is **read-only**. It adds no write operation, takes no lock, and changes nothing in a repository. Everything in stage 4's list stays out of scope, including "check out this commit", revert and cherry-pick from the history.

**Reference implementation.** gws's history code (`C:\repos\DotFiles\pwsh\GitWorkspace`) isn't in the DotFiles repository on GitHub, so this design was written from the summary above and NexusMD's stage 1–2 code, not from a line-by-line port. Points where gws behaviour should be matched are marked *(check against gws)*.

### Architecture

The same shape as stage 2: named read operations, exact argv in main, parsing in core.

1. The renderer asks for a history page with a **query object**: which ref, which filter, which search, how many commits.
2. Main validates every field, builds the argv itself and runs `git log --graph` with a fixed format.
3. Core parses the text into rows. The renderer draws them and asks for a commit's details, files and diffs on demand.

Commit objects never change, so everything keyed by a full commit id is cached in the renderer for the session. A history page is keyed by its query plus the tip commit id it was read at, so it's re-read only when the ref moves.

Rejected options:
- **Paging with `--skip`.** `git log --graph --skip=N` draws the graph from the skipped point, so lanes break between pages. Instead "Load more" re-runs the query with a larger limit (200 → 400 → … → 5000). That re-runs the walk, but the graph stays correct and the result is cached.
- **A JS graph layout from parent ids.** Git's own `--graph` drawing is exact and well tested. Core only colours and re-draws its characters.

### Adapter contract (stage 3)

Every call runs under stage 1's environment and process rules (absolute git path, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, stripped `GIT_*` location variables, `GIT_LITERAL_PATHSPECS=1`, 30 s timeout with a tree-kill). Every call also adds:

```
git --no-pager -c core.fsmonitor=false -c log.showSignature=false -c i18n.logOutputEncoding=UTF-8 -c color.ui=never …
```

`log.showSignature=false` stops a repository's config from making `log` run gpg on every commit.

All four methods take `(repo, worktreePath, registered, …)`, like stage 2. `worktreePath` must be exactly an entry of `git worktree list --porcelain` for that repo. A bare entry counts, so a `.bare` layout can show branch history without a checked-out worktree.

| Method | Main runs | Returns |
|---|---|---|
| `refs(repo, worktreePath, registered)` | `for-each-ref --format=%(refname)%00%(objectname)%00%(upstream)%00%(HEAD) refs/heads/ refs/remotes/ refs/tags/`, plus `symbolic-ref --quiet refs/remotes/origin/HEAD` and `rev-parse --is-shallow-repository` | `{ refs: raw text, originHead: ref \| null, shallow }` |
| `log(repo, worktreePath, registered, query)` | See **Building the log argv** below | `{ text, tip, unpushed: [oid], truncated, limit }` |
| `commitDetails(repo, worktreePath, registered, oid)` | 1. `rev-parse --verify --quiet --end-of-options <oid>^{commit}`. 2. `show -s --decorate=full --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B --end-of-options <oid>`. | `{ details: raw text }`, or `{ missing: true }` |
| `commitFiles(repo, worktreePath, registered, oid, parent)` | `diff-tree --no-commit-id -r -z -M --name-status --no-ext-diff --no-textconv <parent> <oid>`; for a root commit, `diff-tree --no-commit-id --root -r -z -M --name-status <oid>` (without `--no-commit-id`, `--root` prints the commit id as an extra record) | `{ files: raw text }` |
| `commitDiff(repo, worktreePath, registered, oid, parent, paths)` | `diff --no-color --no-ext-diff --no-textconv -M -U3 <parent> <oid> -- <paths>`; for a root commit, `show --format= --no-color --no-ext-diff --no-textconv -M -U3 <oid> -- <paths>`. Same 1 MB cap and binary detection as stage 2. | `{ text, truncated, binary }` |

**Query object** (built by core, checked again by main):

```js
{
  ref: 'HEAD' | 'refs/heads/<name>',       // HEAD only for a worktree, a branch for inactive branch rows
  filter: 'all' | 'unpushed' | 'sinceBase',
  base: 'refs/heads/<x>' | 'refs/remotes/<r>/<x>' | null,   // required for sinceBase
  search: null | { kind: 'message' | 'author' | 'path', text },
  limit: 200 | 400 | … | 5000,
}
```

**Checks before spawning** (anything else is refused with a message, nothing spawned):
- `ref` is `HEAD` or exactly one of the `refs/heads/` names `for-each-ref` returns now. `base` is exactly one returned `refs/heads/` or `refs/remotes/` name.
- `limit` is a multiple of 200 from 200 to 5000.
- Search text is 1–200 characters, with no NUL, CR or LF.
- A `path` search is a relative path inside the worktree (stage 2's `requirePaths` rule).
- `oid` is 40 (SHA-1) or 64 (SHA-256) lowercase hex characters. `parent` is either `null` (root commit) or one of that commit's own parents, read with `rev-list --parents --max-count=1 --end-of-options <oid>`.

**Building the log argv:**

```
log --graph --topo-order --decorate=full --max-count=<limit+1> --no-color --no-ext-diff --no-textconv
    --format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s
    [search flags] [exclusions] --end-of-options <revs> [-- <path>]
```

- `all` → `--end-of-options <ref>`.
- `unpushed` → `--not --remotes --not --end-of-options <ref>`. Everything after `--end-of-options` is a revision, so the exclusion has to come first; the second `--not` turns exclusion off again before `<ref>`. (`<ref> --not --remotes` would put `--not` after `--end-of-options`, where it isn't an option.)
- `sinceBase` → `--end-of-options <base>..<ref>`.
- Message search: `--fixed-strings --regexp-ignore-case --grep=<text>`. Author search: `--fixed-strings --regexp-ignore-case --author=<text>`. Each is a single argv element starting with `--grep=` / `--author=`, so the text can't become an option.
- Path search: `-- <path>` (literal, from `GIT_LITERAL_PATHSPECS`). Git simplifies the graph to commits touching that path, as it does in a terminal.
- Reading `limit + 1` commits tells main whether there are more (`truncated`); the extra row is dropped before returning.
- `tip` is `rev-parse --verify --end-of-options <ref>^{commit}`, read just before the log. An unborn branch returns `tip: null` and no text.
- `unpushed` is `rev-list --max-count=<limit> --not --remotes --not --end-of-options <ref>`: commits on this ref that no remote-tracking branch has. If the repo has no remotes it's `null`, not "everything", and the UI says "No remotes".

Output over 8 MB is cut at the last complete record and reported as `truncated`.

These forms were checked against git 2.43: the `--not … --not --end-of-options` order, `--fixed-strings` applying to both `--grep` and `--author`, `<base>..<ref>` after `--end-of-options`, and an option-like word after `--end-of-options` being refused (`option '--all' must come before non-option arguments`) rather than obeyed.

### Core (`packages/core/src/modules/git`, pure ESM)

**`history.js`**
- `parseLog(text)` → `rows: [{ graph, commit? }]`.
  - Each output line is the graph prefix (git's `* | / \ _ .` characters and spaces), then, on commit lines, `\x1e` and the record.
  - `commit` is `{ oid, parents: [oid], author, email, time, refs, subject }`. Lines with no record are connector rows (graph only).
  - `refs` comes from `%D` with `--decorate=full`: `HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1.2`, a detached `HEAD`. Each becomes `{ kind: 'head' | 'branch' | 'remote' | 'tag', name }` with the short name. Full names are what make the kind unambiguous: with short names, a local branch called `origin/main` would look like a remote one.
- `graphCells(graph)` → `[{ ch, lane }]`: git's ASCII redrawn as box-drawing glyphs (`*` → `●`, `|` → `│`, `/` → `╱`, `\` → `╲`), with a lane index for colouring. *(check against gws's graph glyphs and colours)*
- `parseSearch(input)` → `null` | `{ kind, text }`. A leading `@` means author, a leading `:` means path, anything else is message words. `\@` and `\:` escape a literal first character. Text is trimmed; whitespace inside it is kept.
- `historyQuery({ tree | branch, filter, base, search, limit })` builds the query object. It throws the same messages main uses, so bad input is caught before IPC.
- `defaultBase(refs, tree)` picks the "since base" default:
  1. the upstream's remote's HEAD (`refs/remotes/origin/HEAD` → its target);
  2. else `refs/heads/main`, then `refs/heads/master`, if they exist and aren't the ref itself;
  3. else none, and the filter asks the user to pick.
- `parseCommitDetails(raw)` → `{ oid, parents, author, authorEmail, authorDate, committer, committerEmail, committerDate, refs, message }`.
- `parseNameStatus(raw)` → `[{ status, path, oldPath? }]` for `M A D T R### C###` records (the `R`/`C` records carry two paths).
- `parentLabel(details, index)` → `'1 (main line)'`, `'2 (merged in)'`, and so on, plus the parent's short id.

All new exports are added to `public-api.test.js`.

### Screens (stage 3)

**Changes | History.** The worktree panel gets a two-button switch above the header strip. The choice is stored in `view.panel` (`'changes'` default). Selecting an **inactive branch row** (◇) opens History for that branch, because a branch that isn't checked out has no changes to show.

**History layout.** It reuses the panel's draggable divider and `view.split`:
1. **Toolbar:**
   - A search box with the placeholder "words · @author · :path". Enter runs the search; Esc clears it.
   - The filter switch: `All` `Unpushed` `Since [base ▾]`. `Unpushed` shows "No remotes" and is disabled when the repo has none.
   - The commit count, "Load more" while `truncated`, and a ⟳ button.
   - Notes for a shallow clone ("Shallow clone — older history isn't here") and for an unborn branch ("No commits yet").
2. **Commit list:** one row per commit, each with:
   - the graph cells;
   - ref chips (HEAD, local branch, remote branch, tag; each in its own style);
   - the subject;
   - the author;
   - a relative date (the full date in a tooltip);
   - `↑` when the commit is unpushed.

   Connector rows are drawn graph-only and are skipped by keyboard focus.
3. **Commit detail** (below the divider):
   - the full id (with Copy), author and committer when they differ, dates, and the full message;
   - parents as links that jump to that commit in the list (or show it on its own if it isn't loaded);
   - for a merge, **Compare with parent** `[1 (main line) ▾]`, default parent 1;
   - the file list (status code, path, `← old` for renames);
   - the focused file's diff, in stage 2's `DiffPane` with a read-only legend (`− old: <parent short id>` / `+ new: <commit short id>`) and no hunk buttons.

**Interaction.**
- ↑/↓ moves through commits, Enter moves focus into the file list, Esc goes back, `/` focuses the search box.
- Selecting a commit loads its details and file list. The first file's diff loads only when a file is focused.
- **Background loading:** after the focused commit, details and file lists for the next five commits are fetched, with at most two history requests in flight. That keeps the 10 s status polls (which share main's concurrency limit of 6) from waiting behind history.
- **Caches** (session, in memory):
  - details and file lists by oid (up to 500 commits);
  - diffs by (oid, parent, path) (up to 200);
  - log pages by (repo, query, tip).

  A new snapshot that shows the worktree's HEAD (or the branch's tip) moved re-reads the visible page in the background. The old rows stay on screen until it arrives, and the focused commit stays focused if it's still in the page.

### Error handling (stage 3)

| Situation | Behaviour |
|---|---|
| Invalid search (empty, too long, newline, path outside the worktree) | Caught in core before any IPC; shown under the search box |
| `log` takes longer than 30 s | The tree is killed. Shows "History took too long - narrow it with a search or a filter." Earlier pages stay on screen. |
| Shallow clone | The history ends where the clone does, with the shallow note; `unpushed` may over-report, and the note says so |
| Unborn branch | "No commits yet"; no git log is run |
| A commit id no longer exists (history rewritten, then gc) | "This commit no longer exists - refresh"; its cache entries are dropped |
| Ref deleted or renamed since the list was read | Main refuses the query ("That branch no longer exists"); the view falls back to the worktree's HEAD, or to the branch list for an inactive branch row |
| Diff over 1 MB, or binary | Stage 2's truncated or binary notice |
| No remotes | `Unpushed` disabled with "No remotes"; no `↑` markers |
| `since base` with no base found | The filter opens its base picker instead of running |

### Residual risk (stage 3)

- Every diff and log uses `--no-ext-diff --no-textconv`, so repository-configured diff programs don't run. Commit-to-commit diffs read objects only, so clean/smudge filters don't run either (they run against the working tree, which stage 3 never compares).
- `log.showSignature=false` keeps gpg from running. A repo's `core.hooksPath` is irrelevant: nothing in stage 3 triggers a hook.
- So stage 3 adds no new exposure to repository-configured programs. The ownership / `safe.directory` question raised in stage 1 stays open for **stage 4**, whose pull, rebase and checkout run filters and hooks.
- Search text reaches git only as the tail of a single `--grep=` / `--author=` element or after `--`; refs and oids only after `--end-of-options`, and only after matching a list main read itself.

### Testing (stage 3)

**Core:**
- `parseLog` on recorded `git log --graph` output: a linear history, a merge, an octopus merge, a criss-cross merge, a root commit, a detached HEAD, tags, remote refs, `HEAD -> branch`, unicode and very long subjects, and a page truncated mid-graph.
- `graphCells` glyphs and lane numbers on the same fixtures.
- `parseSearch`: each prefix, escapes, trimming, the error cases.
- `historyQuery` refusals; `defaultBase` with and without `origin/HEAD`, `main`, `master`.
- `parseCommitDetails` (multi-line message, empty body, different committer) and `parseNameStatus` (renames, copies, type changes, unicode paths).
- Public API.

**IPC (injected spawn):**
- Exact argv for each filter × search combination, including `--end-of-options` placement and `limit + 1`.
- Refusals spawn nothing: a ref not in `for-each-ref`, a base that isn't a branch, a non-hex oid, a parent that isn't one of the commit's parents, search text with a newline, a path outside the worktree, a limit off the 200 step.
- `unpushed` is `null` with no remotes.
- The 8 MB cut lands on a record boundary.
- The global `-c` flags are present on every history call.

**Integration (real git, temporary repos):**
- A repo with a merge, a tag, a pushed and an unpushed commit (a bare "remote" in the temp folder): filters return the right commits, `↑` marks only the unpushed ones, and `since base` matches `git log base..ref`.
- Message, author and path searches with regex characters (`a.b`, `[x]`, `*`) are matched literally.
- Merge-parent diffs: parent 1 vs parent 2 file lists differ as expected.
- A `.bare` layout shows branch history from its bare entry.
- `log.showSignature=true` in the repo's config doesn't run gpg (a fake `gpg.program` that records it was called stays unused).

**UI (jsdom, fake adapter):**
- The Changes | History switch and `view.panel`; an inactive branch row opens History.
- Rows render graph, ref chips and `↑`; connector rows are skipped by ↑/↓.
- Search parsing errors show under the box; Enter runs, Esc clears.
- Filters change the query; "No remotes" disables Unpushed.
- Load more raises the limit and keeps the focused commit.
- Selecting a merge offers parents, and switching parent reloads the file list.
- At most two background requests are in flight; cached commits don't refetch.
- A moved tip re-reads the page and keeps the old rows until it arrives.

**E2E:** the existing smoke test still opens the view (reported as blocked in headless shells).
