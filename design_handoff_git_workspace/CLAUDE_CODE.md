# Git Workspace redesign — Claude Code implementation plan

You are implementing a redesign of the NexusMD desktop **Git Workspace** view in this repo. The new
building blocks are already in the tree (they were dropped in as new files, nothing was overwritten).
Your job is to wire them in, adapt the existing components, and keep every test green.

- Full visual/behaviour spec: `design_handoff_git_workspace/README.md`. Read it first.
- Interactive reference: open `design_handoff_git_workspace/prototype/Git Workspace.dc.html` in a browser
  (it needs `support.js` beside it). The Tweaks `startScreen` jumps to every state. It's a design
  reference with mock data — **don't ship or copy its inline styles**. Use the CSS classes in
  `git-workspace.css` and the theme variables.

## Ground rules
1. Theme variables only (`--surface`, `--accent`, `--danger-soft`…). Never hard-code hex values; every `data-theme` must keep working.
2. Reuse what exists: adapters, `@nexusmd/core` git helpers, `PlModal`, `ActionDialog` kinds, `use-commit.js`, `use-conflict.js`, `.btn`, `.nx-badge`, `.kbd`.
3. Keep accessible names that existing tests rely on (e.g. buttons named Continue / Skip / Abort). When copy changes on purpose, update the tests in the same commit.
4. Run the tests after every step (vitest: core + desktop). Commit per step with a clear message.
5. If something in the spec needs a new git operation in the Electron main process (see step 11), implement it behind the existing ACTION_KINDS / preview pattern, with integration tests like `git.actions.integration.test.js`.

## Files already added (new, self-contained, tested)
| File | What it is |
|---|---|
| `packages/core/src/modules/git/word-match.js` (+test) | `wordMatch`, `filterByWords`, `filterFilesByWords`: match from the start of words only |
| `packages/core/src/modules/git/status-meta.js` (+test) | `BRANCH_FILTERS`, `branchState`, `matchesFilter`, `filterCounts`, `branchMeta`, `repoPills`, `primaryAction` |
| `apps/desktop/src/views/git/git-workspace.css` | All new styles (`nx-gw-*`), theme variables only |
| `apps/desktop/src/views/git/filter-chips.jsx` | `FilterChips`, `BranchSearch` |
| `apps/desktop/src/views/git/branch-list.jsx` | `BranchList`, a drop-in for `RepoCards` (same props + `query`, `filter`, `onClearFilters`) |
| `apps/desktop/src/views/git/attention-overview.jsx` | `AttentionOverview`, the page with nothing selected |
| `apps/desktop/src/views/git/operation-banner.jsx` (+test) | `OperationBanner`, a drop-in for `OperationBar` (same props) |
| `apps/desktop/src/views/git/commit-composer.jsx` (+test) | `CommitComposer`, the inline sticky commit box |
| `apps/desktop/src/views/git/popover-menu.jsx` | `PopoverMenu` for More ▾ and the group ⋯ menu |
| `apps/desktop/src/views/git/output-console.jsx` (+test) | `OutputConsole`: wraps `GitCommandLine` and floats output + activity above it |
| `apps/desktop/src/views/git/use-git-shortcuts.js` | `useGitShortcuts`, the page-level keys |

## Steps

### 1. Core exports
In `packages/core/src/modules/git/index.js` add:
```js
export { wordMatch, filterByWords, filterFilesByWords } from './word-match.js'
export { BRANCH_FILTERS, branchState, matchesFilter, filterCounts, branchMeta, repoPills, primaryAction } from './status-meta.js'
```
Check that `@nexusmd/core` re-exports the git module the same way as the existing git exports. Run the core tests.

### 2. Styles
Find where `devenv-git.css` is imported (the Git Workspace / Dev Environment view entry) and import `./git/git-workspace.css` right after it.

