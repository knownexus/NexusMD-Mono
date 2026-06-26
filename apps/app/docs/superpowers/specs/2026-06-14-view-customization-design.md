# Design: View Customization & Persistence

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Four related improvements to view configuration across the app:

1. PR page: group by project
2. Home page: choose which widgets are visible
3. Work items: sort by number, status, or type (within any grouping)
4. Persist view settings (filters, grouping, sort) across sessions

---

## 1. PR grouping by project

**File:** `src/views/view-prs.jsx`

### Data

PR objects already carry a `project` field (set in `data.jsx` line 174). No data layer changes needed.

### State

Add `groupBy` state initialized from persisted view state (see Section 4):

```js
const [groupBy, setGroupBy] = useState(() => loadPRViewState().groupBy ?? null);
// values: null | 'project'
```

### UI — toggle button in appbar

Add a group icon button to the PR appbar actions row (alongside the existing segment control area). When `groupBy === 'project'`, the button is visually active (accent colour). Tapping it toggles between `null` and `'project'`.

### Rendering

When `groupBy === null`: existing flat list, unchanged.

When `groupBy === 'project'`:
- Derive sorted project list from `filtered` (the already-segmented list): `[...new Set(filtered.map(pr => pr.project || 'Unknown'))].sort()`
- Render a project header (`<div className="m-list-section-header">`) followed by the PR rows for that project
- Empty projects are not shown
- The `seg` filter (all / needs-me / drafts) applies before grouping, so it still works as normal

---

## 2. Dashboard widget chooser

**Files:** `src/views/view-dashboard.jsx`, `src/views/view-settings.jsx`, `src/app.jsx`

### Tweak key

Add to `DEFAULT_TWEAKS`:

```js
"hiddenDashWidgets": []
```

An array of widget IDs that are hidden. Empty by default = all widgets visible.

### Widget IDs

| ID | Widget |
|----|--------|
| `sprint` | Sprint progress |
| `blockers` | Blockers |
| `needsme` | PRs needing review |
| `activity` | Recent activity |

Stat tiles are always shown (they are the primary dashboard numbers). Quick links already render conditionally based on data — not togglable.

### Settings UI

In `src/views/view-settings.jsx`, Appearance card, add a "Dashboard widgets" group after the existing Markdown tab toggle:

```jsx
<VsRow title="Sprint progress" desc="Current sprint burndown on the home page">
  <PlToggle
    checked={!tweaks.hiddenDashWidgets?.includes('sprint')}
    onChange={v => toggleDashWidget('sprint', v)}
  />
</VsRow>
<VsRow title="Blockers" desc="Blocked work items on the home page">
  <PlToggle
    checked={!tweaks.hiddenDashWidgets?.includes('blockers')}
    onChange={v => toggleDashWidget('blockers', v)}
  />
</VsRow>
<VsRow title="PRs needing review" desc="Pull requests waiting for your review">
  <PlToggle
    checked={!tweaks.hiddenDashWidgets?.includes('needsme')}
    onChange={v => toggleDashWidget('needsme', v)}
  />
</VsRow>
<VsRow title="Recent activity" desc="Latest team updates on the home page">
  <PlToggle
    checked={!tweaks.hiddenDashWidgets?.includes('activity')}
    onChange={v => toggleDashWidget('activity', v)}
  />
</VsRow>
```

`toggleDashWidget(id, shown)` helper in `SettingsView`:

```js
const toggleDashWidget = (id, shown) => {
  const current = tweaks.hiddenDashWidgets || [];
  setTweak('hiddenDashWidgets', shown
    ? current.filter(x => x !== id)
    : [...current, id]
  );
};
```

### DashboardView prop threading

In `app.jsx`, add `tweaks={tweaks}` to the `<DashboardView .../>` JSX element.

`DashboardView` already receives named props — add `tweaks = {}` to its destructuring. Gate each widget:

```jsx
{/* Sprint progress */}
{sprintItems.length > 0 && !tweaks.hiddenDashWidgets?.includes('sprint') && ( ... )}

{/* Blockers */}
{blockers.length > 0 && !tweaks.hiddenDashWidgets?.includes('blockers') && ( ... )}

{/* PRs needing review */}
{needsMePrs.length > 0 && !tweaks.hiddenDashWidgets?.includes('needsme') && ( ... )}

{/* Recent activity */}
{recentAct.length > 0 && !tweaks.hiddenDashWidgets?.includes('activity') && ( ... )}
```

---

## 3. Work items sort

**File:** `src/views/view-workitems.jsx`

### State

