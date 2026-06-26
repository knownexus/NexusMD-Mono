# View Customization & Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PR project grouping, dashboard widget chooser, work-items sort, and persistent view state (filters/group/sort survive page reload).

**Architecture:** Five isolated edits across five files. Tasks 1–3 are a chain (app.jsx seeds `hiddenDashWidgets`, dashboard gates on it, settings exposes the toggles). Tasks 4 and 5 are independent and can land in any order. No new files, no new abstractions.

**Tech Stack:** React (vanilla, no build step), JSX loaded directly in browser, `window.useTweaks` + localStorage for persistence, Capacitor Android shell (Tab S7).

---

## File map

| File | What changes |
|------|-------------|
| `src/app.jsx` | Add `hiddenDashWidgets: []` to `DEFAULT_TWEAKS`; pass `hiddenDashWidgets` prop to `DashboardView` |
| `src/views/view-dashboard.jsx` | Accept `hiddenDashWidgets` prop; gate sprint/blockers/needsme/activity widgets |
| `src/views/view-settings.jsx` | Add `toggleDashWidget` helper + 4 toggle rows after Markdown toggle in Appearance card |
| `src/views/view-workitems.jsx` | Add `sortBy` state; add `sortedFiltered` memo; wire downstream memos to `sortedFiltered`; add sort chips to filter sheet; load/save all view state to localStorage |
| `src/views/view-prs.jsx` | Add `groupBy` state; add project group toggle in appbar; render grouped list when active; load/save `{groupBy, seg}` to localStorage |

**Execution order:** Task 1 → Task 2 → Task 3 (chain). Task 4 and Task 5 are independent.

---

## Task 1: `app.jsx` — seed `hiddenDashWidgets` and thread into DashboardView

**Files:**
- Modify: `src/app.jsx`

### Context

`DEFAULT_TWEAKS` (near line 31) controls default values for the tweaks system. `DashboardView` is called around line 1866 with individual tweak values passed as props. We add the new key and pass it through.

- [ ] **Step 1: Add `hiddenDashWidgets` to `DEFAULT_TWEAKS`**

Find `DEFAULT_TWEAKS` (around line 31). Add `"hiddenDashWidgets": []` after `"showMarkdown": true`:

```js
const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "lightTheme": "parchment",
  "darkTheme": "cobalt",
  "density": "balanced",
  "sidebar": "labels",
  "typeLabels": false,
  "widgetOrder": ["sprint", "review", "blockers", "team", "triage", "activity", "resolvedme"],
  "widgetWidths": {},
  "widgetHeights": {},
  "quickLinks": [],
  "showMarkdown": true,
  "hiddenDashWidgets": []
}/*EDITMODE-END*/;
```

- [ ] **Step 2: Pass `hiddenDashWidgets` to `DashboardView`**

Find the `case 'dashboard':` line (around line 1866). The existing JSX already passes `widgetOrder`, `quickLinks`, etc. Add `hiddenDashWidgets={tweaks.hiddenDashWidgets || []}` to that element:

