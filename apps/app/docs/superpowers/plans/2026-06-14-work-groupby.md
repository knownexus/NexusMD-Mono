# Work Page Group By — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group-by (User / Project / Status) to `WorkItemsView`, controlled from the filter sheet, applied in both list and board views.

**Architecture:** A single `groupBy` state var (`null | 'user' | 'project' | 'status'`) drives two derived computations — `groupedList` (for list view) and `boardLanes` (for board view). The filter sheet gains a "Group by" section at the top; the badge count does not include grouping. No new files needed.

**Tech Stack:** React (hooks via `window.React`), existing `ChipToggle` component, `Sheet` component, inline styles + CSS class additions to `public/css/helm-mobile.css`.

---

### Task 1: Add `groupBy` state and filter sheet section

**Files:**
- Modify: `src/views/view-workitems.jsx`

- [ ] **Step 1: Add `groupBy` state**

In `WorkItemsView`, add this line alongside the existing `useState` declarations (after `assigneeFilter`):

```jsx
const [groupBy, setGroupBy] = useState(null);
```

- [ ] **Step 2: Add "Group by" section to the filter sheet**

Inside the `<Sheet>` component, add this block **before** the `{allTypes.length > 0 && ...}` block:

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

- [ ] **Step 3: Verify `filterCount` is unchanged**

Confirm line `const filterCount = typeFilter.size + stateFilter.size + assigneeFilter.size;` does **not** reference `groupBy`. No change needed here — just confirm and move on.

- [ ] **Step 4: Manual check**

Open the app → Work page → tap Filter. Confirm "Group by" section appears at the top with three chips (User, Project, Status). Confirm tapping a chip toggles it active/inactive. Confirm the badge on the Filter button does NOT increment when a group chip is selected.

- [ ] **Step 5: Commit**

```bash
git add src/views/view-workitems.jsx
git commit -m "feat(work): add groupBy state and filter sheet section"
```

---

### Task 2: List view — grouped rendering

**Files:**
- Modify: `src/views/view-workitems.jsx`
- Modify: `public/css/helm-mobile.css`

- [ ] **Step 1: Add `STATUS_ORDER` constant**

At module level (near the existing `LANES` constant), add:

```jsx
const STATUS_ORDER = ['To Do', 'Active', 'Blocked', 'In Review', 'Done'];
```

- [ ] **Step 2: Add `GroupHeader` component**

At module level (after `ChipToggle`), add:

```jsx
function GroupHeader({ label, count, collapsed, onToggle }) {
  return (
    <div className="wi-group-hd" onClick={onToggle}>
      <span className="wi-group-label">{label}</span>
      <span className="wi-group-count">{count}</span>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14}/>
    </div>
  );
}
```

- [ ] **Step 3: Add `collapsedGroups` state**

In `WorkItemsView`, alongside the other `useState` declarations, add:

```jsx
const [collapsedGroups, setCollapsedGroups] = useState(new Set());
```

- [ ] **Step 4: Add `groupedList` memo**

In `WorkItemsView`, after the `filtered` memo, add:

```jsx
const groupedList = useMemo(() => {
  if (!groupBy) return null;
  const buckets = {};
  filtered.forEach(w => {
    const key =
      groupBy === 'user'    ? (w.assignee || 'unassigned') :
      groupBy === 'project' ? (w.project  || 'unknown')    :
      /* status */            (w.state    || 'Unknown');
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
}, [filtered, groupBy, team]);
```

Note: `memberName` is already defined above this memo in the component, so it is in scope.

- [ ] **Step 5: Replace list view render block**

Find the list view render section (the `viewMode === 'list' ? (...)` ternary). Replace the non-empty branch (the `<div className="m-card flush">` block) with:

