# Per-Item Unseen/Alert Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two divergent, race-prone "new item" badge implementations (web's localStorage fingerprint diffing, desktop's in-memory id diffing) with one shared `useSeenTracking` hook where each item's seen/unseen state is tracked individually and persisted, fixing the bug where badges show new items that don't actually exist because counting happened before real data loaded.

**Architecture:** A new `useSeenTracking` hook in `packages/ui/src/app-components.jsx` (alongside the existing `usePersisted`) owns a per-item fingerprint map, persisted to `localStorage` under profile-scoped keys, for each of four fixed categories: `work`, `pr`, `builds`, `tests`. It takes `storage`/`getProfileKey` as explicit parameters (NOT via `useNexusData()` context) because on desktop the top-level `App()` component calls hooks *before* rendering its own `<NexusDataProvider>` child, so context-based access wouldn't see the real profile-scoped storage there — explicit params work uniformly in both apps regardless of where in the tree they're called. The hook only diffs/updates once a caller-supplied `dataLoaded` flag is true. Both `apps/app/src/app.jsx` and `apps/desktop/src/main.jsx` delete their bespoke effects and call this hook instead.

**Tech Stack:** React (hooks), Vitest + @testing-library/react for `packages/ui` tests.

## Global Constraints

- Persisted storage keys must stay `helm_seen_work`, `helm_seen_pr`, `helm_seen_builds`, `helm_seen_tests` (matching today's web implementation) so existing users' seen state is not lost/reset by this change.
- Item ids must be stored as strings in the persisted map (`String(item.id)`) since object keys are always strings — avoids id-type mismatches between numeric and string ids across categories.
- `useSeenTracking` must take `storage`/`getProfileKey` as explicit parameters, not read them from `useNexusData()` context — see Architecture above for why.
- Run `packages/ui` and `apps/desktop` tests from their own directory, not the repo root (workspace/jsdom gap at the root).
- `apps/app` has no test runner configured (`apps/app/package.json` has no `test` script) — verify web wiring changes via manual smoke check (`npm run dev`), not automated tests.
- `apps/desktop/src/main.jsx` is not imported by any test file (it renders and starts sync at import) — verify desktop wiring changes via the existing `packages/ui`/`apps/desktop` suites (regression) plus a manual smoke check, not a new unit test of `main.jsx` itself.

---

### Task 1: Add `useSeenTracking` hook to `packages/ui`

**Files:**
- Modify: `packages/ui/src/app-components.jsx` (add hook after `usePersisted`, currently ending at line 49)
- Modify: `packages/ui/src/index.js` (export the new hook, alongside `usePersisted` at line 19-20)
- Modify: `packages/ui/tests/components.test.jsx` (add tests)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task). Does NOT use `usePersisted`/`useNexusData()` — see Architecture note above.
- Produces:
  - `useSeenTracking(categories, dataLoaded, { storage, getProfileKey })` where:
    - `categories`: `{ work: {items, fingerprint}, pr: {items, fingerprint}, builds: {items, fingerprint}, tests: {items, fingerprint} }`, `items: Array<{id: string|number, ...}>`, `fingerprint: (item) => string`.
    - `storage`: `{ getItem(key), setItem(key, value) }` (e.g. `window.localStorage`).
    - `getProfileKey`: `(key: string) => string`.
  - Returns `{ unseenIds: {work: Set, pr: Set, builds: Set, tests: Set}, unseenCounts: {work: number, pr: number, builds: number, tests: number}, markSeen: (key: 'work'|'pr'|'builds'|'tests') => void }`.
  - Consumed by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/tests/components.test.jsx`. First, extend the import at the top of the file to include `useSeenTracking`:

```javascript
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer, NexusDataProvider,
  useSeenTracking,
} from '../src/index.js'
```

Then append a new `describe` block at the end of the file (after the closing `})` of `describe('pure presentational components', ...)`, before the final newline):

```javascript
describe('useSeenTracking', () => {
  // Harness: renders the hook and exposes its return value via a callback,
  // since there's no renderHook helper wired up in this repo's test setup.
  function Harness({ categories, dataLoaded, deps, onResult }) {
    const result = useSeenTracking(categories, dataLoaded, deps)
    onResult(result)
    return null
  }

  function makeStorage(seed = {}) {
    const store = { ...seed }
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    }
  }

  const identityDeps = (storage) => ({ storage, getProfileKey: (k) => k })

  const workCategory = (items) => ({
    work:   { items, fingerprint: (x) => `${x.id}|${x.state}` },
    pr:     { items: [], fingerprint: (x) => `${x.id}|${x.status}` },
    builds: { items: [], fingerprint: (x) => `${x.id}|${x.status}` },
    tests:  { items: [], fingerprint: (x) => `${x.id}|${x.result}` },
  })

  function renderTracking({ categories, dataLoaded, storage }) {
    let captured
    render(<Harness categories={categories} dataLoaded={dataLoaded} deps={identityDeps(storage)} onResult={(r) => { captured = r }} />)
    return captured
  }

  it('marks a brand-new item as unseen', () => {
    const storage = makeStorage()
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(true)
    expect(result.unseenCounts.work).toBe(1)
  })

  it('does not flag an item whose fingerprint is unchanged from the persisted seen map', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active' }) })
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(false)
    expect(result.unseenCounts.work).toBe(0)
  })

  it('flags an item as unseen again when its tracked field changes', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active' }) })
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Done' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(true)
    expect(result.unseenCounts.work).toBe(1)
  })

  it('does nothing while dataLoaded is false, even with items present', () => {
    const storage = makeStorage()
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: false, storage })
    expect(result.unseenIds.work.size).toBe(0)
    expect(result.unseenCounts.work).toBe(0)
    expect(storage.getItem('helm_seen_work')).toBeNull()
  })

  it('does not resurrect false positives when data loads empty before loading for real (the race)', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active', '2': '2|Active' }) })
    // First render: not loaded yet, items happen to be empty (placeholder state).
    const { rerender } = render(
      <Harness categories={workCategory([])} dataLoaded={false} deps={identityDeps(storage)} onResult={() => {}} />,
    )
    // Second render: real data has now loaded, matching the persisted seen map.
    let result
    rerender(
      <Harness
        categories={workCategory([{ id: '1', state: 'Active' }, { id: '2', state: 'Active' }])}
        dataLoaded
        deps={identityDeps(storage)}
        onResult={(r) => { result = r }}
      />,
    )
    expect(result.unseenCounts.work).toBe(0)
  })

  it('prunes ids no longer present in the current dataset from the persisted map', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active', '2': '2|Active' }) })
    renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(JSON.parse(storage.getItem('helm_seen_work'))).toEqual({ '1': '1|Active' })
  })

  it('markSeen persists current fingerprints and clears unseen state for that category', () => {
    const storage = makeStorage()
    let result
    const categories = workCategory([{ id: '1', state: 'Active' }])
    const deps = identityDeps(storage)
    const { rerender } = render(<Harness categories={categories} dataLoaded deps={deps} onResult={(r) => { result = r }} />)
    expect(result.unseenCounts.work).toBe(1)
    result.markSeen('work')
    rerender(<Harness categories={categories} dataLoaded deps={deps} onResult={(r) => { result = r }} />)
    expect(result.unseenCounts.work).toBe(0)
    expect(JSON.parse(storage.getItem('helm_seen_work'))).toEqual({ '1': '1|Active' })
  })

  it('scopes persisted keys through the supplied getProfileKey', () => {
    const storage = makeStorage()
    renderTracking({
      categories: workCategory([{ id: '1', state: 'Active' }]),
      dataLoaded: true,
      storage,
    })
    // identityDeps uses (k) => k, so the raw key is used; assert the raw key was written.
    expect(storage.getItem('helm_seen_work')).toBeNull() // no markSeen call yet, only diffed
    let result
    render(<Harness categories={workCategory([{ id: '1', state: 'Active' }])} dataLoaded deps={{ storage, getProfileKey: (k) => `profileA.${k}` }} onResult={(r) => { result = r }} />)
    result.markSeen('work')
    expect(storage.getItem('profileA.helm_seen_work')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui`): `cd packages/ui && npx vitest run tests/components.test.jsx`
Expected: FAIL — `useSeenTracking is not exported from '../src/index.js'` (or similar import error), since the hook doesn't exist yet.

- [ ] **Step 3: Implement `useSeenTracking`**

In `packages/ui/src/app-components.jsx`, add after the closing `}` of `usePersisted` (currently line 49):

```javascript
const SEEN_CATEGORY_KEYS = ['work', 'pr', 'builds', 'tests']
const SEEN_STORAGE_KEYS = { work: 'helm_seen_work', pr: 'helm_seen_pr', builds: 'helm_seen_builds', tests: 'helm_seen_tests' }

function readSeenMap(storage, key) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function writeSeenMap(storage, key, map) {
  try { storage.setItem(key, JSON.stringify(map)) } catch { /* quota / private mode */ }
}

function diffUnseen(items, fingerprint, seenMap) {
  const unseen = new Set()
  items.forEach((item) => {
    const id = String(item.id)
    if (seenMap[id] !== fingerprint(item)) unseen.add(id)
  })
  return unseen
}

function pruneSeenMap(items, seenMap) {
  const ids = new Set(items.map((item) => String(item.id)))
  const pruned = {}
  let changed = false
  Object.keys(seenMap).forEach((id) => {
    if (ids.has(id)) pruned[id] = seenMap[id]
    else changed = true
  })
  return changed ? pruned : seenMap
}

/**
 * Per-item seen/unseen tracking for four fixed categories (work/pr/builds/tests).
 * Each category's persisted state is a { [itemId]: lastSeenFingerprint } map, so
 * every item owns its own seen state rather than a single tab-level timestamp.
 * Diffing/persisting is skipped entirely while dataLoaded is false, so a
 * placeholder/empty dataset can never be recorded as (or overwrite) a real baseline.
 *
 * Takes storage/getProfileKey as explicit params (not via useNexusData()) so it
 * works identically whether called inside or outside a NexusDataProvider subtree.
 */
export function useSeenTracking(categories, dataLoaded, { storage, getProfileKey }) {
  const [seenMaps, setSeenMapsState] = useState(() => {
    const initial = {}
    SEEN_CATEGORY_KEYS.forEach((key) => {
      initial[key] = readSeenMap(storage, getProfileKey(SEEN_STORAGE_KEYS[key]))
    })
    return initial
  })
  const [unseenIds, setUnseenIds] = useState({ work: new Set(), pr: new Set(), builds: new Set(), tests: new Set() })

  const setCategorySeenMap = (key, map) => {
    setSeenMapsState((prev) => ({ ...prev, [key]: map }))
    writeSeenMap(storage, getProfileKey(SEEN_STORAGE_KEYS[key]), map)
  }

  useEffect(() => {
    if (!dataLoaded) return
    const nextUnseen = {}
    SEEN_CATEGORY_KEYS.forEach((key) => {
      const cat = categories[key]
      const items = cat ? cat.items : []
      const fingerprint = cat ? cat.fingerprint : () => ''
      nextUnseen[key] = diffUnseen(items, fingerprint, seenMaps[key])
      const pruned = pruneSeenMap(items, seenMaps[key])
      if (pruned !== seenMaps[key]) setCategorySeenMap(key, pruned)
    })
    setUnseenIds(nextUnseen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, categories.work.items, categories.pr.items, categories.builds.items, categories.tests.items])

  const markSeen = (key) => {
    const cat = categories[key]
    if (!cat) return
    const nextMap = {}
    cat.items.forEach((item) => { nextMap[String(item.id)] = cat.fingerprint(item) })
    setCategorySeenMap(key, nextMap)
    setUnseenIds((prev) => ({ ...prev, [key]: new Set() }))
  }

  const unseenCounts = {
    work: unseenIds.work.size,
    pr: unseenIds.pr.size,
    builds: unseenIds.builds.size,
    tests: unseenIds.tests.size,
  }

  return { unseenIds, unseenCounts, markSeen }
}
```

- [ ] **Step 4: Export it from the package**

In `packages/ui/src/index.js`, update line 19-20 to include the new hook:

```javascript
  Avatar, TypeIcon, NotificationBanner, MenuButton, usePersisted, useSeenTracking, ProjectChip, Drawer, Sheet,
} from './app-components.jsx'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `packages/ui`): `cd packages/ui && npx vitest run tests/components.test.jsx`
Expected: PASS — all 8 new `useSeenTracking` tests green, plus all pre-existing tests in the file still green.

- [ ] **Step 6: Run the full `packages/ui` suite for regressions**

Run: `cd packages/ui && npx vitest run`
Expected: PASS — no regressions elsewhere in the package.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/app-components.jsx packages/ui/src/index.js packages/ui/tests/components.test.jsx
git commit -m "feat(ui): add useSeenTracking hook for per-item unseen/alert state"
```

---

### Task 2: Wire `useSeenTracking` into the web app

**Files:**
- Modify: `apps/app/src/components.jsx` (import list at line 5-9, `Object.assign` at line 55)
- Modify: `apps/app/src/app.jsx` (delete effects at lines 1533-1586, add replacement)

**Interfaces:**
- Consumes: `useSeenTracking(categories, dataLoaded, { storage, getProfileKey })` (Task 1), existing `dataLoaded` (`app.jsx:1445`), `view` (existing nav state), `HelmData.WORK_ITEMS`/`PRS`/`BUILDS`/`TESTS`, `dataVersion` (existing), `getProfileKey` (already imported at `app.jsx:10`).
- Produces: `changeBadges` and `newItemIds` in the exact shapes already consumed by `MobileBottomNav`/`TabletRail` (`app.jsx:192,219`) and the view components at `app.jsx:1927,1930,1933,1936` — no changes needed downstream.

- [ ] **Step 1: Expose `useSeenTracking` the same way `usePersisted` is exposed**

In `apps/app/src/components.jsx`, update the import at lines 5-9:

```javascript
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Avatar, usePersisted, useSeenTracking, NotificationBanner, MenuButton,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer,
} from '@nexusmd/ui';
```

And update the `Object.assign(window, ...)` call at line 55 to include it:

```javascript
Object.assign(window, { Avatar, TypeIcon, StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat, Drawer, Ring, MenuButton, SortHeader, StatusSelect, ProjectChip, usePersisted, useSeenTracking });
```

- [ ] **Step 2: Replace the bespoke diffing effects**

In `apps/app/src/app.jsx`, delete the two effects at lines 1533-1586 (from `useEffect(() => {` starting the fingerprint-diff effect through the closing `}, [view]);` of the row-highlight-clearing effect) and the `newItemIds` state declaration at line 1510, and the `changeBadges` state declaration at line 1446 (both are now owned by the hook). Replace with:

```javascript
  const seenCategories = {
    work:   { items: HelmData.WORK_ITEMS || [], fingerprint: (x) => `${x.id}|${x.state}` },
    pr:     { items: HelmData.PRS || [],        fingerprint: (x) => `${x.id}|${x.status}` },
    builds: { items: HelmData.BUILDS || [],     fingerprint: (x) => `${x.id}|${x.status}` },
    tests:  { items: HelmData.TESTS || [],      fingerprint: (x) => `${x.id}|${x.result}|${x.failedTests || 0}` },
  };
  const { unseenIds: newItemIds, unseenCounts: changeBadges, markSeen } = useSeenTracking(
    seenCategories, dataLoaded, { storage: window.localStorage, getProfileKey },
  );

  // Mark the active tab's items seen the moment the user opens it (and keep marking
  // it seen as new data arrives while that tab stays active, matching prior behavior
  // of zeroing the active tab's badge on every refresh).
  useEffect(() => {
    if (['work', 'pr', 'builds', 'tests'].includes(view)) markSeen(view);
  }, [view, dataVersion]);
