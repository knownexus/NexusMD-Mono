# Handoff: Git Workspace v2 + Regex Tester

Target repo: `knownexus/NexusMD-Mono` @ `master`. Scope: `modules/git/src/renderer/` (+ `git-workspace.css`), and `packages/ui/src/views/view-regex-tester.jsx` + `view-documents.jsx` (see **Part 2** at the end).

## Overview
A layout pass on the Git Workspace page. All existing behaviour is kept; the layout changes reduce header rows, remove the Changes toolbar, and move commit and per-file actions into a collapsible right rail. The chosen direction is **1b "Two lanes + commit rail"**, carried through every state (2a–2c) and both Files tabs (3a–3b).

## About the design files
`Git Workspace Redesign.dc.html` is a **design reference built in HTML**: static mock data, not production code. Recreate it in the existing React components, using the existing adapters, `@nexusmd/core` helpers, `.btn`, `PlModal` and the theme variables in `packages/ui/src/styles/base.css`. **Do not hard-code hex values.** The prototype styles against Nexus design-system variable names; map them with the table under *Design tokens* so every `data-theme` (pewter, midnight, umber…) keeps working.

Open the board in a browser with `support.js` and the `Gw*.dc.html` files next to it. Boards are labelled: **1b** (main Changes), **2a** clean, **2b** rebase, **2c** large set, **3a** Files local, **3b** Files GitHub, **1z** today's screen for comparison. 1a, 1c, 1d–1h are rejected alternatives; ignore them.

## Fidelity
**High fidelity** for layout, sizes, copy and behaviour. Colours are final as theme-variable mappings.

---

## Global changes (implement first)

### G1. One top bar (replaces window title row + `nx-gw-head` rows 1 and 2)
48px, `--surface`, 1px bottom `--border`, padding 0 16px, gap 14px, nowrap.
Left → right: git-branch icon 16px `--accent` · title `Git Workspace` (600 15px `--font-heading`, .02em) · Local/GitHub segmented (track `--bg`, 3px pad, radius 8; tab 24px high, 0 12px, radius 6; active `--surface-2` + `--text`, 600 12px) · spacer · `● Fetched 2 min ago` (7px `--success` dot, 12px muted) · `Jump to branch... [Ctrl K]` (min-width 170, 28px, `--bg` field look) · `Fetch all` (secondary 28px) · `Pull all (N)` (ghost, 0.6 opacity when N=0).
GitHub mode: same bar, GitHub tab active, plus `N repositories from …` (12px muted) after the segmented control.

### G2. Branch filter + chips move into the branch list (`branch-list.jsx`, `filter-chips.jsx`, `group-tabs.jsx`)
List column is **272px** (was 330), `--bg`, padding 12px 10px, gap 10px. Top to bottom:
1. Group picker: button `NexusMD  1 repo ▾` (28px, `--surface-2`, 600 12.5px; count 400 11.5 muted) + `+` icon button (28×28) for New group. Group menu/editor unchanged.
2. Filter field: 28px, `--surface`, search icon 12px, placeholder `Filter branches`, `/` kbd at right.
3. Chips (wrap, gap 4): 22px pills, 0 8px, 500 11.5px, 6px status dot, bold count. Active = `--accent` border + text + `--accent-soft` fill. **Only chips with a count > 0 are shown** (plus All).
4. Repo groups: header row (caret, repo name 600 11px .08em uppercase `--accent`, branch count 11.5 muted, status pill right: 18px, radius 4, `--warning-soft`/`--warning`, 600 10.5px, nowrap).
5. Branch rows: grid `8px 1fr`, gap 9, padding 6px 8px, radius 7. Name 600 12.5px `--text`; meta 11.5px muted with the status part coloured by tone. Selected = `--accent-soft` + 1px `--accent-border`.

