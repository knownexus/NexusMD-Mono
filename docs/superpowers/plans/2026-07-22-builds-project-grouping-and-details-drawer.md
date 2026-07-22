# Builds: Project Grouping + Details Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the Builds page by project (then pipeline), move the Project column next to Branch, and make build rows open a details drawer with full metadata plus fetched failure detail for desktop.

**Architecture:** Data-layer changes (a new `mapBuildTimeline` mapper, a reordered column catalog) land in `packages/core`. A new shared `BuildDetail` component and a `build-source.js` DI seam (mirroring the existing `work-item-source.js` pattern) land in `packages/ui`, alongside the project→pipeline regrouping of `view-builds.jsx`. Desktop-only wiring (a new `desktop-build-source.js` that calls Azure DevOps's timeline API directly, plus drawer/state wiring in `main.jsx`) is last, since it consumes everything built in the earlier tasks.

**Tech Stack:** React (no component library — plain JSX + CSS variables), Vitest + @testing-library/react for tests, Azure DevOps REST API (`api-version=7.0`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-builds-project-grouping-and-details-drawer-design.md` (read it if anything below is ambiguous).
- Desktop only gets the details drawer this pass — do not touch `apps/app` or `apps/web`.
- No full build logs (`_apis/build/builds/{id}/logs/{logId}`) — only the timeline API's per-record `issues[].message`.
- Run each package's tests from its own directory (`packages/core`, `packages/ui`, `apps/desktop`) — cross-directory `vitest run` misses workspace/jsdom config.
- Every new `@nexusmd/core` export must be added to the `EXPECTED` allow-list in `packages/core/tests/public-api.test.js` in the same task, or that test fails.
- ADO REST calls use `api-version=7.0`, matching every existing call in `packages/core/src/modules/ado/loader.js` and `apps/desktop/src/main.jsx`.

---

### Task 1: Core — `mapBuildTimeline` + reordered `BUILDS_TABLE_COLUMNS`

**Files:**
- Modify: `packages/core/src/modules/ado/mappers.js`
- Modify: `packages/core/src/modules/ado/index.js:2`
- Modify: `packages/core/src/modules/ado/field-visibility.js:44-55`
- Modify: `packages/core/tests/public-api.test.js:33`
- Test: `packages/core/tests/ado/mappers.test.js`
- Test: `packages/core/tests/ado/field-visibility.test.js`

**Interfaces:**
- Produces: `mapBuildTimeline(raw)` → `{ failedRecords: [{ name: string, type: string, messages: string[] }] }`, exported from `@nexusmd/core`.
- Produces: `BUILDS_TABLE_COLUMNS` with `project` immediately before `branch` (order: `status, build, triggeredBy, project, branch, commit, reason, duration, date, actions`).

- [ ] **Step 1: Write the failing tests for `mapBuildTimeline`**

Add to `packages/core/tests/ado/mappers.test.js` (after the existing `mapBuild` describe block, before `mapTestBuild` if present, otherwise at end of file):

```js
// ── mapBuildTimeline ────────────────────────────────────────────────────────

const rawTimeline = {
  records: [
    { id: 'a', name: 'Build', type: 'Stage', result: 'failed', issues: [{ type: 'error', message: 'Package restore failed' }] },
    { id: 'b', name: 'Run tests', type: 'Task', result: 'failed', issues: [{ type: 'error', message: 'Test suite exited with code 1' }, { type: 'error', message: '2 tests failed' }] },
    { id: 'c', name: 'Checkout', type: 'Task', result: 'succeeded', issues: [] },
    { id: 'd', name: 'Some checkpoint', type: 'Checkpoint', result: 'failed', issues: [{ type: 'error', message: 'ignored type' }] },
    { id: 'e', name: 'No issues array', type: 'Task', result: 'failed' },
  ],
}

describe('mapBuildTimeline', () => {
  it('keeps only failed records of known types (Stage/Phase/Job/Task)', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.map(r => r.name)).toEqual(['Build', 'Run tests', 'No issues array'])
  })
  it('maps each record\'s issues to a flat messages array', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.find(r => r.name === 'Run tests').messages).toEqual([
      'Test suite exited with code 1', '2 tests failed',
    ])
  })
  it('defaults messages to an empty array when issues is missing', () => {
    const { failedRecords } = mapBuildTimeline(rawTimeline)
    expect(failedRecords.find(r => r.name === 'No issues array').messages).toEqual([])
  })
  it('returns an empty failedRecords array for an empty/missing records list', () => {
    expect(mapBuildTimeline({ records: [] })).toEqual({ failedRecords: [] })
    expect(mapBuildTimeline({})).toEqual({ failedRecords: [] })
  })
})
```

Update the import at the top of the file to include `mapBuildTimeline`:

```js
import { mapWorkItem, mapPR, mapBuild, mapTestBuild, mapBuildTimeline } from '../../src/modules/ado/mappers.js'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/core`): `npx vitest run tests/ado/mappers.test.js`
Expected: FAIL — `mapBuildTimeline is not a function` (or similar import error).

- [ ] **Step 3: Implement `mapBuildTimeline`**

Append to `packages/core/src/modules/ado/mappers.js` (after `mapBuild`, before `mapTestBuild`):

```js
const TIMELINE_RECORD_TYPES = ['Stage', 'Phase', 'Job', 'Task']

