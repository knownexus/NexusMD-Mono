# Mobile Redesign — Design Spec
**Date:** 2026-06-14  
**Source material:** `upgrade/` folder (helm-mobile.css, Integration Guide, reference React files)  
**Scope:** Full phone + tablet, no desktop mode

---

## Goal

Replace the existing desktop-first shell (sidebar + topbar) with a mobile-only layout using the `upgrade/` design system. The app is Android-only (Capacitor, Tab S7 primary) — there is no desktop target. All screens use `.m-*` mobile patterns exclusively.

---

## Architecture

### CSS layer
- **`public/css/helm.css`** — replace with `upgrade/assets/helm.css` (adds touch targets, bottom nav, bottom-sheet drawer/modal overrides at source level rather than via patch)
- **`public/css/helm-mobile.css`** — new file, copied from `upgrade/mobile/helm-mobile.css` with the `.proto-*` prototype chrome block stripped (everything from `/* ============ 1. PROTOTYPE CHROME */` through the `.proto-caption` rule)
- **`index.html`** — add `<link rel="stylesheet" href="/css/helm-mobile.css"/>` after `helm-planner-v2.css`

### App shell (`src/app.jsx`)
The `App()` component is rewritten. The desktop sidebar, topbar, and `.app` grid are removed entirely.

**New shell structure:**
```
.m-app  data-device="phone|tablet"  data-theme={palette}
  StatusBar
  [phone]
    .m-main  → {activeScreen}
    BottomNav  (4 tabs + More)
  [tablet]
    .m-bodyrow
      Rail  (icon nav, left column)
      .m-main  → {activeScreen}
  Flash  (toast, absolutely positioned)
  MoreSheet  (secondary nav, bottom sheet)
```

**Device detection:**
```js
const isPhone = window.matchMedia('(max-width:600px)').matches;
// also listen for resize/orientation change and re-derive
```

**Navigation — primary tabs (phone bottom nav + tablet rail):**
| id | Label | Icon |
|----|-------|------|
| dashboard | Home | dashboard |
| work | Work | work |
| planner | Planner | planner |
| pr | PRs | pr |
| more | More | more |

**Navigation — secondary (via More bottom sheet, 2-col action grid):**
Builds · Tests · Calendar · Triage · Team · Markdown · Settings

**Badges:** PRs tab shows "needs-me" count badge (existing `changeBadges` logic reused).

### Shared atoms (`src/components.jsx`)
Atoms from `upgrade/mobile/shell.jsx` are adapted and merged into the existing `src/components.jsx`:
- `Sheet({ open, onClose, icon, title, sub, children, footer, size })` — `.m-sheet-veil` + `.m-sheet` bottom sheet, escape key closes
- `Avatar({ who, size })` — reads from `window.HelmData.TEAM` initials
- `StatusChip({ value, onChange, readOnly })` — `.stchip` with inline `<select>`
- `PrioChip({ value, onChange, readOnly })` — `.priochip` with inline `<select>`
- `DueLabel({ value, status })` — coloured due date (overdue = danger, today = accent)
- `Flash({ msg, icon })` — `.m-flash` toast (existing `src/toast.jsx` can be replaced or unified)

`mdToHtml` mini-markdown stays in `src/MarkdownViewer.jsx` (already exists).

---

## Screens

### Dashboard (`src/views/view-dashboard.jsx`)
**Phone:**
- `.m-appbar` — title "Home", subtitle sprint name + days remaining, search icon button
- `.m-screen` scroll area
- `.m-stats` 2-up grid: Open WIs · Blocked · PRs needs-me · Builds failing — each stat tile is tappable (navigates to relevant screen)
- Sprint card: `.m-card` with `.m-prog` progress bar (done/in-progress/review segments) + legend
- Quick links row: horizontal scroll of `.m-chip` buttons
- Recent activity: `.m-card` with `.m-row` activity items (reuse existing activity data)
- Blockers card: `.m-card` with `.m-row` per blocked item

**Tablet:** `.m-cardgrid.wide` (1.4fr / 1fr two-column), stats become 4-up (`.m-stats` with `grid-template-columns: repeat(4,1fr)` already handled by CSS `[data-device="tablet"]`).

---

### Work Items (`src/views/view-workitems.jsx`)
**Phone:**
- `.m-appbar` — title "Work", search icon (opens `.m-search` inline), filter button (opens filter sheet)
- `.m-screen`
- `.m-seg` segmented: List | Board
- **List mode:** `.m-card.flush` containing `.m-row` per work item (`WorkCard` pattern from reference `work.jsx`, adapted to `HelmData.WORK_ITEMS`)
  - Leading `.m-typ` colour swatch (type)
  - Title, `#id` mono, state pill, priority chip, assignee avatar+name, updated date
  - Tap → existing `DetailDrawer` (already bottom-sheets at mobile widths via CSS)
- **Board mode:** horizontal snap-scroll lanes (`.board` with `overflow-x: auto; scroll-snap-type: x mandatory`)
- **Filter sheet:** single `.m-sheet` with chip groups for Type / State / Assignee / Priority; "Apply" + "Clear" footer buttons
- FAB (`.m-fab` `+`) → `CreateWIModal` refactored as bottom sheet