### G3. Branch header in two short rows (`branch-header.jsx`)
`--surface`, 1px bottom border.
- Row 1 (padding 10px 16px 4px, gap 12): branch name 600 16px · `Switch ▾` chip (22px, 1px border, 11.5px muted) · meta group 12px muted: `origin/master`, sync state (`In sync` success / `Rebasing onto origin/master` danger / ↑↓ text), mono 11.5px worktree path with a copy icon (click = Copy path; full path in title) · spacer · `Fetch`, `Pull...`, `Rebase...`, `More ▾` (26px secondary, 500 12px; Pull/Rebase at 0.45 opacity + disabled during an operation) · 1px divider · Terminal and Editor as 26×26 icon buttons with titles.
- Row 2 (34px, padding 0 12px): tabs `Changes N` | `History` | `Files` (32px, 0 10px, 600 12.5px; active `--text` + 2px `--accent` bottom border; count 500 11px muted) · right: `Go to file [Ctrl P]` ghost.
- The breadcrumb `Overview › Repo` row is removed in split layout (keep it in focus layout only).

### G4. Command bar in one row (`git-command-line.jsx`)
42px, `--surface`, top border, padding 0 12px, gap 8. Input field flex 1, 28px, `--bg`: `git ›` (600 12.5 mono `--accent`) + placeholder + `` ` `` kbd. Then quick chips `status`, `log -5`, `stash` (24px, `--surface-2`, mono 11.5 muted) and `Aliases N ▴`. The hint row (`in <path> · Enter to run …`) is removed; put the cwd in the field's `title`. The floating output console is unchanged.

---

## Screens

### 1b. Changes: two lanes + commit rail (`changes-pane.jsx`, `commit-composer.jsx`, `diff-pane.jsx`)
Body grid: `320px | minmax(0,1fr) | 290px (rail; 40px collapsed)`.

**Left: lanes** (`--surface`, right border). Grid rows `minmax(0,1.3fr) minmax(0,1fr)`; each lane scrolls on its own.
- Lane header 34px, padding 0 10px 0 14px, bottom 1px `--surface-3`: title (600 10.5px .08em uppercase) + count (11.5 muted) + right action button (24px, 500 11.5 `--accent`, with arrow icon): `Stage all ↓` on Not staged, `Unstage all ↑` on Staged. The Staged header has `--success-soft` fill and `--success` title.
- File row: grid `14px | 1fr | 22px`, gap 8, height 28px, padding 0 4px 0 8px, radius 5. Status letter (600 11px mono; M warning, A success, D danger, ? info, U danger), basename (500 12.5px). The 22×22 move button (arrow down on Not staged = Stage, arrow up on Staged = Unstage) shows on hover/focus; focused row = `--accent-soft`, button `--surface-3`.
- **The Stage/Unstage/Discard/Delete toolbar and the row checkboxes are removed.** Multi-select still works (click, Shift-click, Ctrl-click, Space). With a selection, the lane header's action reads `Stage 3 ↓` / `Unstage 3 ↑`; Discard/Delete for a selection go in the row context menu and the diff header. Keep `s`/`u` keys.
- Untracked files go in the Not staged lane, as today.

**Centre: diff** (`--bg`).
- Header 42px, padding 0 14px, bottom border: basename (600 12.5 mono `--text`) · dir (11.5 muted, ellipsis) · `+n` success / `−n` danger (600 11.5 mono) · spacer · `Discard...` (danger ghost) · `Stage file` / `Unstage file` (secondary 26px). Unified/Split toggle stays (from today's diff pane).
- Hunk header 28px `--surface`: range + context (11px mono `--accent`) · right `Stage hunk` (500 11.5 accent).
- Lines: grid `40px 40px 18px 1fr`, 12px/20px mono; line numbers muted 0.6 opacity; del `--danger-soft`, add `--success-soft`. Syntax highlighting per the existing `.tok-*` classes.

**Right: commit rail** (`--surface`, left border, padding 10px 14px 14px, gap 10, flex column).
1. Hide-panel icon button (24×24, top right).
2. `COMMIT TO <branch>` eyebrow (600 10.5 .08em uppercase muted).
3. Summary input 32px with `n/72` counter (same rules as today).
4. Description textarea, **always visible**, 150px.
5. Summary card (1px `--surface-3`, radius 6, padding 10, 12px muted): `N files` + `+a −b`; second line `Pushes to origin/x` (or `Not published yet`).
6. `Amend last commit` checkbox.
7. Spacer, then stacked full-width buttons: primary `Commit N files  Ctrl ⏎` (32px), secondary `Commit & push` / `Commit & publish` / `Amend & push` (30px).
8. A hint line above the buttons when disabled (`Write a summary to commit`, `Stage files first`) in `--warning` 11.5px.

### 2a. Clean tree
Lanes stay. Not staged lane body: check badge (20px circle `--success-soft`) + `Working tree clean` (600 13) + `Edits to files on <branch> appear here.` Staged lane: `Nothing staged.` Centre: `No diff to show.` centred muted.
Rail: `LAST COMMIT` eyebrow · card (`--bg`, radius 8): subject 600 13, `hash · 2 hours ago · pushed` (hash mono `--accent`), `N files  +a −b` · `Amend message...` (secondary) · `View in History` (ghost, switches tab and selects the commit).

### 2b. Rebase paused on conflicts (replaces `operation-bar.jsx` banner in split layout)
- Top lane becomes **Conflicts** (header `--danger-soft`, title `--danger`) with the note `Resolve each file, then continue the rebase.` Rows show `U`, basename, and on the right `N blocks` / `1 block left` (11px muted). Bottom lane stays Staged.
- Centre: the resolve pane as today (conflict header, explainer, two side cards with 3px top border info/violet, `Use theirs`/`Use mine`, Both buttons, `Edit result...`, `Mark resolved & next`).
- Rail swaps the commit form for: `REBASE IN PROGRESS` eyebrow (`--warning`) · `Rebasing onto origin/master` (600 13) · card: `Commit 3 of 7`, `hash subject`, step bar (one flex segment per commit, 5px, done success / now warning / todo `--surface-3`) · `0 of 2 conflicts resolved` (600 12 danger → success when all resolved) · paused note (12px muted) · spacer · `Continue rebase` (primary, disabled with title `Resolve N remaining conflicts first`) · `Skip this commit` (secondary; hidden for merges) · `Abort rebase...` (danger ghost → existing confirm dialog).
- Collapsed rail label: `Rebase 3 of 7`.

### 2c. Large change set (more than ~50 files)
- Not staged lane gets a second row under its header: filter field (26px, word-start match) + `Folders | Flat` segmented (20px tabs). Lane rows become 1.6fr of the height.
- Folders view: folder rows (chevron, dominant status letter, path 500 12.5 `--text`, file count right in mono muted) expand to file rows indented 24px with `+a −b`. A trailing `Show N more in this folder` row (500 12 accent) replaces today's `Show N more` button. Selecting a folder row shows a folder header in the diff pane (`apps/web/dist/  142 untracked files` + `Delete...` + `Stage folder`) and `Folder selected — pick a file inside it…` body.
- Staged lane uses the same grouping.
- Keep `ROWS_SHOWN` virtualisation logic.

### 3a. Files tab, local (`files-pane.jsx`, `file-explorer.jsx`)
Body grid `290px | 1fr | 290px rail`.
- **Tree column** (`--surface`): filter (26px) + collapse-all icon. Then pinned groups, each with a 600 10.5 uppercase muted label:
  - `Changed N`: rows 22px, status letter (staged ones coloured success), basename, short dir 11px muted. Click = pick file.
  - `Recent`: last 3 files opened in this worktree (clock icon, name, relative time). Session-only list is fine.
  - `<RepoName>`: the full tree. Rows **22px** (was 26), indent 12px per level, chevron 9px, folder icon `--accent` 0.8 opacity, file icon muted. Changed files tinted by tone with letter at right; folders holding changes get a 6px dot.
  - Footer legend (Staged / Not staged / Untracked dots, 11px).
- **Preview**: path bar 40px: breadcrumb (`Repo › … › file`, last crumb 600 `--text`, separators `›` muted; crumbs shrink and fade at the right edge) + `File | Diff` segmented (Diff only when the file is changed; shows the same diff view as Changes). Code: 12.5px/20px mono, 48px gutter, syntax highlighting; changed lines get `--warning-soft` fill and a 2px `--warning` gutter edge. Status footer 26px: language, lines, size, EOL, encoding.
- **Rail**: basename (600 14) + dir (11 mono muted) · status card when changed (tinted by tone; `Modified · not staged  +9 −5`, note, buttons `View diff`, `Stage`/`Unstage`, `Discard...`) · `RECENT COMMITS` list (subject 12.5, `hash · when`; click opens History at that commit) · spacer · `Edit here  Enter` (primary) · `Open in VS Code` (secondary; label from `openElsewhere`) · `Show in Explorer` + `New window` (ghost, side by side). These replace `PreviewHead` actions.
- Drag-and-drop import and context menus are unchanged.

### 3b. Files tab, GitHub (`github/github-files.jsx`, `github-repo-pane.jsx`)
- Same explorer component as 3a (no Changed/Recent pins). Filter matches highlighted with `<mark>` (`--accent-soft` bg, `--accent` text, radius 2), word-start only (see `wordMatch` in the previous handoff). Footer: `N of M files match`.
- Path bar: branch picker button first (`⑂ main ▾`, 24px secondary) replaces the separate `Branch` select in the tab row, then breadcrumb, then `Source | Preview` segmented for Markdown.
- Rail: basename + `dir · on <branch>` · `OPEN PULL REQUEST` card when an open PR touches the file (`#n title`, `Changes this file +a −b`, link `View in Pull requests`) · `HISTORY ON <branch>` (3 commits) · `Open in local copy` (primary; when a local copy exists) · `Open on GitHub` · `Copy permalink` (ghost).
- Repo header: one row, name 600 16 + meta 12 muted + `Open local copy`, `Open on GitHub`, refresh icon; tabs row below.

