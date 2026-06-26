# Persist Collapsed/Expanded Section State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember collapsed/expanded group state across navigation and app restarts in Builds, Tests, Triage, and Work Items views.

**Architecture:** Each view's collapse state is a plain object `{}` (or `Set`) held in `useState`. Swapping to `usePersisted` (already defined globally in `components.jsx`) writes the value to `localStorage` under a profile-scoped key on every change and restores it on mount. No new infrastructure needed.

**Tech Stack:** React (global), `usePersisted` hook (global, `src/components.jsx`), `localStorage`

---

### Task 1: Persist collapsed state in Builds view

**Files:**
- Modify: `src/views/view-builds.jsx:9`

- [ ] **Step 1: Replace `React.useState` with `usePersisted` for `collapsed`**

In `src/views/view-builds.jsx`, line 9, change:
```js
const [collapsed,        setCollapsed]        = React.useState({});
```
to:
```js
const [collapsed,        setCollapsed]        = usePersisted('helm.builds.collapsed', {});
```

- [ ] **Step 2: Verify manually**

Open the app → navigate to Builds. Collapse any pipeline group (tap the chevron). Navigate to another tab. Navigate back to Builds. The group should still be collapsed.

Also: hard-refresh the app (or close and reopen). The collapsed group should be remembered.

- [ ] **Step 3: Commit**

```bash
git add src/views/view-builds.jsx
git commit -m "feat(builds): persist collapsed group state across sessions"
```

---

### Task 2: Persist collapsed state in Tests view

**Files:**
- Modify: `src/views/view-tests.jsx:10`

- [ ] **Step 1: Replace `useStateT` with `usePersisted` for `collapsed`**

In `src/views/view-tests.jsx`, line 10, change:
```js
const [collapsed,   setCollapsed]   = useStateT({});
```
to:
```js
const [collapsed,   setCollapsed]   = usePersisted('helm.tests.collapsed', {});
```

Note: `useStateT` is a local alias for `React.useState` (defined at the top of the file). `usePersisted` is globally available — no import needed.

- [ ] **Step 2: Verify manually**

Open the app → navigate to Tests. Collapse any test suite group. Navigate away and back. The group should still be collapsed. Hard-refresh confirms persistence.

- [ ] **Step 3: Commit**

```bash
git add src/views/view-tests.jsx
git commit -m "feat(tests): persist collapsed group state across sessions"
```

---

### Task 3: Persist collapsed state in Triage view

**Files:**
- Modify: `src/views/view-triage.jsx:246` (swap hook) and after line 246 (add clear effect)

- [ ] **Step 1: Replace `React.useState` with `usePersisted` for `collapsed`**

In `src/views/view-triage.jsx`, line 246, change:
```js
const [collapsed, setCollapsed]       = React.useState({});
```
to:
```js
const [collapsed, setCollapsed]       = usePersisted('helm.triage.collapsed', {});
```

- [ ] **Step 2: Add clear-on-groupBy-change effect**

Immediately after that line (line 247), add:
```js
React.useEffect(() => { setCollapsed({}); }, [groupBy]);
```

This mirrors the existing pattern in `view-workitems.jsx:108` — when the user switches groupBy (bucket → area → priority), the group keys change, so stale collapsed state is cleared.

- [ ] **Step 3: Verify manually**

Open Triage. Collapse a group. Navigate away and back — group should still be collapsed.

Also verify that switching the "Group by" dropdown resets all groups to expanded (no stale collapsed state carrying over from a different groupBy).

- [ ] **Step 4: Commit**

```bash
git add src/views/view-triage.jsx
git commit -m "feat(triage): persist collapsed group state; clear on groupBy change"
```

---

### Task 4: Persist collapsed state in Work Items view

**Files:**
- Modify: `src/views/view-workitems.jsx:107`

- [ ] **Step 1: Replace `useState` with `usePersisted` for `collapsedGroups`**

In `src/views/view-workitems.jsx`, line 107, change:
```js
const [collapsedGroups, setCollapsedGroups] = useState(new Set());
```
to:
```js
const [collapsedGroups, setCollapsedGroups] = usePersisted('helm.workitems.collapsed', new Set());
```

Leave line 108 unchanged:
```js
useEffect(() => { setCollapsedGroups(new Set()); }, [groupBy]);
```
This effect already clears groups on groupBy change — it will now also clear the persisted value (since `usePersisted` writes on every state change).

- [ ] **Step 2: Verify manually**

Open Work Items. Enable grouping (e.g. group by Status). Collapse a group. Navigate away and back — group should still be collapsed.

Also verify: switching groupBy (e.g. Status → Assignee) resets all groups to expanded.

- [ ] **Step 3: Commit**

```bash
git add src/views/view-workitems.jsx
git commit -m "feat(workitems): persist collapsed group state across sessions"
```
