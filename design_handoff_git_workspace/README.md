# Handoff: Git Workspace redesign (NexusMD desktop)

Target repo: `knownexus/NexusMD-Mono` @ `master`, scope `apps/desktop/src/views/git/` + `apps/desktop/src/views/devenv-git.css`.

## Overview
A redesign of the Git Workspace page focused on clarity, speed and fewer clicks. It covers the overview, the branch list, changes/diff/commit, conflict resolution, history, all action dialogs and menus, and the inline git command bar with a floating output console.

## About the design files
`Git Workspace.dc.html` is a **design reference built in HTML**: an interactive prototype with mock data, not production code. Recreate it inside the existing React components in `apps/desktop/src/views/git/`, using the existing adapters, `@nexusmd/core` helpers (`worktreeSummary`, `groupChanges`, `actionsFor`, `commitReview`, `GroupDraft`, `filterFiles`…), `PlModal`, `.btn` and the theme CSS variables. **Do not hard-code hex values.** The prototype inlines the default parchment theme's literals only because it runs standalone; map them back to the variables listed under *Design tokens* so every `data-theme` keeps working.

Open the prototype in a browser (keep `support.js` next to it). Tweaks: `layout` = `split` | `focus`, and `startScreen` jumps to each state.

## Fidelity
**High fidelity.** Layout, spacing, type, copy and behaviour are final. Colours are final *as theme-variable mappings*.

---

## Global behaviour changes (implement first)

1. **Counts are branches, not files, and are labelled.** The four stat tiles (`GitSummary` in `repo-cards.jsx`) are replaced by **filter chips** in a header row: `All`, `In progress`, `Uncommitted`, `To push`, `To pull`, `Not published`. Each shows a branch count, filters the list when clicked, and clicking the active chip again goes back to All. The tooltip names what's counted ("… · count is branches").
2. **Repo group headers** (`RepoCards`) show `N branches` plus status pills: `rebasing` (danger), `N uncommitted` (warning), `↑N`, `↓N` (info), or `all clean` (success). This replaces the ambiguous "50 changed". The pills wrap under the name when there isn't room.
3. **Branch rows** (`TreeRow`) get a status dot (danger = operation, warning = uncommitted, info = ahead/behind, subtle = unpublished, success = clean). The meta line only shows what's non-default: `Rebasing 1/7 · 10 conflicts`, `N files changed · N staged`, `↑N to push`, `↓N to pull`, `upstream deleted`, `not published`, or `Up to date`. **Never render `↑0 ↓0`.** Worktree folder names (e.g. `agent-a370507d`) show for detached worktrees.
4. **Word-start filtering** everywhere (branch filter, Ctrl+K, Ctrl+P, group editor). Every whitespace-separated term must match at the start of the text or right after a non-alphanumeric character (`- _ / .` space). It never matches mid-word.
   ```js
   const wordMatch = (text, query) => {
     const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
     if (!terms.length) return true
     const s = String(text).toLowerCase()
     return terms.every(t => new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(s))
   }
   ```
   Put this in `packages/core/src/modules/git/file-filter.js` next to `filterFiles` (and use it there), with tests. Branch search text = `repo + ' ' + branch + ' ' + worktreeName`.