---

## Interactions & behaviour (Git Workspace)
- **Collapsible rail** (all screens with a rail): hide button top-right of the rail; collapsed = 40px strip, `--surface`, left border, expand icon + vertical label (`writing-mode: vertical-rl; transform: rotate(180deg)`, 600 10.5 uppercase muted). The whole strip is clickable (hover `--surface-2`). Labels: `Commit · N staged`, `Last commit`, `Rebase i of n`, `File details`. Grid column animates `grid-template-columns` over .22s `cubic-bezier(0.4,0,0.2,1)`. Persist per tab kind (`changes` / `files` / `github-files`) in the same store as `usePaneWidth`. Suggested shortcut: `Ctrl+]`.
- Lane/column widths stay draggable with `PaneResizer` (left 320 default, rail 290 default, min 240).
- `Ctrl+Enter` commits from anywhere in the Changes tab while the summary is valid.
- Esc in the lane filter clears it.
- All buttons that are disabled carry a `title` explaining why.

## State to add
`railOpen: { changes, files, githubFiles }` (persisted) · `laneFilter` + `laneMode: 'folders'|'flat'` (per worktree) · `recentFiles[]` per worktree (session) · `fileView: 'file'|'diff'` · `mdView: 'source'|'preview'`. Everything else maps to existing state.

