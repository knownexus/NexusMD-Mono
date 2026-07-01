# Create Work Item Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop app's fixed-field "Create Work Item" modal with a `<Drawer>`-based form that fetches each work item type's real field/layout definition from Azure DevOps (cached until manually refreshed), for full parity with the ADO web "New work item" experience.

**Architecture:** A new pure-logic module (`ado-workitem-types.js`) owns all ADO REST calls, localStorage caching, and field-classification logic — no React, fully unit-testable with a mocked `fetch`. A new `create-work-item-drawer.jsx` consumes that module to render a two-column form inside the existing shared `<Drawer>` component (title/type/project on top, long-text fields in a main column, status/planning/classification fields in a right rail, attachments and links below). `apps/desktop/src/main.jsx` swaps `CreateWorkItemModal` for the new drawer and generalizes `desktopWorkItemSource.createWorkItem` to accept a dynamic `fields` map instead of named parameters.

Deviation from the design spec: the spec suggested extracting `HtmlField`'s Write/Preview markdown UI from `packages/ui/src/views/work-item-detail.jsx` into a shared component. This plan instead writes a small local `MarkdownField` inside `create-work-item-drawer.jsx` that reproduces the same Write/Preview visual pattern. It avoids touching the shared `@nexusmd/ui` package for a ~40-line UI pattern, keeping this change isolated to `apps/desktop`.

**Tech Stack:** React 18 (function components + hooks), Vitest 4 + jsdom + `@testing-library/react` (already a devDependency of `apps/desktop`, unused until now), Azure DevOps REST API 7.0, existing `createAdoHttpAdapter`/`getAdoConfig`/`getProfileKey` from `apps/desktop/src/ado-client.js` / `profile-keys.js`.

## Global Constraints

- All ADO calls go through `createAdoHttpAdapter()` from `apps/desktop/src/ado-client.js` — never call `window.fetch` directly against `dev.azure.com`.
- Field-definition cache has no TTL/expiry; it is only refreshed when the user clicks "Refresh field definitions" or when no cache exists yet for that `project+type`.
- Cache keys and all other new localStorage keys must go through `getProfileKey` from `apps/desktop/src/profile-keys.js` (profile-scoped, matches every other desktop persistence key).
- Attachment/link creation happens only *after* the base work item POST succeeds; failures in attachment/link steps must not be thrown — they are collected and reported, and the created work item is never treated as lost.
- `CreateWorkItemModal` (`apps/desktop/src/main.jsx:406-565`) is deleted once the new drawer is wired in — no dual code paths left behind.
- No new npm dependencies — the plan uses only what's already installed (`@testing-library/react`, `vitest`, `jsdom` at the workspace root, `marked`/`dompurify` already used by `@nexusmd/ui`... actually markdown conversion here reuses `mdToHtml` re-exported from `@nexusmd/ui`, not a fresh copy).

---

## Section: File Structure

- **Create** `apps/desktop/vitest.config.js` — jsdom test environment for `apps/desktop` (mirrors `packages/ui/vitest.config.js`, which has no test setup file needed either).
- **Create** `apps/desktop/src/ado-workitem-types.js` — pure logic: fetch work item types/fields/classification paths, localStorage cache, field-bucket/group classification, link-type table, patch-op builders. No React.
- **Create** `apps/desktop/src/ado-workitem-types.test.js` — unit tests for the above, with `global.fetch` mocked.
- **Create** `apps/desktop/src/create-work-item-drawer.jsx` — `CreateWorkItemDrawer`, `FieldInput`, `MarkdownField` components.
- **Create** `apps/desktop/src/create-work-item-drawer.test.jsx` — component tests with `@testing-library/react`, mocking `ado-workitem-types.js` and `ado-client.js`.
- **Modify** `apps/desktop/src/main.jsx` — delete `CreateWorkItemModal` (lines 406-565), generalize `desktopWorkItemSource.createWorkItem` (lines 191-214), import and render `CreateWorkItemDrawer` in place of `CreateWorkItemModal` (line 1146).

---

## Task 1: Test harness for `apps/desktop`

**Files:**
- Create: `apps/desktop/vitest.config.js`
- Test: `apps/desktop/src/smoke.test.js` (deleted at the end of this task once the real suites exist — used only to prove the harness works)

**Interfaces:**
- Produces: a working `npm test` (`vitest run`) inside `apps/desktop` with `environment: 'jsdom'`, consumed by every later task's tests.

- [ ] **Step 1: Write the config**

```js
// apps/desktop/vitest.config.js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// React components render under jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
})
```

- [ ] **Step 2: Write a throwaway smoke test**

```js
// apps/desktop/src/smoke.test.js
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('runs under jsdom', () => {
    expect(typeof document).toBe('object')
  })
})
```

- [ ] **Step 3: Run it**

Run: `cd apps/desktop && npm test`
Expected: PASS — `1 passed`

- [ ] **Step 4: Delete the smoke test**

```bash
rm apps/desktop/src/smoke.test.js
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/vitest.config.js
git commit -m "test(desktop): add jsdom vitest harness"
```

---

## Task 2: `ado-workitem-types.js` — localStorage cache

**Files:**
- Create: `apps/desktop/src/ado-workitem-types.js`
- Test: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Consumes: `getProfileKey(key: string): string` from `./profile-keys.js`.
- Produces: `getCachedDefs(project: string, type: string): object|null`, `setCachedDefs(project: string, type: string, defs: object): void` — consumed by Task 5's `loadWorkItemTypeDefs`.

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/ado-workitem-types.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedDefs, setCachedDefs } from './ado-workitem-types.js'

beforeEach(() => {
  localStorage.clear()
})