```jsx
case 'dashboard': return <DashboardView onOpenItem={openWI} onOpenPR={openPR}
  widgetOrder={tweaks.widgetOrder} setWidgetOrder={arr => setTweak('widgetOrder', arr)}
  quickLinks={tweaks.quickLinks || DEFAULT_TWEAKS.quickLinks}
  density={tweaks.density} team={team} acknowledgedSet={acknowledgedSet}
  needsMeCriteria={needsMeCriteria}
  setPlannerData={setPlannerData}
  widgetWidths={tweaks.widgetWidths || {}} setWidgetWidths={ww => setTweak('widgetWidths', ww)}
  widgetHeights={tweaks.widgetHeights || {}} setWidgetHeights={wh => setTweak('widgetHeights', wh)}
  hiddenDashWidgets={tweaks.hiddenDashWidgets || []}
  device={device} onFlash={showFlash}/>;
```

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx
git commit -m "feat(dashboard): add hiddenDashWidgets tweak key; thread into DashboardView"
```

---

## Task 2: `view-dashboard.jsx` — gate widgets on `hiddenDashWidgets`

**Files:**
- Modify: `src/views/view-dashboard.jsx`

### Context

`DashboardView` currently receives: `onOpenItem`, `onOpenPR`, `quickLinks`, `team`, `acknowledgedSet`, `needsMeCriteria`, `device`, and several widget-order props. We add `hiddenDashWidgets = []` and use it to gate the four toggleable widgets.

Widget IDs: `sprint`, `blockers`, `needsme`, `activity`.

The stat tiles row (Open items / Blocked / Needs my review / Failed builds) is **always shown** — do not gate it.

Quick links is already conditionally rendered on data — do not gate it.

- [ ] **Step 1: Add `hiddenDashWidgets` to the props destructuring**

Find the `function DashboardView({` line (line 4). Add `hiddenDashWidgets = []` to the destructuring:

```js
function DashboardView({
  onOpenItem, onOpenPR, quickLinks, team = [], acknowledgedSet,
  needsMeCriteria, device, hiddenDashWidgets = [],
}) {
```

- [ ] **Step 2: Gate the Sprint progress widget**

Find the sprint progress block (starts at `{/* Sprint progress */}`, around line 77):

```jsx
{sprintItems.length > 0 && (
```

Change to:

```jsx
{sprintItems.length > 0 && !hiddenDashWidgets.includes('sprint') && (
```

- [ ] **Step 3: Gate the Blockers widget**

Find `{/* Blockers */}` (around line 112):

```jsx
{blockers.length > 0 && (
```

Change to:

```jsx
{blockers.length > 0 && !hiddenDashWidgets.includes('blockers') && (
```

- [ ] **Step 4: Gate the PRs needing review widget**

Find `{/* PRs needing review */}` (around line 141):

```jsx
{needsMePrs.length > 0 && (
```

Change to:

```jsx
{needsMePrs.length > 0 && !hiddenDashWidgets.includes('needsme') && (
```

- [ ] **Step 5: Gate the Recent activity widget**

Find `{/* Recent activity */}` (around line 166):

```jsx
{recentAct.length > 0 && (
```

Change to:

```jsx
{recentAct.length > 0 && !hiddenDashWidgets.includes('activity') && (
```

- [ ] **Step 6: Commit**

```bash
git add src/views/view-dashboard.jsx
git commit -m "feat(dashboard): gate sprint/blockers/needsme/activity widgets on hiddenDashWidgets"
```

---

## Task 3: `view-settings.jsx` — dashboard widget toggles in Appearance card

**Files:**
- Modify: `src/views/view-settings.jsx`

### Context

`SettingsView` already receives `tweaks` and `setTweak` as props. `VsRow` and `PlToggle` are defined in this file. The Appearance card ends at line 530 with the Markdown tab toggle row then `</VsCard>`. We add 4 more toggle rows immediately after the Markdown toggle.

The `toggleDashWidget(id, shown)` helper adds/removes an ID from `tweaks.hiddenDashWidgets`. When `shown` is `true`, the widget ID is removed from the hidden array. When `false`, it is added.

- [ ] **Step 1: Add the `toggleDashWidget` helper inside `SettingsView`**

Find the `SettingsView` function body. Add this helper near the top, with the other handler functions:

```js
const toggleDashWidget = (id, shown) => {
  const current = tweaks.hiddenDashWidgets || [];
  setTweak('hiddenDashWidgets', shown
    ? current.filter(x => x !== id)
    : [...current, id]
  );
};
```

- [ ] **Step 2: Add 4 widget toggle rows to the Appearance card**

Find the Markdown tab toggle row in the Appearance card (around line 524–529):

```jsx
<VsRow title="Markdown tab" desc="Show the Markdown viewer in the navigation">
  <PlToggle
    checked={tweaks.showMarkdown !== false}
    onChange={v => setTweak('showMarkdown', v)}
  />
</VsRow>
```

Add these 4 rows directly after it (before the closing `</VsCard>`):

```jsx
<VsRow title="Sprint progress" desc="Show the sprint burndown widget on the home page">
  <PlToggle
    checked={!(tweaks.hiddenDashWidgets || []).includes('sprint')}
    onChange={v => toggleDashWidget('sprint', v)}
  />
</VsRow>
<VsRow title="Blockers widget" desc="Show blocked work items on the home page">
  <PlToggle
    checked={!(tweaks.hiddenDashWidgets || []).includes('blockers')}
    onChange={v => toggleDashWidget('blockers', v)}
  />
</VsRow>
<VsRow title="PRs needing review" desc="Show pull requests waiting for your review on the home page">
  <PlToggle
    checked={!(tweaks.hiddenDashWidgets || []).includes('needsme')}
    onChange={v => toggleDashWidget('needsme', v)}
  />
</VsRow>
<VsRow title="Recent activity" desc="Show the team activity feed on the home page">
  <PlToggle
    checked={!(tweaks.hiddenDashWidgets || []).includes('activity')}
    onChange={v => toggleDashWidget('activity', v)}
  />
</VsRow>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/view-settings.jsx
git commit -m "feat(settings): add dashboard widget visibility toggles in appearance card"
```

---

## Task 4: `view-workitems.jsx` — sort by number/status/type + persist view state

**Files:**
- Modify: `src/views/view-workitems.jsx`

### Context

`WorkItemsView` has `filtered` (the post-filter items), then three memos that consume it: `groupedList`, `boardLanes`, `userBoardData`. We insert a `sortedFiltered` memo between `filtered` and those three — all three switch from `filtered` to `sortedFiltered`.

State is currently all ephemeral `useState`. We add a load helper (IIFE inside lazy initializer) and a save `useEffect`.

The filter sheet already has a `Group by` field with `ChipToggle` chips. We add a `Sort by` field below it.

- [ ] **Step 1: Add the load/save helpers at the top of the file (module level)**

After the `window.WorkItemsView = WorkItemsView;` line is where we want it, but since these helpers are used inside the component via lazy initializers, define them as module-level functions before `function WorkItemsView`. Add after the `ChipToggle` and `GroupHeader` component definitions:

```js
function loadWIViewState() {
  try {
    const s = localStorage.getItem(window.getProfileKey('helm.workitems.viewState'));
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}
```

- [ ] **Step 2: Change the state initializers to restore from localStorage**

Find the state declarations at the top of `WorkItemsView` (lines 92–99):

```js
const [search, setSearch]           = useState('');
const [viewMode, setViewMode]       = useState('list');
const [filterOpen, setFilterOpen]   = useState(false);
const [typeFilter, setTypeFilter]   = useState(new Set());
const [stateFilter, setStateFilter] = useState(new Set());
const [assigneeFilter, setAssigneeFilter] = useState(new Set());
const [groupBy, setGroupBy]         = useState(null);
const [collapsedGroups, setCollapsedGroups] = useState(new Set());
```

Replace with (add `sortBy` state, and restore persisted values):

```js
const [search, setSearch]           = useState('');
const [viewMode, setViewMode]       = useState('list');
const [filterOpen, setFilterOpen]   = useState(false);
const [typeFilter, setTypeFilter]   = useState(() => new Set(loadWIViewState().typeFilter || []));
const [stateFilter, setStateFilter] = useState(() => new Set(loadWIViewState().stateFilter || []));
const [assigneeFilter, setAssigneeFilter] = useState(() => new Set(loadWIViewState().assigneeFilter || []));
const [groupBy, setGroupBy]         = useState(() => loadWIViewState().groupBy ?? null);
const [sortBy, setSortBy]           = useState(() => loadWIViewState().sortBy ?? null);
const [collapsedGroups, setCollapsedGroups] = useState(new Set());
```

- [ ] **Step 3: Add the `sortedFiltered` memo after the `filtered` memo**

Find the `filtered` memo (lines 126–133):

```js
const filtered = useMemo(() => list.filter(w => {
  ...
}), [list, typeFilter, stateFilter, assigneeFilter, search]);
```

Directly after its closing `}), [list, typeFilter, stateFilter, assigneeFilter, search]);`, add:

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

- [ ] **Step 4: Switch the three downstream memos from `filtered` to `sortedFiltered`**

**`groupedList` memo** (around line 135): Change every reference to `filtered` inside the memo body and deps to `sortedFiltered`:

Old first line: `const groupedList = useMemo(() => {`
Old body uses `filtered.forEach(...)` and `filtered.filter(...)`
Old deps: `[filtered, groupBy, team]`

New deps: `[sortedFiltered, groupBy, team]`
New body: replace `filtered.forEach` → `sortedFiltered.forEach`, `filtered.filter` → `sortedFiltered.filter`:

```js
const groupedList = useMemo(() => {
  if (!groupBy) return null;
  const buckets = {};
  sortedFiltered.forEach(w => {
    const key =
      groupBy === 'user'    ? (w.assignee || 'unassigned') :
      groupBy === 'project' ? (w.project  || 'Unknown')    :
      /* status */ (LANES.find(lane => laneFilter(lane, w)) || w.state || 'Unknown');
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(w);
  });

  if (groupBy === 'status') {
    const known = STATUS_ORDER.filter(s => buckets[s]);
    const rest  = Object.keys(buckets).filter(k => !STATUS_ORDER.includes(k)).sort();
    return [...known, ...rest].map(k => ({ key: k, label: k, items: buckets[k] }));
  }
  if (groupBy === 'user') {
    const keys = Object.keys(buckets).filter(k => k !== 'unassigned').sort(
      (a, b) => memberName(a).localeCompare(memberName(b))
    );
    if (buckets['unassigned']) keys.push('unassigned');
    return keys.map(k => ({ key: k, label: memberName(k), items: buckets[k] }));
  }
  // project
  return Object.keys(buckets).sort().map(k => ({ key: k, label: k, items: buckets[k] }));
}, [sortedFiltered, groupBy, team]);
```

**`boardLanes` memo** (around line 163): Change `filtered.filter(...)` → `sortedFiltered.filter(...)` throughout, and update deps:

```js
const boardLanes = useMemo(() => {
  if (!groupBy || groupBy === 'status') {
    return LANES.map(lane => ({
      key: lane,
      label: lane,
      items: sortedFiltered.filter(w => laneFilter(lane, w)),
    }));
  }
  if (groupBy === 'user') {
    const ids = [...new Set(sortedFiltered.map(w => w.assignee || 'unassigned'))];
    ids.sort((a, b) => {
      if (a === 'unassigned') return 1;
      if (b === 'unassigned') return -1;
      return memberName(a).localeCompare(memberName(b));
    });
    return ids.map(id => ({
      key: id,
      label: memberName(id),
      items: sortedFiltered.filter(w => (w.assignee || 'unassigned') === id),
    }));
  }
  // project
  const projects = [...new Set(sortedFiltered.map(w => w.project || 'Unknown'))].sort();
  return projects.map(proj => ({
    key: proj,
    label: proj,
    items: sortedFiltered.filter(w => (w.project || 'Unknown') === proj),
  }));
}, [sortedFiltered, groupBy, team]);
```

**`userBoardData` memo** (around line 193): Change `filtered.map(...)` and `filtered.filter(...)` → `sortedFiltered`, update deps:

```js
const userBoardData = useMemo(() => {
  if (viewMode !== 'board' || groupBy !== 'user') return null;
  const ids = [...new Set(sortedFiltered.map(w => w.assignee || 'unassigned'))];
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
      items: sortedFiltered.filter(w =>
        (w.assignee || 'unassigned') === userId && laneFilter(lane, w)
      ),
    })),
  }));
}, [sortedFiltered, viewMode, groupBy, team]);
```

Also update the **flat list render** and **empty state check**: find these two uses of `filtered` in the JSX:

```jsx
{viewMode === 'list' ? (
  filtered.length === 0
```

```jsx
{filtered.map(wi => (
```

```jsx
Show {filtered.length}
```

Replace each with `sortedFiltered`:

```jsx
{viewMode === 'list' ? (
  sortedFiltered.length === 0
```

```jsx
{sortedFiltered.map(wi => (
```

```jsx
Show {sortedFiltered.length}
```

- [ ] **Step 5: Add the persistence `useEffect`**

After the `useEffect(() => { setCollapsedGroups(new Set()); }, [groupBy]);` line (line 100), add:

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

- [ ] **Step 6: Add the Sort by field to the filter sheet**

Find the `Group by` field in the filter sheet (around line 393–403):

```jsx
<div className="m-fld">
  <label>Group by</label>
  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
    {['user','project','status'].map(g => (
      <ChipToggle key={g}
        label={g.charAt(0).toUpperCase() + g.slice(1)}
        active={groupBy === g}
        onToggle={() => setGroupBy(groupBy === g ? null : g)}/>
    ))}
  </div>
</div>
```

Add a Sort by field directly after this `</div>` and before the `{allTypes.length > 0 && ...` block:

```jsx
<div className="m-fld">
  <label>Sort by</label>
  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
    {[['id','Number'],['status','Status'],['type','Type']].map(([val, label]) => (
      <ChipToggle key={val}
        label={label}
        active={sortBy === val}
        onToggle={() => setSortBy(sortBy === val ? null : val)}/>
    ))}
  </div>
</div>
```

- [ ] **Step 7: Commit**

```bash
git add src/views/view-workitems.jsx
git commit -m "feat(work): sort by number/status/type; persist group/sort/filters across sessions"
```

---

## Task 5: `view-prs.jsx` — group by project + persist view state

**Files:**
- Modify: `src/views/view-prs.jsx`

### Context

`PRView` currently has `seg` (all/needsme/drafts) and `detailPR` as local state. We add `groupBy` (null | 'project'). When active, the flat list is replaced by project-section dividers followed by `PRRow`s for each project. The `seg` filter applies first, then grouping.

PR objects have a `project` field (set in `data.jsx`).

- [ ] **Step 1: Add the load/save helper (module-level, before `PRView`)**

After the `PRRow` function definition, before `function PRView`, add:

```js
function loadPRViewState() {
  try {
    const s = localStorage.getItem(window.getProfileKey('helm.prs.viewState'));
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}
```

- [ ] **Step 2: Add `groupBy` state and restore `seg` from localStorage**

Find the state declarations at the top of `PRView` (lines 34–35):

```js
const [seg, setSeg]           = useState('all');
const [detailPR, setDetailPR] = useState(null);
```

Replace with:

```js
const [seg, setSeg]           = useState(() => loadPRViewState().seg ?? 'all');
const [groupBy, setGroupBy]   = useState(() => loadPRViewState().groupBy ?? null);
const [detailPR, setDetailPR] = useState(null);
```

- [ ] **Step 3: Add the persistence `useEffect`**

After the `const needsMe = pr => ...` line (line 37), add:

```js
useEffect(() => {
  try {
    localStorage.setItem(
      window.getProfileKey('helm.prs.viewState'),
      JSON.stringify({ seg, groupBy })
    );
  } catch {}
}, [seg, groupBy]);
```

Make sure `useEffect` is imported — the first line of the file is `const { useState, useMemo } = React;`. Change it to:

```js
const { useState, useMemo, useEffect } = React;
```

- [ ] **Step 4: Add the group toggle button to the appbar**

Find the appbar actions div (lines 54–59):

```jsx
<div className="m-ab-actions">
  <button type="button" className="m-iconbtn"
    onClick={() => window.HelmApi?.load().catch(() => {})} title="Refresh">
    <Icon name="refresh" size={18}/>
  </button>
</div>
```

Add a group toggle button before the refresh button:

```jsx
<div className="m-ab-actions">
  <button type="button"
    className={`m-iconbtn${groupBy === 'project' ? ' active' : ''}`}
    title={groupBy === 'project' ? 'Ungroup' : 'Group by project'}
    onClick={() => setGroupBy(g => g === 'project' ? null : 'project')}>
    <Icon name="group" size={18}/>
  </button>
  <button type="button" className="m-iconbtn"
    onClick={() => window.HelmApi?.load().catch(() => {})} title="Refresh">
    <Icon name="refresh" size={18}/>
  </button>
</div>
```

Note: if the `group` icon name doesn't exist in the icon set, use `"layers"` instead. Check by looking at what icon name the work-items groupBy uses. If neither exists, fall back to `"list"`.

- [ ] **Step 5: Replace the flat list render with a grouped/flat conditional**

Find the PR list block (lines 76–93):

```jsx
{filtered.length === 0
  ? (
    <div className="m-empty">
      <div className="ei"><Icon name="pr" size={22}/></div>
      <div className="et">No pull requests</div>
    </div>
  )
  : (
    <div className="m-card flush">
      {filtered.map(pr => (
        <PRRow key={pr.id} pr={pr}
          active={newItemIds?.has(pr.id)}
          onDetail={setDetailPR}
          needsMe={needsMe(pr)}/>
      ))}
    </div>
  )
}
```

Replace with:

```jsx
{filtered.length === 0
  ? (
    <div className="m-empty">
      <div className="ei"><Icon name="pr" size={22}/></div>
      <div className="et">No pull requests</div>
    </div>
  )
  : groupBy === 'project'
    ? (() => {
        const projects = [...new Set(filtered.map(pr => pr.project || 'Unknown'))].sort();
        return projects.map(proj => (
          <div key={proj} style={{ marginBottom: 16 }}>
            <div style={{
              fontWeight: 700, fontSize: 12, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '0 2px', marginBottom: 6,
            }}>
              {proj}
            </div>
            <div className="m-card flush">
              {filtered.filter(pr => (pr.project || 'Unknown') === proj).map(pr => (
                <PRRow key={pr.id} pr={pr}
                  active={newItemIds?.has(pr.id)}
                  onDetail={setDetailPR}
                  needsMe={needsMe(pr)}/>
              ))}
            </div>
          </div>
        ));
      })()
    : (
      <div className="m-card flush">
        {filtered.map(pr => (
          <PRRow key={pr.id} pr={pr}
            active={newItemIds?.has(pr.id)}
            onDetail={setDetailPR}
            needsMe={needsMe(pr)}/>
        ))}
      </div>
    )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/views/view-prs.jsx
git commit -m "feat(prs): group by project; persist seg and groupBy across sessions"
```

---

## Self-review

**Spec coverage:**
- PR grouping by project ✓ Task 5
- Widget chooser (Settings toggles) ✓ Tasks 1–3
- Work items sort ✓ Task 4
- Persist work items view state (groupBy, sortBy, typeFilter, stateFilter, assigneeFilter) ✓ Task 4
- Persist PR view state (seg, groupBy) ✓ Task 5

**Placeholder scan:** All steps contain exact code. No TBDs.

**Type consistency:**
- `hiddenDashWidgets` key introduced in Task 1, consumed in Task 2 and Task 3 — consistent.
- Widget IDs `sprint`, `blockers`, `needsme`, `activity` match across Tasks 2 and 3.
- `sortedFiltered` introduced in Task 4 Step 3, consumed in Step 4 (`groupedList`, `boardLanes`, `userBoardData` memos) and Step 4 JSX — consistent.
- `loadWIViewState()` defined in Task 4 Step 1, used in Task 4 Step 2 — consistent.
- `loadPRViewState()` defined in Task 5 Step 1, used in Task 5 Step 2 — consistent.
- `helm.workitems.viewState` and `helm.prs.viewState` keys match between save and load in their respective tasks.