**Tablet:** same as phone but items in `.m-cardgrid` two-column list.

---

### Pull Requests (`src/views/view-prs.jsx`)
**Phone:**
- `.m-appbar` — "Pull Requests", needs-me badge
- `.m-screen`
- `.m-seg` segmented: All | Needs me | Drafts
- `.m-card.flush` containing `.pr-row` items (existing class, already responsive)
- PR tap → `.m-sheet size="tall"` detail sheet: title, description, reviewers, checks, Approve / Comment / Open in ADO buttons
- Existing state pills (active/draft/merged/blocked) reused

---

### Planner (`src/planner/view-planner.jsx`)
**Phone:**
- Force `navMode = 'tabs'` (already supported)
- Force `entryMode = 'quickadd'` (already supported)
- `.m-appbar`: title = active section name, week chip (opens week-switcher sheet), search + view-menu icon buttons
- Week chip tap → `.m-sheet` showing week selector (existing week navigation logic)
- Section chips: `.m-chipscroll` horizontal scroll (existing section tabs become chips)
- `.m-screen` scroll area with QuickAdd list rows
- FAB (`.m-fab` `+`) → capture sheet with 2-col `.m-actiongrid`: Note · Meeting · Task · Work Item

**Tablet:**
- `.m-twopane`: left pane = `.m-pane-nav` section list (`.m-paneitem` per section); right pane = selected section items
- No chip scroll on tablet (sidebar handles navigation)

---

### Secondary screens (Builds, Tests, Calendar, Triage, Team, Markdown)
Each screen gets wrapped in the standard mobile shell:
- `.m-appbar` with title + back-to-more button (or just title, since More sheet handles nav)
- `.m-screen` wrapping the existing view content
- No other content changes — existing table/list components are left intact; CSS touch targets and bottom-sheet drawer already apply

---

### Settings
`SettingsModal` refactored: the fixed-position overlay becomes a `Sheet` (`.m-sheet`) opened from the More menu. Interior form layout unchanged. `ProjectAreasModal` same treatment. `CreateWIModal` becomes a `Sheet size="tall"`.

---

## Data mapping

Reference files used `window.SEED.*`. Production bindings:

| SEED reference | HelmData equivalent |
|----------------|---------------------|
| `SEED.WORK_ITEMS` | `window.HelmData.WORK_ITEMS` |
| `SEED.PRS` | `window.HelmData.PRS` |
| `SEED.TEAM` | `window.HelmData.TEAM` |
| `SEED.PROJECTS` | `window.HelmData.PROJECTS` |
| `SEED.BUILDS` | `window.HelmData.BUILDS` |
| `SEED.initials(who)` | existing `initials()` helper in `src/globals.js` |
| `SEED.name(who)` | display name lookup from `HelmData.TEAM` |

`upgrade/mobile/seed.jsx` is **not merged**.

---

## Files changed

| File | Change |
|------|--------|
| `index.html` | Add helm-mobile.css link tag |
| `public/css/helm.css` | Replace with `upgrade/assets/helm.css` |
| `public/css/helm-mobile.css` | New — stripped copy of `upgrade/mobile/helm-mobile.css` |
| `src/app.jsx` | Rewrite App() shell; refactor modals to Sheet |
| `src/components.jsx` | Add Sheet, Avatar, StatusChip, PrioChip, DueLabel, Flash atoms |
| `src/views/view-dashboard.jsx` | Rewrite to mobile layout |
| `src/views/view-workitems.jsx` | Rewrite to mobile card rows + filter sheet + FAB |
| `src/views/view-prs.jsx` | Rewrite to mobile card list + seg control + detail sheet |
| `src/planner/view-planner.jsx` | Force phone defaults, add FAB + capture sheet, tablet two-pane |
| `src/views/view-builds.jsx` | Wrap in m-appbar + m-screen |
| `src/views/view-tests.jsx` | Wrap in m-appbar + m-screen |
| `src/views/view-calendar.jsx` | Wrap in m-appbar + m-screen |
| `src/views/view-triage.jsx` | Wrap in m-appbar + m-screen |
| `src/views/view-team.jsx` | Wrap in m-appbar + m-screen |
| `src/icons.jsx` | Verify/add: dashboard, work, pr, build, inbox, more icons |

**Not changed:** `ado-client.js`, `data.jsx`, `globals.js`, `MarkdownViewer.jsx`, planner sub-components (editors, notes, glance), `triage.jsx`, `toast.jsx` (existing desktop toast; `Flash` in `components.jsx` is a new parallel mobile toast — both coexist).

---

## Constraints

- All styling uses existing design tokens from `helm.css` — theme-agnostic across all 7 palettes
- No new dependencies
- `upgrade/mobile/seed.jsx` is demo data only, not merged
- Android Capacitor safe-area insets respected via `env(safe-area-inset-bottom)` already in `helm-mobile.css`