5. **Keyboard:** `Ctrl/⌘K` jump to a branch · `Ctrl/⌘P` go to a file (selected worktree) · `/` focus the filter · `` ` `` focus the command bar · `j`/`k` next/previous branch · `s`/`u` stage/unstage the focused file · `b` new branch · `Ctrl+Enter` commit · `Esc` closes the menu/dialog/switcher, or minimises the output if nothing else is open. Key hints are shown as `.kbd` chips (they can be toggled).

---

## Screens

### 1. Page header (`git-workspace` view root + `group-tabs.jsx`)
- Row 1 (wraps): title `Git Workspace` (`--font-heading`, 600 20px, letter-spacing .03em) · group **segmented control** (`--surface-2` track, 3px padding, radius 8; active tab `--surface` with `--shadow-sm`; each tab reads `Label  N repos`; trailing `+ Group` in `--accent`) · a `⋯` group menu button (custom groups only) · spacer · status `● All fetched 2 min ago` · `Jump to branch… [Ctrl K]` (min-width 180, `--bg` field look) · `Fetch all` · `Pull all (N)` (accent, disabled when N=0).
- Row 2 (wraps): filter input (240px, `/` hint) · divider · `Show` · filter chips (28px pill, 1px `--border`; active = `--accent` border and text + `--accent-soft` fill; 7px status dot).
- Everything uses `white-space:nowrap; flex:none` so labels never break.

### 2. Overview (nothing selected)
- `H2 "N branches need attention"` + `M branches across K repositories`.
- One card per category, only when it has items: **In progress**, **Behind upstream**, **Ready to push**, **Uncommitted work**, **Not published**. Card head = `--surface-2` with a dot, an uppercase title and a count hint. Rows: repo (muted 11.5) + branch (600), a one-line description, and `Open` (ghost) + a primary action (`Resolve`, `Pull ↓12`, `Push ↑3`, `Review & commit`, `Publish`/`Re-publish`).
- Bulk actions in card heads: `Pull all clean (N)` (opens the Pull all preview) and `Commit across branches (N)…` (opens the multi-commit dialog, reusing `CommitDialog` logic).
- An empty state when nothing needs attention.
- **Focus layout only:** a full-width table below (`Branch | Local changes | Sync | Upstream | action`), grouped by repo.

### 3. Split layout (default)
- Left `aside` is 330px wide with the repo cards (see Global 2–3) and a `No branches match. Clear filters` empty state. Selected row = `--accent-soft` fill + `--accent-border`.
- The focus layout hides the aside; the overview becomes the table, and the detail view has a breadcrumb.

### 4. Branch detail header
- Breadcrumb `Overview › Repo › worktree` (Overview is a link back).
- The branch name (18/600, ellipsis) + a `Switch ▾` chip that opens Ctrl+K.
- Meta: mono path (ellipsis, full path in the title), `Copy path`, `Tracks origin/x` / `Upstream was deleted on origin` (warning) / `Not published yet`, `↑a to push · ↓b to pull` or `In sync`, and `Fetched …`.
- Actions (wrap; the title column keeps a min of 360px): a **contextual primary** (`Pull ↓N` › `Push ↑N` › `Publish`, chosen in that priority; hidden during an operation) · `Fetch` · `Pull…` · `Rebase…` (both disabled during an operation) · `More ▾` · divider · `Terminal` · `Editor` (ghost).
- **More ▾ menu** (250px popover, `--shadow-pop`, uppercase section heads):
  - Branch: `New branch… [b]`, `Check out another branch…`
  - Remote: `Push…` / `Publish…`
  - Stash: `Stash changes…`, `Stashes… [count]`
  - Worktree: `Add worktree…`, `Remove this worktree…` (danger; disabled for main/master/develop with the title "The main worktree can't be removed")
  - Disabled items show a reason in their `title`.

### 5. Operation banner (replaces `operation-bar.jsx`)
- A flex-wrap card: 1px `color-mix(--warning 45%)` border, `--warning-soft` fill, radius 10.
- Title: `Rebasing onto origin/master — paused on conflicts` / `…, ready to continue`.
- Line 2: `Commit 1 of 7 · 580ddbd Centralize…` (hash in `--accent` mono, ellipsis).
- A step bar: one 22×5 segment per commit (done `--success`, current `--warning`, todo `--surface-3`) + `3 of 10 conflicts resolved` (danger) / `All conflicts resolved` (success).
- Buttons: `Continue rebase` (accent; disabled with the title `Resolve N remaining conflicts first`), `Skip this commit`, `Abort` (danger ghost → confirmation dialog). The `Skip` button is hidden for merges, as now.

### 6. Changes tab (`changes-pane.jsx`, `diff-pane.jsx`)
- Tabs `Changes  N` | `History` (2px underline in `--accent`), with a `Go to file [Ctrl P]` button on the right.
- Grid `clamp(260px,32%,360px) | 1fr`.
- **Left column scrolls as a whole** (`overflow:auto`). The file list is `flex:1 0 auto; min-height:160px`.
- Sections `Conflicts` (danger dot + note "Resolve each file, then continue the rebase."), `Staged` (`Unstage all`), `Not staged` (`Stage all`).
- File row: grid `18px | 1fr | auto` with a status letter (U danger, A success, D danger, M warning), **basename 500** + muted dir, and a small action button (`Resolve` / `Stage` / `Unstage`). Selected = `--accent-soft`.
- **Commit composer** (`position:sticky; bottom:0`, `--bg` fill):
  - `Commit summary` input with a live `n/72` counter (subtle → warning >50 → danger >72).
  - Description textarea (2 rows) **only after the summary is focused or when there's text**.
  - `Amend last commit` checkbox.
  - Equal 2-column buttons: `Commit & push` / `Commit & publish` / `Amend & push` (secondary) and `Commit N files` / `Amend commit` (accent).
  - A hint line underneath that always explains the state: `Stage files first — use Stage or Stage all above`, `Write a summary to commit`, or `5 staged files → feature/x · Ctrl+Enter`.
  - Amend is allowed with nothing staged.
  - **During an operation the whole form is replaced** by one line: "Committing is paused during the rebase — resolved files go into the replayed commit."
- **Diff pane** header (flex-wrap):
  - Path group (`flex:1 1 160px`, ellipsis): mono path, language tag (`C#`/`TypeScript`/`JSON`/`SQL`/`Markdown`), `+n` success, `−n` danger.
  - Action group (`flex:0 1 auto; flex-wrap; justify-content:flex-end`): `Unified | Side by side` segmented, `Stage file`/`Unstage file`, and `Discard…` (danger ghost → review dialog).
  - Hunk header: range chip + bold context + `Stage hunk` / `Unstage hunk`.
  - Unified lines: grid `44 44 18 1fr`, 12px/20px mono; del rows `--danger-soft`, add rows `--success-soft`.
  - Side by side: aligned pairs; the missing side is filled with `--surface-2`.