describe('getCachedDefs / setCachedDefs', () => {
  it('returns null when nothing is cached', () => {
    expect(getCachedDefs('ProjectA', 'Bug')).toBe(null)
  })

  it('round-trips a defs object', () => {
    const defs = { fields: [{ referenceName: 'System.Title' }], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 123 }
    setCachedDefs('ProjectA', 'Bug', defs)
    expect(getCachedDefs('ProjectA', 'Bug')).toEqual(defs)
  })

  it('keys are isolated per project+type', () => {
    setCachedDefs('ProjectA', 'Bug', { fields: [], paths: {}, types: [], fetchedAt: 1 })
    expect(getCachedDefs('ProjectA', 'Task')).toBe(null)
    expect(getCachedDefs('ProjectB', 'Bug')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: FAIL with "Failed to resolve import ./ado-workitem-types.js" (file doesn't exist)

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/src/ado-workitem-types.js
// ado-workitem-types.js — fetches, caches, and classifies ADO work item type
// field/layout definitions for the desktop "Create Work Item" drawer.
import { createAdoHttpAdapter } from './ado-client.js'
import { getProfileKey } from './profile-keys.js'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

function cacheKey(project, type) {
  return getProfileKey(`ado.wiTypeDefs.${project}.${type}`)
}

export function getCachedDefs(project, type) {
  try {
    const raw = rawStorage.get(cacheKey(project, type))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setCachedDefs(project, type, defs) {
  rawStorage.set(cacheKey(project, type), JSON.stringify(defs))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: PASS — `3 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): add work item type definition cache"
```

---

## Task 3: `ado-workitem-types.js` — fetch work item types, project fields, and per-type fields

**Files:**
- Modify: `apps/desktop/src/ado-workitem-types.js`
- Modify: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Consumes: `createAdoHttpAdapter()` from `./ado-client.js` (its `.fetch(path)` returns a Fetch-like `Response`; `getAdoConfig`/`saveAdoConfig` also exported from `./ado-client.js`, used only in tests to configure org/pat before the adapter's `fetch` calls `window.fetch`).
- Produces:
  - `fetchWorkItemTypes(project: string): Promise<{name, referenceName, icon, color}[]>`
  - `fetchProjectFieldTypes(project: string): Promise<Record<string,string>>` (referenceName → ADO data type, e.g. `'html'`, `'string'`, `'integer'`)
  - `fetchTypeFields(project: string, type: string, fieldTypeMap: Record<string,string>): Promise<{referenceName, name, alwaysRequired, defaultValue, allowedValues, dataType}[]>`
  These three are consumed by Task 5's `loadWorkItemTypeDefs`.

- [ ] **Step 1: Write the failing tests**

```js
// append to apps/desktop/src/ado-workitem-types.test.js
import { saveAdoConfig } from './ado-client.js'
import { fetchWorkItemTypes, fetchProjectFieldTypes, fetchTypeFields } from './ado-workitem-types.js'
import { vi } from 'vitest'

function mockFetchOnce(json) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
  })
}

beforeEach(() => {
  localStorage.clear()
  saveAdoConfig({ org: 'contoso', pat: 'fake-pat', projects: ['ProjectA'] })
})

describe('fetchWorkItemTypes', () => {
  it('maps and filters out disabled types', async () => {
    mockFetchOnce({
      value: [
        { name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: { id: 'icon_bug' }, color: 'CC293D', isDisabled: false },
        { name: 'Old Type', referenceName: 'Custom.OldType', icon: { id: 'icon_x' }, color: '000000', isDisabled: true },
      ],
    })
    const result = await fetchWorkItemTypes('ProjectA')
    expect(result).toEqual([
      { name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: 'icon_bug', color: 'CC293D' },
    ])
  })
})

describe('fetchProjectFieldTypes', () => {
  it('builds a referenceName -> type map', async () => {
    mockFetchOnce({
      value: [
        { referenceName: 'System.Description', type: 'html' },
        { referenceName: 'Microsoft.VSTS.Common.Priority', type: 'integer' },
      ],
    })
    const result = await fetchProjectFieldTypes('ProjectA')
    expect(result).toEqual({
      'System.Description': 'html',
      'Microsoft.VSTS.Common.Priority': 'integer',
    })
  })
})

describe('fetchTypeFields', () => {
  it('merges the per-type field list with the data-type map', async () => {
    mockFetchOnce({
      value: [
        { referenceName: 'System.Title', name: 'Title', alwaysRequired: true, allowedValues: [] },
        { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', alwaysRequired: false, allowedValues: [1, 2, 3, 4] },
      ],
    })
    const fieldTypeMap = { 'System.Title': 'string', 'Microsoft.VSTS.Common.Priority': 'integer' }
    const result = await fetchTypeFields('ProjectA', 'Bug', fieldTypeMap)
    expect(result).toEqual([
      { referenceName: 'System.Title', name: 'Title', alwaysRequired: true, defaultValue: null, allowedValues: [], dataType: 'string' },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', alwaysRequired: false, defaultValue: null, allowedValues: [1, 2, 3, 4], dataType: 'integer' },
    ])
  })

  it('defaults dataType to string when the field is missing from the map', async () => {
    mockFetchOnce({ value: [{ referenceName: 'Custom.Unknown', name: 'Unknown', alwaysRequired: false, allowedValues: [] }] })
    const result = await fetchTypeFields('ProjectA', 'Bug', {})
    expect(result[0].dataType).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: FAIL — `fetchWorkItemTypes is not a function` (and similar for the other two)

- [ ] **Step 3: Write minimal implementation**

```js
// add to apps/desktop/src/ado-workitem-types.js, below the cache functions

async function adoFetchJson(path) {
  const adapter = createAdoHttpAdapter()
  const res = await adapter.fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

export async function fetchWorkItemTypes(project) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.0`)
  return (data.value || [])
    .filter((t) => !t.isDisabled)
    .map((t) => ({ name: t.name, referenceName: t.referenceName, icon: t.icon?.id || '', color: t.color || '' }))
}

export async function fetchProjectFieldTypes(project) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/fields?api-version=7.0`)
  const map = {}
  for (const f of data.value || []) map[f.referenceName] = f.type
  return map
}

export async function fetchTypeFields(project, type, fieldTypeMap) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?api-version=7.0`)
  return (data.value || []).map((f) => ({
    referenceName: f.referenceName,
    name: f.name,
    alwaysRequired: !!f.alwaysRequired,
    defaultValue: f.defaultValue ?? null,
    allowedValues: f.allowedValues || [],
    dataType: fieldTypeMap[f.referenceName] || 'string',
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: PASS — `7 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): fetch ADO work item types and per-type field definitions"
```

---

## Task 4: `ado-workitem-types.js` — classification path flattening

**Files:**
- Modify: `apps/desktop/src/ado-workitem-types.js`
- Modify: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Produces: `fetchClassificationPaths(project: string): Promise<{ areas: string[], iterations: string[] }>` — consumed by Task 5's `loadWorkItemTypeDefs` and by the Area/Iteration path pickers in Task 8.

- [ ] **Step 1: Write the failing test**

```js
// append to apps/desktop/src/ado-workitem-types.test.js
import { fetchClassificationPaths } from './ado-workitem-types.js'

describe('fetchClassificationPaths', () => {
  it('flattens the area and iteration trees into backslash-joined paths', async () => {
    const areaTree = { name: 'ProjectA', children: [{ name: 'Team1', children: [{ name: 'SubTeam', children: [] }] }] }
    const iterationTree = { name: 'ProjectA', children: [{ name: 'Sprint 1', children: [] }, { name: 'Sprint 2', children: [] }] }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => areaTree })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => iterationTree })

    const result = await fetchClassificationPaths('ProjectA')
    expect(result).toEqual({
      areas: ['ProjectA', 'ProjectA\\Team1', 'ProjectA\\Team1\\SubTeam'],
      iterations: ['ProjectA', 'ProjectA\\Sprint 1', 'ProjectA\\Sprint 2'],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: FAIL — `fetchClassificationPaths is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// add to apps/desktop/src/ado-workitem-types.js

function flattenClassificationNode(node, prefix = '') {
  const path = prefix ? `${prefix}\\${node.name}` : node.name
  const children = (node.children || []).flatMap((c) => flattenClassificationNode(c, path))
  return [path, ...children]
}

export async function fetchClassificationPaths(project) {
  const [areas, iterations] = await Promise.all([
    adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.0`),
    adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/classificationnodes/iterations?$depth=10&api-version=7.0`),
  ])
  return {
    areas: flattenClassificationNode(areas),
    iterations: flattenClassificationNode(iterations),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: PASS — `8 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): flatten ADO area/iteration classification trees"
```

---

## Task 5: `ado-workitem-types.js` — `loadWorkItemTypeDefs` orchestration

**Files:**
- Modify: `apps/desktop/src/ado-workitem-types.js`
- Modify: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Consumes: `getCachedDefs`, `setCachedDefs` (Task 2), `fetchWorkItemTypes`, `fetchProjectFieldTypes`, `fetchTypeFields` (Task 3), `fetchClassificationPaths` (Task 4).
- Produces: `loadWorkItemTypeDefs(project: string, type: string, opts?: { forceRefresh?: boolean }): Promise<{ fields, paths, types, fetchedAt }>` — the single entry point `create-work-item-drawer.jsx` (Task 9) calls.

- [ ] **Step 1: Write the failing tests**

```js
// append to apps/desktop/src/ado-workitem-types.test.js
import { loadWorkItemTypeDefs, setCachedDefs, getCachedDefs } from './ado-workitem-types.js'

describe('loadWorkItemTypeDefs', () => {
  it('returns the cached value without calling fetch when a cache exists', async () => {
    const cached = { fields: [{ referenceName: 'System.Title' }], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 1 }
    setCachedDefs('ProjectA', 'Bug', cached)
    global.fetch = vi.fn()
    const result = await loadWorkItemTypeDefs('ProjectA', 'Bug')
    expect(result).toEqual(cached)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches and caches when nothing is cached yet', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/_apis/wit/fields?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ referenceName: 'System.Title', type: 'string' }] }) })
      if (url.includes('/workitemtypes/Bug/fields')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ referenceName: 'System.Title', name: 'Title', alwaysRequired: true, allowedValues: [] }] }) })
      if (url.includes('/classificationnodes/areas')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/classificationnodes/iterations')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/_apis/wit/workitemtypes?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: {}, color: '' }] }) })
      return Promise.reject(new Error('unexpected url: ' + url))
    })

    const result = await loadWorkItemTypeDefs('ProjectA', 'Bug')
    expect(result.fields).toEqual([{ referenceName: 'System.Title', name: 'Title', alwaysRequired: true, defaultValue: null, allowedValues: [], dataType: 'string' }])
    expect(result.paths).toEqual({ areas: ['ProjectA'], iterations: ['ProjectA'] })
    expect(result.types).toEqual([{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }])
    expect(getCachedDefs('ProjectA', 'Bug')).toEqual(result)
  })

  it('refetches when forceRefresh is true even if a cache exists', async () => {
    setCachedDefs('ProjectA', 'Bug', { fields: [], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 1 })
    global.fetch = vi.fn((url) => {
      if (url.includes('/_apis/wit/fields?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      if (url.includes('/workitemtypes/Bug/fields')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      if (url.includes('/classificationnodes/areas')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/classificationnodes/iterations')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'ProjectA', children: [] }) })
      if (url.includes('/_apis/wit/workitemtypes?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) })
      return Promise.reject(new Error('unexpected url: ' + url))
    })
    await loadWorkItemTypeDefs('ProjectA', 'Bug', { forceRefresh: true })
    expect(global.fetch).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: FAIL — `loadWorkItemTypeDefs is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// add to apps/desktop/src/ado-workitem-types.js

export async function loadWorkItemTypeDefs(project, type, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = getCachedDefs(project, type)
    if (cached) return cached
  }
  const fieldTypeMap = await fetchProjectFieldTypes(project)
  const [fields, paths, types] = await Promise.all([
    fetchTypeFields(project, type, fieldTypeMap),
    fetchClassificationPaths(project),
    fetchWorkItemTypes(project),
  ])
  const defs = { fields, paths, types, fetchedAt: Date.now() }
  setCachedDefs(project, type, defs)
  return defs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: PASS — `11 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): orchestrate cache-first work item type definition loading"
```

---

## Task 6: `ado-workitem-types.js` — field bucketing, grouping, link types, patch-op builders

**Files:**
- Modify: `apps/desktop/src/ado-workitem-types.js`
- Modify: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Produces:
  - `fieldBucket(field: {referenceName, dataType, allowedValues}): 'html'|'treePath'|'identity'|'picklist'|'dateTime'|'boolean'|'number'|'text'` — consumed by `FieldInput` (Task 7).
  - `fieldGroup(field): 'status'|'classification'|'planning'|'tags'|'main'|'additional'` — consumed by `CreateWorkItemDrawer` (Task 9) to place each field in the right section.
  - `LINK_TYPES: {label: string, rel: string}[]` — consumed by the Links UI (Task 11).
  - `buildFieldPatchOps(fields: Record<string,string|number|boolean>): {op:'add',path:string,value:any}[]` — consumed by `desktopWorkItemSource.createWorkItem` (Task 12).
  - `buildAttachmentRelationOps(attachmentUrls: string[]): {op:'add',path:'/relations/-',value:object}[]` — consumed by Task 10.
  - `buildLinkRelationOps(links: {rel:string, id:number}[]): {op:'add',path:'/relations/-',value:object}[]` — consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

```js
// append to apps/desktop/src/ado-workitem-types.test.js
import { fieldBucket, fieldGroup, LINK_TYPES, buildFieldPatchOps, buildAttachmentRelationOps, buildLinkRelationOps } from './ado-workitem-types.js'

describe('fieldBucket', () => {
  it('classifies known html fields', () => {
    expect(fieldBucket({ referenceName: 'System.Description', dataType: 'html', allowedValues: [] })).toBe('html')
  })
  it('classifies area/iteration path fields as treePath', () => {
    expect(fieldBucket({ referenceName: 'System.AreaPath', dataType: 'treePath', allowedValues: [] })).toBe('treePath')
  })
  it('classifies AssignedTo as identity', () => {
    expect(fieldBucket({ referenceName: 'System.AssignedTo', dataType: 'string', allowedValues: [] })).toBe('identity')
  })
  it('classifies fields with allowedValues as picklist', () => {
    expect(fieldBucket({ referenceName: 'Custom.Env', dataType: 'string', allowedValues: ['Dev', 'Prod'] })).toBe('picklist')
  })
  it('classifies integer/double as number, dateTime, boolean, and falls back to text', () => {
    expect(fieldBucket({ referenceName: 'Microsoft.VSTS.Scheduling.RemainingWork', dataType: 'double', allowedValues: [] })).toBe('number')
    expect(fieldBucket({ referenceName: 'Microsoft.VSTS.Scheduling.TargetDate', dataType: 'dateTime', allowedValues: [] })).toBe('dateTime')
    expect(fieldBucket({ referenceName: 'Custom.Flag', dataType: 'boolean', allowedValues: [] })).toBe('boolean')
    expect(fieldBucket({ referenceName: 'Custom.Notes', dataType: 'string', allowedValues: [] })).toBe('text')
  })
})

describe('fieldGroup', () => {
  it('groups known status/classification/planning/tags fields', () => {
    expect(fieldGroup({ referenceName: 'System.AssignedTo', dataType: 'string', allowedValues: [] })).toBe('status')
    expect(fieldGroup({ referenceName: 'System.AreaPath', dataType: 'treePath', allowedValues: [] })).toBe('classification')
    expect(fieldGroup({ referenceName: 'Microsoft.VSTS.Scheduling.StoryPoints', dataType: 'double', allowedValues: [] })).toBe('planning')
    expect(fieldGroup({ referenceName: 'System.Tags', dataType: 'string', allowedValues: [] })).toBe('tags')
  })
  it('groups html fields as main and everything unrecognized as additional', () => {
    expect(fieldGroup({ referenceName: 'System.Description', dataType: 'html', allowedValues: [] })).toBe('main')
    expect(fieldGroup({ referenceName: 'Custom.Whatever', dataType: 'string', allowedValues: [] })).toBe('additional')
  })
})

describe('LINK_TYPES', () => {
  it('exposes the seven ADO relation types with rel URNs', () => {
    expect(LINK_TYPES).toHaveLength(7)
    expect(LINK_TYPES.find((l) => l.label === 'Parent').rel).toBe('System.LinkTypes.Hierarchy-Reverse')
    expect(LINK_TYPES.find((l) => l.label === 'Related').rel).toBe('System.LinkTypes.Related')
  })
})

describe('buildFieldPatchOps', () => {
  it('builds one add op per populated field', () => {
    expect(buildFieldPatchOps({ 'System.Title': 'Fix bug', 'Microsoft.VSTS.Common.Priority': 2 })).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Fix bug' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
    ])
  })
})

describe('buildAttachmentRelationOps', () => {
  it('builds one AttachedFile relation op per url', () => {
    expect(buildAttachmentRelationOps(['https://x/attachments/1'])).toEqual([
      { op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: 'https://x/attachments/1' } },
    ])
  })
})

describe('buildLinkRelationOps', () => {
  it('builds one relation op per link with the vstfs URL format', () => {
    expect(buildLinkRelationOps([{ rel: 'System.LinkTypes.Related', id: 1234 }])).toEqual([
      { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: 'vstfs:///WorkItemTracking/WorkItem/1234' } },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: FAIL — `fieldBucket is not a function` (and the rest)

- [ ] **Step 3: Write minimal implementation**

```js
// add to apps/desktop/src/ado-workitem-types.js

const HTML_FIELDS = new Set([
  'System.Description',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.SystemInfo',
])

const KNOWN_FIELD_GROUPS = {
  'System.AssignedTo': 'status',
  'System.State': 'status',
  'System.Reason': 'status',
  'System.AreaPath': 'classification',
  'System.IterationPath': 'classification',
  'Microsoft.VSTS.Common.Priority': 'classification',
  'Microsoft.VSTS.Common.Severity': 'classification',
  'System.Tags': 'tags',
}

export function fieldBucket(field) {
  if (HTML_FIELDS.has(field.referenceName) || field.dataType === 'html') return 'html'
  if (field.referenceName === 'System.AreaPath' || field.referenceName === 'System.IterationPath' || field.dataType === 'treePath') return 'treePath'
  if (field.referenceName === 'System.AssignedTo' || field.dataType === 'identity') return 'identity'
  if (field.allowedValues && field.allowedValues.length > 0) return 'picklist'
  if (field.dataType === 'dateTime') return 'dateTime'
  if (field.dataType === 'boolean') return 'boolean'
  if (field.dataType === 'integer' || field.dataType === 'double') return 'number'
  return 'text'
}

export function fieldGroup(field) {
  if (KNOWN_FIELD_GROUPS[field.referenceName]) return KNOWN_FIELD_GROUPS[field.referenceName]
  if (field.referenceName.startsWith('Microsoft.VSTS.Scheduling.')) return 'planning'
  if (fieldBucket(field) === 'html') return 'main'
  return 'additional'
}

export const LINK_TYPES = [
  { label: 'Parent', rel: 'System.LinkTypes.Hierarchy-Reverse' },
  { label: 'Child', rel: 'System.LinkTypes.Hierarchy-Forward' },
  { label: 'Related', rel: 'System.LinkTypes.Related' },
  { label: 'Predecessor', rel: 'System.LinkTypes.Dependency-Reverse' },
  { label: 'Successor', rel: 'System.LinkTypes.Dependency-Forward' },
  { label: 'Duplicate', rel: 'System.LinkTypes.Duplicate-Forward' },
  { label: 'Duplicate Of', rel: 'System.LinkTypes.Duplicate-Reverse' },
]

export function buildFieldPatchOps(fields) {
  return Object.entries(fields).map(([referenceName, value]) => ({
    op: 'add',
    path: `/fields/${referenceName}`,
    value,
  }))
}

export function buildAttachmentRelationOps(attachmentUrls) {
  return attachmentUrls.map((url) => ({
    op: 'add',
    path: '/relations/-',
    value: { rel: 'AttachedFile', url },
  }))
}

export function buildLinkRelationOps(links) {
  return links.map(({ rel, id }) => ({
    op: 'add',
    path: '/relations/-',
    value: { rel, url: `vstfs:///WorkItemTracking/WorkItem/${id}` },
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ado-workitem-types`
Expected: PASS — `19 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): add field bucketing, grouping, and ADO patch-op builders"
```

---

## Task 7: `create-work-item-drawer.jsx` — `FieldInput` generic renderer

**Files:**
- Create: `apps/desktop/src/create-work-item-drawer.jsx`
- Create: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `fieldBucket` from `./ado-workitem-types.js` (Task 6), `SettField`/`settInputStyle` from `./desktop-settings.jsx`.
- Produces: `FieldInput({ def, value, onChange, team, paths })` where `def` is one field object from `loadWorkItemTypeDefs().fields`, `team` is `{id,name}[]`, `paths` is `{areas:string[], iterations:string[]}` — consumed by `CreateWorkItemDrawer` (Task 9).

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/desktop/src/create-work-item-drawer.test.jsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldInput } from './create-work-item-drawer.jsx'

describe('FieldInput', () => {
  it('renders a select with allowedValues for a picklist field', () => {
    const def = { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    const select = screen.getByLabelText('Priority')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(5) // 4 values + blank
  })

  it('renders a team select for an identity field', () => {
    const def = { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[{ id: '1', name: 'Alex' }]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByLabelText('Assigned To').tagName).toBe('SELECT')
    expect(screen.getByText('Alex')).toBeTruthy()
  })

  it('renders a datalist-backed input for a treePath field', () => {
    const def = { referenceName: 'System.AreaPath', name: 'Area Path', dataType: 'treePath', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: ['ProjectA\\Team1'], iterations: [] }} />)
    const input = screen.getByLabelText('Area Path')
    expect(input.getAttribute('list')).toBeTruthy()
  })

  it('calls onChange with the new value for a text field', () => {
    const def = { referenceName: 'Custom.Notes', name: 'Notes', dataType: 'string', allowedValues: [], alwaysRequired: false }
    const onChange = vi.fn()
    render(<FieldInput def={def} value="" onChange={onChange} team={[]} paths={{ areas: [], iterations: [] }} />)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('shows a required marker when alwaysRequired is true', () => {
    const def = { referenceName: 'System.Title', name: 'Title', dataType: 'string', allowedValues: [], alwaysRequired: true }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByText('Title *')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: FAIL — `Failed to resolve import ./create-work-item-drawer.jsx`

- [ ] **Step 3: Write minimal implementation**

```jsx
// apps/desktop/src/create-work-item-drawer.jsx
import React from 'react'
import { fieldBucket } from './ado-workitem-types.js'
import { settInputStyle } from './desktop-settings.jsx'

function FieldLabel({ def }) {
  return <span>{def.name}{def.alwaysRequired ? ' *' : ''}</span>
}

export function FieldInput({ def, value, onChange, team, paths }) {
  const bucket = fieldBucket(def)
  const id = `wi-field-${def.referenceName}`

  if (bucket === 'picklist') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <select id={id} aria-label={def.name} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle}>
          <option value="" />
          {def.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
    )
  }

  if (bucket === 'identity') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <select id={id} aria-label={def.name} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle}>
          <option value="">Unassigned</option>
          {(team || []).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </label>
    )
  }

  if (bucket === 'treePath') {
    const isArea = def.referenceName === 'System.AreaPath'
    const listId = `${id}-list`
    const options = isArea ? paths.areas : paths.iterations
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} list={listId} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
        <datalist id={listId}>
          {options.map((p) => <option key={p} value={p} />)}
        </datalist>
      </label>
    )
  }

  if (bucket === 'dateTime') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
      </label>
    )
  }

  if (bucket === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={id} aria-label={def.name} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <FieldLabel def={def} />
      </label>
    )
  }

  if (bucket === 'number') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
      </label>
    )
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldLabel def={def} />
      <input id={id} aria-label={def.name} type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
    </label>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: PASS — `5 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): add generic FieldInput renderer for dynamic ADO fields"
```