export function mapBuildTimeline(raw) {
  const records = raw?.records || []
  const failedRecords = records
    .filter(r => r.result === 'failed' && TIMELINE_RECORD_TYPES.includes(r.type))
    .map(r => ({
      name: r.name || 'Unnamed',
      type: r.type,
      messages: (r.issues || []).map(i => i.message).filter(Boolean),
    }))
  return { failedRecords }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ado/mappers.test.js`
Expected: PASS (all `mapBuildTimeline` tests green, existing `mapBuild`/`mapWorkItem`/`mapPR` tests unaffected).

- [ ] **Step 5: Export `mapBuildTimeline` from the ado module and the core public API**

Modify `packages/core/src/modules/ado/index.js:2`:

```js
export { mapWorkItem, mapPR, mapBuild, mapTestBuild, mapBuildTimeline } from './mappers.js'
```

Modify `packages/core/tests/public-api.test.js:33` (append to the existing `mapBuild`/`mapPR`/etc. line):

```js
  'indexPRsByWorkItem', 'makeProfileKeys', 'mapBuild', 'mapBuildTimeline', 'mapPR', 'mapTestBuild', 'mapWorkItem',
```

- [ ] **Step 6: Run the full core test suite**

Run (from `packages/core`): `npx vitest run`
Expected: PASS — including `tests/public-api.test.js` (which would fail if the new export weren't added to `EXPECTED`).

- [ ] **Step 7: Write the failing test for the column reorder**

Add to `packages/core/tests/ado/field-visibility.test.js`, inside the existing `describe('catalogs', ...)` block (after the "every catalog entry has a key and label" test):

```js
  it('BUILDS_TABLE_COLUMNS puts project immediately before branch', () => {
    const keys = BUILDS_TABLE_COLUMNS.map(f => f.key)
    expect(keys.indexOf('project')).toBe(keys.indexOf('branch') - 1)
  })
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run tests/ado/field-visibility.test.js`
Expected: FAIL — `project` is currently at index 2, `branch` at index 4, so `2 !== 3`.

- [ ] **Step 9: Reorder the catalog**

Modify `packages/core/src/modules/ado/field-visibility.js:44-55` — replace the whole `BUILDS_TABLE_COLUMNS` array:

```js
export const BUILDS_TABLE_COLUMNS = [
  { key: 'status',      label: 'Status',       width: '28px',  locked: true },
  { key: 'build',       label: 'Build #',      width: '68px',  locked: true },
  { key: 'triggeredBy', label: 'Triggered by', width: '1fr' },
  { key: 'project',     label: 'Project',      width: '120px' },
  { key: 'branch',      label: 'Branch',       width: '160px' },
  { key: 'commit',      label: 'Commit',       width: '72px' },
  { key: 'reason',      label: 'Reason',       width: '80px' },
  { key: 'duration',    label: 'Duration',     width: '72px' },
  { key: 'date',        label: 'Date',         width: '148px' },
  { key: 'actions',     label: 'Actions',      width: '140px', locked: true },
]
```

- [ ] **Step 10: Run the tests to verify they pass**

Run (from `packages/core`): `npx vitest run`
Expected: PASS — all tests, including the new column-order assertion.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/modules/ado/mappers.js packages/core/src/modules/ado/index.js packages/core/src/modules/ado/field-visibility.js packages/core/tests/ado/mappers.test.js packages/core/tests/ado/field-visibility.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): add mapBuildTimeline and move Project column next to Branch"
```

---

### Task 2: UI — `build-source.js` data seam

**Files:**
- Create: `packages/ui/src/views/build-source.js`
- Modify: `packages/ui/src/data-context.jsx`
- Test: `packages/ui/tests/build-source.test.jsx`

**Interfaces:**
- Consumes: nothing from other tasks (uses plain `fetch`).
- Produces: `apiBuildSource.loadTimeline(project, id)` → `Promise<{ failedRecords: [] }>`, never throws. Exported from `packages/ui/src/views/build-source.js`. `useNexusData().buildSource` defaults to `apiBuildSource`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/build-source.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiBuildSource } from '../src/views/build-source.js'