### 7. Syntax highlighting (all code)
Language comes from the extension. Reuse the existing `@lezer/highlight` `classHighlighter` + `.tok-*` classes already in `devenv-git.css`, extending the parsers to `cs`, `ts/tsx/js`, `json`, `sql` and `md`. Apply it to unified and split diff lines, both conflict sides, the conflict result, and the result editor (CodeMirror already does this in `file-editor.jsx`). Palette mapping: keyword `--violet`, string `--success`, number `--warning`, comment `--text-muted` italic, type `--info`, function `--accent`, JSON keys `--info`, SQL keywords 600.

### 8. Conflict resolution (`resolve-pane.jsx`, `non-text-conflict.jsx`)
- Header: `CONFLICT` (danger, uppercase) · path · `File i of n` · `‹` `›`.
- Explainer: "Both sides changed the same lines. **origin/master** is already in your branch; **your commit 580ddbd** is being replayed on top…" Use `conflictLabels()` for the wording.
- Two side cards (3px top border: incoming `--info`, yours `--violet`), each with a kicker (`Incoming · already applied` / `Yours · being replayed`), the ref, and a `Use theirs` / `Use mine` button. The chosen side gets a coloured border and the button reads `✓ Using this`.
- Result row: `Both, theirs first` · `Both, mine first` · `Show markers` · state text (`1 conflict block left in this file` danger / `Conflict resolved — review, then mark resolved` success). The result box tints theirs lines `--info-soft`, mine `--violet-soft`, and markers `--warning-soft` + warning 600.
- Buttons: `Edit result…` (opens the editor dialog) · `Mark resolved & next` (accent; disabled until a choice is made). It stages the file and jumps to the next conflict.
- **Non-text conflict** (e.g. deleted by them): a `deleted upstream` pill, an explainer, and two big option cards (`Keep the file` / `Accept the deletion`), then `Mark resolved & next`.