```

Place this block where the deleted effects were (directly after the `team` re-sync effect that ends at line 1531, before whatever followed the deleted block).

- [ ] **Step 3: Run the `packages/ui` suite for regressions**

Run: `cd packages/ui && npx vitest run`
Expected: PASS — `apps/app` has no automated test runner configured, so this is the closest available regression signal (it exercises the shared hook `apps/app` now depends on).

- [ ] **Step 4: Manual smoke check**

Run: `cd apps/app && npm run dev`, open the app in a browser:
1. Confirm nav badges show counts matching genuinely new/changed work items, PRs, builds, and tests (compare against a manual look at the data).
2. Switch to the Work Items tab — confirm its badge clears and row highlights ("new" pills) disappear.
3. Reload the page — confirm badges do **not** spike to the full item count on load (the race this change fixes).
4. Switch away from a tab, then back — confirm previously-seen items don't reappear as "new" without an actual change.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components.jsx apps/app/src/app.jsx
git commit -m "feat(app): use shared useSeenTracking for per-item alert badges"
```

---

### Task 3: Wire `useSeenTracking` into the desktop app

**Files:**
- Modify: `apps/desktop/src/main.jsx` (`useNexusSnapshot` at lines 204-221; effects at lines 659-711; sidebar badge render at line 818, 832)