---

## Task 8: `create-work-item-drawer.jsx` — `MarkdownField` Write/Preview editor

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `mdToHtml` from `@nexusmd/ui` (re-exported `render-content.js`).
- Produces: `MarkdownField({ label, value, onChange, required, rows })` — consumed by `CreateWorkItemDrawer` (Task 9) for Description/Acceptance Criteria/Repro Steps/System Info.

- [ ] **Step 1: Write the failing tests**

```jsx
// append to apps/desktop/src/create-work-item-drawer.test.jsx
import { MarkdownField } from './create-work-item-drawer.jsx'

describe('MarkdownField', () => {
  it('renders a textarea in Write mode by default and calls onChange on input', () => {
    const onChange = vi.fn()
    render(<MarkdownField label="Description" value="" onChange={onChange} />)
    const textarea = screen.getByLabelText('Description')
    fireEvent.change(textarea, { target: { value: '**bold**' } })
    expect(onChange).toHaveBeenCalledWith('**bold**')
  })

  it('switches to Preview mode and renders converted markdown as HTML', () => {
    render(<MarkdownField label="Description" value="**bold**" onChange={() => {}} />)
    fireEvent.click(screen.getByText('Preview'))
    expect(document.querySelector('strong')).toBeTruthy()
  })

  it('shows a required marker in the label when required', () => {
    render(<MarkdownField label="Description" value="" onChange={() => {}} required />)
    expect(screen.getByText('Description *')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: FAIL — `MarkdownField is not exported`

- [ ] **Step 3: Write minimal implementation**

```jsx
// add to apps/desktop/src/create-work-item-drawer.jsx
import { mdToHtml } from '@nexusmd/ui'