### 9. History tab (`history-pane.jsx`, `commit-detail.jsx`)
- Grid `1fr | 400px`. List rows have a graph rail (2px `--surface-3` line + a 10px dot: yours `--violet`, upstream `--info`), ref chips (`HEAD` accent-soft, `origin/master` info-soft), subject, `author · time`, and a mono hash.
- Divider labels: `Your commits · being rebased` (or `Local commits`) and `On origin/master`.
- Detail panel: hash, subject (15/600), author/time, actions `Copy hash`, `Cherry-pick…`, `Revert…`, `Reset to here…` (danger ghost), and a files-changed card.

### 10. Command bar + output console (`git-command-line.jsx`, `ActivityDrawer`)
- The command bar is unchanged in function. It gets a `git ›` prompt, a `` ` `` hint, `Run`, quick chips (`status`, `log -5`, `stash`, `switch -c`) and `My aliases (N) ▾` (same grouped menu, opens upward).
- **Output is a floating panel** anchored to the bar (`position:absolute; bottom:calc(100% + 6px); left/right:12px; z-index above content`). **It never pushes layout.**
  - Heights: compact `200px`, expanded `min(64vh, 620px)`, toggled by `Expand ▴` / `Shrink ▾`.
  - Tabs: `Output` | `Activity N` (Activity merges `ActivityDrawer`: time, ✓/✗, summary, mono detail).
  - Header buttons: `Copy`, `Clear`, expand/shrink, and `–` minimise (also Esc).
  - **Auto-scroll:** stick to the bottom on new output while the user is at the bottom (within 24px). If they scroll up, stop sticking and show a floating `Jump to latest ↓` pill.
  - **Minimised:** the panel hides and an `Output ▴` chip appears in the bar's hint row. While minimised, new runs don't reopen it; the chip shows `Output · N new ▴` with an accent dot. Clicking it restores the panel and re-sticks to the bottom.

---

## Dialogs (all on `PlModal`; footer = mono command preview on the left, buttons on the right)
Common rules:
- Destructive confirmations need the word typed when the loss is irreversible or covers several items (existing `TYPED` pattern).
- Disabled primaries say why (via the hint/title).
- The title says what will happen; the sub-line gives `Repo › branch`.

| Dialog | Fields / content | Primary |
|---|---|---|
| **Rebase** (`rebase-dialog.jsx`, `RebaseOptions`) | Onto select · 3 stat tiles (your commits replayed / new on target / files likely to conflict) · overlap note · two lists (yours, violet; upstream, info) · `Fetch origin first` · `Stash my N uncommitted files…` · **`Choose what happens to each commit`**, which turns each "yours" row into a pick/reword/squash/fixup/drop select (drop = strikethrough) | `Rebase 7 commits` / `Rebase · keep N of 7` |
| **Pull** | Radio cards: Fast-forward only (default), Rebase, Merge, each with a one-line consequence · stash notice if dirty · Incoming list | `Pull N commits`; footer shows `git pull --ff-only [--autostash]` |
| **Pull all** (batch `ActionDialog`) | Target rows `Repo › branch`, a detail line, and a status `Ready` (info) / `Skipped` (muted, with reason) / `✓ Pulled` (success). Snapshot the targets at open so the rows persist after running | `Pull N branches` → `Close` |
| **Push** | Remote select · Remote branch (validated) · `Track it as this branch's upstream` (on by default when unpublished) · commits list | `Push N commits` |
| **New branch** | Name (live validation: empty, spaces, `.. ~ ^ : ? * [ \`, duplicate) with a hint "Use / to group" · Start from · `Switch to it now` | `Create branch` |
| **Check out** | Branch select (not checked out elsewhere) · warning when dirty | `Stash & switch` (when dirty) + `Switch to X` |
| **Add worktree** | Branch (local + remote) · Folder (auto-filled from the branch) | `Add worktree` |
| **Remove worktree** | Info note · if dirty, a danger note + type `REMOVE` | `Remove worktree` (danger) |
| **Stash changes** | Message (placeholder `WIP on <branch>`) · Include untracked · files list | `Stash` |
| **Stashes** (`stash-list.jsx`) | List rows `stash@{n}`, message, `N files · when`, with `Apply` / `Pop` / `Drop…` | `Stash current changes…` + `Close` |
| **Drop stash** | Danger note · type `DROP` | `Drop stash` (danger) |
| **Discard** (`review-dialog.jsx`) | Danger note · files list with `+/−` · type `DISCARD` when >1 file | `Stash instead` (secondary) + `Discard` (danger) |
| **Revert** | Info note · `Commit the revert straight away` | `Revert` |
| **Reset** | Radio Soft/Mixed (default)/Hard (Hard tints danger) · `Leaves the branch` list · type `RESET` for hard | `Reset (mode)` |
| **Cherry-pick** | Onto branch select · overlap warning · `-x` checkbox | `Cherry-pick` |
| **Abort rebase** | Info note · danger note with the resolved count | `Keep rebasing` (ghost) + `Abort rebase` (danger) |
| **Commit across branches** (`commit-dialog.jsx`) | Checkbox rows per worktree with staged files · one message | `Commit on N branches` |
| **Edit result** (`file-editor.jsx`) | Syntax-highlighted editor · footer says whether conflict markers remain; saving with markers doesn't resolve | `Save result` |
| **Group editor** (`group-editor.jsx`) | Name (dup check) · member filter (word-start) · tree: repo checkbox = whole repo ("includes worktrees added later"), branch rows inherit (`--accent-soft` box) or tick individually (`–` when partial) · footer summary | `Save group` (+ `Delete group…` when editing) |
| **Group menu** (`group-menu.jsx`) | **A popover menu, not a modal**: Edit members…, Rename…, Duplicate…, Delete… (danger), each opening a small dialog | — |
| **Go to file** (`go-to-file.jsx`) | Shares the Ctrl+K palette shell: 46px input, rows with a status dot (conflict/changed), basename + dir, Enter opens the first match | — |

Menus/popovers close on outside click (transparent fixed backdrop) and on Esc.

---

## State to add (desktop view)
`filter` (chip key) · `q` · `collapsed[]` · `menu: null|'more'|'group'` · `dialog` + `form` · `switcher: { open, mode:'branch'|'file', q }` · `diffMode: 'unified'|'split'` · `composeOpen` · console `{ outOpen, outMin, outBig, outTab, unread, atBottom }` + `stick` ref · rebase `{ interactive, todo{hash:action} }` · conflict `choice{path}`.

## Design tokens (map prototype literals → theme variables)
| Prototype literal | Variable |
|---|---|
| `#f4f1e8` | `--bg` |
| `#fbf8ee` | `--surface` |
| `#ebe5d4` | `--surface-2` |
| `#e3dcc6` | `--surface-3` (inner dividers) |
| `#c9bd9c` | `--border` |
| `#b0a480` | `--border-strong` |
| `#2c2618` / `#76705e` / `#a8a08a` | `--text` / `--text-muted` / `--text-subtle` |
| `#9a7e22`, `rgba(154,126,34,.12/.45)` | `--accent`, `--accent-soft`, `--accent-border` |
| `#1f7a48` / `#a85e10` / `#a02617` / `#1f5d8c` (+ `.08–.10` alpha) | `--success` / `--warning` / `--danger` / `--info` (+ `-soft`) |
| `oklch(0.58 0.18 295)` | `--violet`, `--violet-soft` |

- Radii: 4 (chips/kbd), 6 (`--radius-sm`, buttons), 8 (`--radius`), 10–12 (cards, `--radius-lg`), 14 (dialogs).
- Shadows: menus/console `--shadow-pop`, active tab `--shadow-sm`.
- Type: Geist (`--sans`) 12–13px UI, 18 detail title; Geist Mono (`--mono`) for paths, hashes and code at 11.5–12.5; uppercase labels 10.5–11px / 600 / .06–.08em.
- Buttons: 30px high (26 small, 22 in-row), 12.5px/500, primary 600.

## Files
- `Git Workspace.dc.html`: the prototype (current).
- `Git Workspace v1.dc.html`: the earlier iteration, for reference.
- `support.js`: the runtime needed to open the prototypes locally.