```jsx
{viewMode === 'list' ? (
  filtered.length === 0
    ? (
      <div className="m-empty">
        <div className="ei"><Icon name="work" size={22}/></div>
        <div className="et">{search || filterCount > 0 ? 'No matches' : 'No items'}</div>
      </div>
    )
    : groupedList
      ? groupedList.map(({ key, label, items }) => {
          const collapsed = collapsedGroups.has(key);
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <GroupHeader
                label={label}
                count={items.length}
                collapsed={collapsed}
                onToggle={() => setCollapsedGroups(prev => {
                  const n = new Set(prev);
                  n.has(key) ? n.delete(key) : n.add(key);
                  return n;
                })}
              />
              {!collapsed && (
                <div className="m-card flush">
                  {items.map(wi => (
                    <WorkRow key={wi.id} wi={wi} newItemIds={newItemIds}
                      onOpen={onOpen} team={team}/>
                  ))}
                </div>
              )}
            </div>
          );
        })
      : (
        <div className="m-card flush">
          {filtered.map(wi => (
            <WorkRow key={wi.id} wi={wi} newItemIds={newItemIds}
              onOpen={onOpen} team={team}/>
          ))}
        </div>
      )
) : (
  /* board view — Task 3 will replace this; leave the existing board JSX block here unchanged */
  <div role="region" aria-label="Board view"
    style={{ display:'flex', gap:12, overflowX:'auto', scrollSnapType:'x mandatory', paddingBottom:12 }}>
    {LANES.map(lane => {
      const laneList = filtered.filter(w => laneFilter(lane, w));
      return (
        <div key={lane} style={{
          minWidth: 256, flexShrink: 0, scrollSnapAlign: 'start',
          background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', padding: 10,
        }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
            <span style={{ fontWeight:600, fontSize:13 }}>{lane}</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-subtle)' }}>{laneList.length}</span>
          </div>
          {laneList.map(wi => (
            <div key={wi.id} onClick={() => onOpen(wi)} style={{
              background:'var(--surface)', borderRadius:'var(--radius)', padding:'8px 10px',
              marginBottom:8, cursor:'pointer',
            }}>
              <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4 }}>
                <span className={`m-typ ${(wi.type||'task').toLowerCase()}`}
                  style={{ fontSize:12, width:18, height:18 }}>
                  <Icon name={TYPE_ICON(wi.type)} size={13}/>
                </span>
                <span className="m-id">#{wi.id}</span>
              </div>
              <div style={{ fontSize:13, lineHeight:1.4 }}>{wi.title}</div>
            </div>
          ))}
          {laneList.length === 0 && (
            <div style={{ fontSize:12, color:'var(--text-subtle)', textAlign:'center', padding:'12px 0' }}>
              Empty
            </div>
          )}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 6: Add group header CSS**

In `public/css/helm-mobile.css`, append at the end of the file:

```css
/* ── Work item group headers ──────────────────────────── */
.wi-group-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 6px;
  cursor: pointer;
  user-select: none;
}
.wi-group-label {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .05em;
}
.wi-group-count {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-subtle);
  background: var(--surface-3);
  border-radius: 99px;
  padding: 1px 7px;
}
```

- [ ] **Step 7: Manual check**

Open app → Work → Filter → select "User" → tap "Show X". Confirm list shows collapsible group headers per assignee (alphabetical, Unassigned last). Tap a header to collapse/expand. Repeat for Project and Status. Confirm ungrouped (no group selected) shows flat list as before.

- [ ] **Step 8: Commit**

```bash
git add src/views/view-workitems.jsx public/css/helm-mobile.css
git commit -m "feat(work): grouped list view with collapsible headers"
```

---

### Task 3: Board view — dynamic lanes

**Files:**
- Modify: `src/views/view-workitems.jsx`

- [ ] **Step 1: Add `boardLanes` memo**

In `WorkItemsView`, after `groupedList`, add:

```jsx
const boardLanes = useMemo(() => {
  if (!groupBy || groupBy === 'status') {
    return LANES.map(lane => ({
      key: lane,
      label: lane,
      items: filtered.filter(w => laneFilter(lane, w)),
    }));
  }
  if (groupBy === 'user') {
    const ids = [...new Set(filtered.map(w => w.assignee || 'unassigned'))];
    ids.sort((a, b) => {
      if (a === 'unassigned') return 1;
      if (b === 'unassigned') return -1;
      return memberName(a).localeCompare(memberName(b));
    });
    return ids.map(id => ({
      key: id,
      label: memberName(id),
      items: filtered.filter(w => (w.assignee || 'unassigned') === id),
    }));
  }
  // project
  const projects = [...new Set(filtered.map(w => w.project || 'Unknown'))].sort();
  return projects.map(proj => ({
    key: proj,
    label: proj,
    items: filtered.filter(w => (w.project || 'Unknown') === proj),
  }));
}, [filtered, groupBy, team]);
```

- [ ] **Step 2: Replace board view render block**

Find the board view section (the `role="region" aria-label="Board view"` div). Replace the inner `{LANES.map(lane => { ... })}` with `{boardLanes.map(({ key, label, items }) => { ... })}`:

```jsx
<div role="region" aria-label="Board view"
  style={{ display:'flex', gap:12, overflowX:'auto', scrollSnapType:'x mandatory', paddingBottom:12 }}>
  {boardLanes.map(({ key, label, items }) => (
    <div key={key} style={{
      minWidth: 256, flexShrink: 0, scrollSnapAlign: 'start',
      background: 'var(--surface-2)', borderRadius: 'var(--radius-lg)', padding: 10,
    }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
        <span style={{ fontWeight:600, fontSize:13 }}>{label}</span>
        <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-subtle)' }}>{items.length}</span>
      </div>
      {items.map(wi => (
        <div key={wi.id} onClick={() => onOpen(wi)} style={{
          background:'var(--surface)', borderRadius:'var(--radius)', padding:'8px 10px',
          marginBottom:8, cursor:'pointer',
        }}>
          <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4 }}>
            <span className={`m-typ ${(wi.type||'task').toLowerCase()}`}
              style={{ fontSize:12, width:18, height:18 }}>
              <Icon name={TYPE_ICON(wi.type)} size={13}/>
            </span>
            <span className="m-id">#{wi.id}</span>
          </div>
          <div style={{ fontSize:13, lineHeight:1.4 }}>{wi.title}</div>
        </div>
      ))}
      {items.length === 0 && (
        <div style={{ fontSize:12, color:'var(--text-subtle)', textAlign:'center', padding:'12px 0' }}>
          Empty
        </div>
      )}
    </div>
  ))}
</div>
```

- [ ] **Step 3: Manual check**

Open app → Work → switch to Board view. Confirm default (no groupBy) shows existing 5-lane status board. Then Filter → "User" → Show. Confirm board rekeys to one lane per assignee. Then Filter → "Project" → Show. Confirm board rekeys to one lane per project. Filter → "Status" → Show. Confirm board returns to 5-lane layout.

- [ ] **Step 4: Commit**

```bash
git add src/views/view-workitems.jsx
git commit -m "feat(work): dynamic board lanes based on groupBy"
```
