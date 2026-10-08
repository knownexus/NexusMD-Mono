# ADO Dynamic Work Item Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app from silently dropping or corrupting Azure DevOps work item data because of hardcoded type/state/priority defaults that don't match a project's real (possibly customized) process template.

**Architecture:** Add one new pure function, `fetchAdoProcessMetadata`, to `packages/core/src/modules/ado/` that walks a project's real ADO work item types (`_apis/wit/workitemtypes`), their real states with ADO's own `category` (`_apis/wit/workitemtypes/{type}/states`), and their real Priority field `allowedValues` (`_apis/wit/workitemtypes/{type}/fields`). `loader.js` calls it once per full load (parallel to the existing team/sprint fetches), uses the real state names — grouped by ADO's `category`, not by guessed English names — to build the two WIQL queries that decide which items are "active" vs "resolved", and publishes the real type/state/priority lists on the returned data object (`TYPES`, `STATES`, `PRIORITIES`, `WI_TYPE_STATES`) so every app's dropdowns source from real project data instead of a fixed list. Because `loadAdoData` already runs identically on web (proxied through `AdoController`'s generic passthrough), desktop, and app (both hit `dev.azure.com` directly), this single change reaches all three apps.

**Tech Stack:** JavaScript (ES modules), React, Vitest.

**Spec:** This plan is scoped directly from two completed codebase audits (transcribed below in Global Constraints) — there is no separate spec document.

## Global Constraints

- Every ADO REST call must go through the `get(path)`/injected `http` adapter pattern already used in `loader.js` — never construct a new adapter or hit `dev.azure.com` directly from new code.
- `adoTypeToHelm` must keep its existing 6 known mappings (`bug/task/user story/feature/epic/spike`) byte-for-byte — only the "unknown type" fallback changes (from `'task'` to a slug of the real type name).
- `isTerminalState` and `stateCategory` (the UI bucket function) must remain backward compatible: existing 1-argument callers (`derive.js`, `digest/index.js`, `team/index.js`, `view-dashboard.jsx`, `apps/web/src/app.jsx`, `apps/app/src/app.jsx`) are **out of scope** for this plan and must keep working unchanged via the existing regex fallback — only `loader.js`'s own internal call site (assigned-work-item count) is updated to pass the new optional `adoCategory` argument.
- No new backend endpoints. `/api/workitems/states` currently has **no server implementation anywhere** (confirmed absent from `apps/web/server`, `apps/desktop`, `apps/app`) — its consumer in `view-workitems.jsx` is replaced with data sourced from `loadAdoData`, not with a new endpoint.
- Priority values are never clamped to 1–4 again — out-of-range or missing values pass through as-is (default `3` only when truly absent/unparseable).
- Every fetch in the new metadata function must fail soft (`catch` + continue) — one bad project/type must never abort the whole load, matching every other fetch in `loader.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/modules/ado/process-metadata.js` (new) | Fetch real ADO types/states/priorities for a set of projects; pure, transport-agnostic (takes an injected `get`). |
| `packages/core/tests/ado/process-metadata.test.js` (new) | Unit tests for the above. |
| `packages/core/src/modules/ado/helpers.js` | `adoTypeToHelm` stops collapsing unknown types to `'task'`; `isTerminalState`/`stateCategory` gain an optional `adoCategory` override. |
| `packages/core/src/modules/ado/mappers.js` | `mapWorkItem` gains a 3rd `stateCategoryByName` param, stops clamping priority. |
| `packages/core/src/modules/ado/loader.js` | Fetches process metadata once per full load; builds WIQL from real state names; publishes `TYPES`/`STATES`/`PRIORITIES`/`WI_TYPE_STATES`/`_adoMeta`. |
| `packages/core/src/modules/ado/index.js` | Export `fetchAdoProcessMetadata`. |
| `packages/ui/src/data-context.jsx` | `EMPTY_NEXUS_DATA` gets `TYPES`, `PRIORITIES`, `WI_TYPE_STATES` defaults. |
| `apps/web/src/data.js`, `apps/app/src/data.jsx` | Seed objects get the same 3 new keys. |
| `packages/ui/src/views/view-workitems.jsx` | Priority clamp removed; Type/Priority filter dropdowns become dynamic; broken `/api/workitems/states` fetch replaced with data sourced from `NexusMDData.WI_TYPE_STATES`. |
| `apps/web/src/app.jsx`, `apps/app/src/app.jsx` | Create-modal Type/Priority selects and edit-drawer Priority select become dynamic instead of hardcoded. |

---

### Task 1: `fetchAdoProcessMetadata` — real types, states, priorities per project

**Files:**
- Create: `packages/core/src/modules/ado/process-metadata.js`
- Test: `packages/core/tests/ado/process-metadata.test.js`

**Interfaces:**
- Consumes: an already-bound `async get(path) => json` function (same contract as `loader.js`'s local `get`), and `projects: string[]`.
- Produces: `fetchAdoProcessMetadata(get, projects) => Promise<{ types: string[], typeStates: {[type:string]: string[]}, stateCategoryByName: {[state:string]: string}, states: string[], terminalStateNames: string[], doneStateNames: string[], priorities: number[] }>` — consumed by Task 4 (`loader.js`).

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/ado/process-metadata.test.js
import { describe, it, expect } from 'vitest'
import { fetchAdoProcessMetadata } from '../../src/modules/ado/process-metadata.js'

function makeGet(responses) {
  return async (path) => {
    for (const [pattern, data] of Object.entries(responses)) {
      if (path.includes(pattern)) return data
    }
    return { value: [] }
  }
}

const TYPES_RESPONSE = {
  value: [
    { name: 'Bug', isDisabled: false },
    { name: 'Task', isDisabled: false },
    { name: 'Retired Type', isDisabled: true },
  ],
}

const BUG_STATES = {
  value: [
    { name: 'New', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
    { name: 'Verified', category: 'Resolved' },
    { name: 'Closed', category: 'Completed' },
  ],
}

const TASK_STATES = {
  value: [
    { name: 'To Do', category: 'Proposed' },
    { name: 'Doing', category: 'InProgress' },
    { name: 'Done', category: 'Completed' },
  ],
}

const PRIORITY_FIELDS = {
  value: [
    { referenceName: 'Microsoft.VSTS.Common.Priority', allowedValues: [1, 2, 3, 4] },
  ],
}

function makeStandardGet() {
  return makeGet({
    'workitemtypes?api-version': TYPES_RESPONSE,
    'workitemtypes/Bug/states': BUG_STATES,
    'workitemtypes/Task/states': TASK_STATES,
    'workitemtypes/Bug/fields': PRIORITY_FIELDS,
    'workitemtypes/Task/fields': PRIORITY_FIELDS,
  })
}

describe('fetchAdoProcessMetadata', () => {
  it('returns empty result for no projects', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), [])
    expect(result).toEqual({
      types: [], typeStates: {}, stateCategoryByName: {}, states: [],
      terminalStateNames: [], doneStateNames: [], priorities: [],
    })
  })

  it('filters out disabled types', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.types).not.toContain('Retired Type')
    expect(result.types).toEqual(['Bug', 'Task'])
  })

  it('builds per-type state lists', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.typeStates.Bug).toEqual(['New', 'Active', 'Verified', 'Closed'])
    expect(result.typeStates.Task).toEqual(['To Do', 'Doing', 'Done'])
  })

  it('classifies a custom terminal state ("Verified") as done, not just the standard names', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.stateCategoryByName.Verified).toBe('Resolved')
    expect(result.doneStateNames).toContain('Verified')
    expect(result.terminalStateNames).toContain('Verified')
  })

  it('excludes Proposed/InProgress states from terminal/done lists', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.terminalStateNames).not.toContain('New')
    expect(result.terminalStateNames).not.toContain('Active')
    expect(result.doneStateNames).not.toContain('Active')
  })

  it('unions numeric priority allowedValues across types, sorted ascending', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.priorities).toEqual([1, 2, 3, 4])
  })

  it('does not throw when a project fails entirely', async () => {
    const get = async (path) => { throw new Error('network down') }
    const result = await fetchAdoProcessMetadata(get, ['BrokenProj'])
    expect(result).toEqual({
      types: [], typeStates: {}, stateCategoryByName: {}, states: [],
      terminalStateNames: [], doneStateNames: [], priorities: [],
    })
  })

  it('does not throw when the states call fails for one type but the fields call succeeds', async () => {
    const get = makeGet({
      'workitemtypes?api-version': { value: [{ name: 'Bug', isDisabled: false }] },
      'workitemtypes/Bug/fields': PRIORITY_FIELDS,
      // no 'states' entry → falls through to the default { value: [] } in makeGet
    })
    const result = await fetchAdoProcessMetadata(get, ['Proj'])
    expect(result.types).toEqual(['Bug'])
    expect(result.priorities).toEqual([1, 2, 3, 4])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- process-metadata`
Expected: FAIL — `Cannot find module '../../src/modules/ado/process-metadata.js'`

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/modules/ado/process-metadata.js
// Fetches an org's REAL work item types/states/priorities per project, so
// callers never have to guess at a process template's names. ADO's own
// per-state `category` field (Proposed/InProgress/Resolved/Completed/Removed)
// drives terminal/done classification instead of matching on English state
// names — a project can rename "Done" to "Verified" and this still works.

const TERMINAL_CATEGORIES = new Set(['Resolved', 'Completed', 'Removed'])
const DONE_CATEGORIES = new Set(['Resolved', 'Completed'])

export async function fetchAdoProcessMetadata(get, projects = []) {
  const typeNames = new Set()
  const typeStates = {}
  const stateCategoryByName = {}
  const priorityValues = new Set()

  await Promise.all(projects.map(async (proj) => {
    let types = []
    try {
      const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes?api-version=7.0`)
      types = (res.value || []).filter((t) => !t.isDisabled).map((t) => t.name)
    } catch (_) { return }

    await Promise.all(types.map(async (type) => {
      typeNames.add(type)

      try {
        const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.0`)
        const names = []
        ;(res.value || []).forEach((s) => {
          if (!s.name) return
          names.push(s.name)
          if (!stateCategoryByName[s.name]) stateCategoryByName[s.name] = s.category || 'Proposed'
        })
        if (names.length) {
          typeStates[type] = Array.from(new Set([...(typeStates[type] || []), ...names]))
        }
      } catch (_) {}

      try {
        const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?api-version=7.0`)
        const priorityField = (res.value || []).find((f) => f.referenceName === 'Microsoft.VSTS.Common.Priority')
        ;(priorityField?.allowedValues || []).forEach((v) => {
          const n = Number(v)
          if (Number.isFinite(n)) priorityValues.add(n)
        })
      } catch (_) {}
    }))
  }))

  const stateNames = Object.keys(stateCategoryByName)

  return {
    types: Array.from(typeNames).sort(),
    typeStates,
    stateCategoryByName,
    states: stateNames.sort(),
    terminalStateNames: stateNames.filter((n) => TERMINAL_CATEGORIES.has(stateCategoryByName[n])),
    doneStateNames: stateNames.filter((n) => DONE_CATEGORIES.has(stateCategoryByName[n])),
    priorities: Array.from(priorityValues).sort((a, b) => a - b),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- process-metadata`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/process-metadata.js packages/core/tests/ado/process-metadata.test.js
git commit -m "feat(core): fetch real ADO work item types/states/priorities per project"
```

---

### Task 2: `helpers.js` — stop collapsing unknown types, add real-category override

**Files:**
- Modify: `packages/core/src/modules/ado/helpers.js:36-45,58,62-68`
- Test: `packages/core/tests/ado/helpers.test.js:64-73,91-122`

**Interfaces:**
- Consumes: nothing new.
- Produces: `adoTypeToHelm(t)` unknown-type fallback changes from `'task'` to `slugify(t) || 'task'`. `isTerminalState(s, adoCategory?)` and `stateCategory(s, adoCategory?)` gain an optional 2nd param — consumed by Task 3 (`mappers.js` sets `adoStateCategory`) and Task 4 (`loader.js`'s assigned-count filter).

- [ ] **Step 1: Update the existing test to the new (correct) behavior**

In `packages/core/tests/ado/helpers.test.js`, replace:

```js
  it('maps unknown types to "task"', () => expect(adoTypeToHelm('Requirement')).toBe('task'))
  it('handles null', () => expect(adoTypeToHelm(null)).toBe('task'))
```

with:

```js
  it('slugifies unknown/custom types instead of collapsing them to "task"', () => {
    expect(adoTypeToHelm('Requirement')).toBe('requirement')
    expect(adoTypeToHelm('Product Backlog Item')).toBe('product-backlog-item')
  })
  it('handles null', () => expect(adoTypeToHelm(null)).toBe('task'))
```

Add a new `describe` block after `describe('state classifiers', ...)` (after line 122, before `describe('constants', ...)`):

```js
describe('isTerminalState with an ADO category override', () => {
  it('treats Resolved/Completed/Removed categories as terminal regardless of the state name', () => {
    expect(isTerminalState('Verified', 'Resolved')).toBe(true)
    expect(isTerminalState('Shipped', 'Completed')).toBe(true)
    expect(isTerminalState('Deprecated', 'Removed')).toBe(true)
  })
  it('treats Proposed/InProgress categories as not terminal even if the name looks terminal-ish', () => {
    expect(isTerminalState('Done-ish Review', 'InProgress')).toBe(false)
  })
  it('falls back to the name regex when no category is given', () => {
    expect(isTerminalState('Done')).toBe(true)
    expect(isTerminalState('Active')).toBe(false)
  })
})

describe('stateCategory with an ADO category override', () => {
  it('buckets Resolved/Completed/Removed as done', () => {
    expect(stateCategory('Verified', 'Resolved')).toBe('done')
    expect(stateCategory('Shipped', 'Completed')).toBe('done')
    expect(stateCategory('Deprecated', 'Removed')).toBe('done')
  })
  it('buckets InProgress as active and Proposed as todo', () => {
    expect(stateCategory('Doing Stuff', 'InProgress')).toBe('active')
    expect(stateCategory('Backlog Item', 'Proposed')).toBe('todo')
  })
  it('falls back to the name regex when no category is given', () => {
    expect(stateCategory('Blocked')).toBe('blocked')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- helpers`
Expected: FAIL — `adoTypeToHelm('Requirement')` returns `'task'` not `'requirement'`; `isTerminalState`/`stateCategory` ignore the 2nd arg.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/ado/helpers.js`, replace lines 36-45:

```js
export function adoTypeToHelm(t) {
  const s = (t || '').toLowerCase()
  if (s === 'bug')        return 'bug'
  if (s === 'task')       return 'task'
  if (s === 'user story') return 'story'
  if (s === 'feature')    return 'feature'
  if (s === 'epic')       return 'epic'
  if (s === 'spike')      return 'spike'
  return slugify(t) || 'task'
}
```

Replace line 58 (`isTerminalState`) and lines 62-68 (`stateCategory`, currently the last block in the file):

```js
export const isTerminalState = (s, adoCategory) => {
  if (adoCategory) return adoCategory === 'Resolved' || adoCategory === 'Completed' || adoCategory === 'Removed'
  return /^(done|closed|resolved|completed|removed)$/i.test(s || '')
}
export const isActiveState   = s => /^(active|in progress|in testing|specced|assigned)$/i.test(s || '')
export const isReviewState   = s => /^(in review|needs review|review|pull request|pr)$/i.test(s || '')
export const isBlockedState  = s => /^(blocked)$/i.test(s || '')
export const stateCategory   = (s, adoCategory) => {
  if (adoCategory === 'Completed' || adoCategory === 'Resolved' || adoCategory === 'Removed') return 'done'
  if (adoCategory === 'InProgress') return 'active'
  if (adoCategory === 'Proposed')   return 'todo'
  if (isTerminalState(s)) return 'done'
  if (isActiveState(s))   return 'active'
  if (isReviewState(s))   return 'review'
  if (isBlockedState(s))  return 'blocked'
  return 'todo'
}
```

(`isActiveState`/`isReviewState`/`isBlockedState` are unchanged — only re-copied here to show the block in full.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/core test -- helpers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/helpers.js packages/core/tests/ado/helpers.test.js
git commit -m "fix(core): stop collapsing custom work item types to 'task'; classify state by real ADO category when known"
```

---

### Task 3: `mappers.js` — carry `adoStateCategory`, stop clamping priority

**Files:**
- Modify: `packages/core/src/modules/ado/mappers.js:3-33`
- Test: `packages/core/tests/ado/mappers.test.js:46-51`

**Interfaces:**
- Consumes: nothing new (still just `adoTypeToHelm` from `./helpers.js`).
- Produces: `mapWorkItem(wi, nameToId = {}, stateCategoryByName = {})` — 3rd param is new. Returned object gains `adoStateCategory: string|null`. `priority` is no longer clamped. Consumed by Task 4 (`loader.js` passes `meta.stateCategoryByName`).

- [ ] **Step 1: Update the existing clamp test to the new (correct) behavior**

In `packages/core/tests/ado/mappers.test.js`, replace:

```js
  it('clamps priority between 1 and 4', () => {
    const hi = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '0' } }
    expect(mapWorkItem(hi, {}).priority).toBe(1)
    const lo = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '9' } }
    expect(mapWorkItem(lo, {}).priority).toBe(4)
  })
```

with:

```js
  it('preserves out-of-range priority values instead of clamping them (custom process templates use non-1-4 ranges)', () => {
    const zero = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '0' } }
    expect(mapWorkItem(zero, {}).priority).toBe(0)
    const nine = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': '9' } }
    expect(mapWorkItem(nine, {}).priority).toBe(9)
  })
  it('defaults priority to 3 when missing or unparseable', () => {
    const missing = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': undefined } }
    expect(mapWorkItem(missing, {}).priority).toBe(3)
    const garbage = { ...rawWI, fields: { ...rawWI.fields, 'Microsoft.VSTS.Common.Priority': 'n/a' } }
    expect(mapWorkItem(garbage, {}).priority).toBe(3)
  })
  it('sets adoStateCategory from the 3rd param when the item state is a known category', () => {
    const wi = mapWorkItem(rawWI, {}, { Active: 'InProgress' })
    expect(wi.adoStateCategory).toBe('InProgress')
  })
  it('sets adoStateCategory to null when the state is not in the map', () => {
    expect(mapWorkItem(rawWI, {}).adoStateCategory).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- mappers`
Expected: FAIL — priority is still clamped to 1/4; `adoStateCategory` is `undefined`, not `null`/`'InProgress'`.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/ado/mappers.js`, replace lines 3-33:

```js
export function mapWorkItem(wi, nameToId = {}, stateCategoryByName = {}) {
  const f = wi.fields || wi
  const id        = wi.id || f['System.Id']
  const title     = f['System.Title']              || f.title      || ''
  const wiType    = f['System.WorkItemType']        || f.type       || 'Task'
  const state     = f['System.State']              || f.state      || ''
  const priorityRaw = parseInt(f['Microsoft.VSTS.Common.Priority'] ?? f.priority, 10)
  const priority  = Number.isFinite(priorityRaw) ? priorityRaw : 3
  const assignedTo = f['System.AssignedTo'] || f.assignedTo
  const tags      = (f['System.Tags'] || f.tags || '').split(';').map(t => t.trim()).filter(Boolean)
  const changed   = f['System.ChangedDate'] || f.changedDate || ''
  const iterPath  = f['System.IterationPath'] || f.iterationPath || ''
  const areaPath  = f['System.AreaPath']     || f.areaPath     || ''
  const area      = f['Custom.Area']         || f.area         || ''
  const projSlug  = slugify(areaPath.replace(/\//g, '\\').split('\\')[0] || 'default')
  const assigneeName = typeof assignedTo === 'string'
    ? assignedTo
    : (assignedTo?.displayName || assignedTo?.uniqueName || null)
  const assigneeId = assigneeName ? (nameToId[assigneeName] || null) : null
  const isNew  = changed ? (Date.now() - new Date(changed).getTime()) < 86_400_000 : false
  const isSprint = iterPath.toLowerCase().includes('sprint') || iterPath.toLowerCase().includes('iteration')
  return {
    id, type: adoTypeToHelm(wiType), title, project: projSlug,
    state, adoStateCategory: stateCategoryByName[state] || null,
    assignee: assigneeId,
    priority,
    points: Math.round(parseFloat(f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0) || 0),
    tags, updated: timeAgo(changed), changedMs: changed ? new Date(changed).getTime() : null,
    sprint: isSprint, iterationPath: iterPath, areaPath, area,
    comments: parseInt(f['System.CommentCount'] ?? f.commentCount ?? 0, 10) || 0,
    prs: 0, isNew,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/core test -- mappers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/mappers.js packages/core/tests/ado/mappers.test.js
git commit -m "fix(core): stop clamping work item priority to 1-4; carry real ADO state category"
```

---

### Task 4: `loader.js` — dynamic WIQL + publish real types/states/priorities

**Files:**
- Modify: `packages/core/src/modules/ado/loader.js`
- Test: `packages/core/tests/ado/loader.test.js`

**Interfaces:**
- Consumes: `fetchAdoProcessMetadata` (Task 1), `mapWorkItem(wi, nameToId, stateCategoryByName)` (Task 3), `isTerminalState(s, adoCategory)` (Task 2).
- Produces: `loadAdoData(...)`'s returned `data` object gains `TYPES: string[]`, `PRIORITIES: number[]`, `WI_TYPE_STATES: {[type]: string[]}`, `_adoMeta: object|null`. `data.STATES` is now the real per-org state list when available (falls back to the existing hardcoded `STATES` constant only when metadata fetch fails). Consumed by Task 6 (`view-workitems.jsx`), Task 7 (seed defaults), Task 8/9 (`app.jsx` dropdowns).

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/ado/loader.test.js` (after the existing `describe('loadAdoData — events', ...)` block):

```js
describe('loadAdoData — dynamic WIQL from real ADO state metadata', () => {
  it('excludes a custom terminal state ("Verified") from the active-items query, and includes it in the resolved-items query — not just the hardcoded Done/Closed/Resolved/Completed/Removed names', async () => {
    const http = makeHttp({
      'workitemtypes?api-version': { value: [{ name: 'Bug', isDisabled: false }] },
      'workitemtypes/Bug/states': {
        value: [
          { name: 'New', category: 'Proposed' },
          { name: 'Active', category: 'InProgress' },
          { name: 'Verified', category: 'Resolved' },
        ],
      },
      'workitemtypes/Bug/fields': { value: [] },
      '_apis/wit/wiql': { workItems: [] },
    })
    await loadAdoData({ org: 'myorg', projects: ['Proj'] }, { http, storage: makeStorage() })

    const wiqlCalls = http.fetch.mock.calls.filter(([path]) => path.includes('_apis/wit/wiql'))
    const bodies = wiqlCalls.map(([, opts]) => JSON.parse(opts.body).query)

    const activeQuery   = bodies.find(q => q.includes('NOT IN'))
    const resolvedQuery = bodies.find(q => q.includes(' IN ('))

    expect(activeQuery).toContain("'Verified'")
    expect(resolvedQuery).toContain("'Verified'")
    // Proposed/InProgress states must never appear as "resolved"
    expect(resolvedQuery).not.toContain("'New'")
    expect(resolvedQuery).not.toContain("'Active'")
  })

  it('falls back to the hardcoded terminal-state list when the metadata fetch returns nothing (e.g. all calls failed)', async () => {
    const http = makeHttp({ '_apis/wit/wiql': { workItems: [] } }) // workitemtypes falls through to { value: [] }
    await loadAdoData({ org: 'myorg', projects: ['Proj'] }, { http, storage: makeStorage() })

    const wiqlCalls = http.fetch.mock.calls.filter(([path]) => path.includes('_apis/wit/wiql'))
    const bodies = wiqlCalls.map(([, opts]) => JSON.parse(opts.body).query)
    const activeQuery = bodies.find(q => q.includes('NOT IN'))
    expect(activeQuery).toContain("'Done'")
    expect(activeQuery).toContain("'Closed'")
  })

  it('publishes TYPES, PRIORITIES, and WI_TYPE_STATES on the returned data', async () => {
    const http = makeHttp({
      'workitemtypes?api-version': { value: [{ name: 'Bug', isDisabled: false }] },
      'workitemtypes/Bug/states': { value: [{ name: 'New', category: 'Proposed' }] },
      'workitemtypes/Bug/fields': {
        value: [{ referenceName: 'Microsoft.VSTS.Common.Priority', allowedValues: [1, 2, 3] }],
      },
    })
    const data = await loadAdoData({ org: 'myorg', projects: ['Proj'] }, { http, storage: makeStorage() })

    expect(data.TYPES).toEqual(['Bug'])
    expect(data.PRIORITIES).toEqual([1, 2, 3])
    expect(data.WI_TYPE_STATES).toEqual({ Bug: ['New'] })
    expect(data.STATES).toEqual(['New'])
  })

  it('reuses the prior full load\'s metadata on a refresh instead of refetching it', async () => {
    const http = makeHttp({})
    const priorData = {
      TEAM: [], ME: { id: 'me', name: 'Test', role: 'EM', initials: 'T', org: 'myorg' },
      _iterMeta: null,
      _adoMeta: { types: ['CustomType'], typeStates: {}, stateCategoryByName: {}, states: [], terminalStateNames: ['Shipped'], doneStateNames: ['Shipped'], priorities: [] },
    }
    const data = await loadAdoData(
      { org: 'myorg', projects: ['Proj'] },
      { http, storage: makeStorage() },
      { isRefresh: true, priorData },
    )
    expect(data.TYPES).toEqual(['CustomType'])
    // No workitemtypes call should have been made on refresh.
    expect(http.fetch.mock.calls.some(([path]) => path.includes('workitemtypes'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- loader`
Expected: FAIL — `data.TYPES`/`PRIORITIES`/`WI_TYPE_STATES` are `undefined`; WIQL queries still contain the hardcoded literal state list only.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/ado/loader.js`, change the import at line 1-4:

```js
import { core } from '../../core.js'
import { slugify, timeAgo, isTerminalState, STATES } from './helpers.js'
import { mapWorkItem, mapPR, mapBuild, mapTestBuild } from './mappers.js'
import { deriveProjects, deriveSprint, deriveActivity, derivePrSparkline } from './derive.js'
import { fetchAdoProcessMetadata } from './process-metadata.js'
```

Insert a new `metaP` promise right after `teamP` (after line 66, before the existing `const wiP = (async () => {` block), and replace the `wiP` and `summaryP` blocks (originally lines 68-89 and 158-191) so they depend on it:

```js
  const metaP = !isRefresh
    ? fetchAdoProcessMetadata(get, cfgProjects).catch(() => null)
    : Promise.resolve(priorData?._adoMeta || null)

  const FALLBACK_TERMINAL_STATES = ['Done', 'Closed', 'Resolved', 'Completed', 'Removed']
  const FALLBACK_DONE_STATES = ['Done', 'Closed', 'Resolved', 'Completed']
  const wiqlStateList = (names) => names.map(s => `'${String(s).replace(/'/g, "''")}'`).join(',')

  const wiP = metaP.then(async (meta) => {
    const terminalNames = meta?.terminalStateNames?.length ? meta.terminalStateNames : FALLBACK_TERMINAL_STATES
    const notInClause = wiqlStateList(terminalNames)
    const all = []
    await Promise.all(cfgProjects.map(async proj => {
      try {
        const wiql = await post(`${encodeURIComponent(proj)}/_apis/wit/wiql?api-version=7.0&$top=300`, {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] NOT IN (${notInClause}) ORDER BY [System.ChangedDate] DESC`,
        })
        const ids = (wiql.workItems || []).slice(0, 300).map(w => w.id)
        if (!ids.length) return
        const fields = 'System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo,System.ChangedDate,System.CreatedDate,System.Tags,System.IterationPath,System.AreaPath,Custom.Area,Microsoft.VSTS.Common.Priority,Microsoft.VSTS.Scheduling.StoryPoints,System.CommentCount'
        const batches = []
        for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200))
        await Promise.all(batches.map(async batch => {
          try {
            const r = await get(`_apis/wit/workitems?ids=${batch.join(',')}&fields=${encodeURIComponent(fields)}&api-version=7.0`)
            ;(r.value || []).forEach(wi => all.push(wi))
          } catch (_) {}
        }))
      } catch (_) {}
    }))
    return all
  })
```

Leave `sprintP`, `prsP`, `buildsP`, `testBuildsP`, `testRunsP` exactly as they are. Replace `summaryP` (originally lines 158-191):

```js
  const summaryP = metaP.then(async (meta) => {
    try {
      const doneNames = meta?.doneStateNames?.length ? meta.doneStateNames : FALLBACK_DONE_STATES
      const inClause = wiqlStateList(doneNames)
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const all = []
      await Promise.all(cfgProjects.map(async proj => {
        try {
          const wiql = await post(`${encodeURIComponent(proj)}/_apis/wit/wiql?api-version=7.0`, {
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (${inClause}) AND [System.ChangedDate] >= '${cutoff}' ORDER BY [System.ChangedDate] DESC`,
          })
          const ids = (wiql.workItems || []).slice(0, 100).map(w => w.id)
          if (!ids.length) return
          const r = await get(`_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.CreatedDate,Microsoft.VSTS.Common.ClosedDate&api-version=7.0`)
          ;(r.value || []).forEach(wi => all.push(wi))
        } catch (_) {}
      }))
      const items = all.map(wi => ({
        id: wi.id,
        title:       wi.fields?.['System.Title']        || '',
        type:        wi.fields?.['System.WorkItemType']  || '',
        state:       wi.fields?.['System.State']         || '',
        createdDate: wi.fields?.['System.CreatedDate']   || null,
        closedDate:  wi.fields?.['Microsoft.VSTS.Common.ClosedDate'] || wi.fields?.['System.ChangedDate'] || null,
      })).slice(0, 15)
      const durations = items
        .filter(i => i.createdDate && i.closedDate)
        .map(i => (new Date(i.closedDate) - new Date(i.createdDate)) / 86_400_000)
      return {
        resolvedWorkItems: items,
        avgResolutionDays: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 10) / 10
          : null,
      }
    } catch (_) { return null }
  })
```

Update the `Promise.all` destructure (originally lines 194-195) to also await `metaP`:

```js
  const [teamNames, meData, wiRaw, sprintResult, prsRaw, buildsRaw, testBuildsResult, testRunsResult, summaryResult, meta] =
    await Promise.all([teamP, meP, wiP, sprintP, prsP, buildsP, testBuildsP, testRunsP, summaryP, metaP])
```

Update the work-item mapping loop (originally lines 247-249) to pass `meta.stateCategoryByName`:

```js
  const helmWIs = []
  ;(wiRaw || []).forEach(wi => { try { helmWIs.push(mapWorkItem(wi, nameToId, meta?.stateCategoryByName)) } catch (_) {} })
```

Update the assigned-count filter (originally line 252) to use the mapped item's real category:

```js
  helmTeam.forEach(member => {
    const assigned = helmWIs.filter(w => w.assignee === member.id && !isTerminalState(w.state, w.adoStateCategory))
    member.assignedCount = assigned.length
    const latest = assigned.reduce((best, w) => (!best || (w.changedMs && w.changedMs > (best.changedMs || 0))) ? w : best, null)
    member.lastActiveAgo = (latest?.changedMs) ? timeAgo(new Date(latest.changedMs).toISOString()) : '—'
  })
```

Finally, in the `data` assembly object (originally lines 311-333), replace the `STATES,` line and add the three new fields plus `_adoMeta`:

```js
    STATES: meta?.states?.length ? meta.states : STATES,
    TYPES: meta?.types || [],
    PRIORITIES: meta?.priorities || [],
    WI_TYPE_STATES: meta?.typeStates || {},
```

and, alongside the existing `_iterMeta: iterMeta,` / `_testProject: testProj,` lines:

```js
    _adoMeta: meta || null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/core test -- loader`
Expected: PASS. Also run the full core suite to catch any regression in unrelated loader tests: `npm -w packages/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/ado/loader.js packages/core/tests/ado/loader.test.js
git commit -m "fix(core): build active/resolved WIQL from real per-project ADO state categories, not a hardcoded name list"
```

---

### Task 5: Export `fetchAdoProcessMetadata` from the package barrel

**Files:**
- Modify: `packages/core/src/modules/ado/index.js:1`

**Interfaces:**
- Consumes: `fetchAdoProcessMetadata` from `./process-metadata.js` (Task 1).
- Produces: `fetchAdoProcessMetadata` importable from `@nexusmd/core` — not directly consumed by any later task (loader.js imports it directly from the module file), but kept exported for symmetry with every other ADO module function and for potential future direct use (e.g. by a settings screen wanting to preview a project's real types).

- [ ] **Step 1: Add the export**

```js
export { loadAdoData, loadCachedAdoData, ADO_CACHE_KEY } from './loader.js'
export { fetchAdoProcessMetadata } from './process-metadata.js'
export { mapWorkItem, mapPR, mapBuild, mapTestBuild, mapBuildTimeline } from './mappers.js'
```

(Insert the new line directly after the existing `loader.js` export line; the rest of `index.js` is unchanged.)

- [ ] **Step 2: Verify the export resolves**

Run: `npm -w packages/core test`
Expected: PASS (no test imports it yet, but this confirms no syntax error was introduced)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/modules/ado/index.js
git commit -m "feat(core): export fetchAdoProcessMetadata from the ado module barrel"
```

---

### Task 6: `view-workitems.jsx` — dynamic Type/Priority filters, remove clamp, fix state sourcing

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx:284-295,316,399-406,644-694`

**Interfaces:**
- Consumes: `NexusMDData.TYPES`, `NexusMDData.PRIORITIES`, `NexusMDData.WI_TYPE_STATES` (Task 4/7).
- Produces: no new exports; internal behavior only.

- [ ] **Step 1: Remove the priority clamp in `mapDto`**

At line 316, replace:

```js
        priority:      Math.min(4, Math.max(1, wi.priority || 3)),
```

with:

```js
        priority:      Number.isFinite(wi.priority) ? wi.priority : 3,
```

- [ ] **Step 2: Replace the broken `/api/workitems/states` fetch with `NexusMDData`-sourced seeding**

Replace the effect at lines 399-406:

```js
  const [wiTypeStates, setWiTypeStates] = useStateW({});

  React.useEffect(() => {
    const cached = localStorage.getItem(WI_TYPE_STATES_CACHE_KEY);
    if (cached) { try { setWiTypeStates(JSON.parse(cached)); } catch (_) {} }
    fetch('/api/workitems/states')
      .then(r => r.ok ? r.json() : {})
      .then(data => { setWiTypeStates(data); localStorage.setItem(WI_TYPE_STATES_CACHE_KEY, JSON.stringify(data)); })
      .catch(() => {});
  }, []);
```

with:

```js
  const [wiTypeStates, setWiTypeStates] = useStateW({});

  // Seed instantly from the last load's cache so board columns/state filters
  // aren't empty on first paint, then overwrite with the current load's real
  // per-project data as soon as it's in NexusMDData (populated by loadAdoData —
  // there is no /api/workitems/states backend; this used to fetch that route,
  // which 404s everywhere, silently forcing the hardcoded STATES fallback below).
  React.useEffect(() => {
    const cached = localStorage.getItem(WI_TYPE_STATES_CACHE_KEY);
    if (cached) { try { setWiTypeStates(JSON.parse(cached)); } catch (_) {} }
  }, []);

  React.useEffect(() => {
    const live = NexusMDData.WI_TYPE_STATES;
    if (!live || Object.keys(live).length === 0) return;
    setWiTypeStates(live);
    try { localStorage.setItem(WI_TYPE_STATES_CACHE_KEY, JSON.stringify(live)); } catch (_) {}
  }, [NexusMDData.WI_TYPE_STATES]);
```

- [ ] **Step 3: Make the Type filter dropdown dynamic**

Add a new memo near the other item-derived memos, directly after the `allItems` memo (after line 295, before the `mapDto` memo at line 298):

```js
  const KNOWN_TYPES = ['bug', 'feature', 'task', 'story', 'spike', 'epic'];
  const typeFilterOptions = useMemoW(() => {
    const extra = new Set();
    allItems.forEach(w => { if (w.type && !KNOWN_TYPES.includes(w.type)) extra.add(w.type); });
    return [...KNOWN_TYPES, ...Array.from(extra).sort()];
  }, [allItems]);
```

Replace the Type filter's inline array (lines 645-654):

```js
          {/* Type */}
          <FilterDropdown label="Type" activeCount={activeTypes.size + negatedTypes.size} width={260}>
            <FilterSection title="Type">
              {['bug', 'feature', 'task', 'story', 'spike', 'epic'].map(t => (
                <FilterOption key={t} active={activeTypes.has(t)} negated={negatedTypes.has(t)}
                  label={t[0].toUpperCase() + t.slice(1)} icon={<TypeIcon type={t}/>}
                  count={allItems.filter(w => w.type === t).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedTypes, setActiveTypes)(t); else toggle(setActiveTypes)(t); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>
```

with:

```js
          {/* Type */}
          <FilterDropdown label="Type" activeCount={activeTypes.size + negatedTypes.size} width={260}>
            <FilterSection title="Type">
              {typeFilterOptions.map(t => (
                <FilterOption key={t} active={activeTypes.has(t)} negated={negatedTypes.has(t)}
                  label={t[0].toUpperCase() + t.slice(1)} icon={<TypeIcon type={t}/>}
                  count={allItems.filter(w => w.type === t).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedTypes, setActiveTypes)(t); else toggle(setActiveTypes)(t); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>
```

- [ ] **Step 4: Make the Priority filter dropdown dynamic**

Add a memo right after `typeFilterOptions` (from Step 3):

```js
  const priorityFilterOptions = useMemoW(() => {
    const base = new Set(NexusMDData.PRIORITIES?.length ? NexusMDData.PRIORITIES : [1, 2, 3, 4]);
    allItems.forEach(w => { if (Number.isFinite(w.priority)) base.add(w.priority); });
    return Array.from(base).sort((a, b) => a - b);
  }, [allItems, NexusMDData.PRIORITIES]);
```

Replace the Priority filter's inline array (lines 685-694):

```js
          {/* Priority */}
          <FilterDropdown label="Priority" activeCount={activePrios.size + negatedPrios.size} width={240}>
            <FilterSection title="Priority">
              {[1, 2, 3, 4].map(p => (
                <FilterOption key={p} active={activePrios.has(p)} negated={negatedPrios.has(p)}
                  label={`P${p}`} icon={<Prio p={p}/>}
                  count={allItems.filter(w => w.priority === p).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedPrios, setActivePrios)(p); else toggle(setActivePrios)(p); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>
```

with:

```js
          {/* Priority */}
          <FilterDropdown label="Priority" activeCount={activePrios.size + negatedPrios.size} width={240}>
            <FilterSection title="Priority">
              {priorityFilterOptions.map(p => (
                <FilterOption key={p} active={activePrios.has(p)} negated={negatedPrios.has(p)}
                  label={`P${p}`} icon={<Prio p={p}/>}
                  count={allItems.filter(w => w.priority === p).length}
                  onClick={(e) => { if (e.detail >= 2) negate(setNegatedPrios, setActivePrios)(p); else toggle(setActivePrios)(p); }}/>
              ))}
            </FilterSection>
          </FilterDropdown>
```

- [ ] **Step 5: Run the UI test suite**

Run: `npm -w packages/ui test`
Expected: PASS — `wi-type-states-key.test.js` still passes unchanged (the constant itself didn't move); no other test in `packages/ui/tests` currently asserts on the Type/Priority filter option lists.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx
git commit -m "fix(ui): source work-item Type/Priority/State filters from real ADO data instead of hardcoded lists"
```

---

### Task 7: Seed the 3 new fields everywhere `NexusMDData`/`HelmData` starts empty

**Files:**
- Modify: `packages/ui/src/data-context.jsx:19-36`
- Modify: `apps/web/src/data.js:50-63`
- Modify: `apps/app/src/data.jsx:36-45` (read the file first to confirm the exact seed object's closing line before editing — the excerpt below only shows through `STATES`)

**Interfaces:**
- Consumes: nothing.
- Produces: `EMPTY_NEXUS_DATA`, `NexusMDData` (web seed), `HelmData` (app seed) all carry `TYPES: []`, `PRIORITIES: []`, `WI_TYPE_STATES: {}` from the start, so nothing dereferences `undefined` before the first load completes.

- [ ] **Step 1: `packages/ui/src/data-context.jsx`**

In `EMPTY_NEXUS_DATA` (lines 19-36), add the 3 keys after `STATES: [],` (line 33):

```js
  STATES: [],
  TYPES: [],
  PRIORITIES: [],
  WI_TYPE_STATES: {},
```

- [ ] **Step 2: `apps/web/src/data.js`**

In the `NexusMDData` seed object (lines 50-63), add the 3 keys after the `STATES:` line (line 55):

```js
  STATES: ['Backlog','To Do','Active','In Progress','In Review','Blocked','Resolved','Done','Closed'],
  TYPES: [],
  PRIORITIES: [],
  WI_TYPE_STATES: {},
```

- [ ] **Step 3: `apps/app/src/data.jsx`**

Read `apps/app/src/data.jsx` around line 40 to find the exact `STATES:` line in the `HelmData` seed object, then add the same 3 keys directly after it, matching the same values as Step 2.

- [ ] **Step 4: Run both apps' test suites**

Run: `npm -w apps/web test && npm -w apps/app test`
Expected: PASS (these are additive default fields; nothing reads them yet in a way that could break on an empty array/object)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/data-context.jsx apps/web/src/data.js apps/app/src/data.jsx
git commit -m "chore: seed TYPES/PRIORITIES/WI_TYPE_STATES defaults alongside the existing STATES seed"
```

---

### Task 8: `apps/web/src/app.jsx` — dynamic Type/Priority in create modal + edit drawer

**Files:**
- Modify: `apps/web/src/app.jsx:39,872,969-973,1006-1013,2372,2455-2463`

**Interfaces:**
- Consumes: `NexusMDData.TYPES`, `NexusMDData.PRIORITIES` (Task 4/7).
- Produces: no new exports; internal behavior only.

- [ ] **Step 1: Add module-level fallback constants**

After line 39 (`const adoTypeToNexusMD = adoTypeToHelm;`):

```js
const adoTypeToNexusMD = adoTypeToHelm;
const DEFAULT_WI_TYPES = ['Bug', 'Task', 'User Story', 'Feature', 'Epic'];
const DEFAULT_PRIORITIES = [1, 2, 3, 4];
const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };
```

- [ ] **Step 2: Source `TYPES`/`PRIORITIES` in the create-modal component**

At line 872 (`const STATES   = NexusMDData.STATES || [];`), add immediately after:

```js
  const STATES   = NexusMDData.STATES || [];
  const TYPES    = NexusMDData.TYPES?.length ? NexusMDData.TYPES : DEFAULT_WI_TYPES;
  const PRIORITIES = NexusMDData.PRIORITIES?.length ? NexusMDData.PRIORITIES : DEFAULT_PRIORITIES;
```

- [ ] **Step 3: Make the create-modal Type select dynamic**

Replace lines 969-973:

```js
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
                {['Bug', 'Task', 'User Story', 'Feature', 'Epic'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
```

with:

```js
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
```

- [ ] **Step 4: Make the create-modal Priority select dynamic**

Replace lines 1006-1013:

```js
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                <option value="1">1 – Critical</option>
                <option value="2">2 – High</option>
                <option value="3">3 – Medium</option>
                <option value="4">4 – Low</option>
              </select>
            </SettField>
```

with:

```js
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
                ))}
              </select>
            </SettField>
```

- [ ] **Step 5: Source `PRIORITIES` in the edit-drawer component and make its Priority select dynamic**

At line 2372 (`const { STATES } = NexusMDData;`), replace with:

```js
  const { STATES, PRIORITIES: PRIORITIES_RAW } = NexusMDData;
  const PRIORITIES = PRIORITIES_RAW?.length ? PRIORITIES_RAW : DEFAULT_PRIORITIES;
```

Replace lines 2455-2463:

```js
          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              <option value="1">1 – Critical</option>
              <option value="2">2 – High</option>
              <option value="3">3 – Medium</option>
              <option value="4">4 – Low</option>
            </select>
          </dd>
```

with:

```js
          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
              ))}
            </select>
          </dd>
```

- [ ] **Step 6: Run the web test suite**

Run: `npm -w apps/web test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app.jsx
git commit -m "fix(web): source work-item Type/Priority create+edit options from real ADO data instead of a hardcoded list"
```

---

### Task 9: `apps/app/src/app.jsx` — mirror Task 8 for the Capacitor app

**Files:**
- Modify: `apps/app/src/app.jsx:31,923,1020-1024,1057-1064,2148,2229-2237`

**Interfaces:**
- Consumes: `HelmData.TYPES`, `HelmData.PRIORITIES` (Task 4/7).
- Produces: no new exports; internal behavior only.

- [ ] **Step 1: Add module-level fallback constants**

After line 31 (`const { useState, useEffect, useMemo, useRef, useCallback } = React;`):

```js
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const DEFAULT_WI_TYPES = ['Bug', 'Task', 'User Story', 'Feature', 'Epic'];
const DEFAULT_PRIORITIES = [1, 2, 3, 4];
const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };
```

- [ ] **Step 2: Source `TYPES`/`PRIORITIES` in the create-modal component**

At line 923 (`const STATES   = HelmData.STATES || [];`), add immediately after:

```js
  const STATES   = HelmData.STATES || [];
  const TYPES    = HelmData.TYPES?.length ? HelmData.TYPES : DEFAULT_WI_TYPES;
  const PRIORITIES = HelmData.PRIORITIES?.length ? HelmData.PRIORITIES : DEFAULT_PRIORITIES;
```

- [ ] **Step 3: Make the create-modal Type select dynamic**

Replace lines 1020-1024:

```js
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
                {['Bug', 'Task', 'User Story', 'Feature', 'Epic'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
```

with:

```js
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={settInputStyle}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
```

- [ ] **Step 4: Make the create-modal Priority select dynamic**

Replace lines 1057-1064:

```js
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                <option value="1">1 – Critical</option>
                <option value="2">2 – High</option>
                <option value="3">3 – Medium</option>
                <option value="4">4 – Low</option>
              </select>
            </SettField>
```

with:

```js
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={settInputStyle}>
                <option value="">None</option>
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
                ))}
              </select>
            </SettField>
```

- [ ] **Step 5: Source `PRIORITIES` in the edit-drawer component and make its Priority select dynamic**

At line 2148 (`const { STATES } = HelmData;`), replace with:

```js
  const { STATES, PRIORITIES: PRIORITIES_RAW } = HelmData;
  const PRIORITIES = PRIORITIES_RAW?.length ? PRIORITIES_RAW : DEFAULT_PRIORITIES;
```

Replace lines 2229-2237:

```js
          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              <option value="1">1 – Critical</option>
              <option value="2">2 – High</option>
              <option value="3">3 – Medium</option>
              <option value="4">4 – Low</option>
            </select>
          </dd>
```

with:

```js
          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
              ))}
            </select>
          </dd>
```

- [ ] **Step 6: Run the app test suite**

Run: `npm -w apps/app test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/app.jsx
git commit -m "fix(app): source work-item Type/Priority create+edit options from real ADO data instead of a hardcoded list"
```

---

## Final verification (run after all 9 tasks)

```bash
npm test                 # full workspace unit suite (vitest, root-level)
npm -w packages/core test
npm -w packages/ui test
npm -w apps/web test
npm -w apps/app test
npm -w apps/desktop test  # desktop uses loadAdoData directly — confirm no regression even though this plan touches no desktop files
```

Manually verify against a real (or sandbox) ADO org that uses a customized process template if one is available: confirm the "resolved items" dashboard widget picks up items in a custom terminal state, the Work Items Type/Priority/State filters show real project values, and the New/Edit Work Item Type/Priority dropdowns match what ADO actually accepts for that project.

## Explicitly out of scope (per Global Constraints)

- `derive.js`, `digest/index.js`, `team/index.js`, `view-dashboard.jsx`, and the `isTerminalState`/`isActiveState`/`isReviewState`/`isBlockedState` call sites in `apps/web/src/app.jsx` / `apps/app/src/app.jsx` keep using name-based regex classification — not wired to real ADO categories in this plan.
- No new ASP.NET backend endpoints are added. The pre-existing, unimplemented `/api/workitems` (POST create), `/api/workitems/:id` (PATCH), `/api/workitems/:id/comments` (POST), and `/api/builds/queue`/`/api/builds/:id/cancel` routes remain unimplemented — that's a separate, larger gap (the web app's entire work-item/build write path has no server controller) unrelated to type/state/priority metadata correctness.
- `AdoController.cs`'s missing PATCH/PUT verb support (blocking PR votes, PR thread edits, and work item field patches when proxied through the web server) is unrelated to this plan and not fixed here.