```js
const [sortBy, setSortBy] = useState(() => loadWorkItemsViewState().sortBy ?? null);
// values: null | 'id' | 'status' | 'type'
```

### Sort logic

Applied after `filtered` is computed, before grouping. A `sortedFiltered` memo:

```js
const sortedFiltered = useMemo(() => {
  if (!sortBy) return filtered;
  return [...filtered].sort((a, b) => {
    if (sortBy === 'id')     return a.id - b.id;
    if (sortBy === 'status') return (a.state || '').localeCompare(b.state || '');
    if (sortBy === 'type')   return (a.type  || '').localeCompare(b.type  || '');
    return 0;
  });
}, [filtered, sortBy]);
```

All downstream memos (`groupedList`, `boardLanes`, `userBoardData`) consume `sortedFiltered` instead of `filtered`. Sorting within groups is automatic — each group bucket is built from `sortedFiltered`, so items inside each group are already in sort order.

### UI — sort chips in filter sheet

In the filter sheet, below the existing groupBy chips, add a "Sort by" row with three chips: **Number**, **Status**, **Type**. Tapping an active chip clears sort (sets to `null`). Chips use the same `ChipToggle` pattern as groupBy.

The filter button badge count (`filterCount`) is not incremented by sort — sort is not a filter.

---

## 4. Persist view settings

**Files:** `src/views/view-workitems.jsx`, `src/views/view-prs.jsx`

### Storage keys (profile-scoped)

```js
window.getProfileKey('helm.workitems.viewState')  // work items
window.getProfileKey('helm.prs.viewState')         // pull requests
```

### Work items — what is persisted

```js
{
  groupBy,       // null | 'user' | 'project' | 'status'
  sortBy,        // null | 'id' | 'status' | 'type'
  typeFilter,    // array (from Set)
  stateFilter,   // array (from Set)
  assigneeFilter // array (from Set)
}
```

`search` is **not** persisted — text search is ephemeral.

### PR view — what is persisted

```js
{
  groupBy,  // null | 'project'
  seg       // 'all' | 'needsme' | 'drafts'
}
```

### Load pattern (lazy useState initializer)

```js
function loadWorkItemsViewState() {
  try {
    const s = localStorage.getItem(window.getProfileKey('helm.workitems.viewState'));
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}
```

Initialize state from the loader:

```js
const [groupBy, setGroupBy] = useState(() => loadWorkItemsViewState().groupBy ?? null);
const [sortBy,  setSortBy]  = useState(() => loadWorkItemsViewState().sortBy  ?? null);
const [typeFilter,    setTypeFilter]    = useState(() => new Set(loadWorkItemsViewState().typeFilter    || []));
const [stateFilter,   setStateFilter]   = useState(() => new Set(loadWorkItemsViewState().stateFilter   || []));
const [assigneeFilter, setAssigneeFilter] = useState(() => new Set(loadWorkItemsViewState().assigneeFilter || []));
```

### Save pattern (useEffect)

```js
useEffect(() => {
  try {
    localStorage.setItem(
      window.getProfileKey('helm.workitems.viewState'),
      JSON.stringify({
        groupBy,
        sortBy,
        typeFilter:     [...typeFilter],
        stateFilter:    [...stateFilter],
        assigneeFilter: [...assigneeFilter],
      })
    );
  } catch {}
}, [groupBy, sortBy, typeFilter, stateFilter, assigneeFilter]);
```

Same pattern for PR view state (`groupBy`, `seg`).

### Profile switching

When the user switches profiles, the profile key changes, so `loadWorkItemsViewState()` naturally returns a different (or empty) object. No explicit clear needed.

---

## Files changed

| File | Change |
|------|--------|
| `src/views/view-prs.jsx` | Add `groupBy` state; derive sorted project groups from `filtered`; add appbar toggle button; persist/restore view state |
| `src/views/view-dashboard.jsx` | Add `tweaks` prop; gate each widget on `hiddenDashWidgets` |
| `src/views/view-settings.jsx` | Add `toggleDashWidget` helper; add 4 widget toggle rows in Appearance card |
| `src/views/view-workitems.jsx` | Add `sortBy` state; add `sortedFiltered` memo; wire downstream memos to use `sortedFiltered`; add sort chips to filter sheet; persist/restore view state |
| `src/app.jsx` | Add `hiddenDashWidgets: []` to `DEFAULT_TWEAKS`; thread `tweaks` into `DashboardView` |

---

## Out of scope

- Drag-to-reorder widgets on the dashboard
- Sort on the PR list (only grouping is added)
- Persisting the `search` text field
- Syncing view state across profiles or devices