describe('apiBuildSource.loadTimeline', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the parsed JSON body on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ failedRecords: [{ name: 'Build', type: 'Stage', messages: ['boom'] }] }) })))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [{ name: 'Build', type: 'Stage', messages: ['boom'] }] })
    expect(fetch).toHaveBeenCalledWith('/api/builds/42/timeline?project=proj')
  })

  it('returns an empty failedRecords array on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [] })
  })

  it('returns an empty failedRecords array if fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/ui`): `npx vitest run tests/build-source.test.jsx`
Expected: FAIL — cannot find module `../src/views/build-source.js`.

- [ ] **Step 3: Implement `apiBuildSource`**

Create `packages/ui/src/views/build-source.js`:

```js
// build-source.js — the data seam for BuildDetail. Mirrors work-item-source.js:
// the render code (BuildDetail) is shared; only how the timeline is fetched
// differs per platform.
//   loadTimeline(project, id) → { failedRecords: [{ name, type, messages }] }
//
// Default = a /api/builds/*/timeline web-host proxy. Desktop supplies an
// ado-client-backed source via NexusDataProvider (see apps/desktop/src/desktop-build-source.js).

export const apiBuildSource = {
  async loadTimeline(project, id) {
    try {
      const r = await fetch(`/api/builds/${id}/timeline?project=${encodeURIComponent(project || '')}`)
      if (!r.ok) return { failedRecords: [] }
      return await r.json()
    } catch {
      return { failedRecords: [] }
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/build-source.test.jsx`
Expected: PASS.

- [ ] **Step 5: Wire the default into `NexusDataProvider`**

Modify `packages/ui/src/data-context.jsx` — add the import (line 15, next to the existing work-item-source import):

```js
import { apiWorkItemSource, setWorkItemSource } from './views/work-item-source.js'
import { apiBuildSource } from './views/build-source.js'
```

Add to `DEFAULTS` (after `workItemSource: apiWorkItemSource,` around line 58):

```js
  workItemSource: apiWorkItemSource, // data ops for WorkItemDetail (web/desktop: /api; app: ado-client)
  buildSource: apiBuildSource,       // data ops for BuildDetail's failure timeline (web/desktop: /api; desktop: ado-client)
```

- [ ] **Step 6: Export `apiBuildSource` from the package index**

Modify `packages/ui/src/index.js` — add near the `WorkItemDetail` export (line 90):

```js
export { WorkItemDetail, WorkItemFieldsEditor } from './views/work-item-detail.jsx'
export { apiBuildSource } from './views/build-source.js'
```

- [ ] **Step 7: Run the full `packages/ui` test suite**

Run (from `packages/ui`): `npx vitest run`
Expected: PASS — no existing test reads `useNexusData().buildSource`, so nothing else should change behavior.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/views/build-source.js packages/ui/src/data-context.jsx packages/ui/src/index.js packages/ui/tests/build-source.test.jsx
git commit -m "feat(ui): add buildSource data seam for build failure timelines"
```

---

### Task 3: UI — `BuildDetail` component

**Files:**
- Create: `packages/ui/src/views/build-detail.jsx`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/build-detail.test.jsx`

**Interfaces:**
- Consumes: `useNexusData().buildSource.loadTimeline(project, id)` (Task 2's shape: `Promise<{ failedRecords: [{ name, type, messages }] }>`).
- Consumes: a `build` object shaped like `mapBuild`'s output (`packages/core/src/modules/ado/mappers.js`): `{ id, project, pipeline, status, duration, actor, commit, finishTime, branch, reason, failureReason }`.
- Produces: `BuildDetail({ build })` React component, exported from `@nexusmd/ui`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/build-detail.test.jsx`:

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildDetail } from '../src/index.js'

afterEach(cleanup)

const successBuild = {
  id: 1, project: 'proj-a', pipeline: 'API', status: 'success',
  duration: '1m 30s', actor: 'alice', commit: 'abc1234',
  finishTime: '2026-01-02T10:00:00Z', branch: 'main', reason: 'manual', failureReason: null,
}

const failedBuild = { ...successBuild, id: 2, status: 'failed', failureReason: 'Step "test" failed' }

describe('BuildDetail', () => {
  it('renders static metadata for a successful build without fetching a timeline', () => {
    const loadTimeline = vi.fn()
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={successBuild} />
      </NexusDataProvider>,
    )
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('abc1234')).toBeTruthy()
    expect(screen.getByText('1m 30s')).toBeTruthy()
    expect(loadTimeline).not.toHaveBeenCalled()
    expect(screen.queryByText('Errors')).toBeNull()
  })

  it('fetches and renders failed timeline records for a failed build', async () => {
    const loadTimeline = vi.fn(async () => ({
      failedRecords: [{ name: 'Run tests', type: 'Task', messages: ['Test suite exited with code 1'] }],
    }))
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={failedBuild} />
      </NexusDataProvider>,
    )
    expect(loadTimeline).toHaveBeenCalledWith('proj-a', 2)
    await waitFor(() => expect(screen.getByText('Run tests')).toBeTruthy())
    expect(screen.getByText('Test suite exited with code 1')).toBeTruthy()
  })

  it('shows an error line if the timeline fetch rejects', async () => {
    const loadTimeline = vi.fn(async () => { throw new Error('ADO unreachable') })
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={failedBuild} />
      </NexusDataProvider>,
    )
    await waitFor(() => expect(screen.getByText('ADO unreachable')).toBeTruthy())
  })

  it('shows an empty state when a cancelled build has no failed records', async () => {
    const loadTimeline = vi.fn(async () => ({ failedRecords: [] }))
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={{ ...successBuild, id: 3, status: 'cancelled' }} />
      </NexusDataProvider>,
    )
    await waitFor(() => expect(screen.getByText('No failure details available.')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui`): `npx vitest run tests/build-detail.test.jsx`
Expected: FAIL — `BuildDetail` is not exported from `../src/index.js`.

- [ ] **Step 3: Implement `BuildDetail`**

Create `packages/ui/src/views/build-detail.jsx`:

```jsx
import React from 'react'
import { formatDateTime } from '@nexusmd/core'
import { Avatar, ProjectChip } from '../app-components.jsx'
import { useNexusData } from '../data-context.jsx'

const ERROR_STATUSES = ['failed', 'partial', 'cancelled']

export function BuildDetail({ build }) {
  const { buildSource } = useNexusData()
  const showErrors = ERROR_STATUSES.includes(build.status)
  const [loading, setLoading] = React.useState(showErrors)
  const [error, setError] = React.useState(null)
  const [failedRecords, setFailedRecords] = React.useState(null)

  React.useEffect(() => {
    if (!showErrors) return
    let cancelled = false
    setLoading(true); setError(null)
    buildSource.loadTimeline(build.project, build.id)
      .then(res => { if (!cancelled) setFailedRecords(res?.failedRecords ?? []) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [showErrors, build.project, build.id, buildSource])

  return (
    <div>
      <div className="drawer-section">
        <MetaRow label="Project"><ProjectChip id={build.project}/></MetaRow>
        <MetaRow label="Branch"><span className="mono">{build.branch}</span></MetaRow>
        <MetaRow label="Commit"><span className="mono">{build.commit}</span></MetaRow>
        <MetaRow label="Triggered by">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar who={build.actor} size="xs"/> {build.actor}
          </span>
        </MetaRow>
        <MetaRow label="Reason">{build.reason || '—'}</MetaRow>
        <MetaRow label="Duration">{build.duration}</MetaRow>
        <MetaRow label="Finished">{build.finishTime ? formatDateTime(build.finishTime) : '—'}</MetaRow>
      </div>

      {showErrors && (
        <div className="drawer-section">
          <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
            Errors
          </h4>
          {loading && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading errors…</div>}
          {!loading && error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {!loading && !error && failedRecords?.length === 0 && (
            <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No failure details available.</div>
          )}
          {!loading && !error && failedRecords?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {failedRecords.map((r, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: r.messages.length ? 4 : 0 }}>
                    <span className="pill" style={{ fontSize: 10 }}>{r.type}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
                  </div>
                  {r.messages.map((m, j) => (
                    <div key={j} className="mono" style={{ fontSize: 11.5, color: 'var(--danger)' }}>{m}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MetaRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ width: 100, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}
```

- [ ] **Step 4: Export `BuildDetail` from the package index**

Modify `packages/ui/src/index.js` (same area as Task 2's Step 6):

```js
export { WorkItemDetail, WorkItemFieldsEditor } from './views/work-item-detail.jsx'
export { apiBuildSource } from './views/build-source.js'
export { BuildDetail } from './views/build-detail.jsx'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `packages/ui`): `npx vitest run tests/build-detail.test.jsx`
Expected: PASS — all four tests green.

- [ ] **Step 6: Run the full `packages/ui` test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/views/build-detail.jsx packages/ui/src/index.js packages/ui/tests/build-detail.test.jsx
git commit -m "feat(ui): add BuildDetail drawer content component"
```

---

### Task 4: UI — group `view-builds.jsx` by project, then pipeline; make rows open the drawer

**Files:**
- Modify: `packages/ui/src/views/view-builds.jsx`
- Test: `packages/ui/tests/builds-project-grouping.test.jsx`

**Interfaces:**
- Consumes: nothing new from other tasks (grouping is pure client-side logic over the existing `builds` prop shape).
- Produces: `BuildsView` gains an optional `onOpenBuild(build)` prop, called when a build row is clicked.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/builds-project-grouping.test.jsx`:

```jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView } from '../src/index.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const BUILDS = [
  { id: 1, pipeline: 'API', status: 'success', branch: 'main', project: 'proj-a', definitionId: 5, commit: 'abc1234', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' },
  { id: 2, pipeline: 'Web', status: 'success', branch: 'main', project: 'proj-b', definitionId: 6, commit: 'def5678', reason: 'manual', duration: '2m', when: 'now', finishTime: '2026-01-02T11:00:00' },
]

const PROJECTS = [
  { id: 'proj-a', name: 'Project A', color: '#111111' },
  { id: 'proj-b', name: 'Project B', color: '#222222' },
]

function renderBuilds(props = {}) {
  return render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS } }}>
      <BuildsView builds={BUILDS} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} {...props} />
    </NexusDataProvider>,
  )
}