### 3. Header, group tabs, filters
In the Git Workspace view (the component that renders `GroupTabs`, `GitSummary`, `RepoCards` and the detail panel; locate it from the imports of `repo-cards.jsx`):
- Remove the `GitSummary` stat tiles. Add `filter` ('all') and `query` ('') state, and render `<BranchSearch>` + `<FilterChips trees={scoped.worktrees} …>` in a second header row (see README §1 for layout; classes `nx-gw-head`, `nx-gw-head-row`).
- `group-tabs.jsx`: render as the `nx-gw-seg` segmented control. Each tab reads `Label  N repos`. Add a trailing `+ Group`.
- Replace the GroupMenu modal's first screen with `<PopoverMenu label="⋯">` (Edit members…, Rename…, Duplicate…, Delete… [danger]). Keep the existing rename/duplicate/delete modals as the targets.
- Header actions: `Jump to branch… [Ctrl K]`, `Fetch all`, `Pull all (N)`. N = worktrees behind with no changes and no operation. Pull all opens the existing batch `ActionDialog` for pull, **snapshotting the targets at open** so the rows stay visible after they're pulled.

### 4. Branch list
Swap `RepoCards` for `BranchList` (pass `query`, `filter`, `onClearFilters`). Keep `RepoCards` until `repo-cards.test.jsx` has been ported to `branch-list.test.jsx`, then delete it. **Rows must never show `↑0 ↓0`**, and the repo headers show `N branches` plus pills, not a file count.

### 5. Overview (nothing selected)
Render `<AttentionOverview trees={scoped.worktrees} repoCount=… onOpen=… onAction=… onPullAll=… onCommitAcross=…>`. Map `onAction(kind, tree)`:
- `resolve` / `review` → select the worktree (Changes tab)
- `pull` → the pull `ActionDialog` for that worktree
- `push` → the push `ActionDialog`
- `publish` → the push `ActionDialog` with `setUpstream: true`
- `onCommitAcross` → the existing `CommitDialog` with every worktree that has staged files ticked

In the "focus" layout variant (optional, README §3) the overview also gets a full-width table. Skip it unless asked.

### 6. Branch detail header
- Use `primaryAction(tree)` for the accent button (hidden during an operation).
- Add `Fetch`, `Pull…`, `Rebase…` (disabled during an operation), then a `<PopoverMenu label="More ▾">`, then `Terminal`, `Editor`. The More items and their ActionDialog kinds:
  - Branch: `New branch…` (`branch`, hint `b`), `Check out another branch…` (`checkout`)
  - Remote: `Push…` / `Publish…` (`push`)
  - Stash: `Stash changes…` (`stashPush`), `Stashes…` (open `StashList`, hint = count)
  - Worktree: `Add worktree…` (`worktreeAdd`), `Remove this worktree…` (`worktreeRemove`, danger; disabled for the main worktree with a reason)
- Breadcrumb `Overview › repo › worktree`, a `Switch ▾` chip (opens Ctrl+K), path with ellipsis + `Copy path`, and the tracking line (`Tracks origin/x` · `↑a to push · ↓b to pull` / `In sync` · `Fetched …`). The title column keeps `min-width: min(100%, 360px)`; the actions wrap.

### 7. Operation banner
Replace `OperationBar` with `OperationBanner` where it's rendered. Keep `operation-bar.test.jsx` passing until you delete `operation-bar.jsx` together with it. Route `abort` through a confirmation (the ActionDialog `abort` preview): "Puts <branch> back exactly as it was…", warning about resolved conflicts being lost.

### 8. Changes pane + commit composer
- Lay out `nx-gw-changes` (grid) with the file column `nx-gw-files` (scrolls as a whole) and the list in `nx-gw-files-list` (min-height 160px).
- `changes-pane.jsx`:
  - Section headers: `Conflicts` (danger dot + note "Resolve each file, then continue the rebase."), `Staged` (`Unstage all`), `Not staged` (`Stage all`).
  - Rows show a coloured status code, **basename bold + dir muted**, and a per-row `Stage` / `Unstage` / `Resolve` button. Keep the checkbox multi-select, shift-range selection and the s/u/c keys.
- Mount `<CommitComposer tree busy onCommit>` at the bottom of the column. Implement `onCommit({ message, amend, push })` with `use-commit.js` (single target = this worktree). On success with `push`, run the push action (with `setUpstream` when unpublished). Keep the multi-worktree `CommitDialog` for "Commit across branches".