**Interfaces:**
- Consumes: `useSeenTracking(categories, dataLoaded, { storage, getProfileKey })` (Task 1), `useNexusSnapshot()` (modified in this task to also return `loaded`), `getProfileKey` (already imported at `main.jsx:21`).
- Produces: `changeBadges` and `newItemIds` in the shapes consumed by the sidebar render (`main.jsx:818-836`) and detail views — note desktop's nav id for pull requests is `'prs'` (plural, `nav-config.js:8`) while the tracking category is `'pr'` (singular, matching web) — the badge object passed to the sidebar must have a `prs` key, so it's remapped at the render boundary.

- [ ] **Step 1: Add a `loaded` flag to `useNexusSnapshot`**

In `apps/desktop/src/main.jsx`, replace `useNexusSnapshot` (lines 204-221):

```javascript
function useNexusSnapshot() {
  const [snapshot, setSnapshot] = React.useState(EMPTY_NEXUS_DATA)
  const [loaded, setLoaded] = React.useState(false)
  const refresh = React.useCallback(() => {
    try {
      const cached = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
      setSnapshot(cached ? { ...EMPTY_NEXUS_DATA, ...cached } : EMPTY_NEXUS_DATA)
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return { snapshot, loaded }
}
```

- [ ] **Step 2: Update the call site to destructure the new return shape**