it('groups builds by project, then by pipeline within each project', () => {
  const { getByText } = renderBuilds()
  expect(getByText('Project A')).toBeTruthy()
  expect(getByText('Project B')).toBeTruthy()
  expect(getByText('API')).toBeTruthy()
  expect(getByText('Web')).toBeTruthy()
})

it('calls onOpenBuild with the clicked build', () => {
  const onOpenBuild = vi.fn()
  const { getByText } = renderBuilds({ onOpenBuild })
  const row = getByText('abc1234').closest('.build-row')
  fireEvent.click(row)
  expect(onOpenBuild).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

it('collapsing a project group hides its pipeline groups and build rows', () => {
  const { getByText, queryByText } = renderBuilds()
  fireEvent.click(getByText('Project A'))
  expect(queryByText('API')).toBeNull()
  expect(queryByText('abc1234')).toBeNull()
  expect(getByText('Web')).toBeTruthy()
})

it('does not throw when onOpenBuild is not provided', () => {
  const { getByText } = renderBuilds()
  const row = getByText('abc1234').closest('.build-row')
  expect(() => fireEvent.click(row)).not.toThrow()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui`): `npx vitest run tests/builds-project-grouping.test.jsx`
Expected: FAIL — rows currently aren't clickable/wired to any handler, and there's no project-level header (only a pipeline header), so `getByText('Project A')` fails.

- [ ] **Step 3: Change the grouping memo and add composite collapse keys**

Modify `packages/ui/src/views/view-builds.jsx`, replacing the `// ── Group by pipeline ──` block and the `pipelineHistory` memo (current lines 159-179):

```js
  // ── Group by project, then pipeline ──────────────────────────
  const grouped = React.useMemo(() => {
    const projectMap = new Map()
    filteredBuilds.forEach(b => {
      const projKey = b.project || 'Unknown'
      if (!projectMap.has(projKey)) projectMap.set(projKey, new Map())
      const pipelineMap = projectMap.get(projKey)
      const pipeKey = b.pipeline || 'Pipeline'
      if (!pipelineMap.has(pipeKey)) pipelineMap.set(pipeKey, [])
      pipelineMap.get(pipeKey).push(b)
    })
    return Array.from(projectMap.entries()).map(([project, pipelineMap]) => ({
      project,
      pipelines: Array.from(pipelineMap.entries()).map(([name, runs]) => ({ name, runs })),
      runCount: Array.from(pipelineMap.values()).reduce((n, runs) => n + runs.length, 0),
    }))
  }, [filteredBuilds])

  // Full history for the project-level sparkline (unfiltered), keyed by project.
  const projectHistory = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const k = b.project || 'Unknown'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(dispStatus(b))
    })
    return map
  }, [builds, acknowledgedSet])

  // Full history for pipeline sparklines (unfiltered), keyed by "<project>::<pipeline>"
  // so two projects that happen to share a pipeline name don't bleed into each other.
  const pipelineHistory = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const k = `${b.project || 'Unknown'}::${b.pipeline || 'Pipeline'}`
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(dispStatus(b))
    })
    return map
  }, [builds, acknowledgedSet])

  // Project → pipeline names, for the visibility filter dropdown's sub-headings.
  const projectPipelines = React.useMemo(() => {
    const map = new Map()
    builds.forEach(b => {
      const proj = b.project || 'Unknown'
      if (!map.has(proj)) map.set(proj, new Set())
      map.get(proj).add(b.pipeline || 'Pipeline')
    })
    return Array.from(map.entries())
      .map(([project, names]) => ({ project, pipelines: Array.from(names).sort() }))
      .sort((a, b) => a.project.localeCompare(b.project))
  }, [builds])
```

Note: this replaces the two memos but keeps `allPipelines` (used for `visibleCount`/show-all/hide-all) untouched — it stays right above this block, unchanged.

- [ ] **Step 4: Update the "Pipelines" filter dropdown to nest under project sub-headings**

Modify the `{allPipelines.map(name => { ... })}` block inside the `pipelineMenuOpen &&` panel (current lines 401-428) — replace it with:

```jsx
                {projectPipelines.map(({ project, pipelines }) => (
                  <React.Fragment key={project}>
                    <div style={{
                      padding: '6px 12px 2px', fontSize: 10, fontWeight: 700,
                      color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {project}
                    </div>
                    {pipelines.map(name => {
                      const visible = !hiddenSet.has(name)
                      const hist = (pipelineHistory.get(`${project}::${name}`) || []).slice(0, 5)
                      return (
                        <label key={`${project}::${name}`} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 12px', cursor: 'pointer', userSelect: 'none',
                          opacity: visible ? 1 : 0.45,
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <input type="checkbox" checked={visible} onChange={() => togglePipeline(name)}
                            style={{ cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}/>
                          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </span>
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {hist.map((s, i) => (
                              <span key={i} style={{
                                width: 6, height: 6, borderRadius: 2, flexShrink: 0,
                                background: sparkColor[s] || 'var(--text-subtle)', opacity: 0.8,
                              }}/>
                            ))}
                          </div>
                        </label>
                      )
                    })}
                  </React.Fragment>
                ))}
```

- [ ] **Step 5: Update "Collapse all" / "Expand all" to cover both group levels**

Modify the two buttons (current lines 434-437):

```jsx
          <button className="btn sm ghost" onClick={() => {
            const n = {}
            grouped.forEach(pg => {
              n[pg.project] = true
              pg.pipelines.forEach(g => { n[`${pg.project}::${g.name}`] = true })
            })
            setCollapsed(n)
          }}><Icon name="chevron-right" size={12}/> Collapse all</button>
          <button className="btn sm ghost" onClick={() => setCollapsed({})}><Icon name="chevron-down" size={12}/> Expand all</button>
```

- [ ] **Step 6: Add the `onOpenBuild` prop and update the rendering to two nested group levels**

Modify the `BuildsView` function signature (line 13):

```js
export function BuildsView({ builds, acknowledgedBuilds, setAcknowledgedBuilds, newItemIds = new Set(), onOpenBuild }) {
```

Replace the `{/* ── Pipeline groups ── */}` block (current lines 451-498):

```jsx
        {/* ── Project / pipeline groups ── */}
        <div className="card-body flush">
          {grouped.map(pg => {
            const projHistory = (projectHistory.get(pg.project) || []).slice(0, 10)
            const projCollapsed = collapsed[pg.project]
            return (
              <React.Fragment key={pg.project}>
                {/* Project header */}
                <div
                  style={{
                    padding: '8px 14px', background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700,
                  }}
                  onClick={() => setCollapsed(c => ({ ...c, [pg.project]: !c[pg.project] }))}>
                  <Icon name={projCollapsed ? 'chevron-right' : 'chevron-down'} size={12}/>
                  <ProjectChip id={pg.project}/>
                  <span className="muted mono" style={{ fontSize: 10.5 }}>{pg.runCount} run{pg.runCount !== 1 ? 's' : ''}</span>
                  <div style={{ display: 'flex', gap: 3, marginLeft: 4 }} title="Last 10 build results across this project (newest first)">
                    {projHistory.map((status, i) => (
                      <span key={i} style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        background: sparkColor[status] || 'var(--text-subtle)', opacity: 0.85,
                      }}/>
                    ))}
                  </div>
                </div>

                {!projCollapsed && pg.pipelines.map(g => {
                  const key = `${pg.project}::${g.name}`
                  const history = (pipelineHistory.get(key) || []).slice(0, 10)
                  return (
                    <React.Fragment key={key}>
                      {/* Pipeline header */}
                      <div
                        style={{
                          padding: '7px 14px 7px 30px', background: 'var(--surface-2)',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        }}
                        onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}>
                        <Icon name={collapsed[key] ? 'chevron-right' : 'chevron-down'} size={11}/>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{g.name}</span>
                        <span className="muted mono" style={{ fontSize: 10.5 }}>{g.runs.length} run{g.runs.length !== 1 ? 's' : ''}</span>
                        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }} title="Last 10 build results (newest first)">
                          {history.map((status, i) => (
                            <span key={i} style={{
                              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                              background: sparkColor[status] || 'var(--text-subtle)', opacity: 0.85,
                            }}/>
                          ))}
                        </div>
                      </div>

                      {/* Build rows */}
                      {!collapsed[key] && g.runs.map(b => {
                        const isNew = newItemIds.has(b.id)
                        return (
                          <div key={`${key}-${b.id}`}
                            className="build-row"
                            style={{ display: 'grid', gridTemplateColumns: buildGrid, alignItems: 'center', gap: 8, padding: '0 14px', cursor: 'pointer',
                              ...(isNew ? { background: 'color-mix(in srgb, var(--accent) 7%, var(--surface))', boxShadow: 'inset 3px 0 0 var(--accent)' } : {}),
                            }}
                            onClick={() => onOpenBuild?.(b)}>
                            {visibleBuildCols.map(f => buildCell(f.key, b))}
                          </div>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            )
          })}
          {grouped.length === 0 && (
            <div className="empty">No builds match the selected filter.</div>
          )}
        </div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `packages/ui`): `npx vitest run tests/builds-project-grouping.test.jsx`
Expected: PASS — all four tests green.

- [ ] **Step 8: Run the full `packages/ui` test suite**

Run: `npx vitest run`
Expected: PASS — including the pre-existing `tests/builds-table-fields.test.jsx` (column visibility toggling is unaffected by the grouping change).

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/views/view-builds.jsx packages/ui/tests/builds-project-grouping.test.jsx
git commit -m "feat(ui): group builds by project then pipeline, make rows open a details drawer"
```

---

### Task 5: Desktop — `desktopBuildSource` (ADO timeline fetch)

**Files:**
- Create: `apps/desktop/src/desktop-build-source.js`
- Test: `apps/desktop/src/desktop-build-source.test.jsx`

**Interfaces:**
- Consumes: `createAdoHttpAdapter()` from `apps/desktop/src/ado-client.js` (existing — `adapter.fetch(path, options)` returns a raw `Response`-like object with `.ok`/`.json()`).
- Consumes: `mapBuildTimeline(raw)` from `@nexusmd/core` (Task 1).
- Produces: `desktopBuildSource.loadTimeline(project, id)` → `Promise<{ failedRecords: [] }>`, throwing on a non-ok HTTP response (matching `desktopWorkItemSource.loadDetail`'s existing `throw new Error(`HTTP ${res.status}`)` pattern in `apps/desktop/src/main.jsx:152-163`).

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/desktop-build-source.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ado-client.js', () => ({
  createAdoHttpAdapter: vi.fn(),
  getAdoConfig: vi.fn(() => ({ org: 'myorg', pat: 'x', projects: [] })),
  isAdoConfigured: vi.fn(() => true),
}))

import { createAdoHttpAdapter } from './ado-client.js'
import { desktopBuildSource } from './desktop-build-source.js'

describe('desktopBuildSource.loadTimeline', () => {
  beforeEach(() => { createAdoHttpAdapter.mockReset() })

  it('fetches the ADO timeline endpoint and maps the response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ records: [{ name: 'Run tests', type: 'Task', result: 'failed', issues: [{ message: 'boom' }] }] }),
    }))
    createAdoHttpAdapter.mockReturnValue({ fetch: fetchMock })

    const result = await desktopBuildSource.loadTimeline('MyProject', 500)

    expect(fetchMock).toHaveBeenCalledWith('MyProject/_apis/build/builds/500/timeline?api-version=7.0')
    expect(result).toEqual({ failedRecords: [{ name: 'Run tests', type: 'Task', messages: ['boom'] }] })
  })

  it('url-encodes the project name', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ records: [] }) }))
    createAdoHttpAdapter.mockReturnValue({ fetch: fetchMock })

    await desktopBuildSource.loadTimeline('My Project', 500)

    expect(fetchMock).toHaveBeenCalledWith('My%20Project/_apis/build/builds/500/timeline?api-version=7.0')
  })

  it('throws with the HTTP status on a non-ok response', async () => {
    createAdoHttpAdapter.mockReturnValue({ fetch: vi.fn(async () => ({ ok: false, status: 404 })) })

    await expect(desktopBuildSource.loadTimeline('MyProject', 999)).rejects.toThrow('HTTP 404')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/desktop`): `npx vitest run src/desktop-build-source.test.jsx`
Expected: FAIL — cannot find module `./desktop-build-source.js`.

- [ ] **Step 3: Implement `desktopBuildSource`**

Create `apps/desktop/src/desktop-build-source.js`:

```js
// desktop-build-source.js — direct-to-ADO build timeline source for the desktop
// app (no ASP.NET proxy available). Mirrors the shape expected by the shared
// BuildDetail component (packages/ui/src/views/build-detail.jsx):
//   loadTimeline(project, id) → { failedRecords: [{ name, type, messages }] }
import { mapBuildTimeline } from '@nexusmd/core'
import { createAdoHttpAdapter } from './ado-client.js'

export const desktopBuildSource = {
  async loadTimeline(project, id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`${encodeURIComponent(project)}/_apis/build/builds/${id}/timeline?api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    return mapBuildTimeline(raw)
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/desktop`): `npx vitest run src/desktop-build-source.test.jsx`
Expected: PASS — all three tests green.

- [ ] **Step 5: Run the full `apps/desktop` test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/desktop-build-source.js apps/desktop/src/desktop-build-source.test.jsx
git commit -m "feat(desktop): add ADO-backed build timeline source"
```

---

### Task 6: Desktop — wire `openBuild`, `DesktopDetailDrawer`, and `BuildsView` together

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `BuildDetail` and `BuildsView` from `@nexusmd/ui` (Tasks 3 & 4). `desktopBuildSource` from `./desktop-build-source.js` (Task 5).
- Produces: nothing consumed by later tasks — this is the final integration task.

- [ ] **Step 1: Import the new pieces**

Modify `apps/desktop/src/main.jsx:5-18` — add `BuildDetail` to the `@nexusmd/ui` import list:

```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost, toast,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, BuildDetail, Drawer, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  WorkItemFieldsEditor, PRTabs, useSeenTracking, SEEN_FINGERPRINTS,
  ApiClientProvider, ApiClientView,
} from '@nexusmd/ui'
```

Modify `apps/desktop/src/main.jsx:31` — add the `desktopBuildSource` import next to the existing `ado-client.js` import:

```js
import { createAdoHttpAdapter, getAdoConfig, isAdoConfigured } from './ado-client.js'
import { desktopBuildSource } from './desktop-build-source.js'
```

- [ ] **Step 2: Add `openBuild` alongside the other drawer openers**

Modify `apps/desktop/src/main.jsx:633-635`:

```js
  const openItem   = item => setDrawer({ kind: 'wi', data: item })
  const openPR     = pr   => setDrawer({ kind: 'pr', data: pr })
  const openPerson = dev  => setDrawer({ kind: 'person', data: dev })
  const openBuild  = b    => setDrawer({ kind: 'build', data: b })
```

- [ ] **Step 3: Register `desktopBuildSource` on the data context**

Modify `apps/desktop/src/main.jsx:777-784`:

```js
  const nexusDataValue = React.useMemo(() => ({
    data:           snapshot,
    api:            { load: refreshAdoData },
    storage:        window.localStorage,
    getProfileKey,
    pushPref:       () => {},
    workItemSource: desktopWorkItemSource,
    buildSource:    desktopBuildSource,
  }), [snapshot])
```

- [ ] **Step 4: Extend `DesktopDetailDrawer` with a `build` kind**

Modify `apps/desktop/src/main.jsx:280-339` (the whole `DesktopDetailDrawer` function):

```jsx
function DesktopDetailDrawer({ drawer, onClose, setItems, onOpenItem, onOpenPR }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data
  const http = React.useMemo(() => createAdoHttpAdapter(), [])

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : kind === 'person' ? d.name : kind === 'build' ? d.pipeline : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' && d?.project && org
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent((d.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${d.id}`
    : kind === 'pr' ? d?.url
    : kind === 'build' && d?.project && org
      ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(d.project)}/_build/results?buildId=${d.id}`
      : null

  const markDone = async () => {
    try {
      await desktopWorkItemSource.saveField(d.id, 'System.State', 'Done')
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: 'Done' } : w))
      toast?.('Marked done', 'success')
      onClose()
    } catch (e) {
      toast?.('Could not update: ' + (e?.message || 'unknown error'), 'error')
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={kind === 'wi' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ) : kind === 'pr' && d ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
      ) : kind === 'build' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <span className={`build-dot ${d.status}`}/>
        </span>
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {kind === 'person' && d && <PersonActions dev={d} />}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.electronAPI.openLink(adoUrl)}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' || kind === 'build' ? 'ADO' : 'browser'}
            </button>
          )}
        </React.Fragment>
      )}>
      {kind === 'wi' && d && (
        <React.Fragment>
          <WorkItemFieldsEditor item={d} onItemUpdated={patch => setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, ...patch } : w))} />
          <WorkItemDetail id={d.id} project={d.project} />
        </React.Fragment>
      )}
      {kind === 'pr' && d && <PRTabs key={d.id} pr={d} http={http} />}
      {kind === 'person' && d && <PersonSummary dev={d} onOpenItem={onOpenItem} onOpenPR={onOpenPR} />}
      {kind === 'build' && d && <BuildDetail build={d} />}
    </Drawer>
  )
}
```

`build-dot`/status class names (`success`/`failed`/`partial`/`running`/`cancelled`) already exist as CSS classes used by `view-builds.jsx`'s own status dot rendering — reusing them here keeps the badge visually consistent with the table.

- [ ] **Step 5: Thread `onOpenBuild` through `ViewBody` to `BuildsView`**

Modify `apps/desktop/src/main.jsx:342-350` (the `ViewBody` signature):

```js
function ViewBody({
  view, onOpenItem, onOpenPR, onOpenPerson = () => {}, onOpenBuild = () => {},
  tweaks = DEFAULT_TWEAKS, setTweak = () => {},
  newItemIds = { work: new Set(), pr: new Set(), builds: new Set(), tests: new Set() },
  plannerData = {}, setPlannerData = () => {},
  plannerThemes = {}, setPlannerThemes = () => {},
  refreshInterval = 300, onRefreshIntervalChange = () => {},
  localItems = null, setLocalItems = () => {},
}) {
```

Modify `apps/desktop/src/main.jsx:456-461` (the `'builds'` case):

```js
    case 'builds':
      return (
        <BuildsView builds={data.BUILDS || []}
          acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
          newItemIds={newItemIds.builds} onOpenBuild={onOpenBuild}
        />
      )
```

- [ ] **Step 6: Pass `openBuild` into `ViewBody` and `DesktopDetailDrawer` from `App`**

Modify `apps/desktop/src/main.jsx:925-933` (the `<ViewBody .../>` call):

```jsx
            <ViewBody
              view={view} onOpenItem={openItem} onOpenPR={openPR} onOpenPerson={openPerson} onOpenBuild={openBuild}
              tweaks={tweaks} setTweak={setTweak}
              newItemIds={newItemIds}
              plannerData={plannerData} setPlannerData={setPlannerData}
              plannerThemes={plannerThemes} setPlannerThemes={setPlannerThemes}
              refreshInterval={refreshInterval} onRefreshIntervalChange={setRefreshInterval}
              localItems={localItems} setLocalItems={setItemsResolved}
            />
```

`DesktopDetailDrawer`'s own call site (`apps/desktop/src/main.jsx:957-958`) needs no change — it doesn't take an `onOpenBuild` prop; `kind: 'build'` is set directly by `openBuild` via `setDrawer`.

- [ ] **Step 7: Run the full `apps/desktop` test suite**

Run (from `apps/desktop`): `npx vitest run`
Expected: PASS — no existing test exercises `DesktopDetailDrawer`'s `build` branch directly (there was no prior coverage of `DesktopDetailDrawer` at all), so this step is a regression check on everything else (settings cards, calendar view, person summary, etc.), not new coverage.

- [ ] **Step 8: Manually verify in the running app**

Use the `apps/desktop:verify` skill to launch the desktop app and confirm:
- The Builds page groups rows by project, with pipelines nested underneath.
- The Project column sits immediately before Branch.
- Clicking a build row opens a drawer titled with the pipeline name, showing project/branch/commit/actor/reason/duration/finished metadata.
- For a failed build, the drawer's Errors section loads and shows the failing stage/task and its message(s) (or "No failure details available." if ADO reports none).
- "Open in ADO" opens the build's results page in the system browser.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): wire build details drawer into the Builds page"
```
