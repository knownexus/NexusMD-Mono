# Design: Board user×stage view, tablet rail tabs, markdown toggle

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Three related UI improvements:
1. Board view shows each user's work items broken down by stage (vertical user list, horizontal stage columns per user).
2. Builds and Tests tabs become reachable on the tablet rail (Tab S7).
3. A settings toggle controls whether the Markdown tab appears in navigation.

---

## 1. Board view — user × stage layout

### Problem
When the board is grouped by user (`groupBy === 'user'`), the current render produces one horizontal lane per user — no stage breakdown. The user wants to see each user's items split across the standard stages (To Do, Active, Blocked, In Review, Done), with users stacked vertically.

### Design

**File:** `src/views/view-workitems.jsx`

Add a `userBoardData` memo (only computed when `viewMode === 'board'`):

```js
const userBoardData = useMemo(() => {
  if (viewMode !== 'board' || groupBy !== 'user') return null;
  const ids = [...new Set(filtered.map(w => w.assignee || 'unassigned'))];
  ids.sort((a, b) => {
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    return memberName(a).localeCompare(memberName(b));
  });
  return ids.map(userId => ({
    userId,
    label: memberName(userId),
    lanes: LANES.map(lane => ({
      key: lane,
      label: lane,
      items: filtered.filter(w =>
        (w.assignee || 'unassigned') === userId && laneFilter(lane, w)
      ),
    })),
  }));
}, [filtered, viewMode, groupBy, team]);
```

**Render branch** inside the board block (`viewMode !== 'list'`):

- If `userBoardData` is not null: render a vertical stack of user sections. Each section has a user name header followed by a horizontally-scrolling row of stage columns (same column style as the existing board — `minWidth:256`, card background, item cards with title and type icon). Outer scroll is the page; inner scroll is horizontal per-user section with `scrollSnapType:x mandatory`.
- Otherwise: existing flat `boardLanes` render, unchanged.

**No new state.** This is a pure render branch on existing `groupBy` and `viewMode` state.

---

## 2. Builds & Tests tabs on the tablet rail

### Problem
`TabletRail` shows `primaryTabs` in its main section and `RAIL_PINNED` at the bottom. `RAIL_PINNED` currently only includes `team` and `settings`. All other secondary tabs — including builds and tests — are unreachable on tablet because the More sheet is phone-only.

### Design

**File:** `src/app.jsx`

Change `RAIL_PINNED` to include `builds` and `tests`:

```js
const RAIL_PINNED = secondaryTabs.filter(t =>
  ['builds', 'tests', 'team', 'settings'].includes(t.id) ||
  (t.id === 'markdown' && tweaks.showMarkdown !== false)
);
```

Since `secondaryTabs` for manual profiles already excludes `builds` and `tests` (via `tabsForType`), those tabs will not appear for manual profiles. No additional guard needed.

Rail bottom order: builds → tests → [markdown if enabled] → team → settings.

---

## 3. Markdown tab toggle

### Problem
The Markdown viewer tab is inaccessible on tablet (not in RAIL_PINNED) and the user wants an explicit on/off control since not everyone uses it.

### Design

**`DEFAULT_TWEAKS` in `src/app.jsx`:**

```js
"showMarkdown": true
```

**`RAIL_PINNED`** (same expression as above — markdown included when `tweaks.showMarkdown !== false`).

**Phone secondary tabs:** Filter `secondaryTabs` before passing to `MobileBottomNav` / the More sheet — exclude `markdown` when `tweaks.showMarkdown === false`. Concretely, compute a `visibleSecondaryTabs` derived from `secondaryTabs`:

```js
const visibleSecondaryTabs = secondaryTabs.filter(t =>
  t.id !== 'markdown' || tweaks.showMarkdown !== false
);
```

Pass `visibleSecondaryTabs` instead of `secondaryTabs` to `MobileBottomNav` and the More sheet `Sheet` render.

**Settings UI — `src/views/view-settings.jsx`:**

In the Appearance card (`subPage === 'appearance'`), add after the existing type-labels row:

```jsx
<VsRow title="Markdown tab" desc="Show the Markdown viewer in the navigation">
  <PlToggle
    checked={tweaks.showMarkdown !== false}
    onChange={v => setTweak('showMarkdown', v)}
  />
</VsRow>
```

---

## Files changed

| File | Change |
|------|--------|
| `src/views/view-workitems.jsx` | Add `userBoardData` memo; add render branch for user×stage board |
| `src/app.jsx` | Add `showMarkdown` to `DEFAULT_TWEAKS`; expand `RAIL_PINNED`; compute `visibleSecondaryTabs` |
| `src/views/view-settings.jsx` | Add Markdown tab toggle row in Appearance card |

---

## Out of scope

- No changes to the list-mode grouping or existing board behaviour for status/project groupBy.
- No changes to desktop sidebar (`NAV_PRIMARY` / `NAV_SECONDARY`).
- No changes to manual profile tab filtering beyond what `tabsForType` already handles.