At line 673, change:

```javascript
  const snapshot = useNexusSnapshot()
```

to:

```javascript
  const { snapshot, loaded: dataLoaded } = useNexusSnapshot()
```

- [ ] **Step 3: Replace the bespoke diffing effects**

Delete the `prevSnapshotIdsRef`/`newItemIds`/`changeBadges` state declarations at lines 659-663 and the two effects at lines 675-711 (the snapshot-diff effect and the view-switch clearing effect). Replace with:

```javascript
  const seenCategories = {
    work:   { items: snapshot.WORK_ITEMS || [], fingerprint: (x) => `${x.id}|${x.state}` },
    pr:     { items: snapshot.PRS || [],        fingerprint: (x) => `${x.id}|${x.status}` },
    builds: { items: snapshot.BUILDS || [],     fingerprint: (x) => `${x.id}|${x.status}` },
    tests:  { items: snapshot.TESTS || [],      fingerprint: (x) => `${x.id}|${x.result}|${x.failedTests || 0}` },
  }
  const { unseenIds: newItemIds, unseenCounts, markSeen } = useSeenTracking(
    seenCategories, dataLoaded, { storage: window.localStorage, getProfileKey },
  )
  // Sidebar badges are keyed by nav id; 'prs' (nav-config.js) maps to the 'pr' category.
  const changeBadges = { work: unseenCounts.work, prs: unseenCounts.pr, builds: unseenCounts.builds, tests: unseenCounts.tests }

  React.useEffect(() => {
    const viewToCategory = { work: 'work', prs: 'pr', builds: 'builds', tests: 'tests' }
    const key = viewToCategory[view]
    if (key) markSeen(key)
  }, [view, snapshot])
```

