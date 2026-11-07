# UI Update: Git Workspace v2 + Regex Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `ui_update/` design handoff in the real React code: the Git Workspace layout pass (G1–G4, screens 1b/2a/2b/2c/3a/3b) and the Documents › Regex Tester redesign (R1–R3), with every theme (`data-theme`) still working.

**Architecture:** Shared primitives first (`Segmented`, `CollapsibleRail`, icons, persisted rail state), then four phases that each ship as their own branch/PR and leave the app working: (1) Git chrome, (2) Git Changes screens + commit rail, (3) Git Files tabs, (4) Regex Tester. All existing behaviour stays; layout, copy and the controls named in the spec change. Styles go in `git-workspace.css` (`nx-gw-*`) and a new Regex stylesheet; theme variables only, never hex.

**Tech Stack:** React 18 (JSX), Vitest + Testing Library (jsdom), npm workspaces. Git module: `modules/git/src/renderer/` (renderer), `packages/core/src/modules/git/` (pure logic). Regex/Documents: `packages/ui/src/views/`.

**Spec:** `ui_update/README.md` (design reference boards and screenshots beside it: `ui_update/*.dc.html`, `ui_update/screenshots/*.png`). Token map in the README's *Design tokens* table is authoritative.

## Conventions used below

- `GR` = `modules/git/src/renderer`. `UIV` = `packages/ui/src/views`.
- **Task protocol** (applies to every task; steps below name only what is specific): write the listed tests first and run them to see them fail for the stated reason; implement; run the same command to see them pass; then run the phase gate command; commit with a `feat(git):` / `feat(ui):` / `test:` message ending with the attribution line from the session's system-reminder.
- Test commands: Git → `npm run test:git` (core + git projects). Documents/Regex → `npx vitest run packages/ui/tests/regex-tester.test.jsx packages/ui/tests/documents-view.test.jsx`. Whole suite before each phase's last commit → `npm test`.
- Existing tests that assert old copy/structure are updated **in the same commit** as the change that breaks them (keep accessible names where the spec doesn't change them: Continue / Skip / Abort, "Commit summary", "Diff", "Fold repositories").
- Never hard-code hex. Map prototype variables with the README table (`--container-bg`→`--surface`, `--accent-muted`→`--accent-soft`, `--*-bg`→`--*-soft`, etc.). `GROUP_COLORS` in the regex view is the one existing fixed palette.

## Global Constraints

- Top bar 48px, `--surface`, 1px bottom `--border`, padding `0 16px`, gap 14, nowrap (G1, R1).
- Branch list column **272px** default (was 330); rail **290px** default, **40px** collapsed; lane/changes column **320px**; min pane width stays 240 where `PaneResizer` is used.
- Rail collapse animates `grid-template-columns` over `.22s cubic-bezier(0.4,0,0.2,1)`; collapsed strip is clickable (hover `--surface-2`), vertical label `writing-mode: vertical-rl; transform: rotate(180deg)`, 600 10.5px uppercase muted. Persisted per tab kind `changes` / `files` / `github-files` (Git, in the git config `view`) and `regex_tester_rail` (Regex). Shortcut `Ctrl+]`.
- Collapsed labels: `Commit · N staged`, `Last commit`, `Rebase i of n`, `File details`; Regex: `Matches · 3` / `Code · Python` / `Tests · 3 pending`.
- Type: eyebrows 10.5px/600/.08em uppercase; meta 11–11.5; UI 12–12.5; titles 14–16. Buttons 26px (header/inline), 28px (top bar), 30–32px (rail). Radii 4/5/6/7/8 as the README lists.
- Chips show only when count > 0 (plus All). Rows never show `↑0 ↓0`.
- Every disabled button carries a `title` saying why.
- `ROWS_SHOWN` (300) virtualisation in the changes lanes stays.
- Regex: `Substitution` is renamed **Replace** in the UI; stored mode value stays `'sub'`. Flags order `g i m s u`.
- Keys kept: `s`/`u` (stage/unstage), `c` (focus summary), `/` (focus branch filter), `Ctrl K`, `Ctrl P`, `Ctrl+Enter` (commit, from anywhere in Changes while the summary is valid), `Esc` clears a lane/branch filter, `Ctrl+↑/↓` steps regex matches.

## Decisions I made where the handoff is silent (change these before executing if you disagree)

1. **One top bar for Git = the shell's existing `topbar` slot.** The desktop shell already draws icon + `Git Workspace` + the Local/GitHub switch (`GitTopbar`). Rather than hide the shell header, `GitTopbar` also renders the right-hand controls (fetched status, Jump, Fetch all, Pull all, plus two icon buttons below), fed by a store like `githubMode`. The shell header gets `minHeight: 48`. The page keeps drawing the same bar inline only when the shell is too old to (existing `topbarShowsMode` fallback).
2. **Refresh and "Hide/Show repositories"** (not in G1) become 28×28 icon buttons at the right end of the top bar (`Refresh`, `Hide repositories`/`Show repositories` titles and aria-labels preserved).
3. **Documents bar (R1)** is drawn inside `DocumentsView` under the shell's title row (web/app/desktop shells differ, so the shell is untouched): segmented tabs on the left, save state on the right, without repeating the `Documents` title.
4. **Command line Run button is dropped** (G4 doesn't list it; Enter runs). Hint row removed; cwd goes in the field's `title`.
5. **GitHub "open PR touches this file"** needs each open PR's changed files, which the loaded PR list doesn't have. Fetch `repos/{repo}/pulls/{n}/files` lazily for at most the 10 most recently updated open PRs when the first file is picked, cache per repo+refresh.
6. **`ui_update/` is committed as reference material** (Task 0) like `design_handoff_git_workspace/`.

## Review Focus

Failure modes the spec implies but no screen description tests; each has a pinning test in the owning task (marked **Pins**).

1. A new persisted key silently dropped: `normalise()` in `git-config.js` discards unknown `view` keys, so `railOpen` / `laneMode` would never survive a reload (Task 1).
2. A file changed in both areas (`MM`) appears in Staged **and** Not staged with different ids; `Stage 3 ↓` / `Unstage 3 ↑` must count only the selected ids that belong to that lane, and never double-count the path (Task 6).
3. 50,000 untracked files in Folders mode: grouping must be a single pass and rendering stays bounded by `ROWS_SHOWN` per folder, including a focused row that sits past the cut (Task 7).
4. A paused rebase whose `operationInfo` is null (older snapshot) or has no `step/total`: the rail must still show Continue/Skip/Abort and a label without `i of n`, not crash (Task 9). Likewise a merge hides `Skip this commit`.
5. Regex input that the browser rejects or mis-parses: unclosed `(` / `[`, empty pattern, `(?<n>…)` named groups, and empty matches like `a*` (no infinite loops, no thrown render errors, no highlights when invalid) (Tasks 14, 16).
6. Narrow window: top bar is nowrap with a long group name and Windows window controls beside it; it must shrink the group picker with an ellipsis rather than overflow (Task 3).

---

## Phase 0 — Setup and shared primitives

### Task 0: Branch and reference material

**Files:** Create branch `feat/ui-update-redesign`; add `ui_update/` and this plan.

- [ ] `git switch -c feat/ui-update-redesign` from `master`.
- [ ] `git add ui_update docs/superpowers/plans/2026-11-07-ui-update-git-workspace-and-regex-tester.md` and commit `docs: UI update handoff (Git Workspace v2, Regex Tester) and implementation plan`.

### Task 1: Rail state, `CollapsibleRail`, `Segmented`, icons

**Files:**
- Modify: `GR/git-config.js` (`normalise` adds `railOpen`, `laneMode`; export `DEFAULT_RAIL_OPEN`), `packages/ui/src/icons.jsx` (add `panel-right-close`, `panel-right-open`, `terminal`), `packages/ui/src/index.js` (export new components)
- Create: `packages/ui/src/collapsible-rail.jsx`, `packages/ui/src/segmented.jsx`, `GR/use-rail.js`, tests beside each (`*.test.jsx`/`*.test.js`), `GR/git-config.test.js` additions
- Modify: `GR/git-workspace.css` (`nx-gw-rail*`, `nx-seg*`), shared base styles for `.nx-seg` in `packages/ui/src/styles/base.css`

**Interfaces — Produces:**
- `CollapsibleRail({ open: boolean, onToggle: () => void, label: string, side?: 'right', children })` renders the full-height rail wrapper **inside a grid column the parent sizes**; when `!open` renders the 40px strip (button, `aria-expanded=false`, `aria-label={`Show ${label}`}`, vertical label). When open, children plus a 24×24 hide button (`aria-label="Hide panel"`, title `Hide panel (Ctrl+])`) rendered top-right via the exported `RailHideButton`.
- `railColumns(open: boolean, width: number): string` returns `'minmax(0,1fr) ${width}px'`-style fragment: `${open ? width : 40}px`, used by parents inside their `grid-template-columns`; parents set `transition: grid-template-columns .22s cubic-bezier(0.4,0,0.2,1)`.
- `Segmented({ options: {id,label}[], value, onChange, ariaLabel, size?: 'md'|'sm' })` roles `tablist`/`tab` with `aria-selected` (so existing tests that query `tab` still find them).
- `useRail(kind: 'changes'|'files'|'github-files'): { open: boolean, toggle(): void }` reads/writes `getGitConfig().view.railOpen[kind]` (default true), and binds `Ctrl+]` while mounted (ignored when a modal `[aria-modal="true"]` is open).
- `getGitConfig().view.railOpen`: `{ changes: boolean, files: boolean, githubFiles: boolean }`; `view.laneMode`: `'folders' | 'flat'` (default `'folders'`).

- [ ] Tests (`git-config.test.js`): saved `{view:{railOpen:{changes:false}}}` reads back `railOpen.changes === false` and the other two `true`; garbage (`railOpen: 5`, `laneMode: 'x'`) normalises to defaults. **Pins Review Focus 1.**
- [ ] Tests (`collapsible-rail.test.jsx`): collapsed strip is a button named `Show Commit`, click calls `onToggle`; open state renders children and a `Hide panel` button; label text is present for the vertical label; `railColumns(false, 290) === '40px'`.
- [ ] Tests (`use-rail.test.js`): `toggle()` persists to localStorage and survives a re-render; `Ctrl+]` toggles; `Ctrl+]` with an `aria-modal` element in the document does nothing.
- [ ] Tests (`segmented.test.jsx`): clicking a tab calls `onChange(id)`; the active tab has `aria-selected="true"`.
- [ ] Implement the above; CSS uses tokens only.
- [ ] Commit.

---

## Phase 1 — Git chrome (G1–G4)

### Task 2: Branch list column (G2)

**Files:** Modify `GR/branch-list.jsx`, `GR/filter-chips.jsx`, `GR/group-tabs.jsx` (becomes `GroupPicker`), `GR/git-config.js` (`LIST_WIDTH = 272`), `GR/git-workspace.css`, `GR/view-git.jsx` (mount); tests `branch-list.test.jsx`, `view-git.test.jsx`, `stage4-ui.test.jsx`.

**Interfaces:**
- Produces `GroupPicker({ tabs, active, onSelect, onNew, busy })`: a 28px button `NexusMD  1 repo ▾` (active name + `repos(n)` muted) that opens a `PopoverMenu` listing every tab (`role="menuitemradio"`, checked = active); `+` 28×28 icon button `aria-label="New group"` (title = `busy` reason when disabled). Replaces `GroupTabs`; keep the GitHub tab out of this (it stays the mode switch).
- `BranchList` gains the top of the column: props `{ groupPicker: ReactNode, searchRef, query, onQuery, filter, onFilter, trees }`; renders in order: picker row, filter field (`BranchSearch`, 28px, placeholder `Filter branches`, `/` kbd), chips (`FilterChips` only entries with `counts[f.id] > 0`, always `all`), then the repo groups. `FilterChips` keeps clicking the active chip back to All.
- Repo header: caret, name (600 11px .08em uppercase `--accent`), `N branches`, right-aligned status pill(s) (`repoPills`, 18px, nowrap). Branch row: grid `8px 1fr`, gap 9, padding `6px 8px`, radius 7; selected = `--accent-soft` + 1px `--accent-border`.

- [ ] Tests: with counts `{all:3, dirty:0, behind:2}` only `All` and `Behind` chips render; a chip with count 0 never renders even when it is the active filter (falls back to All via `onFilter('all')`). Group picker lists all groups and calls `onSelect(name)`; `+` calls `onNew`; `busy` disables it with the reason as `title`. `/` still focuses the filter (existing `use-git-shortcuts` test).
- [ ] Implement; `view-git.jsx` stops rendering `GroupTabs`/`BranchSearch`/`FilterChips` in the header (Task 3 removes the header) and passes them into `BranchList`.
- [ ] Commit.

### Task 3: One top bar (G1)

**Files:** Modify `GR/github/github-mode.jsx` (add `gitBar` store, `GitTopbarControls`), `GR/view-git.jsx` (remove `nx-gw-head`, publish bar state), `apps/desktop/src/main.jsx` (header `minHeight: 48`), `GR/git-workspace.css`; tests `github-mode.test.jsx`, `view-git.test.jsx`.

**Interfaces — Produces:**
- `gitBar` store (same shape as `githubMode`: `get/publish/subscribe/reset`) holding `{ active: boolean, onGithub, repoNote: string|null, status: {text, tone}|null, canJump: boolean, onJump, onFetchAll, fetchDisabled: boolean, pullCount: number, onPullAll, onRefresh, listHidden, onToggleList }`.
- `GitTopbarControls({ bar })` renders, left→right: `repoNote` (GitHub mode only, 12px muted), spacer (`flex:1`), `● {status.text}` (7px dot, `--success`/`--info`), `Jump to branch…` + `Ctrl K` kbd (min-width 170, 28px), `Fetch all` (secondary 28px), `Pull all (N)` (ghost, 0.6 opacity and `disabled` when N = 0, title explains), icon buttons `Refresh` and `Hide repositories`/`Show repositories`.
- `GitTopbar({ view })` returns `[ModeSwitch, GitTopbarControls]` when `view === 'git'` (the switch only when GitHub is available); `ViewGit` publishes into `gitBar` in an effect and resets on unmount; with `!topbarShowsMode` it renders `GitTopbarControls` + `ModeSwitch` itself in a `nx-gw-bar` row.
- GitHub mode: bar shows only `repoNote`, no Jump/Fetch/Pull/list buttons.

- [ ] Tests: publishing `{pullCount:0}` renders `Pull all (0)` disabled with a title; `pullCount:3` enabled and click calls `onPullAll`; Jump disabled when `canJump` false; GitHub mode renders the note and none of Jump/Fetch/Pull. `ViewGit` (existing harness) shows no `.nx-gw-head` rows and still reaches Fetch all → opens the fetch dialog, Pull all → opens the batch pull dialog with targets snapshotted. **Pins Review Focus 6:** a 60-char group name in `GroupPicker` truncates with `text-overflow: ellipsis` (style assertion) and the bar has `flex-wrap: nowrap`.
- [ ] Implement; delete the dead `nx-gw-head*` CSS.
- [ ] Commit.

### Task 4: Branch header in two rows (G3)

**Files:** Modify `GR/branch-header.jsx`, `GR/worktree-panel.jsx` (stops rendering its own `nx-gw-tabs` row; passes `panel`, `onPanel`, `count`, `onGoTo`, `focusLayout` to `BranchHeader`), `GR/popover-menu.jsx` unchanged, CSS; tests `branch-header.test.jsx`, `worktree-panel.test.jsx`.

**Interfaces:**
- `BranchHeader` new props: `panel`, `onPanel(id)`, `changeCount`, `onGoTo()`, `focusLayout: boolean` (true when `view.list === 'hidden'`; breadcrumb row shows only then).
- Row 1: branch name (600 16px), `Switch ▾` chip, meta group (`origin/master`, sync state `In sync` success / `Rebasing onto origin/master` danger / `↑n ↓n`, mono worktree path + copy icon button `aria-label="Copy path"` (click copies; title shows `Copied` for 1.5s else the full path), `from X ▾` source button, locked/stale/operation badges inline), spacer, `Fetch`, `Pull…`, `Rebase…`, `More ▾` (26px), divider, 26×26 icon buttons `Terminal`, `Editor` (aria-label + title kept). The contextual primary (`primaryAction`) stays first in the action group.
- Row 2: `PanelSwitch` (Changes `N`, History, Files; 32px, active 2px `--accent` underline) and right-aligned `Go to file [Ctrl P]` ghost. `PanelSwitch` export is unchanged.
- Pull/Rebase `disabled` with the existing busy `title` during an operation (0.45 opacity).

- [ ] Tests: row 1 contains the branch name, `Switch`, `Fetch`, `Pull…`, `Rebase…`, `More`; no `Overview ›` breadcrumb unless `focusLayout`; Copy path button writes `tree.path` to the clipboard; during `tree.operation` Pull/Rebase are disabled with the `Finish or abort the … first` title; tabs are in the header (`getByRole('tab', {name: /Changes 3/})`); `Go to file` calls `onGoTo`.
- [ ] Implement; remove the now-duplicate tab row from `WorktreePanel`.
- [ ] Commit.

### Task 5: Command bar in one row (G4)

**Files:** Modify `GR/git-command-line.jsx`, `GR/view-git.jsx` (`CommandDock` unchanged otherwise), CSS; tests `git-command-line.test.jsx`.

**Interfaces:** `GitCommandLine` keeps its props. Layout: one 42px row `lead` (the Output chip), input field (flex 1, 28px, `git ›` prompt, placeholder, `` ` `` kbd, `title={path}` on the field), quick chips `status`, `log -5`, `stash` (24px, mono 11.5), `Aliases N ▴` (`aria-haspopup="menu"`). `switch -c` quick chip stays (it fills, not runs). No Run button, no hint row; Enter runs; `Esc minimises output` hint text goes in the input's `title`.

- [ ] Tests: no element contains `Enter to run`; input has `title` equal to the cwd; Enter runs `git status` → `onRun(['status'])`; the `Aliases (N)` menu still lists DotFiles/git aliases and fills the input; the quick chip `log -5` runs `git log --oneline -5`.
- [ ] Implement; update tests that clicked `Run`.
- [ ] Phase gate: `npm test`. Commit; open PR "Git Workspace chrome (G1–G4)".

---

## Phase 2 — Changes screens (1b, 2a, 2b, 2c)

### Task 6: Lanes and selection (1b left column)

**Files:** Modify `GR/changes-pane.jsx` (rewrite layout), `GR/context-menu.jsx` (no API change), CSS; Create `GR/change-selection.js` (+ test); tests `changes-pane.test.jsx`.

**Interfaces — Produces:**
- `nextSelection({ ordered: Change[], selected: string[], focusId: string|null }, id: string, mods: { shift: boolean, ctrl: boolean }): string[]` — plain click → `[id]`; ctrl/⌘ → toggle `id`; shift → range from `focusId` to `id` (existing `rangeSelection`); Space on the focused row toggles it (same as ctrl).
- `ChangesPane` props unchanged except it no longer owns the composer (Task 8) and gains `laneFilter`, `onLaneFilter`, `laneMode`, `onLaneMode` (Task 7). Sections are two lanes (`Not staged` = unstaged+untracked, `Staged`), plus `Conflicts` (Task 9) on top during a conflict. Lane header 34px: title (600 10.5 .08em), count, right action `Stage all ↓` / `Unstage all ↑` or, when ids of that lane are selected, `Stage 3 ↓` / `Unstage 3 ↑`; Staged header `--success-soft` fill + `--success` title. Row: grid `14px | 1fr | 22px`, 28px high; status letter, basename (`title` = full path), 22×22 move button on hover/focus (`aria-label` `Stage {path}` / `Unstage {path}` kept). **No toolbar, no checkboxes.**
- Row context menu always exists: `Stage`/`Unstage`, `Discard…` or `Delete…` (for a multi-selection acts on all selected ids via `onAction(action, ids)`), then the existing popout items when `onPopout` is given.
- Keys: `s`/`u` stage/unstage selection, `c` focus summary, ArrowUp/Down, Space, Esc clears the lane filter.

- [ ] Tests: `nextSelection` table (plain, ctrl toggle on/off, shift range both directions, shift with no focus); lane header reads `Stage 2 ↓` after selecting two unstaged rows; a path changed in both areas (ids `a:staged`, `a:unstaged`) selected in Not staged yields `Stage 1 ↓` and the Staged lane header still reads `Unstage all ↑` (**Pins Review Focus 2**); no `checkbox` role in the pane; context menu on a selection of 3 offers `Discard 3 files…`-style item that calls `onAction('discard', ids)`; `s` key calls `onWrite('stage', ids)`.
- [ ] Implement; delete `Section` checkbox/indeterminate logic, `VERB`/`NONE`/toolbar code. Keep `ROWS_SHOWN`, drafts marker (`●` Unsaved edits), submodule and rename display, conflict row takes.
- [ ] Commit.

### Task 7: Large change sets (2c)

**Files:** Create `GR/change-folders.js` (+ test); modify `GR/changes-pane.jsx`, `GR/view-git.jsx` (holds `laneFilter`/`laneMode` per worktree like `selections`), CSS.

**Interfaces — Produces:**
- `groupByFolder(changes: Change[]): { path: string, count: number, letter: string, files: Change[] }[]` — single pass over input; `letter` is the dominant status letter (ties broken by severity U > D > M > A > ?); folder `path` is the file's directory with trailing `/` (`''` → `./`).
- `filterChanges(changes, query): Change[]` using core `wordMatch` against `path`.
- Lane with `changes.length > 50` shows a second header row: filter field (26px, `Filter files`, Esc clears) and `Folders | Flat` `Segmented` (20px). Folders: folder row (chevron, dominant letter, path 500 12.5, file count right mono muted) expands to file rows indented 24px with `+a −b` when diff stats are known (else omitted); a trailing `Show N more in this folder` row replaces `Show N more`. Selecting a folder row calls `onFocusFolder({ path, area })`; the centre shows a folder header (`apps/web/dist/  142 untracked files`, `Delete...`, `Stage folder`) and `Folder selected — pick a file inside it…`.
- Staged lane uses the same grouping at the same threshold.

- [ ] Tests: `groupByFolder` counts and dominant letter; 50,000 untracked files group in one call and `ChangesPane` mounts with at most `ROWS_SHOWN` file rows per expanded folder, and a focused file at index 10,000 is still rendered (**Pins Review Focus 3**); filter `ap web` narrows to matching folders; `laneMode` toggles and persists via config (Task 1); `Stage folder` calls `onWrite('stage', idsOfFolder)`.
- [ ] Implement; keep `Show N more` behaviour per folder.
- [ ] Commit.

### Task 8: Diff header and hunks (1b centre)

**Files:** Modify `GR/diff-pane.jsx`, CSS; tests `diff-pane.test.jsx`.

**Interfaces:** `DiffPane` props unchanged, plus `folder?: { path, count, kind }` for the folder header variant (`onFolder(action)` for `stage`/`delete`). Header 42px: basename (600 12.5 mono), dir (11.5 muted ellipsis), `+n` success / `−n` danger, spacer, `Discard...` (danger ghost; `Delete...` when untracked), `Stage file`/`Unstage file` (secondary 26px), Unified/Split toggle kept. Hunk header 28px `--surface`: range + context (11px mono `--accent`), right `Stage hunk` (500 11.5 accent). Lines: grid `40px 40px 18px 1fr`, 12px/20px mono, line numbers at 0.6 opacity (`--text-subtle`), del `--danger-soft`, add `--success-soft`. The `− old / + new` legend row is removed outside History (`readOnly` keeps it). Accessible names `Discard file…`, `Delete file…`, `Hunk N`, `Diff` stay.

- [ ] Tests: header shows basename and dir separately; `Discard...` present for unstaged, `Delete...` for untracked, none for a conflict; split toggle still switches to `diff-pair` rows; no legend when not `readOnly`; folder variant renders `142 untracked files` and calls `onFolder('stage')`.
- [ ] Implement.
- [ ] Commit.

### Task 9: Commit rail, last commit, rebase rail, panel layout (1b right, 2a, 2b)

**Files:**
- Create: `GR/commit-rail.jsx` (+ test), `GR/use-last-commit.js` (+ test), `GR/rebase-rail.jsx` (+ test)
- Modify: `GR/commit-composer.jsx` (kept for the Commit dialog's reuse only if referenced; otherwise delete and port its tests), `GR/worktree-panel.jsx` (grid `320px | minmax(0,1fr) | rail`), `GR/operation-banner.jsx` (not rendered in split layout when the rail shows the operation; kept for focus layout), `GR/resolve-pane.jsx` (conflict header unchanged), CSS; tests `worktree-panel.test.jsx`, `view-git.test.jsx`, `commit-composer.test.jsx`→`commit-rail.test.jsx`.

**Interfaces — Produces:**
- `CommitRail({ tree, busy, onCommit })` — same `onCommit({ message, amend, push })` contract as `CommitComposer`. Content top→bottom: eyebrow `COMMIT TO {branch}`; summary input 32px (`aria-label="Commit summary"`, `n/72` counter with the existing warn/bad thresholds); description textarea always visible 150px (`aria-label="Commit description"`); summary card (`N files  +a −b`; `Pushes to {upstream}` or `Not published yet`); `Amend last commit` checkbox; spacer; hint line (`Write a summary to commit` / `Stage files first`, `--warning` 11.5px) when disabled; primary `Commit N files  Ctrl ⏎` (32px); secondary `Commit & push` / `Commit & publish` / `Amend & push` (30px). `Ctrl+Enter` anywhere inside `.nx-gw-changes` (listener on that container) commits when valid. Clears on worktree change.
- `useLastCommit({ adapter, repo, cwd, registered, tree, version }): { loading, commit: { oid, subject, when: number, pushed: boolean, files: number, add: number, del: number } | null }` using `adapter.log(repo, cwd, registered, { ref:'HEAD', limit: <HISTORY_STEP> })` (first record) and `adapter.commitFiles`; `pushed = !!tree.upstream && !tree.upstreamGone && tree.ahead === 0`.
- Clean tree (2a): the rail shows `LAST COMMIT` eyebrow + card (subject 600 13; `hash · 2 hours ago · pushed`, hash mono `--accent`; `N files  +a −b`), `Amend message...` (secondary → existing `commit-message-dialog`) and `View in History` (ghost → `onShowInHistory({ oid })`, wired to `showInHistory`). Lane bodies: not-staged = check badge + `Working tree clean` + `Edits to files on {branch} appear here.`; staged = `Nothing staged.`; centre `No diff to show.`.
- `RebaseRail({ tree, resolved, total, onAction })` (2b): `REBASE IN PROGRESS` eyebrow (`--warning`), `Rebasing onto {onto}`, card `Commit {step} of {total}` + step bar (one flex segment per commit, 5px: done success / now warning / todo `--surface-3`), `{resolved} of {total} conflicts resolved` (danger → success when all), paused note, `Continue rebase` (primary; disabled with title `Resolve N remaining conflicts first`), `Skip this commit` (hidden for merges), `Abort rebase...` (danger ghost → existing confirm via `onAction('abort')`). `onAction(kind)` is the existing `operation(kind)` in `WorktreePanel`, so unsaved-edit prompts still fire.
- Conflicts lane (2b): header `--danger-soft`/`--danger`, note `Resolve each file, then continue the {op}.`, rows `U`, basename, right `N blocks`/`1 block left` (block counts come from the existing conflict hook's parse when available; otherwise omitted).
- `WorktreePanel` `Changes` body: `display:grid; grid-template-columns: ${files.width}px minmax(0,1fr) ${railColumns(open, 290)}` using `useRail('changes')`; collapsed label `Commit · N staged` / `Last commit` / `Rebase i of n`. Rail tint/content swaps by state: operation → `RebaseRail`, clean → last commit, else `CommitRail`.

- [ ] Tests (`commit-rail`): Commit disabled with hint `Write a summary to commit` when staged>0 and no summary; hint `Stage files first` when nothing staged and not amending; `Ctrl+Enter` inside the changes container commits with `message = "summary\n\ndescription"`; `Commit & publish` label when no upstream, `Amend & push` when amending; draft clears on worktree change; description textarea is always rendered.
- [ ] Tests (`use-last-commit`): fake adapter returns one log record + files; `pushed` false when `ahead>0`; returns `commit: null` for an empty repo.
- [ ] Tests (`rebase-rail`): `Continue rebase` disabled with title `Resolve 2 remaining conflicts first`; enabled at 0; `Skip this commit` absent for `kind: 'merge'`; step bar renders `total` segments with the right done/now/todo split; **Pins Review Focus 4:** `operationInfo: null` and `{kind:'rebase'}` without step/total render Continue/Skip/Abort and a label `Rebase` without `i of n` (collapsed label too), no throw.
- [ ] Tests (`worktree-panel`): collapsing the rail (button, strip click, `Ctrl+]`) hides the form and persists; existing resolve flow, Skip/Abort confirm and `Unsaved edits kept` note still pass.
- [ ] Implement; remove `OperationBanner` from split layout (keep for focus layout).
- [ ] Phase gate: `npm test`; manual compare with `ui_update/screenshots/1b-changes.png`, `2a-clean.png`, `2b-rebase.png`, `2c-large.png` using the `apps/desktop:verify` skill. Commit; open PR "Git Changes redesign (1b, 2a–2c)".

---

## Phase 3 — Files tabs (3a, 3b)

### Task 10: Explorer tree, pins and filter (3a tree column, 3b filter)

**Files:** Modify `GR/file-explorer.jsx`, `GR/files-pane.jsx`, `GR/file-marks.js`, CSS; Create `GR/use-recent-files.js` (+ test); tests `file-explorer.test.jsx`, `files-pane.test.jsx`.

**Interfaces:**
- `FileExplorer` new props: `pins?: ReactNode` (rendered above the tree: `Changed N`, `Recent`, each with a 600 10.5 uppercase muted label), `railFor?(path|null): ReactNode`, `railOpen`, `onRailToggle`, `highlightMatches: boolean`. Rows 22px, indent 12px/level, chevron 9px, folder icon `--accent` .8 opacity, file icon muted, folders holding changes show the existing 6px dot. Filter 26px + collapse-all icon, **word-start match** via core `filterFilesByWords`-style per path (replace the substring `matching()`); with `highlightMatches` matched word starts are wrapped in `<mark>` (`--accent-soft` bg, `--accent` text, radius 2). Footer count: `N of M files match` while filtering.
- `useRecentFiles(worktreeKey: string): { recent: { path, openedAt }[], touch(path): void }` — module-level `Map`, session only, last 3, newest first, de-duplicated.
- Pins (local only): `Changed N` rows 22px (letter, staged tinted success, basename, short dir 11px muted; click = pick); `Recent` (clock icon, name, relative time).

- [ ] Tests: word-start filter (`src comp` matches `src/components/Button.jsx`, `rc` alone does not match mid-word) — the old substring behaviour is replaced; `<mark>` wraps only the matched word starts; `useRecentFiles` keeps three, newest first, dedupes; Changed pin click picks the file and expands its folders; existing keyboard navigation tests still pass.
- [ ] Implement.
- [ ] Commit.

### Task 11: Preview path bar, File|Diff, status footer, changed-line tint

**Files:** Create `GR/file-stats.js` (+ test), `GR/path-bar.jsx` (+ test); modify `GR/file-preview.jsx`, `GR/files-pane.jsx`, `packages/editor-kit/src/code-editor.jsx` (optional `markedLines: number[]` prop with a `warning-soft` line class and a 2px `--warning` gutter edge), CSS.

**Interfaces — Produces:**
- `fileStats(text: string, path: string): { language: string, lines: number, bytes: number, eol: 'LF'|'CRLF'|'Mixed'|'None', encoding: 'UTF-8' }`.
- `PathBar({ segments: string[], children })` 40px, breadcrumb crumbs (last 600 `--text`, separators `›`), crumbs shrink and fade at the right edge; `children` on the right (`File | Diff` `Segmented`, branch picker for 3b).
- `TextPreview` gains `markedLines`, `footer` (26px status: language, lines, size, EOL, encoding). `File | Diff` shows the same `DiffPane` as Changes (only when the file is changed), `fileView` kept per worktree in explorer view state.
- `markedLines` are the new-side line numbers of added lines from `useDiff` for the picked file.

- [ ] Tests: `fileStats` on LF, CRLF, mixed, empty, and 1 MB text; `PathBar` renders all segments with `aria-current` on the last; Diff tab hidden for an unchanged file; footer text for a 12-line LF file; `markedLines` adds the changed-line class to exactly those lines (editor-kit test).
- [ ] Implement.
- [ ] Commit.

### Task 12: Local file rail (3a)

**Files:** Create `GR/use-file-history.js` (+ test), `GR/file-rail.jsx` (+ test); modify `GR/files-pane.jsx` (grid `290px | 1fr | rail` via `useRail('files')`), `GR/file-explorer.jsx`; tests `files-pane.test.jsx`.

**Interfaces — Produces:**
- `useFileHistory({ adapter, repo, cwd, registered, path, version }): { commits: { oid, subject, when }[]|null, error }` using the existing `adapter.log` with `search: { kind: 'path', text: path }`, keeps the first 3.
- `FileRail({ path, change, commits, onViewDiff, onStage, onUnstage, onDiscard, onOpenCommit, onEdit, elsewhere, onReveal, onNewWindow })`: basename (600 14) + dir (11 mono muted); status card when changed (tinted by tone; `Modified · not staged  +9 −5`, note, `View diff`, `Stage`/`Unstage`, `Discard...`); `RECENT COMMITS` (subject 12.5, `hash · when`; click → `onOpenCommit(oid)` switching to History at that commit); spacer; `Edit here  Enter` (primary), `{elsewhere.label}` (secondary; `Open in VS Code` from `openElsewhere`), `Show in Explorer` + `New window` (ghost, side by side). These replace `PreviewHead` actions; drag-and-drop import and context menus unchanged. Collapsed label `File details`.

- [ ] Tests: rail hidden label `File details`; changed file shows status card and `Stage` calls the write path; unchanged file shows no card; history click calls `onOpenCommit`; `Enter` on the picked file still calls `onOpenFile`; dropping files on a folder row still imports (existing test).
- [ ] Implement.
- [ ] Commit.

### Task 13: GitHub Files, repo header (3b)

**Files:** Modify `GR/github/github-files.jsx`, `GR/github/github-repo-pane.jsx`, `GR/github/github-tab.jsx` (repo header), `GR/github/github-ui.jsx`; Create `GR/github/use-file-prs.js` (+ test), `GR/github/github-file-rail.jsx` (+ test); tests `github-files.test.jsx`, `github-repo-pane.test.jsx`, `github-tab.test.jsx`.

**Interfaces — Produces:**
- Path bar: branch picker button first (`⑂ main ▾`, 24px secondary, a `PopoverMenu` of branches) replaces the separate `Branch` select in the tab row (`aria-label="Branch"` kept on the button); then breadcrumb; then `Source | Preview` `Segmented` for `.md` files, using the same markdown renderer as `packages/ui/src/views/MarkdownViewer.jsx` (extract its renderer into a shared export if it isn't one already).
- `useFilePrs({ client, repo, openPRs, path, refreshKey }): { prs: { number, title, add, del }[], loading }` — lazily fetches `repos/{repo}/pulls/{n}/files` for the 10 most recently updated open PRs on first use, caches per `repo + refreshKey`, and returns PRs whose files include `path`.
- `GithubFileRail({ repo, branch, path, prs, commits, localCopy, onOpenLocal, onViewPrs })`: basename + `dir · on {branch}`; `OPEN PULL REQUEST` card when `prs.length` (`#n title`, `Changes this file +a −b`, link `View in Pull requests`); `HISTORY ON {BRANCH}` (3 commits via `client.get('repos/{repo}/commits?path=&sha=&per_page=3')`); `Open in local copy` (primary, only when a local copy exists), `Open on GitHub`, `Copy permalink` (ghost). Collapsed label `File details`, persisted under `githubFiles`.
- Repo header: one row, name 600 16 + meta 12 muted + `Open local copy`, `Open on GitHub`, refresh icon; tabs row below.

- [ ] Tests: `<mark>` highlights and `N of M files match` in the GitHub explorer; branch picker changes the listed tree; markdown file shows `Source | Preview` and toggling switches rendering; `useFilePrs` fetches at most 10 PR file lists and only once per repo+refreshKey (assert call count), and tolerates one PR's fetch rejecting; `Copy permalink` writes the blob URL for the sha; no PR card when none touch the file.
- [ ] Implement.
- [ ] Phase gate: `npm test`; compare `3a-files-local.png` / `3b-files-github.png`. Commit; open PR "Git Files tabs (3a, 3b)".

---

## Phase 4 — Documents shell and Regex Tester

### Task 14: Pure helpers for the new regex UI

**Files:** Create `UIV/regex-syntax.js` (+ `packages/ui/tests/regex-syntax.test.js`). `regex-tester-helpers.js` stays unchanged.

**Interfaces — Produces:**
- `tokenizePattern(pattern: string): { text: string, kind: 'escape'|'class'|'quant'|'group-open'|'group-close'|'literal'|'unclosed', group?: number }[]` — escapes `\w`, classes `[...]`, quantifiers `+ * ? {n,m}`, each capture group's parentheses carry `group` (1-based, counted like the engine; `(?:…)`, lookarounds and `(?<name>…)` handled: non-capturing get no number, named capture does); an unclosed `(` is `kind: 'unclosed'`. Never throws; concatenating `text` equals the input.
- `regexErrorInfo(message: string, pattern: string): { message, column: number|null, hint: string|null }` — column from messages that carry a position (V8's `... at position N` is 0-based → 1-based) else `null`; `hint` for common cases (`Unterminated group`, `Unmatched ')'`, `Nothing to repeat`).
- `insertAt(text: string, start: number, end: number, token: string): { text: string, caret: number }`.
- `replaceSegments(source: string, re: RegExp, replacement: string): { text: string, replaced: boolean }[]` — the result string split into replaced / untouched spans (for the green `RESULT` highlight); empty matches never loop (advance `lastIndex`).
- `stepIndex(current: number, dir: 1|-1, n: number): number` (wraps; -1 current starts at 0 or n-1).

- [ ] Tests: `tokenizePattern('(\\w+)@([\\w.-]+\\.[a-z]{2,})')` round-trips and numbers groups 1 and 2; `(?:a)(b)` numbers only `b` as 1; `(?<y>\\d+)` is group 1; `'(abc'` marks the `(` as `unclosed`; `'[abc'` and `''` and a lone `\\` don't throw and round-trip (**Pins Review Focus 5**); `regexErrorInfo` for `new RegExp('(')` yields a message and a hint; `replaceSegments('aaa', /a*/g, 'X')` terminates and marks replaced spans; `stepIndex` wraps both ways.
- [ ] Implement.
- [ ] Commit.

### Task 15: Documents shell bar and save state (R1)

**Files:** Modify `UIV/view-documents.jsx`, `UIV/view-regex-tester.jsx` (publishes save state), `UIV/document-store.js` only if `saveStatus` needs a `savedAt`; Create `UIV/documents-bar.jsx`; tests `packages/ui/tests/documents-view.test.jsx`.

**Interfaces — Produces:**
- `DocumentsBarContext` (`React.createContext({ setSave: () => {} })`) and `useDocumentsBarSave(status: 'idle'|'saving'|'saved', savedAt?: number)` for tools to publish; `DocumentsBar({ tab, onTab, save })`: 48px bar, `Segmented` `Markdown | JSON Editor | Regex Tester` (tab ids and the `documents_active_tab` storage key unchanged), right side `● Saved just now` (success dot, uses `relativeTime`) / `● Saving...` (warning dot) / nothing when idle.
- The accent-filled button row is removed.

- [ ] Tests: the three tabs render and switching persists to `documents_active_tab`; with the regex tool mounted and an edit, the bar shows `Saving...` then `Saved`; Markdown/JSON tools publish nothing and the bar shows no save text.
- [ ] Implement.
- [ ] Commit.

### Task 16: Regex layout, saved patterns, expression bar (R2 left + top)

**Files:**
- Create: `UIV/regex-tester/saved-patterns.jsx`, `expression-bar.jsx`, `pattern-input.jsx` (overlay-coloured input), `regex-tester.css`; `packages/ui/tests/regex-saved-patterns.test.jsx`, `regex-expression-bar.test.jsx`
- Modify: `UIV/view-regex-tester.jsx` (keeps the `RegexTesterView` export and state machine; layout becomes grid `240px | minmax(0,1fr) | rail`, no outer padding, no cards), `UIV/document-store.js` (add `duplicateDoc(id)` returning the new id), `UIV/documents-modal.jsx` (kept only for rename/delete confirmation if reused; otherwise unreferenced and left in place)

**Interfaces — Produces:**
- `SavedPatterns({ docs, currentDocId, onOpen, onNew, onRename, onDuplicate, onDelete })`: `SAVED PATTERNS` eyebrow + count + `+` 26×26 button (`aria-label="New pattern"`); filter 28px (word-start over name and pattern); rows (name 500 12.5 + `relativeTime` right, pattern 11px mono `--accent` ellipsis; current = `--accent-soft` + 1px `--accent-border`); right-click menu `Rename…`, `Duplicate`, `Delete…` (`ContextMenu`-style, reuse the modal's confirm for delete). Name defaults to `regexAutoName` until renamed.
- `PatternInput({ value, onChange, flags, invalid, inputRef })`: input 15px/500 mono over a `tokenizePattern` overlay (escapes `--accent`, classes `--success`, quantifiers `--warning`, group parens `GROUP_COLORS[group-1]`, literals `--text`, `unclosed` `--danger` + `--danger-soft`); expose caret range via `inputRef` for Task 18.
- `ExpressionBar({ state, patch, matches, selIdx, onStep, error, subCount })`: pattern field (flex 1, 40px, radius 8, `--bg`; focus `--accent` + 3px `--accent-soft` ring; invalid `--danger`) with `/` markers and inline flag toggles `g i m s u` (22×24, `title` from `FLAG_INFO`, `aria-pressed`); status chip (26px: `N matches` success-soft / `no matches` warning-soft / `invalid pattern` danger-soft / `N replaced` in Replace mode / `enter a pattern` muted); match stepper `‹ 2 / 3 ›` (Match mode only) and `Ctrl+↑/↓`; mode `Segmented` `Match | Replace`; error line under the field (alert icon + `<message> · column N · <hint>` via `regexErrorInfo`); Replace row (36px field, `WITH` eyebrow, replacement input with `$1`/`$2` tinted in their group colour, right hint `$& whole match · $1 $2 groups · $<name>`).

- [ ] Tests (`saved-patterns`): filter `inv` word-start matches a name or pattern; click opens; context menu → Duplicate calls `onDuplicate(id)`; Delete asks confirmation then calls `onDelete`.
- [ ] Tests (`expression-bar`): flags toggle through `patch`; chip text for each of the five states; `Substitution` text no longer exists, `Replace` does, and selecting it stores `mode: 'sub'`; invalid `(` shows the error line with a column and hint and no highlight spans; stepper wraps and is hidden in Replace mode; `Ctrl+ArrowDown` steps. **Pins Review Focus 5.**
- [ ] Implement; `duplicateDoc` copies content and names `"{name} copy"`.
- [ ] Commit.

### Task 17: Test text editor and footer (R2 centre)

**Files:** Create `UIV/regex-tester/test-text.jsx` (+ `packages/ui/tests/regex-test-text.test.jsx`); modify `UIV/view-regex-tester.jsx`, `regex-tester.css`.

**Interfaces — Produces:** `TestText({ state, patch, matches, groupColors, selIdx, onSelectMatch, mode, result, error })`: case tabs row 36px (underline tabs, `+` keeps the `window.prompt` name flow, right side group legend `Group n` swatches for the current pattern's groups); editor on `--bg`, 13.5px/28px mono, 48px gutter (muted .5) with line numbers; highlights from `buildOverlaySegments` / `splitMatchByGroups` (match fill `--warning-soft`, 2px underline in group colour or `--warning`, radius 2; selected match `color-mix(in srgb, var(--warning) 26%, transparent)` + 1px `--warning` ring; click a highlight selects it — overlay is `pointer-events:none` today, so route clicks by caret offset from the textarea); Replace mode splits 50/50 into input | `RESULT` (eyebrow `--success`, `Copy` ghost; replaced spans `--success-soft` from `replaceSegments`); invalid pattern renders plain text without highlights; footer 28px `112 chars · Ln 2, Col 6` (Replace: `112 chars → 96 chars`) and right `Click a match to select it · Ctrl ↑/↓ to step`.

- [ ] Tests: highlights render one `mark` per match; none when `error`; clicking at a caret offset inside match 2 calls `onSelectMatch(1)`; Replace mode shows `RESULT` with replaced spans marked and `Copy` writes the result; footer `Ln/Col` follows the textarea selection; `a*` on `baab` renders without hanging (empty matches skipped in the overlay).
- [ ] Implement.
- [ ] Commit.

### Task 18: Right rail (R2 right) and Reference insert-at-caret

**Files:** Create `UIV/regex-tester/rail.jsx`, `matches-panel.jsx`, `code-panel.jsx`, `tests-panel.jsx`, `reference-panel.jsx` (+ tests under `packages/ui/tests/regex-rail-*.test.jsx`); modify `UIV/view-regex-tester.jsx` (remove `UnitTestsPanel`/`ReferencePanel`/bottom grid), `regex-tester-helpers.js` only if `genCode` needs the replacement (add an optional 4th argument `replacement`, default behaviour unchanged).

**Interfaces — Produces:**
- Rail wrapper uses `CollapsibleRail` + `usePersisted('regex_tester_rail', { open: true, tab: 'matches' })`; 40px tab row `Matches N | Code | Tests p/n | Reference` (underline tabs, 600 12px, padding `0 7px`, nowrap, counts 11px muted) + hide button (26×26, flex none); collapsed vertical label `Matches · 3` / `Code · Python` / `Tests · 3 pending`.
- `MatchesPanel({ matches, selIdx, onSelect, colors })`: compact card per match (padding `8px 10px`, radius 7): 18px index badge, value (500 12.5 mono ellipsis), `0–19 · len 19`; groups beneath indented 26px, grid `62px | 1fr`, colour square + `Group n`/`?<name>`, value 12px mono (`undefined` italic muted); selected card `--warning-soft` + `--warning` 45% border; selection syncs with the editor.
- `CodePanel({ lang, onLang, pattern, flags, replacement, mode })`: 28px language `<select>` (`JS, Python, PHP, Go, Java, C#, Ruby`), short note, `Copy`; full-bleed code on `--bg` 12px/19px mono with keyword `--accent`, string `--success`, comment muted tokens; uses `genCode(lang, pattern, flags, mode === 'sub' ? replacement : undefined)`.
- `TestsPanel({ tests, onAdd, onDelete })`: summary `2/3 passing` or `N tests pending` + `They run again as soon as the pattern compiles.`; rows 32px (18px result circle ✓/✗/?, string mono, `should match`/`no match` 11px muted, delete on hover); add bar pinned bottom: input + `Match | No match` `Segmented`, Enter adds.
- `ReferencePanel({ filter, onFilter, onInsert })`: unchanged content (`REFERENCE_DATA`) with filter at top; `onInsert(token)` inserts at the pattern input's selection via `insertAt` (falls back to append when the input has no focus history).

- [ ] Tests: tab counts and collapsed labels for each tab; clicking a card selects the match (and the editor selection follows via the parent); Code panel changing language changes the snippet and, in Replace mode with replacement `$2`, the Python snippet contains it; Tests panel Enter adds a test and `?` rows show while the pattern doesn't compile; Reference click with caret at 3 of `abcdef` inserts at 3 (not the end); rail open/tab persist through remount.
- [ ] Implement; remove the inline `<style>` `.rt-*` classes replaced by the stylesheet.
- [ ] Phase gate: `npm test`; compare `4a-regex-match.png`, `4b-regex-replace.png`, `4c-regex-invalid.png`. Commit; open PR "Documents shell and Regex Tester redesign".

---

## Final verification (Task 19)

- [ ] `npm test` passes on the branch with all four phases (or on each phase branch before merge).
- [ ] Run the desktop app (`apps/desktop:verify` skill) and compare each of the nine screenshots in `ui_update/screenshots/`; switch through at least three `data-theme` values (including a dark one) and confirm no hard-coded colours show through.
- [ ] Update `README.md`/docs only where they describe the old layout (grep for `Substitution`, `Hide repositories`, `Stage all` in `docs/`).

## Self-review notes

- **Spec coverage:** G1 → T3; G2 → T2; G3 → T4; G4 → T5; 1b → T6, T8, T9; 2a → T9; 2b → T9 (+T6 conflicts lane); 2c → T7; 3a → T10–T12; 3b → T10, T11, T13; collapsible rail + persistence + `Ctrl+]` → T1, T9, T12, T13, T18; state to add (`railOpen`, `laneFilter`/`laneMode`, `recentFiles`, `fileView`, `mdView`) → T1, T7, T10, T11, T13; data needed → T12 (`useFileHistory`), T13 (`useFilePrs`, commits API); R1 → T15; R2 left/top → T16; centre → T17; rail → T18; R3 state → T15–T18 (`regex_tester_rail`, docs list replaces the modal, insert-at-caret, `Replace` label with `'sub'` stored).
- **Names checked across tasks:** `useRail`/`railColumns`/`CollapsibleRail`/`Segmented` (T1) are the only shared primitives and are consumed by T7, T9–T13, T15–T18 with the same signatures; `tokenizePattern`/`regexErrorInfo`/`insertAt`/`replaceSegments`/`stepIndex` (T14) are consumed by T16–T18 under those names; `onAction(kind)` in `RebaseRail` is `WorktreePanel.operation`.
- **Open risks to confirm during execution:** the CodeMirror-based `CodeEditor` may need more than a `markedLines` prop for the gutter edge (T11); block counts for conflict rows depend on what `use-conflict.js` exposes (T9); Windows window-control overlap in the shell header at narrow widths needs a look in the running app (T3).