## Data needed
- Per-file recent commits: `git log -n 3 --format=… -- <path>` (local) / GitHub commits API with `path=` (remote).
- Open PRs touching a file: from the PR list already loaded, filtered by changed files (GitHub mode).

## Design tokens: prototype variable → `base.css` variable
| Prototype | Use in code |
|---|---|
| `--page-bg` | `--bg` |
| `--container-bg` | `--surface` |
| `--container-raised`, `--card-raised` | `--surface-2` |
| `--container-hover`, `--border-subtle` | `--surface-3` |
| `--border` | `--border` |
| `--text-bright` / `--text` | `--text` |
| `--text-muted` | `--text-muted` (line numbers: `--text-subtle`) |
| `--accent` / `--accent-bright` | `--accent` |
| `--accent-muted` | `--accent-soft` |
| `--accent-border-glow` | `--accent-border` |
| `--accent-text` | `--accent-fg` |
| `--success/--warning/--danger/--info` | same names |
| `--*-bg` | `--*-soft` |
| `--font-ui` / `'Geist Mono'` | `--sans` / `--mono` |
| `--font-heading` | `--font-heading` |

Radii: 4 (kbd, pills), 5 (row buttons), 6 (buttons, inputs, `--radius-sm`), 7 (branch rows), 8 (cards, `--radius`), 10 (boards). Shadows: floating bars `--shadow-pop`.
Type: 10.5px/600/.08em uppercase eyebrows · 11–11.5 meta · 12–12.5 UI · 13 inputs · 14–16 titles. Buttons 26px (header/inline), 28px (top bar), 30–32px (rail).