- [ ] **Step 4: Import `useSeenTracking`**

In `apps/desktop/src/main.jsx`, update the `@nexusmd/ui` import (lines 11-17) to add `useSeenTracking`:

```javascript
  NexusDataProvider, useNexusData, ToastHost, toast,
  DashboardView, WorkItemsView, TriageView,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  WorkItemFieldsEditor, PRTabs, useSeenTracking,
} from '@nexusmd/ui'
```

- [ ] **Step 5: Run the `packages/ui` and `apps/desktop` suites for regressions**

Run: `cd packages/ui && npx vitest run`
Expected: PASS.

Run: `cd apps/desktop && npx vitest run`
Expected: PASS — `main.jsx` isn't imported by any test file, so this won't directly exercise the change, but confirms no regressions in modules `main.jsx` depends on.

- [ ] **Step 6: Manual smoke check**

Run: `cd apps/desktop && npm run dev`:
1. Confirm sidebar badges (dot in icon-only mode, count pill otherwise) show counts matching genuinely new/changed items.
2. Switch to Work Items / Pull Requests / Builds / Tests tabs — confirm each tab's badge clears on visiting it.
3. Restart the app (relaunch, not just reload) — confirm badges reflect the *persisted* seen state from before restart, not a full reset (this is new: today's desktop badge state resets on every relaunch).
4. Confirm badges do not spike to the full item count immediately after the cache loads on startup (the race this change fixes).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): use shared useSeenTracking for per-item alert badges"
```
