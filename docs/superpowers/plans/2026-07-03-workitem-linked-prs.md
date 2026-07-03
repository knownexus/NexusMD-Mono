# Work Item → Linked PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On work item cards and the work item table, show a clickable PR indicator when a work item has associated pull request(s); clicking navigates to the Pull Requests view filtered to that work item's PR(s).

**Architecture:** The loader fetches PR↔work-item links and populates `pr.linkedWorkItems`. A pure core helper builds a `workItemId → PR[]` reverse index. `WorkItemsView` uses it to annotate items with a real `prs` count and makes the indicator a button that dispatches `nexusmd:navigate` with a `{ workItemId }` filter. `PRView` reads that filter (via `window.NexusMDNav.pendingFilter`, like the planner view) and shows only the linked PRs with a "Clear" banner. The desktop host is wired to carry the filter payload.

**Tech Stack:** React (peer), `@nexusmd/core` (pure JS), `@nexusmd/ui`, Vitest + @testing-library/react. ESM.

## Global Constraints

- `@nexusmd/core` helpers are **pure** — no React/DOM/storage.
- Navigation event: `nexusmd:navigate` with `detail = { view, filter }`; for this feature `filter = { workItemId: <number> }`.
- Reverse index groups by numeric work-item id: `Number(w.id)`, skipping non-finite ids.
- The linked-PR click **bypasses** the PR status/search filter (shows all linked PRs), with a banner + Clear.
- Run tests from inside the package: `cd packages/core && npx vitest run <path>` or `cd packages/ui && npx vitest run <path>`. Wrong cwd → exit code 38.
- Per-PR link fetch failures degrade that PR to `linkedWorkItems: []` — never fail the load.

---

### Task 1: Core reverse-index helper

**Files:**
- Create: `packages/core/src/modules/ado/pr-links.js`
- Modify: `packages/core/src/modules/ado/index.js`
- Test: `packages/core/tests/ado/pr-links.test.js`

**Interfaces:**
- Produces: `indexPRsByWorkItem(prs) → Map<number, PR[]>`.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/ado/pr-links.test.js
import { describe, it, expect } from 'vitest'
import { indexPRsByWorkItem } from '../../src/modules/ado/pr-links.js'

const pr = (id, wids) => ({ id, linkedWorkItems: wids.map(w => ({ id: w })) })