## Assets
Icons are Lucide-equivalent inline SVGs (git-branch, search, chevron-down/right, folder, file, copy, terminal, pencil, refresh-cw, clock, panel-right-close/open, arrow-up/down, more-horizontal). Use the existing `Icon` component from `@nexusmd/ui`; add `panel-right-close`/`panel-right-open` if missing.

## Files
- `screenshots/`: one PNG per chosen board (`1b-changes`, `2a-clean`, `2b-rebase`, `2c-large`, `3a-files-local`, `3b-files-github`, `4a-regex-match`, `4b-regex-replace`, `4c-regex-invalid`), 1442×862.
- `Regex Tester Redesign.dc.html`: the Regex Tester board (Part 2).
- `Git Workspace Redesign.dc.html`: the board (turns 3 → 1, newest first).
- `GwTopBar.dc.html`, `GwBranchList.dc.html`, `GwDetailHead.dc.html`, `GwCmdBar.dc.html`: shared chrome (G1–G4).
- `support.js`: runtime needed to open the files locally.
- `_ds/…`: design-system stylesheets the board loads (reference only; not for the app).

---

# Part 2: Documents › Regex Tester

Files: `packages/ui/src/views/view-documents.jsx` (shell), `view-regex-tester.jsx` (tool), `regex-tester-helpers.js` (unchanged logic: `findMatches`, `buildOverlaySegments`, `splitMatchByGroups`, `runUnitTests`, `genCode`, `REFERENCE_DATA`), `documents-modal.jsx` / `document-store.js` (saved docs).
Boards in `Regex Tester Redesign.dc.html`: **4a** Match, **4b** Replace + Code, **4c** invalid pattern + Tests, **4z** today for comparison. Same token mapping as Part 1.

## R1. Documents shell: one top bar (`view-documents.jsx`)
48px, `--surface`, bottom border, padding 0 16px, gap 14, nowrap. File icon 16px `--accent` · `Documents` (600 15px `--font-heading`) · segmented `Markdown | JSON Editor | Regex Tester` (same style as the Git Local/GitHub control: track `--bg`, 3px pad, radius 8; tab 24px, 0 12px; active `--surface-2` + `--text` 600 12px) · spacer · save state from `useDocumentAutosave`: `● Saved just now` (success dot) / `● Saving...` (warning dot). Replaces the window title row + the accent-filled tab row. The active tool owns everything below. JSON Editor and Markdown can adopt the same bar later.

## R2. Layout (`view-regex-tester.jsx`)
Grid `240px | minmax(0,1fr) | 360px rail (40px collapsed)`, full height, no outer padding, no cards.