### 9. Diff pane + syntax highlighting
- Header: `nx-gw-diff-head` with a `nx-gw-diff-path` group (path, language tag `nx-gw-lang`, `+n`, `−n`) and a `nx-gw-diff-actions` group (`Unified | Side by side` as `nx-gw-seg sm`, `Stage file`/`Unstage file`, `Discard…`). Side by side uses `diffSides` from core.
- Per-hunk `Stage hunk` / `Unstage hunk` if hunk staging exists; otherwise leave a TODO and file an issue. Don't fake it.
- **Syntax highlighting for every code view** (diff lines, both conflict sides, conflict result, file editor). Use the existing `@lezer/highlight` `classHighlighter` + `.tok-*` colours already in `devenv-git.css`. Pick the parser from the extension: `.cs` → C# (use `@replit/codemirror-lang-csharp` or a legacy `clike` C# mode via `@codemirror/legacy-modes` if no lezer grammar is available), `.ts/.tsx/.js/.jsx` → `@lezer/javascript` (jsx/ts dialects), `.json` → `@lezer/json`, `.sql` → `@codemirror/lang-sql`, `.md` → `@lezer/markdown`, and fall back to plain text. Highlight each line with `highlightTree` and render spans; keep the add/del row backgrounds. Lazy-load the parsers.

### 10. Conflict resolution
`resolve-pane.jsx` per README §8:
- Side cards with `--info` / `--violet` top borders, kicker text from `conflictLabels()`, and `Use theirs` / `Use mine` → `✓ Using this`.
- `Both, theirs first`, `Both, mine first`, `Show markers`, plus a state line.
- Result tinting: theirs `--info-soft`, mine `--violet-soft`, markers `--warning-soft`.
- `Edit result…` opens `file-editor.jsx`. `Mark resolved & next` stages the file and selects the next conflict; it's disabled until resolved, with a reason.
- `non-text-conflict.jsx`: a "deleted upstream" pill and two big option cards.

### 11. History
`history-pane.jsx` / `commit-detail.jsx`:
- A graph rail with yours = `--violet`, upstream = `--info`, and the divider labels "Your commits · being rebased" / "On origin/master".
- Detail actions `Copy hash`, `Cherry-pick…`, `Revert…` (existing `revert` kind), and `Reset to here…`.
- If `cherryPick` / `reset` kinds don't exist in `packages/core/src/modules/git/actions.js` and the Electron IPC, add them following the existing preview → confirm → run pattern:
  - reset: soft / mixed / hard radio. Hard needs `RESET` typed, using the existing `TYPED` map.
  - cherry-pick: target worktree select + `-x` checkbox.

Add integration tests next to `git.actions.integration.test.js`.

### 12. Command bar + output console
Wrap `GitCommandLine` in `<OutputConsole lines activity onClear onClearActivity hint>`.
- `lines` = this session's command runs: one `{ text: '$ git …', tone: 'cmd' }` line, then stdout lines (stderr `tone: 'bad'`).
- `activity` = `sync.activity`.
- Remove `ActivityDrawer`.
- Keep the alias menu as is (it already portals to `document.body`).

The output panel floats and **must not change the page layout**. Check it at 924×540 and 1440×900.

### 13. Filtering by word starts
- Use `wordMatch` for the branch filter (`repo branch worktree`), Ctrl+K and the group editor filter (`GroupDraft.rows(filter)`; change its matching to `wordMatch` and update `group-draft.test.js`).
- Switch `go-to-file.jsx` to `filterFilesByWords`. Keep `filterFiles` exported, since its tests stay.

### 14. Shortcuts
Call `useGitShortcuts` in the view:
- Ctrl/⌘K → jump to branch (a palette like `go-to-file.jsx` listing worktrees)
- Ctrl/⌘P → go to file
- `/` → filter, `` ` `` → command input
- j / k → next / previous visible worktree
- b → New branch

Show `.kbd` hints next to the controls.

### 15. Verify
- All vitest suites pass, and lint is clean.
- Manually, with a repo mid-rebase that has conflicts, a dirty branch, one behind, one ahead, one unpublished and one with a deleted upstream, walk every state with the prototype side by side:
  - Overview, the branch list, filters and search
  - Detail with More ▾
  - The banner, Changes, the composer (and its disabled hints)
  - The diff unified and side by side, highlighting in each language
  - Conflicts (text and non-text), History actions, every dialog in the README table
  - Console minimise, expand and jump-to-latest
- Check two themes (default parchment + one dark one, e.g. `noir`) for contrast and hard-coded colours.