describe('indexPRsByWorkItem', () => {
  it('groups PRs by linked work item id', () => {
    const a = pr(1, [7]), b = pr(2, [7, 9])
    const idx = indexPRsByWorkItem([a, b])
    expect(idx.get(7)).toEqual([a, b])
    expect(idx.get(9)).toEqual([b])
  })
  it('coerces string ids to numbers', () => {
    const idx = indexPRsByWorkItem([{ id: 1, linkedWorkItems: [{ id: '7' }] }])
    expect(idx.get(7)).toHaveLength(1)
    expect(idx.has('7')).toBe(false)
  })
  it('skips PRs with no links and malformed ids', () => {
    const idx = indexPRsByWorkItem([{ id: 1 }, { id: 2, linkedWorkItems: [{ id: 'x' }] }])
    expect(idx.size).toBe(0)
  })
  it('returns an empty map for empty/nullish input', () => {
    expect(indexPRsByWorkItem([]).size).toBe(0)
    expect(indexPRsByWorkItem(null).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/ado/pr-links.test.js`
Expected: FAIL — cannot resolve `../../src/modules/ado/pr-links.js`.

- [ ] **Step 3: Write the module**

```js
// packages/core/src/modules/ado/pr-links.js
// Reverse index: work-item id -> PRs that link to it. Pure; built from the
// already-loaded PRS array (each PR carries linkedWorkItems: [{ id }]).
export function indexPRsByWorkItem(prs) {
  const map = new Map()
  for (const pr of prs || []) {
    for (const w of pr.linkedWorkItems || []) {
      const id = Number(w.id)
      if (!Number.isFinite(id)) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(pr)
    }
  }
  return map
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/modules/ado/index.js`, add after the `field-visibility` export block:

```js
export { indexPRsByWorkItem } from './pr-links.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/ado/pr-links.test.js`
Expected: PASS.

- [ ] **Step 6: Update the public-API guardrail**

Adding a core export breaks the surface snapshot. In `packages/core/tests/public-api.test.js`, add `'indexPRsByWorkItem'` to the `EXPECTED` array (place it near the other ado helpers). Then:

Run: `cd packages/core && npx vitest run tests/public-api.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/ado/pr-links.js packages/core/src/modules/ado/index.js packages/core/tests/ado/pr-links.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): add indexPRsByWorkItem reverse-index helper"
```

---

### Task 2: Loader populates PR linkedWorkItems

**Files:**
- Modify: `packages/core/src/modules/ado/loader.js` (the `prsP` block, ~lines 95-121)
- Test: `packages/core/tests/ado/loader.test.js`

**Interfaces:**
- Consumes: raw PR objects already carrying `id` (pullRequestId), `repoId`, `project`.
- Produces: each raw PR gains `linkedWorkItems: [{ id: <number> }]`; `mapPR` (unchanged) then normalizes it onto the mapped PR.

- [ ] **Step 1: Write the failing test**

```js
// append to packages/core/tests/ado/loader.test.js
describe('loadAdoData — PR work-item links', () => {
  it('populates PR linkedWorkItems from the PR workitems endpoint', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = makeHttp({
      '/_apis/git/repositories?': { value: [{ id: 'repo1', name: 'Repo One' }] },
      '/pullrequests?': { value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [] }] },
      '/pullRequests/55/workitems': { value: [{ id: '7' }, { id: '9' }] },
    })
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    const pr = result.PRS.find(p => p.id === 55)
    expect(pr).toBeTruthy()
    expect(pr.linkedWorkItems.map(w => w.id)).toEqual([7, 9])
  })

  it('degrades to empty links when the workitems endpoint fails', async () => {
    vi.spyOn(core, '_emit').mockImplementation(() => {})
    const http = {
      fetch: vi.fn(async (path) => {
        if (path.includes('/pullRequests/55/workitems')) return { ok: false, status: 500, json: async () => ({}) }
        if (path.includes('/_apis/git/repositories?')) return { ok: true, status: 200, json: async () => ({ value: [{ id: 'repo1', name: 'Repo One' }] }) }
        if (path.includes('/pullrequests?')) return { ok: true, status: 200, json: async () => ({ value: [{ pullRequestId: 55, title: 'Fix', createdBy: { displayName: 'Al' }, status: 'active', reviewers: [] }] }) }
        return { ok: true, status: 200, json: async () => ({ value: [] }) }
      }),
    }
    const result = await loadAdoData({ org: 'myorg', projects: ['proj-a'] }, { http, storage: makeStorage() })
    expect(result.PRS.find(p => p.id === 55).linkedWorkItems).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/ado/loader.test.js`
Expected: FAIL — `linkedWorkItems` is `[]` (endpoint never called), so `[7, 9]` assertion fails.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/ado/loader.js`, inside the `prsP` IIFE, after the `await Promise.all(cfgProjects.map(...))` that fills `all` and **before** `return all`, insert a link-population pass:

```js
    // Populate PR↔work-item links (one lightweight call per active PR).
    await Promise.all(all.map(async pr => {
      try {
        const w = await get(`${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/workitems?api-version=7.0`)
        pr.linkedWorkItems = (w.value || [])
          .map(x => ({ id: Number(x.id) }))
          .filter(x => Number.isFinite(x.id))
      } catch (_) {
        pr.linkedWorkItems = []
      }
    }))
    return all
```

(`get` is the loader's existing JSON fetch wrapper; `pr.id`/`pr.repoId`/`pr.project` are already set when the raw PR is pushed at lines 103-115.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/ado/loader.test.js`
Expected: PASS (both new cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/loader.js packages/core/tests/ado/loader.test.js
git commit -m "feat(core): fetch PR work-item links in the loader"
```

---

### Task 3: Work-item PR count + clickable indicator (cards + table)

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx`
- Test: `packages/ui/tests/workitem-linked-prs.test.jsx`

**Interfaces:**
- Consumes: `indexPRsByWorkItem` from `@nexusmd/core`.
- Produces: a module-level `navigateToPRs(workItemId)` and a real `w.prs` count on items.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/workitem-linked-prs.test.jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Linked item', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '3h' }
const PRS = [{ id: 55, title: 'Fix', status: 'active', linkedWorkItems: [{ id: 7 }] }]

afterEach(cleanup)

it('renders a clickable PR indicator that navigates to the PR view filtered to the work item', () => {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify('board') })
  const onOpen = vi.fn()
  const events = []
  const listener = e => events.push(e.detail)
  window.addEventListener('nexusmd:navigate', listener)
  try {
    const { container } = render(
      <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [], PRS } }}>
        <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={onOpen} team={[]} />
      </NexusDataProvider>
    )
    const card = container.querySelector('.board .board-card')
    const prBtn = Array.from(card.querySelectorAll('button')).find(b => b.title === 'View linked pull requests')
    expect(prBtn).toBeTruthy()          // indicator shows because PRS links WI #7
    expect(prBtn.textContent).toContain('1')
    fireEvent.click(prBtn)
    expect(events).toContainEqual({ view: 'prs', filter: { workItemId: 7 } })
    expect(onOpen).not.toHaveBeenCalled()   // clicking the PR indicator doesn't open the card
  } finally {
    window.removeEventListener('nexusmd:navigate', listener)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/workitem-linked-prs.test.jsx`
Expected: FAIL — no button with that title (indicator is a non-clickable span and count is 0).

- [ ] **Step 3: Implement**

3a. Add `indexPRsByWorkItem` to the existing `@nexusmd/core` import (line 10):

```js
import { adoTypeToHelm, adoStateToHelm, slugify, timeAgo, syncBoardColumns, getActiveLanes, resolveFields, WI_CARD_FIELDS, WI_TABLE_COLUMNS, indexPRsByWorkItem } from '@nexusmd/core';
```

3b. Add a module-level navigation helper (near the top of the file, after the imports):

```js
function navigateToPRs(workItemId) {
  window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'prs', filter: { workItemId } } }));
}
```

3c. In `WorkItemsView`, build the index and annotate `allItems` (replace the memo at ~260-263):

```js
  const prIndex = useMemoW(() => indexPRsByWorkItem(NexusMDData.PRS || []), [NexusMDData.PRS]);

  // Merged view: prop items (initial load + background refresh) + any extra pages loaded,
  // each annotated with its real linked-PR count.
  const allItems = useMemoW(() => {
    const seen = new Set(items.map(i => i.id));
    const merged = [...items, ...extraItems.filter(i => !seen.has(i.id))];
    return merged.map(i => ({ ...i, prs: prIndex.get(i.id)?.length ?? 0 }));
  }, [items, extraItems, prIndex]);
```

3d. Board card indicator — replace the span at line ~1171:

```jsx
        {w.prs > 0 && (
          <button
            type="button"
            className="mono"
            title="View linked pull requests"
            onClick={e => { e.stopPropagation(); navigateToPRs(w.id); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: 10.5, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
          ><Icon name="pr" size={10}/> {w.prs}</button>
        )}
```

3e. Table indicator — replace the `prs` fragment at line ~1488:

```jsx
    prs: () => (w.prs > 0 ? (
      <button
        key="prs"
        type="button"
        className="mono"
        title="View linked pull requests"
        onClick={e => { e.stopPropagation(); navigateToPRs(w.id); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
      ><Icon name="pr" size={10}/> {w.prs}</button>
    ) : null),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/workitem-linked-prs.test.jsx`
Expected: PASS.

- [ ] **Step 5: Regression check**

Run: `cd packages/ui && npx vitest run tests/views.test.jsx tests/board-card-fields.test.jsx tests/wi-table-fields.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/tests/workitem-linked-prs.test.jsx
git commit -m "feat(ui): clickable linked-PR indicator on work item cards and table"
```

---

### Task 4: PR view focused-work-item filter + banner

**Files:**
- Modify: `packages/ui/src/views/view-prs.jsx`
- Test: `packages/ui/tests/pr-focused-filter.test.jsx`

**Interfaces:**
- Consumes: `window.NexusMDNav.pendingFilter = { workItemId }` set by the host on navigate.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/pr-focused-filter.test.jsx
import { it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const PRS = [
  { id: 55, title: 'Linked PR', status: 'active', branch: 'a', age: '1d', author: 'x', authorName: 'X', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [{ id: 7 }], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 56, title: 'Other PR', status: 'active', branch: 'b', age: '1d', author: 'y', authorName: 'Y', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
]

beforeEach(() => { window.NexusMDNav = { pendingFilter: { workItemId: 7 } }; })
afterEach(() => { window.NexusMDNav = null; cleanup(); })

function renderView() {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all') })
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={PRS} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
}

it('shows only PRs linked to the focused work item, with a banner', () => {
  const { container } = renderView()
  expect(container.textContent).toContain('Linked PR')
  expect(container.textContent).not.toContain('Other PR')
  expect(container.textContent).toContain('#7')          // banner references the work item
})

it('Clear restores the full list', () => {
  const { container, getByText } = renderView()
  fireEvent.click(getByText('Clear'))
  expect(container.textContent).toContain('Other PR')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/pr-focused-filter.test.jsx`
Expected: FAIL — "Other PR" is present (no focused filter) and there's no "Clear".

- [ ] **Step 3: Implement**

In `packages/ui/src/views/view-prs.jsx`, inside `PRView` add a focused-work-item state + mount effect (near the other `useStatePR` declarations around line 88-92):

```js
  const [focusedWI, setFocusedWI] = useStatePR(null)
  React.useEffect(() => {
    const nav = window.NexusMDNav
    if (nav?.pendingFilter?.workItemId != null) {
      setFocusedWI(nav.pendingFilter.workItemId)
      window.NexusMDNav = null   // consume, like the planner view does
    }
  }, [])
```

Extend the `filtered` memo (lines 118-131) so a focused work item wins over the status/search filter:

```js
  const filtered = useMemoPR(() => {
    if (focusedWI != null) {
      return prs.filter(p => (p.linkedWorkItems || []).some(w => w.id === focusedWI))
    }
    let out = prs
    if (filter === 'needsMe') out = out.filter(p => effectiveNeedsMe(p, criteria))
    else if (filter === 'active') out = out.filter(p => p.status === 'active')
    else if (filter === 'drafts') out = out.filter(p => p.status === 'draft')
    else if (filter === 'merged') out = out.filter(p => p.status === 'merged')
    else if (filter === 'stale')  out = out.filter(p => p.status === 'active' && p.age && (p.age.endsWith('d') && parseInt(p.age) >= 3))
    else if (filter === 'failing') out = out.filter(p => p.ciStatus === 'failed')
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(p => p.title.toLowerCase().includes(q) || p.branch.toLowerCase().includes(q) || String(p.id).includes(q))
    }
    return out
  }, [prs, filter, search, criteria, focusedWI])
```

Render the banner immediately inside the view's returned root, above the filter/list markup (find the top of `PRView`'s returned JSX — the first child after the `page-head`; add this as a sibling before the filter bar):

```jsx
      {focusedWI != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', fontSize: 13 }}>
          <Icon name="pr" size={13} />
          <span>Showing pull requests for work item <strong>#{focusedWI}</strong></span>
          <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setFocusedWI(null)}>Clear</button>
        </div>
      )}
```

(`Icon` is already imported in this file. If the empty case matters, the existing "no PRs" empty state already renders when `filtered` is empty, so no extra handling is needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/pr-focused-filter.test.jsx`
Expected: PASS.

- [ ] **Step 5: Regression check**

Run: `cd packages/ui && npx vitest run tests/views.test.jsx tests/pr-card-fields.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-prs.jsx packages/ui/tests/pr-focused-filter.test.jsx
git commit -m "feat(ui): PR view filters to a focused work item's linked PRs"
```

---

### Task 5: Desktop host carries the navigate filter payload

**Files:**
- Modify: `apps/desktop/src/main.jsx` (the `nexusmd:navigate` handler, ~lines 776-786)

**Interfaces:**
- Consumes: `nexusmd:navigate` detail `{ view, filter }`.
- Produces: `window.NexusMDNav = { pendingFilter, view }` so `PRView` (Task 4) works on desktop. (Web already sets this at `apps/web/src/app.jsx:1936-1943`.)

- [ ] **Step 1: Implement**

Update the handler so it stores the filter before switching view:

```jsx
  React.useEffect(() => {
    const handler = e => {
      const detail = e.detail
      const next = typeof detail === 'string' ? detail : detail?.view
      const filter = (detail && typeof detail === 'object') ? (detail.filter || null) : null
      if (next) {
        window.NexusMDNav = { pendingFilter: filter, view: next }
        setView(next)
      }
    }
    window.addEventListener('nexusmd:navigate', handler)
    return () => window.removeEventListener('nexusmd:navigate', handler)
  }, [])
```

- [ ] **Step 2: Verify no desktop tests regressed**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS (222 tests). There is no unit test for this renderer wiring; correctness is that string-detail navigations still switch view and object-detail navigations additionally stash `pendingFilter`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): carry nexusmd:navigate filter payload into NexusMDNav"
```

---

## Self-Review Notes

- **Spec coverage:** §1 loader fetch → Task 2. §2 reverse index → Task 1. §3 count + clickable indicator (card + table) → Task 3. §4 PR view focused filter + banner → Task 4. §5 host wiring (web already done; desktop) → Task 5. §6 testing → each task's tests. All mapped.
- **Type consistency:** `indexPRsByWorkItem(prs) → Map<number,PR[]>`, `navigateToPRs(workItemId)`, filter shape `{ workItemId }`, and `window.NexusMDNav.pendingFilter.workItemId` are identical across Tasks 1-5. Work-item ids are numbers throughout (`Number(...)`).
- **Public-API guardrail:** Task 1 Step 6 updates `public-api.test.js` in the same task that adds the export (learned from the prior feature where this was missed).
- **Known approximation (called out):** the link fetch is one request per active PR per refresh (accepted in the spec). Non-active PRs are not indexed.