### Left: saved patterns (replaces the `Documents (N)` button + `DocumentsModal` for browsing)
`--bg`, right border, padding 12px 10px, gap 8.
- Header: `SAVED PATTERNS` eyebrow (600 10.5 .08em uppercase muted, nowrap) + count + `+` 26×26 secondary button (= `newDoc`).
- Filter field 28px (filters name + pattern, word-start).
- Rows (padding 7px 8px, radius 7): name 500 12.5 `--text` + relative time 11 muted right; pattern line 11px mono `--accent` ellipsis. Current doc = `--accent-soft` + 1px `--accent-border`. Right-click: Rename…, Duplicate, Delete… (reuse the modal's actions). Name defaults to `regexAutoName` until renamed.

### Expression bar (replaces the duplicated pattern title + EXPRESSION panel)
`--surface`, bottom border, padding 12px 16px, gap 10.
- Pattern field: flex 1, 40px, radius 8, `--bg`, 1px `--border` (focus `--accent` + 3px `--accent-soft` ring; invalid `--danger`). Content in 15px/500 mono: `/` muted · the input · `/` muted · flag toggles **inline after the slash** (`g i m s u`, 22×24, radius 4; on = `--accent-soft` + `--accent`, off = muted; `title` from `FLAG_INFO`).
- Pattern syntax colouring (overlay behind a transparent input, like the test-string overlay): escapes `\w` `--accent`, classes `[...]` `--success`, quantifiers `+ * ? {n,m}` `--warning`, each capture group's parentheses in its `GROUP_COLORS[n]`, literals `--text`. An unclosed `(` gets `--danger` + `--danger-soft`.
- Status chip (26px, radius 5, 600 11.5 mono): `N matches` success-soft / `no matches` warning-soft / `invalid pattern` danger-soft / `N replaced` in Replace mode.
- Match stepper (Match mode only): `‹ 2 / 3 ›` in one 28px bordered control. `Ctrl+↑/↓` also steps.
- Mode segmented `Match | Replace` (rename "Substitution" to "Replace").
- **Error line** (4c), under the field when invalid: 12px mono `--danger`, alert icon, `<message> · column N · <plain hint>`. Column = 1-based position of the offending char where the browser message allows; otherwise message only.
- **Replace row** (4b), under the field in Replace mode: 36px field, `WITH` eyebrow, replacement input (14px mono; `$1`, `$2` tinted in their group colour), right-aligned hint `$& whole match · $1 $2 groups · $<name>` (11px muted).

### Test text (fills remaining height)
- Case tabs row 36px `--surface`: `Email URL Phone Dates` as underline tabs (600 12.5, active `--text` + 2px `--accent`), `+` to add (keep the prompt), right side: group legend (10×3 swatch + `Group n`, 11px muted) for the current pattern's groups.
- Editor: `--bg`, 13.5px/28px mono, 48px line-number gutter (muted 0.5). Highlights from `buildOverlaySegments` / `splitMatchByGroups`: match fill `--warning-soft`, 2px underline in the group colour (or `--warning` outside groups), radius 2. Selected match: stronger fill `color-mix(in srgb, var(--warning) 26%, transparent)` + 1px `--warning` ring. Click a highlight to select it.
- Replace mode: editor splits 50/50 into input | `RESULT` (eyebrow in `--success`, `Copy` ghost). Replaced spans in the result get `--success-soft`.
- Invalid pattern: plain text, no highlights.
- Footer 28px `--surface`, 11px mono muted: `112 chars · Ln 2, Col 6` (Replace: `112 chars → 96 chars`) · right: `Click a match to select it · Ctrl ↑/↓ to step`.

### Right rail (replaces the bottom 1fr/1fr grid)
`--surface`, left border. Tab row 40px: `Matches N | Code | Tests p/n | Reference` (underline tabs, 600 12px, padding 0 7px, nowrap; counts 11px muted) + hide button (26×26, flex:none). Collapse behaviour identical to Git (40px strip, vertical label `Matches · 3` / `Code · Python` / `Tests · 3 pending`; persisted).
- **Matches**: one compact card per match (padding 8px 10px, radius 7): index badge (18px, `--warning-soft`/`--warning` mono 10.5), value (500 12.5 mono, ellipsis), `0–19 · len 19` (10.5 mono muted). Groups beneath, indented 26px, grid `62px | 1fr`: colour square + `Group n` (or `?<name>`) and value (12px mono; `undefined` italic muted). Selected card = `--warning-soft` + `--warning` 45% border; selecting in either place syncs.
- **Code**: a language **dropdown** (28px; JS, Python, PHP, Go, Java, C#, Ruby) replaces the 7 buttons, a short note, `Copy`. Code block full-bleed on `--bg`, 12px/19px mono, syntax-coloured (keywords `--accent`, strings `--success`, comments muted). Generated from `genCode`; when Replace mode has a replacement, use it in the replace line instead of `'$1'`.
- **Tests**: summary line (`2/3 passing` or `N tests pending` + "They run again as soon as the pattern compiles."), rows 32px: result dot (18px circle ✓ success / ✗ danger / ? muted), string mono, `should match`/`no match` 11px muted, delete on hover. Add bar pinned at bottom: test-string input + `Match | No match` segmented, Enter adds.
- **Reference**: unchanged content (`REFERENCE_DATA`) with filter at top; click inserts at the caret (today it appends).

## R3. State changes
- `rail: { open, tab }` persisted (`regex_tester_rail`).
- Docs list replaces `showDocsModal` for browsing; keep the modal only if needed for rename/delete confirmation.
- Insert-at-caret for Reference needs the pattern input's selection range.
- `mode: 'sub'` label becomes "Replace"; storage value can stay `'sub'`.