const tabStyle = (active) => ({
  fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', lineHeight: '20px',
})

export function MarkdownField({ label, value, onChange, required, rows = 4 }) {
  const [preview, setPreview] = React.useState(false)
  const id = `wi-md-${label}`

  return (
    <div className="drawer-section">
      <h4 style={{ marginBottom: 6 }}>{label}{required ? ' *' : ''}</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button type="button" style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
        <button type="button" style={tabStyle(preview)} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? (
        <div
          className="wi-html-content"
          style={{ minHeight: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: value.trim() ? mdToHtml(value) : '<em>Nothing to preview</em>' }}
        />
      ) : (
        <textarea
          id={id}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: PASS — `8 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): add MarkdownField Write/Preview editor for create drawer"
```

---

## Task 9: `create-work-item-drawer.jsx` — `CreateWorkItemDrawer` shell (top strip, two-column grid, type/project switching)

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `Drawer`, `TypeIcon`, `Icon` from `@nexusmd/ui`; `SettField` from `./desktop-settings.jsx`; `loadWorkItemTypeDefs`, `fieldGroup` from `./ado-workitem-types.js`; `adoTypeToHelm` from `@nexusmd/core`; `getAdoConfig` from `./ado-client.js`.
- Produces: `CreateWorkItemDrawer({ open, title, project: projectsList, team, onClose, onCreate })` — `onCreate` is called in Task 10 with the assembled payload; `projectsList: string[]`, `team: {id,name}[]`. This is what Task 12 renders from `main.jsx` in place of `CreateWorkItemModal`.

- [ ] **Step 1: Write the failing tests**

```jsx
// append to apps/desktop/src/create-work-item-drawer.test.jsx
import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import * as adoWorkItemTypes from './ado-workitem-types.js'

function stubDefs() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Custom.RiskLevel', name: 'Risk Level', dataType: 'string', allowedValues: ['Low', 'High'], alwaysRequired: false },
    ],
    paths: { areas: ['ProjectA'], iterations: ['ProjectA'] },
    types: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }, { name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}

describe('CreateWorkItemDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<CreateWorkItemDrawer open={false} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    expect(container.querySelector('.drawer.open')).toBe(null)
  })

  it('loads type definitions on open and renders known + additional fields', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    expect(await screen.findByText('Description')).toBeTruthy()
    expect(screen.getByText('Assigned To')).toBeTruthy()
    expect(screen.getByText('Risk Level')).toBeTruthy()
  })

  it('reloads definitions when the Type selector changes', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByText('Description')
    adoWorkItemTypes.loadWorkItemTypeDefs.mockClear()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Microsoft.VSTS.WorkItemTypes.Task' } })
    expect(adoWorkItemTypes.loadWorkItemTypeDefs).toHaveBeenCalledWith('ProjectA', 'Microsoft.VSTS.WorkItemTypes.Task', expect.anything())
  })

  it('force-refreshes definitions when the refresh button is clicked', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByText('Description')
    adoWorkItemTypes.loadWorkItemTypeDefs.mockClear()
    fireEvent.click(screen.getByTitle('Refresh field definitions'))
    expect(adoWorkItemTypes.loadWorkItemTypeDefs).toHaveBeenCalledWith(expect.any(String), expect.any(String), { forceRefresh: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: FAIL — `CreateWorkItemDrawer is not exported`

- [ ] **Step 3: Write minimal implementation**

```jsx
// add to apps/desktop/src/create-work-item-drawer.jsx
import { Drawer, TypeIcon, Icon } from '@nexusmd/ui'
import { adoTypeToHelm } from '@nexusmd/core'
import { SettField } from './desktop-settings.jsx'
import * as adoWorkItemTypesModule from './ado-workitem-types.js'
import { fieldGroup } from './ado-workitem-types.js'

const DEFAULT_TYPE_REF = 'Microsoft.VSTS.WorkItemTypes.Task'

export function CreateWorkItemDrawer({ open, title: initialTitle, project: projectsList, team, onClose, onCreate }) {
  const [project, setProject] = React.useState(projectsList[0] || '')
  const [typeRef, setTypeRef] = React.useState(DEFAULT_TYPE_REF)
  const [defs, setDefs] = React.useState(null)
  const [wiTitle, setWiTitle] = React.useState('')
  const [values, setValues] = React.useState({})
  const [status, setStatus] = React.useState('')

  const load = React.useCallback((proj, type, opts = {}) => {
    adoWorkItemTypesModule.loadWorkItemTypeDefs(proj, type, opts).then((d) => {
      setDefs(d)
      setValues({})
    })
  }, [])

  React.useEffect(() => {
    if (!open) return
    setWiTitle(initialTitle || '')
    setProject(projectsList[0] || '')
    setTypeRef(DEFAULT_TYPE_REF)
    load(projectsList[0] || '', DEFAULT_TYPE_REF)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const typeName = (defs?.types || []).find((t) => t.referenceName === typeRef)?.name || 'Work Item'
  const fields = defs?.fields || []
  const mainFields = fields.filter((f) => fieldGroup(f) === 'main')
  const statusFields = fields.filter((f) => fieldGroup(f) === 'status')
  const classificationFields = fields.filter((f) => fieldGroup(f) === 'classification')
  const planningFields = fields.filter((f) => fieldGroup(f) === 'planning')
  const tagsFields = fields.filter((f) => fieldGroup(f) === 'tags')
  const additionalFields = fields.filter((f) => fieldGroup(f) === 'additional')

  const setFieldValue = (refName, v) => setValues((prev) => ({ ...prev, [refName]: v }))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`New ${typeName}`}
      badges={<TypeIcon type={adoTypeToHelm(typeName)} />}
      actions={(
        <button className="btn icon ghost sm" title="Refresh field definitions"
          onClick={() => load(project, typeRef, { forceRefresh: true })}>
          <Icon name="refresh" size={13} />
        </button>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SettField label="Project">
          <select aria-label="Project" value={project} onChange={(e) => { setProject(e.target.value); load(e.target.value, typeRef) }}>
            {projectsList.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </SettField>
        <SettField label="Type">
          <select aria-label="Type" value={typeRef} onChange={(e) => { setTypeRef(e.target.value); load(project, e.target.value) }}>
            {(defs?.types || []).map((t) => <option key={t.referenceName} value={t.referenceName}>{t.name}</option>)}
          </select>
        </SettField>
      </div>

      <SettField label="Title">
        <input aria-label="Title" value={wiTitle} onChange={(e) => setWiTitle(e.target.value)} autoFocus />
      </SettField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginTop: 14 }}>
        <div>
          {mainFields.map((f) => (
            <div key={f.referenceName} className="drawer-section">{f.name}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[statusFields, classificationFields, planningFields, tagsFields].map((group, i) => (
            group.length > 0 && (
              <div key={i} className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.map((f) => (
                  <div key={f.referenceName}>{f.name}</div>
                ))}
              </div>
            )
          ))}
          {additionalFields.length > 0 && (
            <div className="drawer-section">
              <h4>Additional Fields</h4>
              {additionalFields.map((f) => (
                <div key={f.referenceName}>{f.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {status && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{status}</div>}
    </Drawer>
  )
}
```

This placeholder renders each field's plain name so Step 4's tests can verify definitions loaded into the right groups; Task 10 replaces these plain `<div>{f.name}</div>` rows with real `FieldInput`/`MarkdownField` calls, which render the same name as their label/heading text — so none of this task's tests need to change in Task 10.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: PASS — `12 passed`. (The right-rail/main-column field rows are wired to real `FieldInput`/`MarkdownField` calls in Task 10 — this task only proves definitions load, react to Project/Type changes, and the refresh button works.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): add CreateWorkItemDrawer shell with dynamic type/project switching"
```

---

## Task 10: Wire `FieldInput`/`MarkdownField` into the drawer body + submit flow (create, attachments)

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `FieldInput` (Task 7), `MarkdownField` (Task 8), `buildFieldPatchOps`/`buildAttachmentRelationOps` (Task 6).
- Produces: the `onCreate` payload shape `{ project, type, fields: Record<string,any>, attachmentFiles: File[] }`, called on submit — consumed by `main.jsx`'s `desktopWorkItemSource.createWorkItem` wiring in Task 12.

- [ ] **Step 1: Write the failing tests**

```jsx
// append to apps/desktop/src/create-work-item-drawer.test.jsx
describe('CreateWorkItemDrawer submit', () => {
  it('renders MarkdownField for main fields and FieldInput for rail fields, and calls onCreate with assembled fields', async () => {
    stubDefs()
    const onCreate = vi.fn().mockResolvedValue({ id: 42 })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[{ id: '1', name: 'Alex' }]} onClose={() => {}} onCreate={onCreate} />)

    await screen.findByLabelText('Description') // wait for defs to load before interacting with dynamic fields
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix login bug' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'It crashes' } })
    fireEvent.change(screen.getByLabelText('Assigned To'), { target: { value: 'Alex' } })

    fireEvent.click(screen.getByText('Create'))

    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      project: 'ProjectA',
      type: 'Microsoft.VSTS.WorkItemTypes.Task',
      fields: expect.objectContaining({
        'System.Title': 'Fix login bug',
        'System.Description': 'It crashes',
        'System.AssignedTo': 'Alex',
      }),
      attachmentFiles: [],
    }))
  })

  it('blocks submit and shows an inline error when Title is empty', async () => {
    stubDefs()
    const onCreate = vi.fn()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')
    fireEvent.click(screen.getByText('Create'))
    expect(await screen.findByText('Title is required.')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('stages a file for upload without calling the attachments API immediately', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={vi.fn().mockResolvedValue({ id: 1 })} />)
    await screen.findByLabelText('Description')
    const file = new File(['contents'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } })
    expect(screen.getByText('notes.txt')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: FAIL — `Unable to find a label with the text of: Create` (footer/submit not wired yet) and `Unable to find label: Attach files`

- [ ] **Step 3: Write minimal implementation**

Replace the placeholder main-column/right-rail bodies and add the footer + attachments UI:

```jsx
// replace the two-column grid block inside CreateWorkItemDrawer's return, and everything after it, with:

  const [attachmentFiles, setAttachmentFiles] = React.useState([])
  const [saving, setSaving] = React.useState(false)
  const [titleError, setTitleError] = React.useState('')

  const submit = async () => {
    if (!wiTitle.trim()) { setTitleError('Title is required.'); return }
    setTitleError('')
    setSaving(true)
    setStatus('Creating…')
    try {
      const fieldValues = { 'System.Title': wiTitle.trim(), ...values }
      const result = await onCreate({ project, type: typeRef, fields: fieldValues, attachmentFiles })
      setStatus(`Created #${result.id}.`)
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'Failed to create'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`New ${typeName}`}
      badges={<TypeIcon type={adoTypeToHelm(typeName)} />}
      actions={(
        <button className="btn icon ghost sm" title="Refresh field definitions"
          onClick={() => load(project, typeRef, { forceRefresh: true })}>
          <Icon name="refresh" size={13} />
        </button>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SettField label="Project">
          <select aria-label="Project" value={project} onChange={(e) => { setProject(e.target.value); load(e.target.value, typeRef) }}>
            {projectsList.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </SettField>
        <SettField label="Type">
          <select aria-label="Type" value={typeRef} onChange={(e) => { setTypeRef(e.target.value); load(project, e.target.value) }}>
            {(defs?.types || []).map((t) => <option key={t.referenceName} value={t.referenceName}>{t.name}</option>)}
          </select>
        </SettField>
      </div>

      <SettField label="Title">
        <input aria-label="Title" value={wiTitle} onChange={(e) => setWiTitle(e.target.value)} autoFocus />
      </SettField>
      {titleError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{titleError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginTop: 14 }}>
        <div>
          {mainFields.map((f) => (
            <MarkdownField
              key={f.referenceName}
              label={f.name}
              required={f.alwaysRequired}
              value={values[f.referenceName] || ''}
              onChange={(v) => setFieldValue(f.referenceName, v)}
            />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[statusFields, classificationFields, planningFields, tagsFields].map((group, i) => (
            group.length > 0 && (
              <div key={i} className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.map((f) => (
                  <FieldInput
                    key={f.referenceName}
                    def={f}
                    value={values[f.referenceName]}
                    onChange={(v) => setFieldValue(f.referenceName, v)}
                    team={team}
                    paths={defs?.paths || { areas: [], iterations: [] }}
                  />
                ))}
              </div>
            )
          ))}
          {additionalFields.length > 0 && (
            <div className="drawer-section">
              <h4>Additional Fields</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {additionalFields.map((f) => (
                  <FieldInput
                    key={f.referenceName}
                    def={f}
                    value={values[f.referenceName]}
                    onChange={(v) => setFieldValue(f.referenceName, v)}
                    team={team}
                    paths={defs?.paths || { areas: [], iterations: [] }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Attachments</h4>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Attach files</span>
          <input
            aria-label="Attach files"
            type="file"
            multiple
            onChange={(e) => setAttachmentFiles((prev) => [...prev, ...Array.from(e.target.files)])}
          />
        </label>
        {attachmentFiles.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {attachmentFiles.map((f, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                {f.name}
                <button type="button" className="btn icon ghost sm" style={{ marginLeft: 6 }}
                  onClick={() => setAttachmentFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
        {status && <span style={{ fontSize: 12.5, color: status.startsWith('Error') ? 'var(--danger)' : 'var(--text-muted)' }}>{status}</span>}
      </div>
    </Drawer>
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: PASS — `15 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): wire field rendering, attachments staging, and submit into the drawer"
```

---

## Task 11: Links/Relations staging UI

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `LINK_TYPES` from `./ado-workitem-types.js` (Task 6).
- Produces: extends the `onCreate` payload with `links: {rel: string, id: number}[]`.

- [ ] **Step 1: Write the failing test**

```jsx
// append to apps/desktop/src/create-work-item-drawer.test.jsx
describe('CreateWorkItemDrawer links', () => {
  it('stages a link and includes it in the onCreate payload', async () => {
    stubDefs()
    const onCreate = vi.fn().mockResolvedValue({ id: 1 })
    render(<CreateWorkItemDrawer open={true} title="Has a parent" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')

    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'System.LinkTypes.Hierarchy-Reverse' } })
    fireEvent.change(screen.getByLabelText('Linked work item ID'), { target: { value: '555' } })
    fireEvent.click(screen.getByText('+ Add link'))

    expect(screen.getByText('#555 (Parent)')).toBeTruthy()

    fireEvent.click(screen.getByText('Create'))
    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      links: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', id: 555 }],
    }))
  })

  it('removes a staged link', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="x" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={vi.fn().mockResolvedValue({ id: 1 })} />)
    await screen.findByLabelText('Description')
    fireEvent.change(screen.getByLabelText('Linked work item ID'), { target: { value: '555' } })
    fireEvent.click(screen.getByText('+ Add link'))
    fireEvent.click(screen.getByTitle('Remove link'))
    expect(screen.queryByText('#555 (Parent)')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: FAIL — `Unable to find a label with the text of: Link type`

- [ ] **Step 3: Write minimal implementation**

```jsx
// add import at top of create-work-item-drawer.jsx
import { LINK_TYPES } from './ado-workitem-types.js'

// add state inside CreateWorkItemDrawer, alongside attachmentFiles:
  const [links, setLinks] = React.useState([])
  const [linkRel, setLinkRel] = React.useState(LINK_TYPES[0].rel)
  const [linkId, setLinkId] = React.useState('')

// add to submit(), inside the fieldValues assembly, pass links through:
      const result = await onCreate({ project, type: typeRef, fields: fieldValues, attachmentFiles, links })

// add a Links section, placed after the Attachments drawer-section:
      <div className="drawer-section">
        <h4>Links</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Link type</span>
            <select aria-label="Link type" value={linkRel} onChange={(e) => setLinkRel(e.target.value)}>
              {LINK_TYPES.map((lt) => <option key={lt.rel} value={lt.rel}>{lt.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Linked work item ID</span>
            <input aria-label="Linked work item ID" type="number" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
          </label>
          <button type="button" className="btn sm"
            onClick={() => {
              const id = parseInt(linkId, 10)
              if (!id) return
              setLinks((prev) => [...prev, { rel: linkRel, id }])
              setLinkId('')
            }}>
            + Add link
          </button>
        </div>
        {links.length > 0 && (
          <ul style={{ paddingLeft: 18 }}>
            {links.map((l, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                #{l.id} ({LINK_TYPES.find((lt) => lt.rel === l.rel)?.label})
                <button type="button" className="btn icon ghost sm" title="Remove link" style={{ marginLeft: 6 }}
                  onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- create-work-item-drawer`
Expected: PASS — `17 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): add links/relations staging to the create work item drawer"
```

---

## Task 12: Wire into `main.jsx` — replace `CreateWorkItemModal`, generalize `createWorkItem`, upload attachments/links after create

**Files:**
- Modify: `apps/desktop/src/main.jsx:191-214` (`desktopWorkItemSource.createWorkItem`)
- Modify: `apps/desktop/src/main.jsx:406-565` (delete `CreateWorkItemModal`)
- Modify: `apps/desktop/src/main.jsx:1146` (render `CreateWorkItemDrawer` instead)
- Modify: `apps/desktop/src/main.jsx` imports (add `CreateWorkItemDrawer`, `buildFieldPatchOps`, `buildAttachmentRelationOps`, `buildLinkRelationOps`)

**Interfaces:**
- Consumes: `CreateWorkItemDrawer` (Task 10/11), `buildFieldPatchOps`/`buildAttachmentRelationOps`/`buildLinkRelationOps` (Task 6).
- Produces: `desktopWorkItemSource.createWorkItem({ project, type, fields, attachmentFiles, links }): Promise<{id: number, warnings: string[]}>` — the `id` and `warnings` are what `CreateWorkItemDrawer`'s status line (Section 7 of the design) reports.

This task has no isolated unit test (it's wiring inside `main.jsx`, which has no existing test harness for the full `App` tree) — it is verified manually per Step 4 below, consistent with how `apps/desktop/src/main.jsx` changes have been verified elsewhere in this codebase (no existing tests cover it).

- [ ] **Step 1: Replace `createWorkItem`**

```js
// replace apps/desktop/src/main.jsx:191-214 (the old createWorkItem method) with:
  async createWorkItem({ project, type, fields, attachmentFiles = [], links = [] }) {
    const adapter = createAdoHttpAdapter()
    const proj = encodeURIComponent(project)
    const ops = buildFieldPatchOps(fields)
    const createRes = await adapter.fetch(
      `${proj}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.0`,
      { method: 'POST', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(ops) },
    )
    if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`)
    const created = await createRes.json()
    const warnings = []

    const attachmentUrls = []
    for (const file of attachmentFiles) {
      try {
        const uploadRes = await adapter.fetch(
          `${proj}/_apis/wit/attachments?fileName=${encodeURIComponent(file.name)}&api-version=7.0`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
        )
        if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`)
        const uploaded = await uploadRes.json()
        attachmentUrls.push(uploaded.url)
      } catch (e) {
        warnings.push(`attachment "${file.name}" failed: ${e.message}`)
      }
    }

    const relationOps = [
      ...buildAttachmentRelationOps(attachmentUrls),
      ...buildLinkRelationOps(links),
    ]
    if (relationOps.length > 0) {
      try {
        const patchRes = await adapter.fetch(
          `_apis/wit/workitems/${created.id}?api-version=7.0`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(relationOps) },
        )
        if (!patchRes.ok) throw new Error(`HTTP ${patchRes.status}`)
      } catch (e) {
        warnings.push(`${relationOps.length} link/attachment relation(s) failed: ${e.message}`)
      }
    }

    return { id: created.id, warnings }
  },
```

- [ ] **Step 2: Delete `CreateWorkItemModal` and update imports/render call**

Delete lines 406-565 (the entire `CreateWorkItemModal` function).

Add near the top of `main.jsx`, with the other local imports:
```js
import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import { buildFieldPatchOps, buildAttachmentRelationOps, buildLinkRelationOps } from './ado-workitem-types.js'
```

Replace line 1146:
```js
<CreateWorkItemModal open={!!createWI} title={createWI?.title} onClose={() => setCreateWI(null)} />
```
with:
```js
<CreateWorkItemDrawer
  open={!!createWI}
  title={createWI?.title}
  project={getAdoConfig().projects || []}
  team={snapshot.TEAM || []}
  onClose={() => setCreateWI(null)}
  onCreate={async (payload) => {
    const result = await desktopWorkItemSource.createWorkItem(payload)
    if (result.warnings.length === 0) {
      setTimeout(() => setCreateWI(null), 600)
    }
    return result
  }}
/>
```

`snapshot` is the `useNexusSnapshot()` result already in scope at this render site inside `App` (`apps/desktop/src/main.jsx:893`) — it holds `{ TEAM, WORK_ITEMS, PRS, BUILDS, TESTS }`.

- [ ] **Step 3: Update the `CreateWorkItemDrawer`'s status text to surface warnings**

```jsx
// in apps/desktop/src/create-work-item-drawer.jsx, update submit()'s try block:
      const result = await onCreate({ project, type: typeRef, fields: fieldValues, attachmentFiles, links })
      if (result.warnings && result.warnings.length > 0) {
        setStatus(`Created #${result.id} — ${result.warnings.length} attachment(s)/link(s) failed: ${result.warnings.join('; ')}`)
      } else {
        setStatus(`Created #${result.id}.`)
      }
```

- [ ] **Step 4: Manual verification**

Run: `cd apps/desktop && npm run dev`
1. Open the app, go to Work Items, click "New work item."
2. Confirm the drawer opens (slides from the right, not a centered modal) and shows Project/Type/Title, then loads real fields for the selected project+type within a couple seconds.
3. Switch Type — confirm the field set changes and a network call fires (check devtools Network tab for `_apis/wit/workitemtypes/.../fields`).
4. Reopen the drawer for the same project+type — confirm no new network call fires (cache hit).
5. Click "Refresh field definitions" — confirm a new network call fires.
6. Fill in Title + Description, attach a small file, add a link to a known work item ID, click Create — confirm the work item appears in ADO with the description, the attachment, and the link.
Expected: all six checks pass.

- [ ] **Step 5: Run the full test suite and commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/main.jsx apps/desktop/src/create-work-item-drawer.jsx
git commit -m "feat(desktop): replace create work item modal with ADO-parity drawer"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (fetch+cache) → Tasks 2-5. Section 2 (layout) → Tasks 9-10. Section 3 (generic renderer) → Task 7. Section 4 (path pickers) → Task 7 (treePath bucket). Section 5 (attachments) → Tasks 10, 12. Section 6 (links) → Tasks 11, 12. Section 7 (submit/validation/signature change) → Tasks 10, 12.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `loadWorkItemTypeDefs`, `fieldBucket`, `fieldGroup`, `LINK_TYPES`, `buildFieldPatchOps`, `buildAttachmentRelationOps`, `buildLinkRelationOps` are defined once in Tasks 2-6 and referenced with identical names/signatures in Tasks 7-12.
