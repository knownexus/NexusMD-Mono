# Jira Work Items — Phase 1 (Desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Electron desktop app load, show, edit, transition and create Jira Cloud issues alongside ADO work items, with a toggle between one merged list/board and separate per-provider tabs.

**Architecture:** All Jira logic is headless in `@nexusmd/core` (`modules/jira/`): config, an HTTP client with retry and error mapping, an HTML→ADF converter, metadata discovery, issue mapping, a loader with its own cache, read/write/transition operations, and create-meta. A new `modules/workitems/` merges the ADO and Jira caches into the one snapshot the views already read, and routes ids (`jira:KEY` vs numeric ADO ids). In `@nexusmd/ui`, an id-routed `workItemSource` sends every existing view write to the right provider, and the Work Items view gains display mode, source tabs, category lanes and status pills. On desktop, Jira HTTP goes through an Electron main-process IPC proxy, because Jira Cloud sends no CORS headers.

**Tech Stack:** JavaScript ES modules, React 18, Vitest (core: node env; ui/desktop: jsdom), @testing-library/react, Electron (CommonJS main process).

**Spec:** `docs/superpowers/specs/2026-10-06-jira-work-items-design.md` — read the "Amendments made during Phase 1 planning" section first; it overrides the body where they conflict.

## Prerequisite

`docs/superpowers/plans/2026-08-26-ado-dynamic-metadata.md` (Phase 0) must be fully merged before Task 1. This plan relies on:
- ADO items carrying `adoStateCategory`.
- `loadAdoData` returning `TYPES`, `PRIORITIES`, `WI_TYPE_STATES` and `_adoMeta` (`{ typeStates, stateCategoryByName, ... }`).
- `isTerminalState(state, category?)` and `stateCategory(state, category?)` accepting an optional second argument.
- `view-workitems.jsx` sourcing `wiTypeStates` from `NexusMDData.WI_TYPE_STATES`.

Check before starting: `grep -n "adoStateCategory" packages/core/src/modules/ado/mappers.js` must print a line. If it doesn't, stop and run Phase 0 first.

## Global Constraints

- Jira Cloud only: site URL `https://<site>.atlassian.net`; auth `Authorization: Basic base64(email:apiToken)`.
- REST paths are relative to the site root: `rest/api/3/...`. Issue search uses `POST rest/api/3/search/jql`, paging on `nextPageToken`.
- Jira cache key: `nexusmd.jira.cache.v1`; discard it when its stored `SITE` differs from config.
- Status category mapping: `new` → `Proposed`, `indeterminate` → `InProgress`, `done` → `Completed`.
- HTTP 429: retry once after `Retry-After` seconds, capped at 10 s, then fail.
- Jira error text shown to users: Jira's `errorMessages` / `errors` content, first 200 characters.
- Jira ids are `jira:<KEY>`; ADO ids stay numeric and unchanged (spec amendment 1).
- New core code is headless: no `window`, `document`, `localStorage` or `fetch` — only injected `http` / `storage` adapters.
- Desktop stores Jira settings in localStorage under `getProfileKey('jira.<name>')`, plain strings, like `ado.*`.
- Profiles that never configure Jira must see no behaviour change; web (`apps/web`) and Android (`apps/app`) are not modified.
- Follow existing style: core uses no semicolons; `packages/ui` view files use semicolons; desktop `.jsx` uses no semicolons; Electron `.cjs` uses `'use strict'` and semicolons.

## Review Focus

Inputs the spec implies but doesn't spell out. Each has a test in the owning task.

1. **Jira issues with missing fields** (unassigned, no priority, no sprint, no story points, unknown status category) must map without throwing, using the same defaults ADO uses. Test: Task 6.
2. **Free-text JQL containing `OR`** must not widen the query beyond the configured projects. Test: Task 7 (user JQL is wrapped in parentheses).
3. **Tags with spaces, edited through the ADO-style tag editor**, must not make Jira reject the update (Jira labels can't contain spaces). Test: Task 8 (spaces become hyphens).
4. **A person who exists in both ADO and Jira under the same display name** must appear once in the team list, not twice. Test: Task 10.
5. **Project keys typed in lowercase or with stray spaces/commas, and a site entered as a full URL with a path**, must still produce valid requests. Test: Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/modules/workitems/ids.js` (new) | `jira:` id prefix helpers, `displayIdOf` |
| `packages/core/src/modules/workitems/categories.js` (new) | Category lanes, `itemCategory`, ADO state for a category |
| `packages/core/src/modules/workitems/status.js` (new) | Persisted per-provider load status |
| `packages/core/src/modules/workitems/merge.js` (new) | Merge ADO + Jira caches into snapshot fields; team merge |
| `packages/core/src/modules/workitems/index.js` (new) | Barrel |
| `packages/core/src/modules/jira/config.js` (new) | `normaliseSite`, `makeJiraConfig` |
| `packages/core/src/modules/jira/client.js` (new) | `makeJiraClient`, `JiraError`, `jiraErrorMessage` |
| `packages/core/src/modules/jira/adf.js` (new) | `htmlToAdf` |
| `packages/core/src/modules/jira/metadata.js` (new) | Types/statuses/priorities/fields/people discovery |
| `packages/core/src/modules/jira/mappers.js` (new) | `mapJiraIssue` |
| `packages/core/src/modules/jira/loader.js` (new) | JQL, paging, `loadJiraData`, cache |
| `packages/core/src/modules/jira/issues.js` (new) | Detail, comments, raw fields, updates, transitions, ADO-field translation |
| `packages/core/src/modules/jira/create.js` (new) | Create-meta, payload, create with attachments/links |
| `packages/core/src/modules/jira/index.js` (new) | Barrel |
| `packages/core/src/index.js` | Re-export `workitems` and `jira` barrels |
| `packages/core/src/modules/digest/index.js`, `team/index.js` | Use `stateCategory` when classifying terminal states |
| `packages/ui/src/views/view-dashboard.jsx` | Same, for unassigned/assigned counts |
| `packages/ui/src/views/work-item-source.js` | `createRoutedWorkItemSource` |
| `packages/ui/src/views/view-workitems.jsx` | `patchWorkItem` returns success; display mode, source tabs, status pills, id links, category lanes, Jira lane dimming, revert on failure, bulk mark-done |
| `packages/ui/src/views/work-item-detail.jsx` | Fields editor uses per-source states/priorities/people; hides Area for Jira |
| `packages/ui/src/index.js` | Export `createRoutedWorkItemSource`, `WorkItemIdLink` |
| `apps/desktop/electron/ipc/jira.cjs` (new) | `jira:request` main-process proxy |
| `apps/desktop/electron/main.cjs`, `preload.cjs` | Register / expose the proxy |
| `apps/desktop/src/jira-client.js` (new) | Desktop Jira config, HTTP adapter over IPC, Jira `workItemSource` |
| `apps/desktop/src/jira-settings.jsx` (new) | `JiraConnectionCard`, `WorkItemsDisplayCard` |
| `apps/desktop/src/desktop-settings.jsx` | Render the two new cards |
| `apps/desktop/src/work-item-data.js` (new) | `buildSnapshot`, `refreshProviders`, `defaultCreateProvider` |
| `apps/desktop/src/main.jsx` | Wire refresh, snapshot, routed source, drawer links, create drawer |
| `apps/desktop/src/jira-create-form.jsx` (new) | Generic Jira create form |
| `apps/desktop/src/create-work-item-drawer.jsx` | Provider switch; render Jira form |

---

### Task 1: Work-item ids and state categories

**Files:**
- Create: `packages/core/src/modules/workitems/ids.js`
- Create: `packages/core/src/modules/workitems/categories.js`
- Test: `packages/core/tests/workitems/ids.test.js`
- Test: `packages/core/tests/workitems/categories.test.js`

**Interfaces:**
- Consumes: `adoTypeToHelm(name)`, `stateCategory(state)` from `../ado/helpers.js` (1-arg form returns `'todo'|'active'|'review'|'blocked'|'done'`).
- Produces:
  - `JIRA_ID_PREFIX = 'jira:'`
  - `isJiraId(id) → boolean`
  - `toJiraId(key) → string`
  - `jiraKeyFromId(id) → string|null`
  - `sourceOfId(id) → 'jira'|'ado'`
  - `displayIdOf(item) → string` (`item.displayId`, else `KEY` for Jira or `#123` for ADO)
  - `CATEGORY_LANES = ['Proposed','InProgress','Resolved','Completed']`
  - `CATEGORY_LABELS = { Proposed:'Proposed', InProgress:'In Progress', Resolved:'Resolved', Completed:'Completed' }`
  - `itemCategory(item) → one of CATEGORY_LANES`
  - `adoStateForCategory(item, category, { typeStates, stateCategoryByName }) → string|null`

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/tests/workitems/ids.test.js
import { describe, it, expect } from 'vitest'
import {
  JIRA_ID_PREFIX, isJiraId, toJiraId, jiraKeyFromId, sourceOfId, displayIdOf,
} from '../../src/modules/workitems/ids.js'

describe('work item ids', () => {
  it('prefixes Jira keys and recognises them', () => {
    expect(JIRA_ID_PREFIX).toBe('jira:')
    expect(toJiraId('ABC-12')).toBe('jira:ABC-12')
    expect(isJiraId('jira:ABC-12')).toBe(true)
    expect(jiraKeyFromId('jira:ABC-12')).toBe('ABC-12')
  })
  it('treats numeric and other ids as ADO', () => {
    expect(isJiraId(123)).toBe(false)
    expect(isJiraId('123')).toBe(false)
    expect(jiraKeyFromId(123)).toBeNull()
    expect(sourceOfId(123)).toBe('ado')
    expect(sourceOfId('jira:X-1')).toBe('jira')
  })
  it('derives a display id', () => {
    expect(displayIdOf({ id: 42 })).toBe('#42')
    expect(displayIdOf({ id: 'jira:ABC-1' })).toBe('ABC-1')
    expect(displayIdOf({ id: 42, displayId: 'custom' })).toBe('custom')
    expect(displayIdOf(null)).toBe('')
  })
})
```

```js
// packages/core/tests/workitems/categories.test.js
import { describe, it, expect } from 'vitest'
import {
  CATEGORY_LANES, CATEGORY_LABELS, itemCategory, adoStateForCategory,
} from '../../src/modules/workitems/categories.js'

describe('itemCategory', () => {
  it('uses the item stateCategory when it is a lane', () => {
    expect(itemCategory({ state: 'Shipped', stateCategory: 'Completed' })).toBe('Completed')
    expect(itemCategory({ state: 'QA', stateCategory: 'InProgress' })).toBe('InProgress')
    expect(itemCategory({ state: 'Verified', stateCategory: 'Resolved' })).toBe('Resolved')
  })
  it('folds Removed into Completed', () => {
    expect(itemCategory({ state: 'Cut', stateCategory: 'Removed' })).toBe('Completed')
  })
  it('falls back to the state-name regex when no category is known', () => {
    expect(itemCategory({ state: 'Done' })).toBe('Completed')
    expect(itemCategory({ state: 'New' })).toBe('Proposed')
    expect(itemCategory({ state: 'Active' })).toBe('InProgress')
    expect(itemCategory({ state: 'Blocked' })).toBe('InProgress')
  })
  it('exposes lanes in board order with labels', () => {
    expect(CATEGORY_LANES).toEqual(['Proposed', 'InProgress', 'Resolved', 'Completed'])
    expect(CATEGORY_LABELS.InProgress).toBe('In Progress')
  })
})

describe('adoStateForCategory', () => {
  const meta = {
    typeStates: { 'User Story': ['New', 'Active', 'Resolved', 'Closed'], Bug: ['New', 'Committed', 'Done'] },
    stateCategoryByName: { New: 'Proposed', Active: 'InProgress', Committed: 'InProgress', Resolved: 'Resolved', Closed: 'Completed', Done: 'Completed' },
  }
  it('picks the first state of the item type in that category', () => {
    expect(adoStateForCategory({ type: 'story' }, 'Completed', meta)).toBe('Closed')
    expect(adoStateForCategory({ type: 'bug' }, 'InProgress', meta)).toBe('Committed')
  })
  it('falls back to any state in that category when the type is unknown', () => {
    expect(adoStateForCategory({ type: 'mystery' }, 'Proposed', meta)).toBe('New')
  })
  it('returns null when nothing matches or metadata is missing', () => {
    expect(adoStateForCategory({ type: 'bug' }, 'Resolved', meta)).toBeNull()
    expect(adoStateForCategory({ type: 'bug' }, 'Completed', {})).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- tests/workitems`
Expected: FAIL — `Cannot find module '../../src/modules/workitems/ids.js'`

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/workitems/ids.js
// Jira items carry string ids prefixed "jira:"; ADO items keep their numeric ids
// (seen-tracking, acknowledged sets and PR links are keyed by them).

export const JIRA_ID_PREFIX = 'jira:'

export const isJiraId = (id) => typeof id === 'string' && id.startsWith(JIRA_ID_PREFIX)
export const toJiraId = (key) => JIRA_ID_PREFIX + key
export const jiraKeyFromId = (id) => (isJiraId(id) ? id.slice(JIRA_ID_PREFIX.length) : null)
export const sourceOfId = (id) => (isJiraId(id) ? 'jira' : 'ado')

export function displayIdOf(item) {
  if (!item) return ''
  if (item.displayId) return item.displayId
  return isJiraId(item.id) ? jiraKeyFromId(item.id) : `#${item.id}`
}
```

```js
// packages/core/src/modules/workitems/categories.js
// State categories shared by ADO and Jira, used for the merged board's columns.
import { adoTypeToHelm, stateCategory as bucketOf } from '../ado/helpers.js'

export const CATEGORY_LANES = ['Proposed', 'InProgress', 'Resolved', 'Completed']
export const CATEGORY_LABELS = {
  Proposed: 'Proposed', InProgress: 'In Progress', Resolved: 'Resolved', Completed: 'Completed',
}

export function itemCategory(item) {
  const c = item?.stateCategory
  if (c === 'Removed') return 'Completed'
  if (CATEGORY_LANES.includes(c)) return c
  const bucket = bucketOf(item?.state)
  if (bucket === 'done') return 'Completed'
  if (bucket === 'todo') return 'Proposed'
  return 'InProgress'
}

// First state (in the type's workflow order) whose ADO category matches.
export function adoStateForCategory(item, category, { typeStates = {}, stateCategoryByName = {} } = {}) {
  const typeName = Object.keys(typeStates).find(t => adoTypeToHelm(t) === item?.type)
  const candidates = typeName ? typeStates[typeName] : Object.keys(stateCategoryByName)
  return candidates.find(s => stateCategoryByName[s] === category) || null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/core test -- tests/workitems`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/workitems packages/core/tests/workitems
git commit -m "feat(core): work-item id routing and shared state categories"
```

---

### Task 2: Jira config

**Files:**
- Create: `packages/core/src/modules/jira/config.js`
- Test: `packages/core/tests/jira/config.test.js`

**Interfaces:**
- Consumes: an injected `{ get(k): string|null, set(k, v: string) }` storage and `key(name) → string`.
- Produces:
  - `normaliseSite(input) → 'https://<host>'` or `''`
  - `makeJiraConfig({ storage, key }) → { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive }`
  - `getJiraConfig() → { site, email, apiToken, projectKeys: string[], jql, enabled: boolean, refreshSecs: number }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/config.test.js
import { describe, it, expect } from 'vitest'
import { normaliseSite, makeJiraConfig } from '../../src/modules/jira/config.js'

function memStorage() {
  const m = new Map()
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), _m: m }
}

describe('normaliseSite', () => {
  it('expands a bare site name', () => expect(normaliseSite('acme')).toBe('https://acme.atlassian.net'))
  it('strips scheme, path, whitespace and case', () => {
    expect(normaliseSite('  HTTPS://Acme.atlassian.net/jira/software/projects  ')).toBe('https://acme.atlassian.net')
  })
  it('keeps a full host', () => expect(normaliseSite('acme.atlassian.net')).toBe('https://acme.atlassian.net'))
  it('returns empty for empty input', () => expect(normaliseSite('')).toBe(''))
})

describe('makeJiraConfig', () => {
  it('requires storage and key', () => {
    expect(() => makeJiraConfig({})).toThrow('makeJiraConfig requires { storage, key }')
  })

  it('round-trips values through namespaced keys', () => {
    const storage = memStorage()
    const cfg = makeJiraConfig({ storage, key: n => `p1.jira.${n}` })
    cfg.saveJiraConfig({ site: 'acme', email: ' me@acme.io ', apiToken: 'tok', projectKeys: ['abc'], jql: 'labels = x' })
    expect(storage._m.get('p1.jira.site')).toBe('https://acme.atlassian.net')
    expect(cfg.getJiraConfig()).toEqual({
      site: 'https://acme.atlassian.net', email: 'me@acme.io', apiToken: 'tok',
      projectKeys: ['ABC'], jql: 'labels = x', enabled: true, refreshSecs: 60,
    })
  })

  it('normalises project keys typed in lowercase, with spaces or blanks', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    cfg.saveJiraConfig({ projectKeys: [' abc ', '', 'Def'] })
    expect(cfg.getJiraConfig().projectKeys).toEqual(['ABC', 'DEF'])
  })

  it('reports configured only with site, email, token and a project', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    expect(cfg.isJiraConfigured()).toBe(false)
    cfg.saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['A'] })
    expect(cfg.isJiraConfigured()).toBe(true)
  })

  it('isJiraActive also respects the enabled toggle', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    cfg.saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['A'], enabled: false })
    expect(cfg.isJiraConfigured()).toBe(true)
    expect(cfg.isJiraActive()).toBe(false)
  })

  it('tolerates corrupt projectKeys JSON', () => {
    const storage = memStorage()
    storage.set('projectKeys', '{nope')
    expect(makeJiraConfig({ storage, key: n => n }).getJiraConfig().projectKeys).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/config`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/config.js — read/write the local Jira Cloud connection.
// Mirrors ado/config.js: storage and key naming are injected per platform.

export function normaliseSite(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  let host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  if (!host.includes('.')) host = `${host}.atlassian.net`
  return `https://${host}`
}

const normaliseKeys = (keys) => keys.map(k => String(k).trim().toUpperCase()).filter(Boolean)

export function makeJiraConfig({ storage, key }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeJiraConfig requires { storage, key }')
  }
  const get = (name) => storage.get(key(name))

  function getJiraConfig() {
    let projectKeys = []
    try { projectKeys = JSON.parse(get('projectKeys') || '[]') } catch { /* ignore */ }
    return {
      site:        get('site')     || '',
      email:       get('email')    || '',
      apiToken:    get('apiToken') || '',
      projectKeys: Array.isArray(projectKeys) ? projectKeys : [],
      jql:         get('jql')      || '',
      enabled:     get('enabled') !== '0',
      refreshSecs: parseInt(get('refreshSecs') || '60', 10),
    }
  }

  function saveJiraConfig(values = {}) {
    const set = (name, v) => storage.set(key(name), v)
    if (values.site        !== undefined) set('site',        normaliseSite(values.site))
    if (values.email       !== undefined) set('email',       String(values.email).trim())
    if (values.apiToken    !== undefined) set('apiToken',    values.apiToken)
    if (values.projectKeys !== undefined) set('projectKeys', JSON.stringify(normaliseKeys(values.projectKeys)))
    if (values.jql         !== undefined) set('jql',         values.jql)
    if (values.enabled     !== undefined) set('enabled',     values.enabled ? '1' : '0')
    if (values.refreshSecs !== undefined) set('refreshSecs', String(values.refreshSecs))
  }

  function isJiraConfigured() {
    const c = getJiraConfig()
    return !!(c.site && c.email && c.apiToken && c.projectKeys.length > 0)
  }

  const isJiraActive = () => isJiraConfigured() && getJiraConfig().enabled

  return { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/config`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/config.js packages/core/tests/jira/config.test.js
git commit -m "feat(core): Jira Cloud connection config"
```

---

### Task 3: Jira HTTP client

**Files:**
- Create: `packages/core/src/modules/jira/client.js`
- Test: `packages/core/tests/jira/client.test.js`

**Interfaces:**
- Consumes: an `http` adapter `{ fetch(path, opts) → Promise<Response-like> }`, where Response-like is `{ ok, status, headers: { get(name) }, text(), json() }`. `opts` may include `{ method, headers, body, attachment }`.
- Produces:
  - `makeJiraClient(http, { sleep? }) → { send(path, opts), get(path), post(path, body), put(path, body) }`. Each returns parsed JSON, or `null` for an empty or 204 body. Failures throw `JiraError`.
  - `class JiraError extends Error { status, path }`
  - `jiraErrorMessage(status, body) → string` (≤ 200 chars)

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/client.test.js
import { describe, it, expect, vi } from 'vitest'
import { makeJiraClient, JiraError, jiraErrorMessage } from '../../src/modules/jira/client.js'

function res(status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: n => headers[n.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  }
}

describe('makeJiraClient', () => {
  it('GETs and parses JSON', async () => {
    const http = { fetch: vi.fn(async () => res(200, { a: 1 })) }
    const c = makeJiraClient(http)
    expect(await c.get('rest/api/3/myself')).toEqual({ a: 1 })
    expect(http.fetch).toHaveBeenCalledWith('rest/api/3/myself', { method: 'GET' })
  })

  it('POSTs and PUTs JSON bodies with a content type', async () => {
    const http = { fetch: vi.fn(async () => res(204)) }
    const c = makeJiraClient(http)
    expect(await c.put('rest/api/3/issue/A-1', { fields: {} })).toBeNull()
    expect(http.fetch).toHaveBeenCalledWith('rest/api/3/issue/A-1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"fields":{}}',
    })
  })

  it('retries a 429 exactly once, honouring Retry-After capped at 10s', async () => {
    const sleep = vi.fn(async () => {})
    const http = { fetch: vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '30' }))
      .mockResolvedValueOnce(res(200, { ok: true })) }
    const c = makeJiraClient(http, { sleep })
    expect(await c.get('x')).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(10_000)
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('fails after a second 429', async () => {
    const http = { fetch: vi.fn(async () => res(429, {}, { 'retry-after': '1' })) }
    const c = makeJiraClient(http, { sleep: async () => {} })
    await expect(c.get('x')).rejects.toMatchObject({ status: 429 })
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws JiraError with Jira error text', async () => {
    const http = { fetch: vi.fn(async () => res(400, { errorMessages: ['Bad JQL'], errors: { summary: 'required' } })) }
    const err = await makeJiraClient(http).get('x').catch(e => e)
    expect(err).toBeInstanceOf(JiraError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('Bad JQL; summary: required')
  })

  it('requires an http adapter', () => {
    expect(() => makeJiraClient(null)).toThrow('makeJiraClient: http adapter is required')
  })
})

describe('jiraErrorMessage', () => {
  it('explains auth failures', () => {
    expect(jiraErrorMessage(401, null)).toMatch(/credentials/)
    expect(jiraErrorMessage(403, {})).toMatch(/permission/)
  })
  it('truncates to 200 characters', () => {
    expect(jiraErrorMessage(400, { errorMessages: ['x'.repeat(500)] })).toHaveLength(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/client`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/client.js — thin JSON client over an injected http adapter.

export class JiraError extends Error {
  constructor(message, { status = 0, path = '' } = {}) {
    super(message)
    this.name = 'JiraError'
    this.status = status
    this.path = path
  }
}

export function jiraErrorMessage(status, body) {
  const msgs = [
    ...(body?.errorMessages || []),
    ...Object.entries(body?.errors || {}).map(([k, v]) => `${k}: ${v}`),
  ]
  if (msgs.length) return msgs.join('; ').slice(0, 200)
  if (status === 401) return 'Jira rejected the credentials (401) — check the email and API token in Settings'
  if (status === 403) return 'Jira denied access (403) — check the account has permission for these projects'
  if (status === 404) return 'Not found in Jira (404)'
  if (status === 429) return 'Jira rate limit hit (429) — try again shortly'
  return `Jira request failed (${status})`
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function makeJiraClient(http, { sleep = defaultSleep } = {}) {
  if (!http?.fetch) throw new Error('makeJiraClient: http adapter is required')

  async function send(path, opts = {}) {
    let res = await http.fetch(path, opts)
    if (res.status === 429) {
      const ra = parseInt(res.headers?.get?.('retry-after') || '1', 10)
      await sleep(Math.min(Number.isFinite(ra) ? ra : 1, 10) * 1000)
      res = await http.fetch(path, opts)
    }
    if (!res.ok) {
      let body = null
      try { body = await res.json() } catch { /* non-JSON error body */ }
      throw new JiraError(jiraErrorMessage(res.status, body), { status: res.status, path })
    }
    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  const withJson = (method) => (path, body) => send(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  return {
    send,
    get: (path) => send(path, { method: 'GET' }),
    post: withJson('POST'),
    put: withJson('PUT'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/client.js packages/core/tests/jira/client.test.js
git commit -m "feat(core): Jira HTTP client with 429 retry and error mapping"
```

---

### Task 4: HTML → ADF converter

**Files:**
- Create: `packages/core/src/modules/jira/adf.js`
- Test: `packages/core/tests/jira/adf.test.js`

**Interfaces:**
- Consumes: nothing (pure; no DOM — core tests run in node).
- Produces: `htmlToAdf(html: string) → { type: 'doc', version: 1, content: AdfNode[] }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/adf.test.js
import { describe, it, expect } from 'vitest'
import { htmlToAdf } from '../../src/modules/jira/adf.js'

const doc = (...content) => ({ type: 'doc', version: 1, content })
const p = (...content) => ({ type: 'paragraph', content })
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })

describe('htmlToAdf', () => {
  it('returns an empty doc for empty input', () => {
    expect(htmlToAdf('')).toEqual(doc())
    expect(htmlToAdf(null)).toEqual(doc())
  })

  it('converts paragraphs and trims edge whitespace', () => {
    expect(htmlToAdf('<p> Hello </p><p>World</p>')).toEqual(doc(p(t('Hello')), p(t('World'))))
  })

  it('converts headings with their level', () => {
    expect(htmlToAdf('<h2>Title</h2>')).toEqual(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Title')] }))
  })

  it('applies inline marks, nesting them', () => {
    expect(htmlToAdf('<p><strong>a <em>b</em></strong> <u>c</u> <s>d</s></p>')).toEqual(doc(p(
      t('a ', [{ type: 'strong' }]),
      t('b', [{ type: 'strong' }, { type: 'em' }]),
      t(' '),
      t('c', [{ type: 'underline' }]),
      t(' '),
      t('d', [{ type: 'strike' }]),
    )))
  })

  it('keeps only link alongside code marks (ADF rule)', () => {
    expect(htmlToAdf('<p><strong><code>x</code></strong></p>')).toEqual(doc(p(t('x', [{ type: 'code' }]))))
  })

  it('converts links', () => {
    expect(htmlToAdf('<p><a href="https://x.io">site</a></p>'))
      .toEqual(doc(p(t('site', [{ type: 'link', attrs: { href: 'https://x.io' } }]))))
  })

  it('converts line breaks to hardBreak', () => {
    expect(htmlToAdf('<p>a<br>b<br/>c</p>')).toEqual(doc(p(t('a'), { type: 'hardBreak' }, t('b'), { type: 'hardBreak' }, t('c'))))
  })

  it('converts nested lists', () => {
    expect(htmlToAdf('<ul><li>one<ol><li>two</li></ol></li></ul>')).toEqual(doc({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          p(t('one')),
          { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('two'))] }] },
        ],
      }],
    }))
  })

  it('converts code blocks preserving whitespace', () => {
    expect(htmlToAdf('<pre><code>a\n  b</code></pre>')).toEqual(doc({ type: 'codeBlock', content: [t('a\n  b')] }))
  })

  it('decodes entities', () => {
    expect(htmlToAdf('<p>a &amp; b &lt;c&gt; &#39;d&#39;</p>')).toEqual(doc(p(t("a & b <c> 'd'"))))
  })

  it('reduces unsupported elements to their text', () => {
    expect(htmlToAdf('<p><span style="color:red">red</span> <img src="x"></p><table><tr><td>cell</td></tr></table>'))
      .toEqual(doc(p(t('red')), p(t('cell'))))
  })

  it('wraps loose text in a paragraph', () => {
    expect(htmlToAdf('<div>loose <b>bold</b></div>')).toEqual(doc(p(t('loose '), t('bold', [{ type: 'strong' }]))))
  })

  it('treats tag-free input as plain text with paragraphs and line breaks', () => {
    expect(htmlToAdf('line 1\nline 2\n\npara 2')).toEqual(doc(
      p(t('line 1'), { type: 'hardBreak' }, t('line 2')),
      p(t('para 2')),
    ))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/adf`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/adf.js — minimal HTML → Atlassian Document Format.
// Covers what mdToHtml and the rich-text editors emit. Unsupported elements are
// reduced to their text rather than rejected. No DOM: core runs headless.

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const MARKS = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'underline', s: 'strike', strike: 'strike', del: 'strike', code: 'code' }
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr'])
const LIST_CHILD_TYPES = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock'])

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g
  let m
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1]
    if (m[4] !== undefined) { top.children.push({ text: decode(m[4]) }); continue }
    if (!m[2]) continue // comment
    const tag = m[2].toLowerCase()
    if (m[1] === '/') {
      const idx = stack.map(n => n.tag).lastIndexOf(tag)
      if (idx > 0) stack.length = idx
      continue
    }
    const attrs = {}
    m[3].replace(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, a, b, c) => {
      attrs[k.toLowerCase()] = decode(a ?? b ?? c ?? '')
      return ''
    })
    const node = { tag, attrs, children: [] }
    top.children.push(node)
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(node)
  }
  return root
}

function addMark(marks, mark) {
  if (marks.some(x => x.type === mark.type)) return marks
  if (mark.type === 'code') return [...marks.filter(x => x.type === 'link'), mark]
  if (marks.some(x => x.type === 'code') && mark.type !== 'link') return marks
  return [...marks, mark]
}

function inline(nodes, marks = []) {
  const out = []
  for (const n of nodes) {
    if (n.text !== undefined) {
      const text = n.text.replace(/\s+/g, ' ')
      if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
    } else if (n.tag === 'br') {
      out.push({ type: 'hardBreak' })
    } else if (MARKS[n.tag]) {
      out.push(...inline(n.children, addMark(marks, { type: MARKS[n.tag] })))
    } else if (n.tag === 'a' && n.attrs.href) {
      out.push(...inline(n.children, addMark(marks, { type: 'link', attrs: { href: n.attrs.href } })))
    } else {
      out.push(...inline(n.children, marks))
    }
  }
  return out
}

// Trim leading/trailing whitespace of a block's inline run and drop empties.
function tidy(content) {
  const out = content.map(n => ({ ...n }))
  const first = out.find(n => n.type === 'text')
  if (first && out[0] === first) first.text = first.text.replace(/^\s+/, '')
  const last = [...out].reverse().find(n => n.type === 'text')
  if (last && out[out.length - 1] === last) last.text = last.text.replace(/\s+$/, '')
  return out.filter(n => n.type !== 'text' || n.text)
}

function textOf(n) {
  if (n.text !== undefined) return n.text
  if (n.tag === 'br') return '\n'
  return n.children.map(textOf).join('')
}

const paragraph = (content) => (content.length ? [{ type: 'paragraph', content }] : [])

function list(n) {
  const items = n.children.filter(c => c.tag === 'li').map(li => {
    const content = blocks(li.children).filter(b => LIST_CHILD_TYPES.has(b.type))
    return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] }
  })
  return items.length ? { type: n.tag === 'ol' ? 'orderedList' : 'bulletList', content: items } : null
}

function block(n) {
  switch (n.tag) {
    case 'p': return paragraph(tidy(inline(n.children)))
    case 'div': return blocks(n.children)
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const content = tidy(inline(n.children))
      return content.length ? [{ type: 'heading', attrs: { level: Number(n.tag[1]) }, content }] : []
    }
    case 'ul': case 'ol': { const l = list(n); return l ? [l] : [] }
    case 'li': { const l = list({ tag: 'ul', children: [n] }); return l ? [l] : [] }
    case 'pre': {
      const text = textOf(n).replace(/^\n/, '')
      return [text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' }]
    }
    case 'blockquote': {
      const inner = blocks(n.children).filter(b => LIST_CHILD_TYPES.has(b.type))
      return inner.length ? [{ type: 'blockquote', content: inner }] : []
    }
    case 'hr': return [{ type: 'rule' }]
    default: return paragraph(tidy(inline([{ text: textOf(n) }])))
  }
}

function blocks(nodes) {
  const out = []
  let pending = []
  const flush = () => { out.push(...paragraph(tidy(inline(pending)))); pending = [] }
  for (const n of nodes) {
    if (n.text !== undefined || !BLOCK.has(n.tag)) { pending.push(n); continue }
    flush()
    out.push(...block(n))
  }
  flush()
  return out
}

function plainTextToAdf(text) {
  const content = text.split(/\n{2,}/).map(par => par.trim()).filter(Boolean).map(par => {
    const parts = []
    par.split('\n').forEach((line, i) => {
      if (i > 0) parts.push({ type: 'hardBreak' })
      if (line) parts.push({ type: 'text', text: line })
    })
    return { type: 'paragraph', content: parts }
  })
  return { type: 'doc', version: 1, content }
}

export function htmlToAdf(html) {
  const s = String(html ?? '')
  if (!/<[a-z!/]/i.test(s)) return plainTextToAdf(s)
  return { type: 'doc', version: 1, content: blocks(parse(s).children) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/adf`
Expected: PASS. If the mark-nesting test fails on whitespace between elements, check `tidy` only trims the first and last text nodes of a block, not inner ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/adf.js packages/core/tests/jira/adf.test.js
git commit -m "feat(core): HTML to Atlassian Document Format converter"
```

---

### Task 5: Jira metadata discovery

**Files:**
- Create: `packages/core/src/modules/jira/metadata.js`
- Test: `packages/core/tests/jira/metadata.test.js`

**Interfaces:**
- Consumes: a `client` from `makeJiraClient` (`get(path)`).
- Produces:
  - `JIRA_CATEGORY_MAP = { new:'Proposed', indeterminate:'InProgress', done:'Completed' }`
  - `categoryOfJiraStatus(status) → 'Proposed'|'InProgress'|'Completed'` (reads `status.statusCategory.key`; unknown → `'Proposed'`)
  - `toPerson(user) → { accountId, displayName, avatarUrl }`
  - `discoverFieldIds(fields) → { storyPoints, sprint, acceptanceCriteria, reproSteps }` (ids or `null`)
  - `emptyJiraMeta() → JiraMeta`
  - `fetchJiraMetadata(client, projectKeys) → Promise<JiraMeta>`
  - `fillMetadataFromIssues(meta, issues) → JiraMeta`
  - `JiraMeta = { types: string[], typeStates: {[typeName]: string[]}, stateCategoryByName: {[state]: category}, states: string[], priorities: [{ id, name, rank }], fieldIds, me: { accountId, displayName, email }|null, people: Person[] }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/metadata.test.js
import { describe, it, expect } from 'vitest'
import {
  categoryOfJiraStatus, discoverFieldIds, fetchJiraMetadata, fillMetadataFromIssues, emptyJiraMeta,
} from '../../src/modules/jira/metadata.js'

function makeClient(routes) {
  return {
    get: async (path) => {
      for (const [pattern, data] of Object.entries(routes)) {
        if (path.includes(pattern)) {
          if (data instanceof Error) throw data
          return data
        }
      }
      throw new Error(`unexpected ${path}`)
    },
  }
}

const STATUSES = [
  { id: '1', name: 'Story', statuses: [
    { name: 'To Do', statusCategory: { key: 'new' } },
    { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    { name: 'Done', statusCategory: { key: 'done' } },
  ] },
  { id: '2', name: 'Bug', statuses: [
    { name: 'Open', statusCategory: { key: 'new' } },
    { name: 'Done', statusCategory: { key: 'done' } },
  ] },
]
const FIELDS = [
  { id: 'customfield_10016', name: 'Story point estimate', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:jsw-story-points' } },
  { id: 'customfield_10028', name: 'Story Points' },
  { id: 'customfield_10020', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10040', name: 'Acceptance Criteria' },
]

describe('categoryOfJiraStatus', () => {
  it('maps Jira status categories', () => {
    expect(categoryOfJiraStatus({ statusCategory: { key: 'new' } })).toBe('Proposed')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'indeterminate' } })).toBe('InProgress')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'done' } })).toBe('Completed')
    expect(categoryOfJiraStatus({ statusCategory: { key: 'undefined' } })).toBe('Proposed')
    expect(categoryOfJiraStatus(null)).toBe('Proposed')
  })
})

describe('discoverFieldIds', () => {
  it('prefers "Story point estimate" and finds sprint by schema', () => {
    expect(discoverFieldIds(FIELDS)).toEqual({
      storyPoints: 'customfield_10016', sprint: 'customfield_10020',
      acceptanceCriteria: 'customfield_10040', reproSteps: null,
    })
  })
  it('returns nulls for an empty list', () => {
    expect(discoverFieldIds([])).toEqual({ storyPoints: null, sprint: null, acceptanceCriteria: null, reproSteps: null })
  })
})

describe('fetchJiraMetadata', () => {
  const routes = {
    'project/ABC/statuses': STATUSES,
    'rest/api/3/priority': [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }],
    'rest/api/3/field': FIELDS,
    'rest/api/3/myself': { accountId: 'me-1', displayName: 'Me Person', emailAddress: 'me@x.io' },
    'multiProjectSearch': [
      { accountId: 'u1', displayName: 'Alex Doe', avatarUrls: { '48x48': 'a.png' }, active: true },
      { accountId: 'bot', displayName: 'Automation', accountType: 'app', active: true },
      { accountId: 'gone', displayName: 'Former', active: false },
    ],
  }

  it('collects types, per-type states, categories, priorities, fields, me and people', async () => {
    const meta = await fetchJiraMetadata(makeClient(routes), ['ABC'])
    expect(meta.types).toEqual(['Bug', 'Story'])
    expect(meta.typeStates.Story).toEqual(['To Do', 'In Progress', 'Done'])
    expect(meta.stateCategoryByName).toEqual({ 'To Do': 'Proposed', 'In Progress': 'InProgress', Done: 'Completed', Open: 'Proposed' })
    expect(meta.states).toEqual(['Done', 'In Progress', 'Open', 'To Do'])
    expect(meta.priorities).toEqual([
      { id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }, { id: '3', name: 'Medium', rank: 3 },
    ])
    expect(meta.fieldIds.storyPoints).toBe('customfield_10016')
    expect(meta.me).toEqual({ accountId: 'me-1', displayName: 'Me Person', email: 'me@x.io' })
    expect(meta.people).toEqual([{ accountId: 'u1', displayName: 'Alex Doe', avatarUrl: 'a.png' }])
  })

  it('fails soft on every call', async () => {
    const meta = await fetchJiraMetadata(makeClient({}), ['ABC'])
    expect(meta).toEqual(emptyJiraMeta())
  })

  it('accepts a paged priority response', async () => {
    const meta = await fetchJiraMetadata(makeClient({ ...routes, 'rest/api/3/priority': { values: [{ id: '9', name: 'Only' }] } }), ['ABC'])
    expect(meta.priorities).toEqual([{ id: '9', name: 'Only', rank: 1 }])
  })
})

describe('fillMetadataFromIssues', () => {
  it('derives types and statuses from loaded issues when status metadata failed', () => {
    const issues = [
      { fields: { issuetype: { name: 'Task' }, status: { name: 'Doing', statusCategory: { key: 'indeterminate' } } } },
      { fields: { issuetype: { name: 'Task' }, status: { name: 'Backlog', statusCategory: { key: 'new' } } } },
    ]
    const meta = fillMetadataFromIssues(emptyJiraMeta(), issues)
    expect(meta.types).toEqual(['Task'])
    expect(meta.typeStates.Task).toEqual(['Doing', 'Backlog'])
    expect(meta.stateCategoryByName.Doing).toBe('InProgress')
  })
  it('leaves existing metadata untouched', () => {
    const meta = { ...emptyJiraMeta(), types: ['Story'] }
    expect(fillMetadataFromIssues(meta, [{ fields: { issuetype: { name: 'Bug' }, status: { name: 'X' } } }])).toBe(meta)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/metadata`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/metadata.js — discover a site's real issue types,
// statuses (with categories), priorities, custom field ids and people. Every call
// fails soft, matching ado/process-metadata.js.

export const JIRA_CATEGORY_MAP = { new: 'Proposed', indeterminate: 'InProgress', done: 'Completed' }

export const categoryOfJiraStatus = (status) => JIRA_CATEGORY_MAP[status?.statusCategory?.key] || 'Proposed'

export const toPerson = (u) => ({
  accountId: u.accountId,
  displayName: u.displayName || '',
  avatarUrl: u.avatarUrls?.['48x48'] || '',
})

function idByName(fields, names) {
  for (const n of names) {
    const f = fields.find(x => String(x.name || '').toLowerCase() === n)
    if (f) return f.id
  }
  return null
}

export function discoverFieldIds(fields = []) {
  return {
    storyPoints: idByName(fields, ['story point estimate', 'story points']),
    sprint: fields.find(f => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id || null,
    acceptanceCriteria: idByName(fields, ['acceptance criteria']),
    reproSteps: idByName(fields, ['steps to reproduce']),
  }
}

export const emptyJiraMeta = () => ({
  types: [], typeStates: {}, stateCategoryByName: {}, states: [], priorities: [],
  fieldIds: { storyPoints: null, sprint: null, acceptanceCriteria: null, reproSteps: null },
  me: null, people: [],
})

export async function fetchJiraMetadata(client, projectKeys = []) {
  const meta = emptyJiraMeta()
  const typeNames = new Set()

  await Promise.all(projectKeys.map(async (key) => {
    let types = []
    try { types = await client.get(`rest/api/3/project/${encodeURIComponent(key)}/statuses`) } catch (_) { return }
    for (const t of types || []) {
      typeNames.add(t.name)
      const names = []
      for (const s of t.statuses || []) {
        names.push(s.name)
        if (!meta.stateCategoryByName[s.name]) meta.stateCategoryByName[s.name] = categoryOfJiraStatus(s)
      }
      meta.typeStates[t.name] = Array.from(new Set([...(meta.typeStates[t.name] || []), ...names]))
    }
  }))

  const keysParam = projectKeys.map(encodeURIComponent).join(',')
  const [priorities, fields, me, people] = await Promise.all([
    client.get('rest/api/3/priority').catch(() => null),
    client.get('rest/api/3/field').catch(() => null),
    client.get('rest/api/3/myself').catch(() => null),
    projectKeys.length
      ? client.get(`rest/api/3/user/assignable/multiProjectSearch?projectKeys=${keysParam}&maxResults=1000`).catch(() => null)
      : Promise.resolve(null),
  ])

  const prioList = Array.isArray(priorities) ? priorities : (priorities?.values || [])
  meta.priorities = prioList.map((p, i) => ({ id: String(p.id), name: p.name, rank: i + 1 }))
  meta.fieldIds = discoverFieldIds(Array.isArray(fields) ? fields : [])
  meta.me = me ? { accountId: me.accountId, displayName: me.displayName || '', email: me.emailAddress || '' } : null
  meta.people = (Array.isArray(people) ? people : [])
    .filter(u => u.active !== false && u.accountType !== 'app')
    .map(toPerson)
  meta.types = Array.from(typeNames).sort()
  meta.states = Object.keys(meta.stateCategoryByName).sort()
  return meta
}

// When status metadata failed, derive types/statuses from the issues themselves.
export function fillMetadataFromIssues(meta, issues = []) {
  if (meta.types.length) return meta
  const next = { ...meta, typeStates: {}, stateCategoryByName: { ...meta.stateCategoryByName } }
  const typeNames = new Set()
  for (const issue of issues) {
    const type = issue.fields?.issuetype?.name
    const status = issue.fields?.status
    if (!type || !status?.name) continue
    typeNames.add(type)
    next.typeStates[type] = Array.from(new Set([...(next.typeStates[type] || []), status.name]))
    if (!next.stateCategoryByName[status.name]) next.stateCategoryByName[status.name] = categoryOfJiraStatus(status)
  }
  next.types = Array.from(typeNames).sort()
  next.states = Object.keys(next.stateCategoryByName).sort()
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/metadata`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/metadata.js packages/core/tests/jira/metadata.test.js
git commit -m "feat(core): discover Jira types, statuses, priorities, fields and people"
```

---

### Task 6: Jira issue mapper

**Files:**
- Create: `packages/core/src/modules/jira/mappers.js`
- Test: `packages/core/tests/jira/mappers.test.js`

**Interfaces:**
- Consumes: `slugify`, `timeAgo` from `../ado/helpers.js`; `toJiraId` from `../workitems/ids.js`; `categoryOfJiraStatus` from `./metadata.js`.
- Produces:
  - `pickSprint(sprints) → sprint|null` (active, else the last one)
  - `mapJiraIssue(issue, { meta, nameToId }) → WorkItem`, where `WorkItem` has the ADO internal shape plus `source: 'jira'`, `displayId`, `key`, `typeName`, `projectKey`, `projectName`, `stateCategory`, `assigneeAccountId`, `priorityName`
  - `mapResolvedJiraIssue(issue) → { id, title, type, state, createdDate, closedDate }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/mappers.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapJiraIssue, mapResolvedJiraIssue, pickSprint } from '../../src/modules/jira/mappers.js'

afterEach(() => vi.useRealTimers())

const META = {
  stateCategoryByName: { 'In Review': 'InProgress' },
  priorities: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }, { id: '3', name: 'Medium', rank: 3 }],
  fieldIds: { storyPoints: 'customfield_10016', sprint: 'customfield_10020', acceptanceCriteria: null, reproSteps: null },
}

const ISSUE = {
  key: 'ABC-12',
  fields: {
    summary: 'Fix login',
    issuetype: { name: 'Story' },
    status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
    assignee: { accountId: 'u1', displayName: 'Alex Doe' },
    priority: { name: 'High' },
    labels: ['auth', 'urgent'],
    components: [{ name: 'API' }, { name: 'Web' }],
    project: { key: 'ABC', name: 'Alpha Beta' },
    updated: '2026-10-05T10:00:00.000+0000',
    created: '2026-09-01T10:00:00.000+0000',
    customfield_10016: 5,
    customfield_10020: [{ id: 1, name: 'Sprint 1', state: 'closed' }, { id: 2, name: 'Sprint 2', state: 'active' }],
  },
}

describe('mapJiraIssue', () => {
  it('maps every field to the internal model', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00Z'))
    const w = mapJiraIssue(ISSUE, { meta: META })
    expect(w).toMatchObject({
      id: 'jira:ABC-12', displayId: 'ABC-12', key: 'ABC-12', source: 'jira',
      type: 'story', typeName: 'Story', title: 'Fix login',
      project: 'abc', projectKey: 'ABC', projectName: 'Alpha Beta',
      state: 'In Review', stateCategory: 'InProgress',
      assignee: 'alex-doe', assigneeAccountId: 'u1',
      priority: 2, priorityName: 'High', points: 5,
      tags: ['auth', 'urgent'], sprint: true, iterationPath: 'Sprint 2',
      areaPath: 'API, Web', area: '', comments: 0, prs: 0, isNew: true,
    })
    expect(w.changedMs).toBe(new Date('2026-10-05T10:00:00.000+0000').getTime())
  })

  it('uses nameToId when the assignee is a known team member', () => {
    expect(mapJiraIssue(ISSUE, { meta: META, nameToId: { 'Alex Doe': 'alex' } }).assignee).toBe('alex')
  })

  it('falls back to the status category on the issue when metadata lacks the state', () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, status: { name: 'Shipped', statusCategory: { key: 'done' } } } }
    expect(mapJiraIssue(issue, { meta: META }).stateCategory).toBe('Completed')
  })

  it('maps a sparse issue without throwing, using ADO-style defaults', () => {
    const w = mapJiraIssue({ key: 'XYZ-1', fields: { summary: 'Bare' } }, { meta: {} })
    expect(w).toMatchObject({
      id: 'jira:XYZ-1', type: 'task', project: 'xyz', projectKey: 'XYZ', state: '',
      stateCategory: 'Proposed', assignee: null, assigneeAccountId: null,
      priority: 3, priorityName: null, points: 0, tags: [], sprint: false,
      iterationPath: '', areaPath: '', changedMs: null, isNew: false,
    })
  })

  it('treats a closed-only sprint list as not in the current sprint', () => {
    const issue = { ...ISSUE, fields: { ...ISSUE.fields, customfield_10020: [{ name: 'Old', state: 'closed' }] } }
    expect(mapJiraIssue(issue, { meta: META })).toMatchObject({ sprint: false, iterationPath: 'Old' })
  })
})

describe('pickSprint', () => {
  it('returns null for empty input', () => {
    expect(pickSprint(null)).toBeNull()
    expect(pickSprint([])).toBeNull()
  })
})

describe('mapResolvedJiraIssue', () => {
  it('matches the ADO resolved-item shape', () => {
    expect(mapResolvedJiraIssue({
      key: 'ABC-3',
      fields: { summary: 'Done thing', issuetype: { name: 'Bug' }, status: { name: 'Done' }, created: 'c', resolutiondate: 'r' },
    })).toEqual({ id: 'jira:ABC-3', title: 'Done thing', type: 'Bug', state: 'Done', createdDate: 'c', closedDate: 'r' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/mappers`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/mappers.js — Jira issue → the internal work-item
// model produced by ado/mappers.js mapWorkItem, plus Jira-specific extras.
import { slugify, timeAgo } from '../ado/helpers.js'
import { toJiraId } from '../workitems/ids.js'
import { categoryOfJiraStatus } from './metadata.js'

export function pickSprint(sprints) {
  if (!Array.isArray(sprints) || sprints.length === 0) return null
  return sprints.find(s => s.state === 'active') || sprints[sprints.length - 1]
}

const projectKeyOf = (issue) => issue.fields?.project?.key || String(issue.key || '').split('-')[0]

export function mapJiraIssue(issue, { meta = {}, nameToId = {} } = {}) {
  const f = issue.fields || {}
  const fieldIds = meta.fieldIds || {}
  const statusName = f.status?.name || ''
  const assigneeName = f.assignee?.displayName || null
  const prio = (meta.priorities || []).find(p => p.name === f.priority?.name)
  const sprint = fieldIds.sprint ? pickSprint(f[fieldIds.sprint]) : null
  const points = fieldIds.storyPoints ? f[fieldIds.storyPoints] : null
  const changed = f.updated || ''
  const projectKey = projectKeyOf(issue)
  return {
    id: toJiraId(issue.key),
    displayId: issue.key,
    key: issue.key,
    source: 'jira',
    type: slugify(f.issuetype?.name || '') || 'task',
    typeName: f.issuetype?.name || 'Task',
    title: f.summary || '',
    project: slugify(projectKey),
    projectKey,
    projectName: f.project?.name || projectKey,
    state: statusName,
    stateCategory: meta.stateCategoryByName?.[statusName] || categoryOfJiraStatus(f.status),
    assignee: assigneeName ? (nameToId[assigneeName] || slugify(assigneeName)) : null,
    assigneeAccountId: f.assignee?.accountId || null,
    priority: prio ? prio.rank : 3,
    priorityName: f.priority?.name || null,
    points: Math.round(parseFloat(points || 0) || 0),
    tags: Array.isArray(f.labels) ? f.labels : [],
    updated: timeAgo(changed),
    changedMs: changed ? new Date(changed).getTime() : null,
    sprint: sprint?.state === 'active',
    iterationPath: sprint?.name || '',
    areaPath: (f.components || []).map(c => c.name).join(', '),
    area: '',
    comments: 0,
    prs: 0,
    isNew: changed ? (Date.now() - new Date(changed).getTime()) < 86_400_000 : false,
  }
}

export function mapResolvedJiraIssue(issue) {
  const f = issue.fields || {}
  return {
    id: toJiraId(issue.key),
    title: f.summary || '',
    type: f.issuetype?.name || '',
    state: f.status?.name || '',
    createdDate: f.created || null,
    closedDate: f.resolutiondate || null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/mappers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/mappers.js packages/core/tests/jira/mappers.test.js
git commit -m "feat(core): map Jira issues to the internal work-item model"
```

---

### Task 7: Jira loader and cache

**Files:**
- Create: `packages/core/src/modules/jira/loader.js`
- Test: `packages/core/tests/jira/loader.test.js`

**Interfaces:**
- Consumes: `makeJiraClient` (Task 3); `fetchJiraMetadata`, `fillMetadataFromIssues` (Task 5); `mapJiraIssue`, `mapResolvedJiraIssue` (Task 6); `PROJECT_COLORS` from `../ado/helpers.js`; `core` from `../../core.js` (`core._emit(event, data)`).
- Produces:
  - `JIRA_CACHE_KEY = 'nexusmd.jira.cache.v1'`
  - `JIRA_BASE_FIELDS: string[]`
  - `buildActiveJql(projectKeys, extraJql) → string`
  - `buildResolvedJql(projectKeys, extraJql) → string`
  - `searchAllIssues(client, jql, fields, max) → Promise<issue[]>`
  - `loadCachedJiraData(config, { storage }) → JiraData|null`
  - `loadJiraData(config, { http, storage, sleep? }, { isRefresh, priorData }) → Promise<JiraData>`
  - `JiraData = { SITE, WORK_ITEMS, PROJECTS: [{ id, name, key, source:'jira', color }], TYPES, STATES, WI_TYPE_STATES, PRIORITIES: [{ id, name, rank }], PEOPLE, ME, RESOLVED_WI, loadedAt, _jiraMeta }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/loader.test.js
import { describe, it, expect, vi } from 'vitest'
import {
  JIRA_CACHE_KEY, buildActiveJql, buildResolvedJql, searchAllIssues, loadJiraData, loadCachedJiraData,
} from '../../src/modules/jira/loader.js'

function res(body) {
  const text = JSON.stringify(body)
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => text, json: async () => body }
}

function makeStorage() {
  const store = {}
  return { get: vi.fn(k => store[k] ?? null), set: vi.fn((k, v) => { store[k] = v }), _store: store }
}

const CONFIG = { site: 'https://acme.atlassian.net', projectKeys: ['ABC'], jql: '' }
const ISSUE = (key, status = 'To Do', cat = 'new') => ({
  key, fields: { summary: key, issuetype: { name: 'Story' }, status: { name: status, statusCategory: { key: cat } }, project: { key: 'ABC', name: 'Alpha' } },
})

function makeHttp({ searchPages = [[ISSUE('ABC-1')]], resolved = [] } = {}) {
  let page = 0
  return {
    fetch: vi.fn(async (path, opts) => {
      if (path === 'rest/api/3/search/jql') {
        const body = JSON.parse(opts.body)
        if (body.jql.includes('statusCategory = Done')) return res({ issues: resolved })
        const issues = searchPages[page] || []
        page += 1
        return res({ issues, ...(page < searchPages.length ? { nextPageToken: `t${page}` } : {}) })
      }
      if (path.includes('/statuses')) return res([{ name: 'Story', statuses: [{ name: 'To Do', statusCategory: { key: 'new' } }] }])
      if (path.includes('rest/api/3/priority')) return res([{ id: '3', name: 'Medium' }])
      if (path.includes('rest/api/3/field')) return res([])
      if (path.includes('myself')) return res({ accountId: 'me', displayName: 'Me' })
      if (path.includes('multiProjectSearch')) return res([])
      throw new Error(`unexpected ${path}`)
    }),
  }
}

describe('JQL builders', () => {
  it('limits active issues to the configured projects and open categories', () => {
    expect(buildActiveJql(['ABC', 'DEF'])).toBe('project in ("ABC", "DEF") AND statusCategory != Done ORDER BY updated DESC')
  })
  it('wraps user JQL in parentheses so OR cannot widen the project scope', () => {
    expect(buildActiveJql(['ABC'], 'labels = a OR labels = b'))
      .toBe('project in ("ABC") AND statusCategory != Done AND (labels = a OR labels = b) ORDER BY updated DESC')
  })
  it('builds the resolved-in-14-days query', () => {
    expect(buildResolvedJql(['ABC'], ' ')).toBe('project in ("ABC") AND statusCategory = Done AND resolved >= -14d ORDER BY resolved DESC')
  })
})

describe('searchAllIssues', () => {
  it('follows nextPageToken until exhausted', async () => {
    const http = makeHttp({ searchPages: [[ISSUE('ABC-1')], [ISSUE('ABC-2')]] })
    const { makeJiraClient } = await import('../../src/modules/jira/client.js')
    const out = await searchAllIssues(makeJiraClient(http), 'jql', ['summary'], 500)
    expect(out.map(i => i.key)).toEqual(['ABC-1', 'ABC-2'])
    const bodies = http.fetch.mock.calls.map(([, o]) => JSON.parse(o.body))
    expect(bodies[1].nextPageToken).toBe('t1')
  })
  it('stops at the max', async () => {
    const http = makeHttp({ searchPages: [[ISSUE('ABC-1'), ISSUE('ABC-2')], [ISSUE('ABC-3')]] })
    const { makeJiraClient } = await import('../../src/modules/jira/client.js')
    const out = await searchAllIssues(makeJiraClient(http), 'jql', ['summary'], 2)
    expect(out).toHaveLength(2)
    expect(http.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('loadJiraData', () => {
  it('loads, maps and caches issues', async () => {
    const storage = makeStorage()
    const data = await loadJiraData(CONFIG, { http: makeHttp(), storage })
    expect(data.SITE).toBe('https://acme.atlassian.net')
    expect(data.WORK_ITEMS.map(w => w.id)).toEqual(['jira:ABC-1'])
    expect(data.PROJECTS).toEqual([expect.objectContaining({ id: 'abc', name: 'Alpha', key: 'ABC', source: 'jira' })])
    expect(data.TYPES).toEqual(['Story'])
    expect(data.WI_TYPE_STATES).toEqual({ Story: ['To Do'] })
    expect(data.PRIORITIES).toEqual([{ id: '3', name: 'Medium', rank: 1 }])
    expect(data.ME).toMatchObject({ accountId: 'me' })
    expect(storage.set).toHaveBeenCalledWith(JIRA_CACHE_KEY, data)
  })

  it('maps resolved issues for the digest', async () => {
    const data = await loadJiraData(CONFIG, {
      http: makeHttp({ resolved: [{ key: 'ABC-9', fields: { summary: 's', issuetype: { name: 'Bug' }, status: { name: 'Done' }, resolutiondate: 'r' } }] }),
      storage: makeStorage(),
    })
    expect(data.RESOLVED_WI).toEqual([expect.objectContaining({ id: 'jira:ABC-9', closedDate: 'r' })])
  })

  it('reuses prior metadata on refresh', async () => {
    const http = makeHttp()
    const priorMeta = { types: ['Epic'], typeStates: {}, stateCategoryByName: {}, states: [], priorities: [], fieldIds: {}, me: null, people: [] }
    const data = await loadJiraData(CONFIG, { http, storage: makeStorage() }, { isRefresh: true, priorData: { _jiraMeta: priorMeta } })
    expect(data.TYPES).toEqual(['Epic'])
    expect(http.fetch.mock.calls.some(([p]) => p.includes('/statuses'))).toBe(false)
  })

  it('throws when the active search fails so the caller can keep the cache', async () => {
    const http = { fetch: vi.fn(async (path) => (path === 'rest/api/3/search/jql'
      ? { ok: false, status: 401, headers: { get: () => null }, text: async () => '', json: async () => ({}) }
      : res([]))) }
    await expect(loadJiraData(CONFIG, { http, storage: makeStorage() })).rejects.toMatchObject({ status: 401 })
  })

  it('validates its inputs', async () => {
    await expect(loadJiraData({}, { http: makeHttp() })).rejects.toThrow('config.site is required')
    await expect(loadJiraData(CONFIG, {})).rejects.toThrow('http adapter is required')
  })
})

describe('loadCachedJiraData', () => {
  it('returns the cache for the same site and null for another site', () => {
    const storage = makeStorage()
    storage._store[JIRA_CACHE_KEY] = { SITE: 'https://acme.atlassian.net', WORK_ITEMS: [] }
    expect(loadCachedJiraData(CONFIG, { storage })).toMatchObject({ WORK_ITEMS: [] })
    expect(loadCachedJiraData({ site: 'https://other.atlassian.net' }, { storage })).toBeNull()
  })
  it('returns null for missing or malformed cache', () => {
    const storage = makeStorage()
    expect(loadCachedJiraData(CONFIG, { storage })).toBeNull()
    storage._store[JIRA_CACHE_KEY] = '{bad'
    expect(loadCachedJiraData(CONFIG, { storage })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/loader`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/loader.js — fetch, map and cache a site's open issues.
import { core } from '../../core.js'
import { PROJECT_COLORS } from '../ado/helpers.js'
import { makeJiraClient } from './client.js'
import { fetchJiraMetadata, fillMetadataFromIssues } from './metadata.js'
import { mapJiraIssue, mapResolvedJiraIssue } from './mappers.js'

export const JIRA_CACHE_KEY = 'nexusmd.jira.cache.v1'
export const JIRA_BASE_FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'priority', 'labels', 'components', 'project', 'updated', 'created']
const RESOLVED_FIELDS = ['summary', 'issuetype', 'status', 'created', 'resolutiondate']
const MAX_ACTIVE = 500
const MAX_RESOLVED = 100

const quoteKey = (k) => `"${String(k).replace(/"/g, '\\"')}"`
const scope = (keys) => `project in (${keys.map(quoteKey).join(', ')})`
const extra = (jql) => (String(jql || '').trim() ? ` AND (${String(jql).trim()})` : '')

export function buildActiveJql(projectKeys, extraJql = '') {
  return `${scope(projectKeys)} AND statusCategory != Done${extra(extraJql)} ORDER BY updated DESC`
}

export function buildResolvedJql(projectKeys, extraJql = '') {
  return `${scope(projectKeys)} AND statusCategory = Done AND resolved >= -14d${extra(extraJql)} ORDER BY resolved DESC`
}

export async function searchAllIssues(client, jql, fields, max) {
  const out = []
  let nextPageToken
  do {
    const page = await client.post('rest/api/3/search/jql', {
      jql, fields, maxResults: Math.min(100, max - out.length),
      ...(nextPageToken ? { nextPageToken } : {}),
    })
    out.push(...(page?.issues || []))
    nextPageToken = page?.nextPageToken
  } while (nextPageToken && out.length < max)
  return out.slice(0, max)
}

export function loadCachedJiraData(config, { storage }) {
  try {
    const raw = storage.get(JIRA_CACHE_KEY)
    if (!raw) return null
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!c || !Array.isArray(c.WORK_ITEMS)) return null
    if (c.SITE && config?.site && c.SITE !== config.site) return null
    return c
  } catch (_) { return null }
}

// Colours count down from the end of the palette so they rarely clash with ADO
// projects, whose colours count up from the start.
function deriveJiraProjects(items) {
  const seen = new Map()
  items.forEach(w => { if (!seen.has(w.project)) seen.set(w.project, { key: w.projectKey, name: w.projectName }) })
  const n = PROJECT_COLORS.length
  return Array.from(seen.entries()).map(([id, p], i) => ({
    id, name: p.name, key: p.key, source: 'jira', color: PROJECT_COLORS[n - 1 - (i % n)],
  }))
}

export async function loadJiraData(config, { http, storage, sleep } = {}, { isRefresh = false, priorData = null } = {}) {
  if (!config?.site) throw new Error('loadJiraData: config.site is required')
  if (!http) throw new Error('loadJiraData: http adapter is required')

  const client = makeJiraClient(http, sleep ? { sleep } : undefined)
  const keys = config.projectKeys || []

  let meta = isRefresh && priorData?._jiraMeta ? priorData._jiraMeta : await fetchJiraMetadata(client, keys)
  const fields = [...JIRA_BASE_FIELDS, ...Object.values(meta.fieldIds || {}).filter(Boolean)]

  const [active, resolved] = await Promise.all([
    searchAllIssues(client, buildActiveJql(keys, config.jql), fields, MAX_ACTIVE),
    searchAllIssues(client, buildResolvedJql(keys, config.jql), RESOLVED_FIELDS, MAX_RESOLVED).catch(() => []),
  ])

  meta = fillMetadataFromIssues(meta, active)
  const items = []
  active.forEach(issue => { try { items.push(mapJiraIssue(issue, { meta })) } catch (_) {} })

  const data = {
    SITE: config.site,
    WORK_ITEMS: items,
    PROJECTS: deriveJiraProjects(items),
    TYPES: meta.types,
    STATES: meta.states,
    WI_TYPE_STATES: meta.typeStates,
    PRIORITIES: meta.priorities,
    PEOPLE: meta.people,
    ME: meta.me,
    RESOLVED_WI: resolved.map(mapResolvedJiraIssue),
    loadedAt: Date.now(),
    _jiraMeta: meta,
  }

  if (storage) {
    try { storage.set(JIRA_CACHE_KEY, data) } catch (_) {}
  }
  core._emit(isRefresh ? 'jira:updated' : 'jira:loaded', data)
  return data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/loader`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/loader.js packages/core/tests/jira/loader.test.js
git commit -m "feat(core): load and cache Jira issues via enhanced JQL search"
```

---

### Task 8: Jira issue operations (read, write, transition, ADO-field translation)

**Files:**
- Create: `packages/core/src/modules/jira/issues.js`
- Test: `packages/core/tests/jira/issues.test.js`

**Interfaces:**
- Consumes: a `client` (Task 3); `htmlToAdf` (Task 4); `categoryOfJiraStatus` (Task 5).
- Produces (all `key` arguments are bare Jira keys like `ABC-12`):
  - `loadJiraDetail(client, key, meta) → { description, acceptanceCriteria, reproSteps }` (HTML or `null`)
  - `loadJiraComments(client, key) → [{ id, author, text, createdDate }]`
  - `addJiraComment(client, key, html) → { id, author, text, createdDate }`
  - `loadJiraRawFields(client, key) → { [label]: value }`
  - `buildJiraFieldsPayload(patch, meta) → fields`. `patch` keys: `title`, `description`, `acceptanceCriteria`, `assigneeAccountId`, `priorityName`, `tags`, `points`.
  - `updateJiraIssue(client, key, patch, meta) → void`
  - `listJiraTransitions(client, key) → [{ id, name, toName, toCategory }]`
  - `pickTransition(transitions, { state?, category? }) → transition|null`
  - `transitionJiraIssue(client, key, { state?, category? }, { currentState? }) → { state, stateCategory }`
  - `jiraPatchFromAdoField(field, value, { people, priorities }) → { transition: { state } } | { patch }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/issues.test.js
import { describe, it, expect, vi } from 'vitest'
import {
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields,
  buildJiraFieldsPayload, updateJiraIssue, listJiraTransitions, pickTransition,
  transitionJiraIssue, jiraPatchFromAdoField,
} from '../../src/modules/jira/issues.js'

const META = {
  fieldIds: { storyPoints: 'customfield_10016', sprint: null, acceptanceCriteria: 'customfield_10040', reproSteps: null },
  priorities: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }],
}

function makeClient(responses = {}) {
  const calls = []
  const handle = (method) => vi.fn(async (path, body) => {
    calls.push({ method, path, body })
    for (const [pattern, data] of Object.entries(responses)) if (path.includes(pattern)) return data
    return null
  })
  return { get: handle('GET'), post: handle('POST'), put: handle('PUT'), calls }
}

describe('reads', () => {
  it('loads rendered description and acceptance criteria', async () => {
    const client = makeClient({ 'issue/ABC-1?': { renderedFields: { description: '<p>d</p>', customfield_10040: '<p>ac</p>' } } })
    expect(await loadJiraDetail(client, 'ABC-1', META)).toEqual({ description: '<p>d</p>', acceptanceCriteria: '<p>ac</p>', reproSteps: null })
    expect(client.get.mock.calls[0][0]).toBe('rest/api/3/issue/ABC-1?fields=description,customfield_10040&expand=renderedFields')
  })

  it('loads rendered comments', async () => {
    const client = makeClient({ '/comment': { comments: [{ id: '5', author: { displayName: 'Sam' }, renderedBody: '<p>hi</p>', created: 't' }] } })
    expect(await loadJiraComments(client, 'ABC-1')).toEqual([{ id: '5', author: 'Sam', text: '<p>hi</p>', createdDate: 't' }])
  })

  it('adds a comment as ADF and returns the normalised comment', async () => {
    const client = makeClient({ '/comment': { id: '6', author: { displayName: 'Me' }, renderedBody: '<p>yo</p>', created: 't2' } })
    expect(await addJiraComment(client, 'ABC-1', '<p>yo</p>')).toEqual({ id: '6', author: 'Me', text: '<p>yo</p>', createdDate: 't2' })
    expect(client.post.mock.calls[0][1]).toEqual({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'yo' }] }] } })
  })

  it('labels raw custom fields with their names', async () => {
    const client = makeClient({ 'expand=names': { fields: { summary: 's', customfield_1: 3 }, names: { summary: 'Summary', customfield_1: 'Points' } } })
    expect(await loadJiraRawFields(client, 'ABC-1')).toEqual({ 'Summary (summary)': 's', 'Points (customfield_1)': 3 })
  })
})

describe('buildJiraFieldsPayload', () => {
  it('maps each normalised patch key', () => {
    expect(buildJiraFieldsPayload({
      title: 'T', assigneeAccountId: 'u1', priorityName: 'High', tags: ['a'], points: '5',
    }, META)).toEqual({
      summary: 'T', assignee: { accountId: 'u1' }, priority: { name: 'High' }, labels: ['a'], customfield_10016: 5,
    })
  })
  it('converts description to ADF and unassigns with null', () => {
    const f = buildJiraFieldsPayload({ description: '<p>x</p>', assigneeAccountId: null }, META)
    expect(f.description.type).toBe('doc')
    expect(f.assignee).toBeNull()
  })
  it('turns spaces in labels into hyphens because Jira rejects spaces', () => {
    expect(buildJiraFieldsPayload({ tags: ['needs review', ' x '] }, META).labels).toEqual(['needs-review', 'x'])
  })
  it('explains when the site has no story points field', () => {
    expect(() => buildJiraFieldsPayload({ points: 3 }, { fieldIds: {} })).toThrow('no story points field')
  })
})

describe('updateJiraIssue', () => {
  it('PUTs the fields', async () => {
    const client = makeClient()
    await updateJiraIssue(client, 'ABC-1', { title: 'New' }, META)
    expect(client.put).toHaveBeenCalledWith('rest/api/3/issue/ABC-1', { fields: { summary: 'New' } })
  })
  it('sends nothing for an empty patch', async () => {
    const client = makeClient()
    await updateJiraIssue(client, 'ABC-1', {}, META)
    expect(client.put).not.toHaveBeenCalled()
  })
})

describe('transitions', () => {
  const TRANSITIONS = { transitions: [
    { id: '11', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
    { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } },
  ] }

  it('lists transitions with destination category', async () => {
    expect(await listJiraTransitions(makeClient({ '/transitions': TRANSITIONS }), 'ABC-1')).toEqual([
      { id: '11', name: 'Start', toName: 'In Progress', toCategory: 'InProgress' },
      { id: '31', name: 'Finish', toName: 'Done', toCategory: 'Completed' },
    ])
  })

  it('picks by state name case-insensitively, or by category', () => {
    const list = [{ id: '1', toName: 'Done', toCategory: 'Completed' }]
    expect(pickTransition(list, { state: 'done' })?.id).toBe('1')
    expect(pickTransition(list, { category: 'Completed' })?.id).toBe('1')
    expect(pickTransition(list, { state: 'Nope' })).toBeNull()
    expect(pickTransition(list, {})).toBeNull()
  })

  it('posts the matching transition and returns the new state', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect(await transitionJiraIssue(client, 'ABC-1', { category: 'Completed' })).toEqual({ state: 'Done', stateCategory: 'Completed' })
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issue/ABC-1/transitions', { transition: { id: '31' } })
  })

  it('throws without posting when no transition reaches the target', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    await expect(transitionJiraIssue(client, 'ABC-1', { state: 'Blocked' }, { currentState: 'To Do' }))
      .rejects.toThrow('No transition from "To Do" to "Blocked" in this workflow')
    expect(client.post).not.toHaveBeenCalled()
  })
})

describe('jiraPatchFromAdoField', () => {
  const ctx = { people: [{ accountId: 'u1', displayName: 'Alex Doe' }], priorities: META.priorities }

  it('turns a state write into a transition', () => {
    expect(jiraPatchFromAdoField('System.State', 'Done', ctx)).toEqual({ transition: { state: 'Done' } })
  })
  it('maps title, description, acceptance criteria and points', () => {
    expect(jiraPatchFromAdoField('System.Title', 'T', ctx)).toEqual({ patch: { title: 'T' } })
    expect(jiraPatchFromAdoField('System.Description', '<p>d</p>', ctx)).toEqual({ patch: { description: '<p>d</p>' } })
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Common.AcceptanceCriteria', '', ctx)).toEqual({ patch: { acceptanceCriteria: '' } })
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Scheduling.StoryPoints', 8, ctx)).toEqual({ patch: { points: 8 } })
  })
  it('splits ADO-style tag strings', () => {
    expect(jiraPatchFromAdoField('System.Tags', 'a; b ;', ctx)).toEqual({ patch: { tags: ['a', 'b'] } })
  })
  it('maps a priority rank to its Jira name', () => {
    expect(jiraPatchFromAdoField('Microsoft.VSTS.Common.Priority', 2, ctx)).toEqual({ patch: { priorityName: 'High' } })
    expect(() => jiraPatchFromAdoField('Microsoft.VSTS.Common.Priority', 9, ctx)).toThrow('no priority ranked 9')
  })
  it('resolves assignee display names to account ids, and blank to unassigned', () => {
    expect(jiraPatchFromAdoField('System.AssignedTo', 'alex doe', ctx)).toEqual({ patch: { assigneeAccountId: 'u1' } })
    expect(jiraPatchFromAdoField('System.AssignedTo', '', ctx)).toEqual({ patch: { assigneeAccountId: null } })
    expect(() => jiraPatchFromAdoField('System.AssignedTo', 'Nobody', ctx)).toThrow("Nobody can't be assigned in Jira")
  })
  it('rejects fields Jira items do not have', () => {
    expect(() => jiraPatchFromAdoField('Custom.Area', 'x', ctx)).toThrow("Custom.Area can't be edited on Jira items")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/issues`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/issues.js — per-issue reads, writes and transitions.
import { htmlToAdf } from './adf.js'
import { categoryOfJiraStatus } from './metadata.js'

const issuePath = (key) => `rest/api/3/issue/${encodeURIComponent(key)}`

export async function loadJiraDetail(client, key, meta = {}) {
  const ids = meta.fieldIds || {}
  const fields = ['description', ids.acceptanceCriteria, ids.reproSteps].filter(Boolean).join(',')
  const issue = await client.get(`${issuePath(key)}?fields=${fields}&expand=renderedFields`)
  const r = issue?.renderedFields || {}
  return {
    description: r.description || null,
    acceptanceCriteria: ids.acceptanceCriteria ? (r[ids.acceptanceCriteria] || null) : null,
    reproSteps: ids.reproSteps ? (r[ids.reproSteps] || null) : null,
  }
}

export async function loadJiraComments(client, key) {
  const res = await client.get(`${issuePath(key)}/comment?orderBy=created&maxResults=100&expand=renderedBody`)
  return (res?.comments || []).map(c => ({
    id: c.id, author: c.author?.displayName || '', text: c.renderedBody || '', createdDate: c.created || '',
  }))
}

export async function addJiraComment(client, key, html) {
  const c = await client.post(`${issuePath(key)}/comment?expand=renderedBody`, { body: htmlToAdf(html) })
  return {
    id: c?.id,
    author: c?.author?.displayName || '',
    text: c?.renderedBody || html,
    createdDate: c?.created || new Date().toISOString(),
  }
}

export async function loadJiraRawFields(client, key) {
  const issue = await client.get(`${issuePath(key)}?expand=names`)
  const names = issue?.names || {}
  const out = {}
  for (const [k, v] of Object.entries(issue?.fields || {})) {
    out[names[k] && names[k] !== k ? `${names[k]} (${k})` : k] = v
  }
  return out
}

const toLabel = (t) => String(t).trim().replace(/\s+/g, '-')

export function buildJiraFieldsPayload(patch, meta = {}) {
  const ids = meta.fieldIds || {}
  const fields = {}
  if ('title' in patch) fields.summary = patch.title
  if ('description' in patch) fields.description = patch.description ? htmlToAdf(patch.description) : null
  if ('acceptanceCriteria' in patch) {
    if (!ids.acceptanceCriteria) throw new Error('This Jira site has no Acceptance Criteria field')
    fields[ids.acceptanceCriteria] = patch.acceptanceCriteria ? htmlToAdf(patch.acceptanceCriteria) : null
  }
  if ('assigneeAccountId' in patch) fields.assignee = patch.assigneeAccountId ? { accountId: patch.assigneeAccountId } : null
  if ('priorityName' in patch) fields.priority = { name: patch.priorityName }
  if ('tags' in patch) fields.labels = patch.tags.map(toLabel).filter(Boolean)
  if ('points' in patch) {
    if (!ids.storyPoints) throw new Error('This Jira site has no story points field')
    fields[ids.storyPoints] = patch.points === '' || patch.points == null ? null : Number(patch.points)
  }
  return fields
}

export async function updateJiraIssue(client, key, patch, meta) {
  const fields = buildJiraFieldsPayload(patch, meta)
  if (Object.keys(fields).length === 0) return
  await client.put(issuePath(key), { fields })
}

export async function listJiraTransitions(client, key) {
  const res = await client.get(`${issuePath(key)}/transitions`)
  return (res?.transitions || []).map(t => ({
    id: String(t.id), name: t.name, toName: t.to?.name || '', toCategory: categoryOfJiraStatus(t.to),
  }))
}

export function pickTransition(transitions, { state, category } = {}) {
  if (state) {
    const s = String(state).toLowerCase()
    return transitions.find(t => t.toName.toLowerCase() === s) || null
  }
  if (category) return transitions.find(t => t.toCategory === category) || null
  return null
}

export async function transitionJiraIssue(client, key, target, { currentState = '' } = {}) {
  const t = pickTransition(await listJiraTransitions(client, key), target)
  if (!t) {
    throw new Error(`No transition from "${currentState || 'its current status'}" to "${target.state || target.category}" in this workflow`)
  }
  await client.post(`${issuePath(key)}/transitions`, { transition: { id: t.id } })
  return { state: t.toName, stateCategory: t.toCategory }
}

// The shared views write ADO field names (saveField(id, 'System.State', v)).
// Translate one such write into a Jira transition or a normalised field patch.
export function jiraPatchFromAdoField(field, value, { people = [], priorities = [] } = {}) {
  switch (field) {
    case 'System.State':
      return { transition: { state: String(value) } }
    case 'System.Title':
      return { patch: { title: String(value ?? '') } }
    case 'System.Description':
      return { patch: { description: value || '' } }
    case 'Microsoft.VSTS.Common.AcceptanceCriteria':
      return { patch: { acceptanceCriteria: value || '' } }
    case 'System.Tags':
      return { patch: { tags: String(value || '').split(';').map(t => t.trim()).filter(Boolean) } }
    case 'Microsoft.VSTS.Scheduling.StoryPoints':
      return { patch: { points: value } }
    case 'Microsoft.VSTS.Common.Priority': {
      const p = priorities.find(x => x.rank === Number(value))
      if (!p) throw new Error(`Jira has no priority ranked ${value}`)
      return { patch: { priorityName: p.name } }
    }
    case 'System.AssignedTo': {
      if (!value) return { patch: { assigneeAccountId: null } }
      const name = String(value).toLowerCase()
      const person = people.find(p => p.displayName.toLowerCase() === name)
      if (!person) throw new Error(`${value} can't be assigned in Jira — they aren't an assignable user on these projects`)
      return { patch: { assigneeAccountId: person.accountId } }
    }
    default:
      throw new Error(`${field} can't be edited on Jira items`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/issues`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/issues.js packages/core/tests/jira/issues.test.js
git commit -m "feat(core): Jira issue detail, comments, edits and workflow transitions"
```

---

### Task 9: Jira create-meta and issue creation

**Files:**
- Create: `packages/core/src/modules/jira/create.js`
- Test: `packages/core/tests/jira/create.test.js`

**Interfaces:**
- Consumes: a `client` (Task 3; `send(path, { method, headers, attachment })` passes `attachment` through to the http adapter); `htmlToAdf` (Task 4); `toJiraId` (Task 1).
- Produces:
  - `classifyJiraField(field, fieldIds) → kind|null`, where kind ∈ `'text'|'richtext'|'number'|'date'|'option'|'multi-option'|'user'|'labels'|'sprint'|'parent'`
  - `normaliseCreateFields(rawFields, fieldIds) → CreateField[]`. `CreateField = { key, name, required, kind, role, allowedValues: [{ id, name }] }`, with role ∈ `'description'|'assignee'|'priority'|'labels'|'points'|'sprint'|'parent'|null`.
  - `layoutCreateFields(fields) → { core, required, more, unsupportedRequired }`
  - `buildJiraCreatePayload({ projectKey, typeId, summary, values, fields }) → { fields }`. `values[key]`: richtext as HTML string; user as accountId; option as id; multi-option as id[]; labels as string[] or a comma string; parent as an issue key.
  - `fetchJiraCreateTypes(client, projectKey) → [{ id, name, subtask }]`
  - `fetchJiraCreateFields(client, projectKey, typeId, fieldIds) → CreateField[]`
  - `fetchJiraLinkTypes(client) → [{ id, name, outward, inward }]`
  - `createJiraIssue(client, input, { attachments: File-like[], links: [{ typeName, key }] }) → { id, key, warnings: string[] }`

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/create.test.js
import { describe, it, expect, vi } from 'vitest'
import {
  classifyJiraField, normaliseCreateFields, layoutCreateFields, buildJiraCreatePayload,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
} from '../../src/modules/jira/create.js'

const IDS = { storyPoints: 'customfield_10016', sprint: 'customfield_10020', acceptanceCriteria: null, reproSteps: null }

const RAW = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, schema: { type: 'issuetype' } },
  { fieldId: 'description', name: 'Description', required: false, schema: { type: 'string' } },
  { fieldId: 'assignee', name: 'Assignee', required: false, schema: { type: 'user' } },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority' }, allowedValues: [{ id: '2', name: 'High' }] },
  { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string' } },
  { fieldId: 'customfield_10016', name: 'Story point estimate', required: false, schema: { type: 'number' } },
  { fieldId: 'customfield_10020', name: 'Sprint', required: false, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { fieldId: 'components', name: 'Components', required: true, schema: { type: 'array', items: 'component' }, allowedValues: [{ id: '10', name: 'API' }] },
  { fieldId: 'customfield_1', name: 'Team', required: true, schema: { type: 'option' }, allowedValues: [{ id: '7', value: 'Core' }] },
  { fieldId: 'customfield_2', name: 'Release notes', required: false, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  { fieldId: 'customfield_3', name: 'Weird', required: true, schema: { type: 'any' } },
  { fieldId: 'duedate', name: 'Due date', required: false, hasDefaultValue: false, schema: { type: 'date' } },
  { fieldId: 'reporter', name: 'Reporter', required: true, hasDefaultValue: true, schema: { type: 'user' } },
]

describe('classifyJiraField', () => {
  it('classifies by id, schema and allowed values', () => {
    const kinds = Object.fromEntries(RAW.map(f => [f.fieldId, classifyJiraField(f, IDS)]))
    expect(kinds).toMatchObject({
      description: 'richtext', assignee: 'user', priority: 'option', labels: 'labels',
      customfield_10016: 'number', customfield_10020: 'sprint', components: 'multi-option',
      customfield_1: 'option', customfield_2: 'richtext', customfield_3: null, duedate: 'date',
    })
  })
})

describe('normaliseCreateFields + layoutCreateFields', () => {
  const fields = normaliseCreateFields(RAW, IDS)

  it('drops fields the form sets itself and normalises allowed values', () => {
    expect(fields.map(f => f.key)).not.toContain('summary')
    expect(fields.map(f => f.key)).not.toContain('issuetype')
    expect(fields.map(f => f.key)).not.toContain('reporter')
    expect(fields.find(f => f.key === 'customfield_1').allowedValues).toEqual([{ id: '7', name: 'Core' }])
    expect(fields.find(f => f.key === 'customfield_10016').role).toBe('points')
  })

  it('orders core fields first and separates required, optional and unsupported', () => {
    const layout = layoutCreateFields(fields)
    expect(layout.core.map(f => f.key)).toEqual(['description', 'assignee', 'priority', 'labels', 'customfield_10016'])
    expect(layout.required.map(f => f.key)).toEqual(['components', 'customfield_1'])
    expect(layout.more.map(f => f.key)).toEqual(['customfield_2', 'duedate'])
    expect(layout.unsupportedRequired.map(f => f.key)).toEqual(['customfield_3'])
  })

  it('treats a required sprint as unsupported (not settable at create in v1)', () => {
    const layout = layoutCreateFields(normaliseCreateFields([{ ...RAW[7], required: true }], IDS))
    expect(layout.unsupportedRequired.map(f => f.key)).toEqual(['customfield_10020'])
  })
})

describe('buildJiraCreatePayload', () => {
  it('shapes each kind and skips empty values', () => {
    const fields = normaliseCreateFields(RAW, IDS)
    const payload = buildJiraCreatePayload({
      projectKey: 'ABC', typeId: '10001', summary: '  Title  ', fields,
      values: {
        description: '<p>d</p>', assignee: 'u1', priority: '2', labels: 'a b, c',
        customfield_10016: '3', components: ['10'], customfield_1: '7', duedate: '2026-10-10',
        customfield_2: '',
      },
    })
    expect(payload.fields).toMatchObject({
      project: { key: 'ABC' }, issuetype: { id: '10001' }, summary: 'Title',
      assignee: { accountId: 'u1' }, priority: { id: '2' }, labels: ['a-b', 'c'],
      customfield_10016: 3, components: [{ id: '10' }], customfield_1: { id: '7' }, duedate: '2026-10-10',
    })
    expect(payload.fields.description.type).toBe('doc')
    expect(payload.fields).not.toHaveProperty('customfield_2')
  })

  it('sends a parent key upper-cased', () => {
    const payload = buildJiraCreatePayload({
      projectKey: 'ABC', typeId: '1', summary: 's',
      fields: [{ key: 'parent', kind: 'parent' }], values: { parent: ' abc-5 ' },
    })
    expect(payload.fields.parent).toEqual({ key: 'ABC-5' })
  })
})

describe('create-meta fetchers', () => {
  it('reads issue types from either response shape', async () => {
    const client = { get: vi.fn(async () => ({ issueTypes: [{ id: 1, name: 'Story', subtask: false }] })) }
    expect(await fetchJiraCreateTypes(client, 'ABC')).toEqual([{ id: '1', name: 'Story', subtask: false }])
    client.get.mockResolvedValueOnce({ values: [{ id: 2, name: 'Bug' }] })
    expect(await fetchJiraCreateTypes(client, 'ABC')).toEqual([{ id: '2', name: 'Bug', subtask: false }])
  })
  it('normalises fields for a type', async () => {
    const client = { get: vi.fn(async () => ({ fields: RAW })) }
    const fields = await fetchJiraCreateFields(client, 'ABC', '1', IDS)
    expect(client.get).toHaveBeenCalledWith('rest/api/3/issue/createmeta/ABC/issuetypes/1?maxResults=200')
    expect(fields.length).toBeGreaterThan(0)
  })
  it('reads link types', async () => {
    const client = { get: vi.fn(async () => ({ issueLinkTypes: [{ id: 1, name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }] })) }
    expect(await fetchJiraLinkTypes(client)).toEqual([{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }])
  })
})

describe('createJiraIssue', () => {
  it('creates, uploads attachments with the no-check header, links, and collects warnings', async () => {
    const client = {
      post: vi.fn(async (path) => (path === 'rest/api/3/issue' ? { key: 'ABC-7' } : null)),
      send: vi.fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('too big')),
    }
    const file = (name) => ({ name, type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(2) })
    const result = await createJiraIssue(client, { projectKey: 'ABC', typeId: '1', summary: 's', values: {}, fields: [] }, {
      attachments: [file('a.txt'), file('b.txt')],
      links: [{ typeName: 'Blocks', key: 'ABC-1' }],
    })
    expect(result).toEqual({ id: 'jira:ABC-7', key: 'ABC-7', warnings: ['attachment "b.txt" failed: too big'] })
    expect(client.send).toHaveBeenCalledWith('rest/api/3/issue/ABC-7/attachments', expect.objectContaining({
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      attachment: expect.objectContaining({ name: 'a.txt', type: 'text/plain' }),
    }))
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issueLink', {
      type: { name: 'Blocks' }, inwardIssue: { key: 'ABC-7' }, outwardIssue: { key: 'ABC-1' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/core test -- tests/jira/create`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/create.js — Jira create metadata, payloads, creation.
import { htmlToAdf } from './adf.js'
import { toJiraId } from '../workitems/ids.js'

// Set by the form itself (summary/type/project) or by Jira (reporter default),
// or handled on their own tabs (attachments, links).
const SKIP = new Set(['summary', 'issuetype', 'project', 'reporter', 'attachment', 'issuelinks'])
const CORE_ROLES = ['description', 'assignee', 'priority', 'labels', 'points', 'parent']

export function classifyJiraField(f, fieldIds = {}) {
  const id = f.fieldId || f.key
  const s = f.schema || {}
  const hasValues = Array.isArray(f.allowedValues) && f.allowedValues.length > 0
  if (id === 'description' || (id && (id === fieldIds.acceptanceCriteria || id === fieldIds.reproSteps))) return 'richtext'
  if (id === 'labels') return 'labels'
  if (id === 'parent') return 'parent'
  if (id && id === fieldIds.sprint) return 'sprint'
  if (id && id === fieldIds.storyPoints) return 'number'
  if (s.type === 'user') return 'user'
  if (s.type === 'array' && hasValues) return 'multi-option'
  if (s.type === 'priority' || s.type === 'option' || hasValues) return 'option'
  if (s.type === 'number') return 'number'
  if (s.type === 'date' || s.type === 'datetime') return 'date'
  if (s.type === 'string') return String(s.custom || '').endsWith(':textarea') ? 'richtext' : 'text'
  return null
}

function roleOf(key, kind, fieldIds) {
  if (['description', 'assignee', 'priority', 'labels', 'parent'].includes(key)) return key
  if (key === fieldIds.storyPoints) return 'points'
  if (kind === 'sprint') return 'sprint'
  return null
}

export function normaliseCreateFields(rawFields = [], fieldIds = {}) {
  return rawFields
    .filter(f => !SKIP.has(f.fieldId || f.key))
    .map(f => {
      const key = f.fieldId || f.key
      const kind = classifyJiraField(f, fieldIds)
      return {
        key,
        name: f.name,
        required: !!f.required && !f.hasDefaultValue,
        kind,
        role: roleOf(key, kind, fieldIds),
        allowedValues: (f.allowedValues || []).map(v => ({ id: String(v.id), name: v.name ?? v.value ?? String(v.id) })),
      }
    })
}

export function layoutCreateFields(fields = []) {
  const core = CORE_ROLES.map(r => fields.find(f => f.role === r)).filter(Boolean)
  const rest = fields.filter(f => !core.includes(f))
  const usable = (f) => f.kind && f.role !== 'sprint'
  return {
    core,
    required: rest.filter(f => f.required && usable(f)),
    more: rest.filter(f => !f.required && usable(f)),
    unsupportedRequired: rest.filter(f => f.required && !usable(f)),
  }
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const toLabels = (v) => (Array.isArray(v) ? v : String(v).split(/[,;]/))
  .map(t => String(t).trim().replace(/\s+/g, '-')).filter(Boolean)

export function buildJiraCreatePayload({ projectKey, typeId, summary, values = {}, fields = [] }) {
  const out = { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary: String(summary).trim() }
  for (const f of fields) {
    const v = values[f.key]
    if (isEmpty(v)) continue
    switch (f.kind) {
      case 'richtext': out[f.key] = htmlToAdf(v); break
      case 'text': out[f.key] = String(v); break
      case 'number': out[f.key] = Number(v); break
      case 'date': out[f.key] = String(v); break
      case 'user': out[f.key] = { accountId: v }; break
      case 'option': out[f.key] = { id: String(v) }; break
      case 'multi-option': out[f.key] = v.map(id => ({ id: String(id) })); break
      case 'labels': out[f.key] = toLabels(v); break
      case 'parent': out[f.key] = { key: String(v).trim().toUpperCase() }; break
      default: break
    }
  }
  return { fields: out }
}

const createmetaPath = (projectKey) => `rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`

export async function fetchJiraCreateTypes(client, projectKey) {
  const res = await client.get(`${createmetaPath(projectKey)}?maxResults=100`)
  return (res?.issueTypes || res?.values || []).map(t => ({ id: String(t.id), name: t.name, subtask: !!t.subtask }))
}

export async function fetchJiraCreateFields(client, projectKey, typeId, fieldIds = {}) {
  const res = await client.get(`${createmetaPath(projectKey)}/${encodeURIComponent(typeId)}?maxResults=200`)
  return normaliseCreateFields(res?.fields || res?.values || [], fieldIds)
}

export async function fetchJiraLinkTypes(client) {
  const res = await client.get('rest/api/3/issueLinkType')
  return (res?.issueLinkTypes || []).map(t => ({ id: String(t.id), name: t.name, outward: t.outward, inward: t.inward }))
}

// Jira's issueLink quirk: the inwardIssue reads with the link type's *outward*
// verb ("<inward> blocks <outward>"), so the new issue goes in inwardIssue to read
// as "<new issue> blocks <other>".
export async function createJiraIssue(client, input, { attachments = [], links = [] } = {}) {
  const created = await client.post('rest/api/3/issue', buildJiraCreatePayload(input))
  const key = created.key
  const warnings = []

  for (const file of attachments) {
    try {
      const data = await file.arrayBuffer()
      await client.send(`rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
        method: 'POST',
        headers: { 'X-Atlassian-Token': 'no-check' },
        attachment: { name: file.name, type: file.type || 'application/octet-stream', data },
      })
    } catch (e) {
      warnings.push(`attachment "${file.name}" failed: ${e.message}`)
    }
  }

  for (const link of links) {
    try {
      await client.post('rest/api/3/issueLink', {
        type: { name: link.typeName }, inwardIssue: { key }, outwardIssue: { key: link.key },
      })
    } catch (e) {
      warnings.push(`link to ${link.key} failed: ${e.message}`)
    }
  }

  return { id: toJiraId(key), key, warnings }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w packages/core test -- tests/jira/create`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/create.js packages/core/tests/jira/create.test.js
git commit -m "feat(core): Jira create metadata, payload building and issue creation"
```

---

### Task 10: Merge, provider status, and barrels

**Files:**
- Create: `packages/core/src/modules/workitems/status.js`
- Create: `packages/core/src/modules/workitems/merge.js`
- Create: `packages/core/src/modules/workitems/index.js`
- Create: `packages/core/src/modules/jira/index.js`
- Modify: `packages/core/src/index.js` (after the `export * from './modules/ado/index.js'` line)
- Test: `packages/core/tests/workitems/merge.test.js`
- Test: `packages/core/tests/workitems/status.test.js`

**Interfaces:**
- Consumes: `slugify`, `adoTypeToHelm` from `../ado/helpers.js`; ADO cache shape after Phase 0 (`WORK_ITEMS`, `TEAM`, `PROJECTS`, `STATES`, `TYPES`, `PRIORITIES`, `WI_TYPE_STATES`, `RESOLVED_WI`, `_adoMeta`); `JiraData` (Task 7).
- Produces:
  - `WORK_ITEM_STATUS_KEY = 'nexusmd.workitems.status.v1'`
  - `readProviderStatus(storage) → { [id]: { status: 'ok'|'error', error?, at } }`
  - `recordProviderStatus(storage, id, { ok, error }) → all`
  - `describeProviderError(err) → string`
  - `PROVIDER_LABELS = { ado: 'Azure DevOps', jira: 'Jira' }`
  - `mergeTeam(adoTeam, jiraPeople, jiraItems, jiraMe) → member[]` (members gain `jiraAccountId`)
  - `mergeWorkItemData({ ado, jira, status, configured: { ado, jira } })` returns `{ WORK_ITEMS, WORK_ITEMS_BY_SOURCE, PROJECTS, TEAM, STATES, TYPES, WI_TYPE_STATES, WI_TYPE_STATES_BY_SOURCE, STATE_CATEGORIES_BY_SOURCE, PRIORITIES_BY_SOURCE, RESOLVED_WI, WORK_ITEM_PROVIDERS, JIRA_SITE, JIRA_PEOPLE }`. ADO items gain `source: 'ado'`, `displayId: '#<id>'` and `stateCategory`; `WORK_ITEM_PROVIDERS = [{ id, label, status: 'ok'|'error'|'stale'|'loading', error }]`.
  - `@nexusmd/core` re-exports everything from `modules/workitems/index.js` and `modules/jira/index.js`.

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/tests/workitems/status.test.js
import { describe, it, expect } from 'vitest'
import { WORK_ITEM_STATUS_KEY, readProviderStatus, recordProviderStatus, describeProviderError } from '../../src/modules/workitems/status.js'

function storage() { const s = {}; return { get: k => s[k] ?? null, set: (k, v) => { s[k] = v }, _s: s } }

describe('provider status', () => {
  it('records ok and error per provider', () => {
    const st = storage()
    recordProviderStatus(st, 'ado', { ok: true })
    recordProviderStatus(st, 'jira', { ok: false, error: Object.assign(new Error('x'), { status: 401 }) })
    const all = readProviderStatus(st)
    expect(all.ado.status).toBe('ok')
    expect(all.jira).toMatchObject({ status: 'error', error: 'auth failed — check settings' })
    expect(st._s[WORK_ITEM_STATUS_KEY]).toBe(all)
  })
  it('reads an empty object when nothing is stored or it is malformed', () => {
    const st = storage()
    expect(readProviderStatus(st)).toEqual({})
    st.set(WORK_ITEM_STATUS_KEY, '{bad')
    expect(readProviderStatus(st)).toEqual({})
  })
  it('describes errors', () => {
    expect(describeProviderError({ status: 403 })).toBe('auth failed — check settings')
    expect(describeProviderError(new Error('Not found in Jira (404)'))).toBe('Not found in Jira (404)')
    expect(describeProviderError(null)).toBe('load failed')
  })
})
```

```js
// packages/core/tests/workitems/merge.test.js
import { describe, it, expect } from 'vitest'
import { mergeWorkItemData, mergeTeam } from '../../src/modules/workitems/merge.js'

const ADO = {
  WORK_ITEMS: [{ id: 7, type: 'story', state: 'Active', adoStateCategory: 'InProgress', assignee: 'alex-doe' }],
  TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }],
  PROJECTS: [{ id: 'web', name: 'Web', color: 'c1' }],
  STATES: ['Active', 'Closed'], TYPES: ['User Story'], PRIORITIES: [1, 2, 3, 4],
  WI_TYPE_STATES: { 'User Story': ['New', 'Active', 'Closed'] },
  RESOLVED_WI: [{ id: 1, closedDate: '2026-10-01' }],
  _adoMeta: { stateCategoryByName: { Active: 'InProgress' } },
}
const JIRA = {
  SITE: 'https://acme.atlassian.net',
  WORK_ITEMS: [{ id: 'jira:ABC-1', source: 'jira', displayId: 'ABC-1', state: 'To Do', stateCategory: 'Proposed', assignee: 'sam-roe', assigneeAccountId: 's1' }],
  PROJECTS: [{ id: 'abc', name: 'Alpha', key: 'ABC', source: 'jira', color: 'c9' }],
  STATES: ['To Do', 'Done'], TYPES: ['Story'], PRIORITIES: [{ id: '1', name: 'High', rank: 1 }],
  WI_TYPE_STATES: { Story: ['To Do', 'Done'], 'Sub-task': ['Open'] },
  PEOPLE: [
    { accountId: 'a1', displayName: 'Alex Doe' },
    { accountId: 's1', displayName: 'Sam Roe' },
    { accountId: 'x1', displayName: 'Unrelated Person' },
  ],
  ME: { accountId: 'me', displayName: 'Me' },
  RESOLVED_WI: [{ id: 'jira:ABC-0', closedDate: '2026-10-03' }],
  _jiraMeta: { stateCategoryByName: { 'To Do': 'Proposed' } },
}

describe('mergeWorkItemData', () => {
  const merged = mergeWorkItemData({ ado: ADO, jira: JIRA, status: {}, configured: { ado: true, jira: true } })

  it('tags ADO items and concatenates both sources', () => {
    expect(merged.WORK_ITEMS.map(w => w.id)).toEqual([7, 'jira:ABC-1'])
    expect(merged.WORK_ITEMS[0]).toMatchObject({ source: 'ado', displayId: '#7', stateCategory: 'InProgress' })
    expect(merged.WORK_ITEMS_BY_SOURCE.jira).toHaveLength(1)
  })

  it('merges projects, states, types and per-source lookups', () => {
    expect(merged.PROJECTS.map(p => p.id)).toEqual(['web', 'abc'])
    expect(merged.STATES).toEqual(['Active', 'Closed', 'To Do', 'Done'])
    expect(merged.TYPES).toEqual(['User Story', 'Story'])
    expect(merged.WI_TYPE_STATES_BY_SOURCE.ado).toEqual({ story: ['New', 'Active', 'Closed'] })
    expect(merged.WI_TYPE_STATES_BY_SOURCE.jira).toEqual({ story: ['To Do', 'Done'], 'sub-task': ['Open'] })
    expect(merged.STATE_CATEGORIES_BY_SOURCE.jira).toEqual({ 'To Do': 'Proposed' })
    expect(merged.PRIORITIES_BY_SOURCE.jira).toEqual([{ id: '1', name: 'High', rank: 1 }])
    expect(merged.JIRA_SITE).toBe('https://acme.atlassian.net')
  })

  it('sorts resolved items newest first across sources', () => {
    expect(merged.RESOLVED_WI.map(r => r.id)).toEqual(['jira:ABC-0', 1])
  })

  it('reports provider status, marking errors with cached data as stale', () => {
    const m = mergeWorkItemData({
      ado: ADO, jira: JIRA, configured: { ado: true, jira: true },
      status: { jira: { status: 'error', error: 'auth failed — check settings' } },
    })
    expect(m.WORK_ITEM_PROVIDERS).toEqual([
      { id: 'ado', label: 'Azure DevOps', status: 'ok', error: null },
      { id: 'jira', label: 'Jira', status: 'stale', error: 'auth failed — check settings' },
    ])
    const noCache = mergeWorkItemData({ ado: ADO, jira: null, configured: { ado: true, jira: true }, status: { jira: { status: 'error', error: 'e' } } })
    expect(noCache.WORK_ITEM_PROVIDERS[1].status).toBe('error')
  })

  it('lists only configured providers and copes with no data at all', () => {
    const m = mergeWorkItemData({ ado: null, jira: null, configured: {} })
    expect(m.WORK_ITEMS).toEqual([])
    expect(m.WORK_ITEM_PROVIDERS).toEqual([])
  })
})

describe('mergeTeam', () => {
  it('keeps one entry for a person in both providers, adding their Jira account id', () => {
    const team = mergeTeam(ADO.TEAM, JIRA.PEOPLE, JIRA.WORK_ITEMS, JIRA.ME)
    const alex = team.filter(m => m.name === 'Alex Doe')
    expect(alex).toHaveLength(1)
    expect(alex[0]).toMatchObject({ id: 'alex-doe', jiraAccountId: 'a1' })
  })
  it('adds Jira-only people who are assigned work, but not every assignable user', () => {
    const team = mergeTeam(ADO.TEAM, JIRA.PEOPLE, JIRA.WORK_ITEMS, JIRA.ME)
    expect(team.find(m => m.name === 'Sam Roe')).toMatchObject({ id: 'sam-roe', jiraAccountId: 's1', source: 'jira', initials: 'SR' })
    expect(team.find(m => m.name === 'Unrelated Person')).toBeUndefined()
  })
  it('does not mutate the ADO team', () => {
    const ado = [{ id: 'alex-doe', name: 'Alex Doe' }]
    mergeTeam(ado, JIRA.PEOPLE, [], null)
    expect(ado[0].jiraAccountId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- tests/workitems`
Expected: FAIL — `status.js` / `merge.js` not found (Task 1 tests still pass)

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/workitems/status.js — last load outcome per provider,
// so the Work Items view can show "Jira: auth failed — check settings".

export const WORK_ITEM_STATUS_KEY = 'nexusmd.workitems.status.v1'

export function describeProviderError(err) {
  const s = err?.status
  if (s === 401 || s === 403) return 'auth failed — check settings'
  return String(err?.message || err || 'load failed').slice(0, 200)
}

export function readProviderStatus(storage) {
  try {
    const raw = storage.get(WORK_ITEM_STATUS_KEY)
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

export function recordProviderStatus(storage, id, { ok, error } = {}) {
  const all = readProviderStatus(storage)
  all[id] = ok
    ? { status: 'ok', at: Date.now() }
    : { status: 'error', error: describeProviderError(error), at: Date.now() }
  try { storage.set(WORK_ITEM_STATUS_KEY, all) } catch { /* quota */ }
  return all
}
```

```js
// packages/core/src/modules/workitems/merge.js — combine the ADO and Jira caches
// into the snapshot fields the shared views read.
import { slugify, adoTypeToHelm } from '../ado/helpers.js'

export const PROVIDER_LABELS = { ado: 'Azure DevOps', jira: 'Jira' }

const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?'
const union = (...lists) => Array.from(new Set(lists.flat().filter(Boolean)))

function slugKeyed(typeStates = {}, toSlug) {
  const out = {}
  for (const [type, states] of Object.entries(typeStates || {})) {
    const k = toSlug(type)
    out[k] = union(out[k] || [], states)
  }
  return out
}

function mergeTypeStates(a = {}, b = {}) {
  const out = { ...(a || {}) }
  for (const [type, states] of Object.entries(b || {})) out[type] = union(out[type] || [], states)
  return out
}

// Same display name in both providers → one member (ADO member ids are already
// slugify(name), as are Jira item assignees). Only Jira-only people who have Jira
// work loaded (or are "me") are added, so the team list isn't flooded with every
// assignable user on the site.
export function mergeTeam(adoTeam = [], jiraPeople = [], jiraItems = [], jiraMe = null) {
  const team = adoTeam.map(m => ({ ...m }))
  const byName = new Map(team.map(m => [String(m.name || '').toLowerCase(), m]))
  const relevant = new Set(jiraItems.map(w => w.assigneeAccountId).filter(Boolean))
  if (jiraMe?.accountId) relevant.add(jiraMe.accountId)
  for (const p of jiraPeople) {
    const existing = byName.get(p.displayName.toLowerCase())
    if (existing) { existing.jiraAccountId = p.accountId; continue }
    if (!relevant.has(p.accountId)) continue
    const member = {
      id: slugify(p.displayName) || `jira-${p.accountId}`,
      name: p.displayName, displayName: p.displayName, initials: initialsOf(p.displayName),
      role: 'Developer', tz: 'UTC', focus: '',
      jiraAccountId: p.accountId, avatarUrl: p.avatarUrl, source: 'jira',
    }
    team.push(member)
    byName.set(p.displayName.toLowerCase(), member)
  }
  return team
}

export function mergeWorkItemData({ ado = null, jira = null, status = {}, configured = {} } = {}) {
  const adoItems = (ado?.WORK_ITEMS || []).map(w => ({
    ...w, source: 'ado', displayId: `#${w.id}`, stateCategory: w.stateCategory ?? w.adoStateCategory ?? null,
  }))
  const jiraItems = jira?.WORK_ITEMS || []

  const providers = ['ado', 'jira'].filter(id => configured[id]).map(id => {
    const s = status[id] || {}
    const hasData = id === 'ado' ? !!ado : !!jira
    const state = s.status === 'error' ? (hasData ? 'stale' : 'error') : (hasData ? 'ok' : 'loading')
    return { id, label: PROVIDER_LABELS[id], status: state, error: s.status === 'error' ? (s.error || null) : null }
  })

  return {
    WORK_ITEMS: [...adoItems, ...jiraItems],
    WORK_ITEMS_BY_SOURCE: { ado: adoItems, jira: jiraItems },
    PROJECTS: [...(ado?.PROJECTS || []), ...(jira?.PROJECTS || [])],
    TEAM: mergeTeam(ado?.TEAM || [], jira?.PEOPLE || [], jiraItems, jira?.ME || null),
    STATES: union(ado?.STATES || [], jira?.STATES || []),
    TYPES: union(ado?.TYPES || [], jira?.TYPES || []),
    WI_TYPE_STATES: mergeTypeStates(ado?.WI_TYPE_STATES, jira?.WI_TYPE_STATES),
    WI_TYPE_STATES_BY_SOURCE: {
      ado: slugKeyed(ado?.WI_TYPE_STATES, adoTypeToHelm),
      jira: slugKeyed(jira?.WI_TYPE_STATES, t => slugify(t) || 'task'),
    },
    STATE_CATEGORIES_BY_SOURCE: {
      ado: ado?._adoMeta?.stateCategoryByName || {},
      jira: jira?._jiraMeta?.stateCategoryByName || {},
    },
    PRIORITIES_BY_SOURCE: { ado: ado?.PRIORITIES || [], jira: jira?.PRIORITIES || [] },
    RESOLVED_WI: [...(ado?.RESOLVED_WI || []), ...(jira?.RESOLVED_WI || [])]
      .sort((a, b) => new Date(b.closedDate || 0) - new Date(a.closedDate || 0))
      .slice(0, 15),
    WORK_ITEM_PROVIDERS: providers,
    JIRA_SITE: jira?.SITE || '',
    JIRA_PEOPLE: jira?.PEOPLE || [],
  }
}
```

```js
// packages/core/src/modules/workitems/index.js
export {
  JIRA_ID_PREFIX, isJiraId, toJiraId, jiraKeyFromId, sourceOfId, displayIdOf,
} from './ids.js'
export { CATEGORY_LANES, CATEGORY_LABELS, itemCategory, adoStateForCategory } from './categories.js'
export { WORK_ITEM_STATUS_KEY, readProviderStatus, recordProviderStatus, describeProviderError } from './status.js'
export { PROVIDER_LABELS, mergeTeam, mergeWorkItemData } from './merge.js'
```

```js
// packages/core/src/modules/jira/index.js
export { normaliseSite, makeJiraConfig } from './config.js'
export { makeJiraClient, JiraError, jiraErrorMessage } from './client.js'
export { htmlToAdf } from './adf.js'
export {
  JIRA_CATEGORY_MAP, categoryOfJiraStatus, discoverFieldIds, fetchJiraMetadata, fillMetadataFromIssues, emptyJiraMeta,
} from './metadata.js'
export { mapJiraIssue, mapResolvedJiraIssue, pickSprint } from './mappers.js'
export {
  JIRA_CACHE_KEY, JIRA_BASE_FIELDS, buildActiveJql, buildResolvedJql, searchAllIssues, loadJiraData, loadCachedJiraData,
} from './loader.js'
export {
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields, buildJiraFieldsPayload,
  updateJiraIssue, listJiraTransitions, pickTransition, transitionJiraIssue, jiraPatchFromAdoField,
} from './issues.js'
export {
  classifyJiraField, normaliseCreateFields, layoutCreateFields, buildJiraCreatePayload,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
} from './create.js'
```

In `packages/core/src/index.js`, directly after `export * from './modules/ado/index.js'`, add:

```js
export * from './modules/workitems/index.js'
export * from './modules/jira/index.js'
```

- [ ] **Step 4: Add a public-API smoke assertion**

Append to `packages/core/tests/workitems/merge.test.js`:

```js
import * as pub from '../../src/index.js'

describe('public API', () => {
  it('re-exports the work-item and Jira modules from @nexusmd/core', () => {
    for (const name of ['mergeWorkItemData', 'isJiraId', 'itemCategory', 'loadJiraData', 'makeJiraConfig', 'createJiraIssue', 'htmlToAdf']) {
      expect(typeof pub[name]).toBe('function')
    }
  })
})
```

- [ ] **Step 5: Run the core suite**

Run: `npm -w packages/core test`
Expected: PASS, including the existing `public-api.test.js` (it checks the `core` object's keys, not named exports, so it's unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/workitems packages/core/src/modules/jira/index.js packages/core/src/index.js packages/core/tests/workitems
git commit -m "feat(core): merge ADO and Jira work-item data and track provider status"
```

---

### Task 11: Downstream modules classify terminal state by category

**Files:**
- Modify: `packages/core/src/modules/digest/index.js` (the `openItems` line in `buildDigest`)
- Modify: `packages/core/src/modules/team/index.js` (the `done` line in `enrichTeamMember`)
- Modify: `packages/ui/src/views/view-dashboard.jsx` (the `unassigned` filter and the per-member `assigned` filter)
- Test: `packages/core/tests/digest.test.js`, `packages/core/tests/team.test.js`

**Interfaces:**
- Consumes: Phase 0's `isTerminalState(state, category)`; `item.stateCategory` (set by Task 10 for ADO, Task 6 for Jira).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/digest.test.js`:

```js
describe('buildDigest with state categories', () => {
  it('treats a custom-named state in the Completed category as closed', () => {
    const d = buildDigest({ workItems: [
      { id: 'jira:A-1', state: 'Shipped', stateCategory: 'Completed', priority: 1 },
      { id: 'jira:A-2', state: 'Doing', stateCategory: 'InProgress', priority: 2 },
    ] })
    expect(d.openCount).toBe(1)
  })
})
```

Append to `packages/core/tests/team.test.js` (it already imports `enrichTeamMember` from `../src/index.js`; add the import if it doesn't):

```js
describe('enrichTeamMember with state categories', () => {
  it('counts a custom Completed-category state as done', () => {
    const m = enrichTeamMember({ id: 'a' }, { workItems: [{ assignee: 'a', state: 'Shipped', stateCategory: 'Completed', priority: 1 }] })
    expect(m.done).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core test -- digest team`
Expected: FAIL — `openCount` is 2; `done` has length 0.

- [ ] **Step 3: Implement**

In `packages/core/src/modules/digest/index.js`, change:

```js
  const openItems     = workItems.filter(wi => !isTerminalState(wi.state))
```

to:

```js
  const openItems     = workItems.filter(wi => !isTerminalState(wi.state, wi.stateCategory))
```

In `packages/core/src/modules/team/index.js`, change:

```js
  const done = myWIs.filter(w => isTerminalState(w.state))
```

to:

```js
  const done = myWIs.filter(w => isTerminalState(w.state, w.stateCategory))
```

In `packages/ui/src/views/view-dashboard.jsx`, change:

```js
  const unassigned      = WORK_ITEMS.filter(w => !w.assignee && !isTerminalState(w.state));
```

to:

```js
  const unassigned      = WORK_ITEMS.filter(w => !w.assignee && !isTerminalState(w.state, w.stateCategory));
```

and change:

```js
    const assigned = workItems.filter(w => w.assignee === t.id && !isTerminalState(w.state));
```

to:

```js
    const assigned = workItems.filter(w => w.assignee === t.id && !isTerminalState(w.state, w.stateCategory));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/core test && npm -w packages/ui test -- views`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/digest/index.js packages/core/src/modules/team/index.js packages/ui/src/views/view-dashboard.jsx packages/core/tests/digest.test.js packages/core/tests/team.test.js
git commit -m "fix: classify closed work items by state category, not just state name"
```

---

### Task 12: Id-routed work-item source; `patchWorkItem` reports success

**Files:**
- Modify: `packages/ui/src/views/work-item-source.js` (append)
- Modify: `packages/ui/src/views/view-workitems.jsx` (`patchWorkItem` at the top of the file)
- Modify: `packages/ui/src/index.js` (export)
- Test: `packages/ui/tests/work-item-source-routing.test.js`
- Test: `packages/ui/tests/workitem-persist.test.jsx` (append)

**Interfaces:**
- Consumes: `isJiraId` from `@nexusmd/core` (Task 10).
- Produces:
  - `createRoutedWorkItemSource({ ado, jira }) → source`. `source` has `loadDetail(id, project)`, `loadComments(id, project)`, `addComment(id, project, html)`, `saveField(id, field, value)`, `loadRawFields(id)`, `createWorkItem(payload)`, `moveToCategory(id, category, item) → { state, stateCategory }`, `availableTargetStates(id) → string[]|null`, `webUrl(item) → string|null` and `jira` (the Jira source or `null`). Each method calls the source matching the id.
  - `patchWorkItem(source, id, ops) → Promise<boolean>`: `true` on success, `false` after toasting a failure. The `/api` fallback path returns `true` unless fetch throws.

- [ ] **Step 1: Write the failing tests**

```js
// packages/ui/tests/work-item-source-routing.test.js
import { describe, it, expect, vi } from 'vitest'
import { createRoutedWorkItemSource } from '../src/views/work-item-source.js'

function fakeSource(name) {
  return {
    loadDetail: vi.fn(async () => name), loadComments: vi.fn(async () => [name]),
    addComment: vi.fn(async () => ({ id: name })), saveField: vi.fn(async () => {}),
    loadRawFields: vi.fn(async () => ({ src: name })), createWorkItem: vi.fn(async () => ({ id: 1, warnings: [] })),
    moveToCategory: vi.fn(async () => ({ state: name, stateCategory: 'Completed' })),
    webUrl: vi.fn(item => `${name}:${item.id}`),
  }
}

describe('createRoutedWorkItemSource', () => {
  it('routes numeric ids to ADO and jira: ids to Jira', async () => {
    const ado = fakeSource('ado'); const jira = fakeSource('jira')
    const s = createRoutedWorkItemSource({ ado, jira })
    expect(await s.loadDetail(7, 'p')).toBe('ado')
    expect(await s.loadDetail('jira:A-1', 'p')).toBe('jira')
    await s.saveField('jira:A-1', 'System.State', 'Done')
    expect(jira.saveField).toHaveBeenCalledWith('jira:A-1', 'System.State', 'Done')
    expect(ado.saveField).not.toHaveBeenCalled()
    expect(await s.loadRawFields(7)).toEqual({ src: 'ado' })
    expect(s.jira).toBe(jira)
  })

  it('rejects Jira ids when Jira is not configured', async () => {
    const s = createRoutedWorkItemSource({ ado: fakeSource('ado'), jira: null })
    await expect(s.loadComments('jira:A-1')).rejects.toThrow('Jira is not configured')
  })

  it('creates through ADO by default', async () => {
    const ado = fakeSource('ado')
    await createRoutedWorkItemSource({ ado }).createWorkItem({ project: 'p' })
    expect(ado.createWorkItem).toHaveBeenCalledWith({ project: 'p' })
  })

  it('routes moveToCategory and webUrl, tolerating sources without them', async () => {
    const ado = { ...fakeSource('ado'), moveToCategory: undefined, webUrl: undefined }
    const s = createRoutedWorkItemSource({ ado, jira: fakeSource('jira') })
    expect(await s.moveToCategory('jira:A-1', 'Completed', {})).toEqual({ state: 'jira', stateCategory: 'Completed' })
    await expect(s.moveToCategory(7, 'Completed', {})).rejects.toThrow('not supported')
    expect(s.webUrl({ id: 'jira:A-1' })).toBe('jira:jira:A-1')
    expect(s.webUrl({ id: 7 })).toBeNull()
    expect(await s.availableTargetStates(7)).toBeNull()
  })
})
```

Append to `packages/ui/tests/workitem-persist.test.jsx`:

```js
it('returns true on success and false after a failure', async () => {
  expect(await patchWorkItem({ saveField: vi.fn().mockResolvedValue() }, 7, [['/fields/System.State', 'Done']])).toBe(true)
  expect(await patchWorkItem({ saveField: vi.fn().mockRejectedValue(new Error('nope')) }, 7, [['/fields/System.State', 'Done']])).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/ui test -- work-item-source-routing workitem-persist`
Expected: FAIL — `createRoutedWorkItemSource` is not exported; `patchWorkItem` returns `undefined`.

- [ ] **Step 3: Implement**

Append to `packages/ui/src/views/work-item-source.js`, and add `import { isJiraId } from '@nexusmd/core'` at the top of the file:

```js
// Dispatch each operation to the provider that owns the item: "jira:KEY" ids go
// to Jira, everything else (numeric ADO ids) to ADO. Methods are async so a
// routing error surfaces as a rejected promise, like any other save failure.
const ROUTED_METHODS = ['loadDetail', 'loadComments', 'addComment', 'saveField', 'loadRawFields']

export function createRoutedWorkItemSource({ ado, jira = null }) {
  const pick = (id) => {
    if (!isJiraId(id)) return ado
    if (!jira) throw new Error('Jira is not configured')
    return jira
  }
  const routed = { jira }
  for (const m of ROUTED_METHODS) routed[m] = async (id, ...rest) => pick(id)[m](id, ...rest)
  routed.createWorkItem = async (payload) => ado.createWorkItem(payload)
  routed.moveToCategory = async (id, category, item) => {
    const s = pick(id)
    if (!s.moveToCategory) throw new Error('Moving between categories is not supported for this item')
    return s.moveToCategory(id, category, item)
  }
  routed.availableTargetStates = async (id) => {
    const s = pick(id)
    return s.availableTargetStates ? s.availableTargetStates(id) : null
  }
  routed.webUrl = (item) => {
    if (!item) return null
    try {
      const s = pick(item.id)
      return s.webUrl ? s.webUrl(item) : null
    } catch { return null }
  }
  return routed
}
```

In `packages/ui/src/views/view-workitems.jsx`, replace the whole `patchWorkItem` function with:

```js
// Persist work-item field changes. Desktop hosts inject workItemSource (writes
// straight to ADO or Jira, routed by id); legacy web hosts hit /api/workitems/:id.
// `ops` is a list of [ '/fields/<Field>', value ] pairs. Failures are toasted and
// reported as `false` so callers can roll back their optimistic edit.
export async function patchWorkItem(workItemSource, id, ops) {
  if (workItemSource?.saveField) {
    try {
      for (const [path, value] of ops) {
        await workItemSource.saveField(id, path.replace('/fields/', ''), value ?? '');
      }
      return true;
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Save failed'), 'error');
      return false;
    }
  }
  try {
    await fetch(`/api/workitems/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ops.map(([path, value]) => ({ op: 'add', path, value }))),
    });
    return true;
  } catch {
    return false;
  }
}
```

In `packages/ui/src/index.js`, next to the existing work-item exports, add:

```js
export { createRoutedWorkItemSource } from './views/work-item-source.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/ui test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/work-item-source.js packages/ui/src/views/view-workitems.jsx packages/ui/src/index.js packages/ui/tests/work-item-source-routing.test.js packages/ui/tests/workitem-persist.test.jsx
git commit -m "feat(ui): route work-item operations by provider and report save success"
```

---

### Task 13: Electron main-process Jira proxy

**Files:**
- Create: `apps/desktop/electron/ipc/jira.cjs`
- Modify: `apps/desktop/electron/main.cjs` (requires block near `const dbManagerIpc = …`; registration block near `dbManagerIpc.register(ipcMain);`)
- Modify: `apps/desktop/electron/preload.cjs` (inside `contextBridge.exposeInMainWorld('electronAPI', { … })`)
- Test: `apps/desktop/electron/ipc/jira.test.js`

**Interfaces:**
- Consumes: Node 18+ globals `fetch`, `FormData`, `Blob` (Electron main process).
- Produces:
  - IPC channel `jira:request`. Request: `{ url, method, headers, body?, attachment?: { name, type, data: ArrayBuffer } }`. Response: `{ ok, status, headers: { 'retry-after': string|null }, body: string, error? }`.
  - Preload exposes `window.electronAPI.jira.request(req)`.
  - `isAllowedJiraUrl(url) → boolean`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/electron/ipc/jira.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { register, isAllowedJiraUrl } = require('./jira.cjs')

function makeFakeIpcMain() {
  const handlers = {}
  return {
    handle(channel, fn) { handlers[channel] = fn },
    invoke(channel, ...args) { return handlers[channel](null, ...args) },
  }
}

function fakeResponse(status, text, headers = {}) {
  return { ok: status < 300, status, headers: { get: n => headers[n] ?? null }, text: async () => text }
}

describe('isAllowedJiraUrl', () => {
  it('allows only https Jira Cloud REST URLs', () => {
    expect(isAllowedJiraUrl('https://acme.atlassian.net/rest/api/3/myself')).toBe(true)
    expect(isAllowedJiraUrl('http://acme.atlassian.net/rest/api/3/myself')).toBe(false)
    expect(isAllowedJiraUrl('https://evilatlassian.net/rest/api/3/myself')).toBe(false)
    expect(isAllowedJiraUrl('https://acme.atlassian.net/secure/Dashboard.jspa')).toBe(false)
    expect(isAllowedJiraUrl('https://example.com/rest/api/3/x')).toBe(false)
    expect(isAllowedJiraUrl('not a url')).toBe(false)
  })
})

describe('jira:request', () => {
  it('forwards an allowed request and returns status, retry-after and body', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(429, '{"x":1}', { 'retry-after': '3' }))
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    const out = await ipc.invoke('jira:request', {
      url: 'https://acme.atlassian.net/rest/api/3/search/jql', method: 'POST',
      headers: { Authorization: 'Basic x', 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://acme.atlassian.net/rest/api/3/search/jql', {
      method: 'POST', headers: { Authorization: 'Basic x', 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(out).toEqual({ ok: false, status: 429, headers: { 'retry-after': '3' }, body: '{"x":1}' })
  })

  it('blocks non-Jira URLs without fetching', async () => {
    const fetchImpl = vi.fn()
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    const out = await ipc.invoke('jira:request', { url: 'https://example.com/rest/x' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: false, status: 0, error: 'Blocked: not a Jira Cloud REST URL' })
  })

  it('sends attachments as multipart form data and drops any JSON content type', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, '[]'))
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    await ipc.invoke('jira:request', {
      url: 'https://acme.atlassian.net/rest/api/3/issue/A-1/attachments', method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check', 'Content-Type': 'application/json' },
      attachment: { name: 'a.txt', type: 'text/plain', data: new TextEncoder().encode('hi').buffer },
    })
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers).toEqual({ 'X-Atlassian-Token': 'no-check' })
    expect(opts.body).toBeInstanceOf(FormData)
    expect(opts.body.get('file').name).toBe('a.txt')
  })

  it('returns network errors instead of throwing across IPC', async () => {
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl: async () => { throw new Error('ENOTFOUND') } })
    expect(await ipc.invoke('jira:request', { url: 'https://acme.atlassian.net/rest/api/3/myself' }))
      .toEqual({ ok: false, status: 0, headers: {}, body: '', error: 'ENOTFOUND' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/desktop test -- electron/ipc/jira`
Expected: FAIL — `Cannot find module './jira.cjs'`

- [ ] **Step 3: Implement**

```js
// apps/desktop/electron/ipc/jira.cjs
'use strict';

// Jira Cloud's REST API sends no CORS headers, so the sandboxed renderer can't
// call it directly (ADO works because dev.azure.com allows CORS). This forwards
// renderer requests, restricted to https://*.atlassian.net/rest/… so it can't be
// used as an open proxy. Credentials come from the renderer, like the ADO PAT.

function isAllowedJiraUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname.endsWith('.atlassian.net') && u.pathname.startsWith('/rest/');
  } catch {
    return false;
  }
}

function register(ipcMain, { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  ipcMain.handle('jira:request', async (_e, req = {}) => {
    if (!isAllowedJiraUrl(req.url)) {
      return { ok: false, status: 0, headers: {}, body: '', error: 'Blocked: not a Jira Cloud REST URL' };
    }
    const headers = { ...(req.headers || {}) };
    let body = req.body;
    if (req.attachment) {
      const form = new FormData();
      const blob = new Blob([req.attachment.data], { type: req.attachment.type || 'application/octet-stream' });
      form.append('file', blob, req.attachment.name || 'file');
      body = form;
      delete headers['Content-Type'];
    }
    try {
      const res = await fetchImpl(req.url, {
        method: req.method || 'GET',
        headers,
        ...(body !== undefined ? { body } : {}),
      });
      return {
        ok: res.ok,
        status: res.status,
        headers: { 'retry-after': res.headers.get('retry-after') },
        body: await res.text(),
      };
    } catch (err) {
      return { ok: false, status: 0, headers: {}, body: '', error: err?.message || String(err) };
    }
  });
}

module.exports = { register, isAllowedJiraUrl };
```

In `apps/desktop/electron/main.cjs`, after `const dbManagerIpc   = require('./ipc/db-manager.cjs');` add:

```js
const jiraIpc        = require('./ipc/jira.cjs');
```

and after `dbManagerIpc.register(ipcMain);` add:

```js
  jiraIpc.register(ipcMain);
```

In `apps/desktop/electron/preload.cjs`, inside the object passed to `exposeInMainWorld('electronAPI', …)`, next to the `dbManager: { … }` entry, add:

```js
  jira: {
    request: (req) => ipcRenderer.invoke('jira:request', req),
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w apps/desktop test -- electron`
Expected: PASS. If `preload.test.js` asserts the exact `electronAPI` key list, add `'jira'` to its expected list.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/jira.cjs apps/desktop/electron/ipc/jira.test.js apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs
git commit -m "feat(desktop): main-process proxy for Jira Cloud REST requests"
```

---

### Task 14: Desktop Jira client and Jira work-item source

**Files:**
- Create: `apps/desktop/src/jira-client.js`
- Test: `apps/desktop/src/jira-client.test.js`

**Interfaces:**
- Consumes: `makeJiraConfig`, `makeJiraClient`, `loadCachedJiraData`, `jiraKeyFromId`, `loadJiraDetail`, `loadJiraComments`, `addJiraComment`, `loadJiraRawFields`, `jiraPatchFromAdoField`, `transitionJiraIssue`, `updateJiraIssue`, `listJiraTransitions`, `fetchJiraCreateTypes`, `fetchJiraCreateFields`, `fetchJiraLinkTypes`, `createJiraIssue` from `@nexusmd/core`; `getProfileKey` from `./profile-keys.js`; `localStorageAdapter` from `@nexusmd/web-adapters`; `window.electronAPI.jira.request` (Task 13).
- Produces:
  - `getJiraConfig`, `saveJiraConfig`, `isJiraConfigured`, `isJiraActive` (stored under `getProfileKey('jira.<name>')`)
  - `createJiraHttpAdapter({ getConfig?, invoke? }) → { fetch(path, opts) → Response-like }`
  - `createJiraWorkItemSource({ http?, getMeta?, getPeople?, getSite? }) → source`. `source` has `loadDetail`, `loadComments`, `addComment`, `saveField`, `loadRawFields`, `moveToCategory(id, category, item)`, `availableTargetStates(id)`, `webUrl(item)`, `getCreateTypes(projectKey)`, `getCreateFields(projectKey, typeId)`, `getLinkTypes()`, `createIssue(input, extras)`.

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/jira-client.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => `p.${k}` }))

import { createJiraHttpAdapter, createJiraWorkItemSource, saveJiraConfig, getJiraConfig, isJiraActive } from './jira-client.js'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

const CONFIG = { site: 'https://acme.atlassian.net', email: 'me@acme.io', apiToken: 'tok' }

function ipcReply(status, body) {
  return { ok: status < 300, status, headers: { 'retry-after': null }, body: body === undefined ? '' : JSON.stringify(body) }
}

describe('config', () => {
  it('stores settings under profile-scoped jira.* keys', () => {
    saveJiraConfig({ site: 'acme', email: 'me@acme.io', apiToken: 'tok', projectKeys: ['abc'] })
    expect(localStorage.getItem('p.jira.site')).toBe('https://acme.atlassian.net')
    expect(getJiraConfig().projectKeys).toEqual(['ABC'])
    expect(isJiraActive()).toBe(true)
  })
})

describe('createJiraHttpAdapter', () => {
  it('sends Basic email:token auth through the IPC proxy and wraps the reply', async () => {
    const invoke = vi.fn(async () => ipcReply(200, { displayName: 'Me' }))
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke })
    const res = await http.fetch('rest/api/3/myself')
    expect(invoke).toHaveBeenCalledWith({
      url: 'https://acme.atlassian.net/rest/api/3/myself', method: 'GET',
      headers: { Authorization: 'Basic ' + btoa('me@acme.io:tok'), Accept: 'application/json' },
      body: undefined, attachment: undefined,
    })
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ displayName: 'Me' })
    expect(res.headers.get('Retry-After')).toBeNull()
  })

  it('throws a readable error when the site is not configured', async () => {
    const http = createJiraHttpAdapter({ getConfig: () => ({ site: '' }), invoke: vi.fn() })
    await expect(http.fetch('x')).rejects.toThrow('Jira site not configured')
  })

  it('surfaces proxy network errors', async () => {
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke: async () => ({ ok: false, status: 0, error: 'ENOTFOUND' }) })
    await expect(http.fetch('x')).rejects.toThrow('ENOTFOUND')
  })
})

describe('createJiraWorkItemSource', () => {
  const meta = { priorities: [{ id: '2', name: 'High', rank: 2 }], fieldIds: {} }
  const people = [{ accountId: 'u1', displayName: 'Alex Doe' }]

  function makeSource(routes) {
    const invoke = vi.fn(async ({ url, method }) => {
      for (const [pattern, reply] of Object.entries(routes)) {
        if (`${method} ${url}`.includes(pattern)) return reply
      }
      return ipcReply(204)
    })
    const http = createJiraHttpAdapter({ getConfig: () => CONFIG, invoke })
    return { invoke, source: createJiraWorkItemSource({ http, getMeta: () => meta, getPeople: () => people, getSite: () => CONFIG.site }) }
  }

  it('turns a state write into a workflow transition', async () => {
    const { invoke, source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }] }),
    })
    await source.saveField('jira:ABC-1', 'System.State', 'Done')
    const post = invoke.mock.calls.find(([r]) => r.method === 'POST')[0]
    expect(post.url).toBe('https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions')
    expect(JSON.parse(post.body)).toEqual({ transition: { id: '31' } })
  })

  it('assigns by display name and sets priority by rank', async () => {
    const { invoke, source } = makeSource({})
    await source.saveField('jira:ABC-1', 'System.AssignedTo', 'Alex Doe')
    await source.saveField('jira:ABC-1', 'Microsoft.VSTS.Common.Priority', 2)
    const puts = invoke.mock.calls.filter(([r]) => r.method === 'PUT').map(([r]) => JSON.parse(r.body))
    expect(puts).toEqual([{ fields: { assignee: { accountId: 'u1' } } }, { fields: { priority: { name: 'High' } } }])
  })

  it('rejects assigning someone who is not assignable in Jira', async () => {
    const { source } = makeSource({})
    await expect(source.saveField('jira:ABC-1', 'System.AssignedTo', 'Nobody')).rejects.toThrow("can't be assigned in Jira")
  })

  it('moves to a category via the first matching transition', async () => {
    const { source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [{ id: '5', to: { name: 'Shipped', statusCategory: { key: 'done' } } }] }),
    })
    expect(await source.moveToCategory('jira:ABC-1', 'Completed', { state: 'To Do' })).toEqual({ state: 'Shipped', stateCategory: 'Completed' })
  })

  it('builds browse URLs', () => {
    const { source } = makeSource({})
    expect(source.webUrl({ id: 'jira:ABC-1' })).toBe('https://acme.atlassian.net/browse/ABC-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/desktop test -- src/jira-client`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// apps/desktop/src/jira-client.js — desktop binding for Jira Cloud: profile-scoped
// config, an http adapter over the main-process proxy (Jira has no CORS), and the
// Jira half of the routed workItemSource. Logic lives in @nexusmd/core.
import {
  makeJiraConfig, makeJiraClient, loadCachedJiraData, jiraKeyFromId,
  loadJiraDetail, loadJiraComments, addJiraComment, loadJiraRawFields,
  jiraPatchFromAdoField, transitionJiraIssue, updateJiraIssue, listJiraTransitions,
  fetchJiraCreateTypes, fetchJiraCreateFields, fetchJiraLinkTypes, createJiraIssue,
} from '@nexusmd/core'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { getProfileKey } from './profile-keys.js'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

export const { getJiraConfig, saveJiraConfig, isJiraConfigured, isJiraActive } = makeJiraConfig({
  storage: rawStorage,
  key: (name) => getProfileKey('jira.' + name),
})

export function createJiraHttpAdapter({
  getConfig = getJiraConfig,
  invoke = (req) => window.electronAPI.jira.request(req),
} = {}) {
  return {
    async fetch(path, options = {}) {
      const { site, email, apiToken } = getConfig()
      if (!site) throw new Error('Jira site not configured — open Settings first.')
      const headers = {
        Authorization: 'Basic ' + btoa(`${email}:${apiToken}`),
        Accept: 'application/json',
        ...(options.headers || {}),
      }
      const r = await invoke({
        url: `${site}/${path}`,
        method: options.method || 'GET',
        headers,
        body: options.body,
        attachment: options.attachment,
      })
      if (!r.status && r.error) throw new Error(r.error)
      return {
        ok: r.ok,
        status: r.status,
        headers: { get: (n) => r.headers?.[String(n).toLowerCase()] ?? null },
        text: async () => r.body || '',
        json: async () => JSON.parse(r.body || 'null'),
      }
    },
  }
}

const cachedJira = () => loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter })

export function createJiraWorkItemSource({
  http = createJiraHttpAdapter(),
  getMeta = () => cachedJira()?._jiraMeta || {},
  getPeople = () => cachedJira()?.PEOPLE || [],
  getSite = () => getJiraConfig().site,
} = {}) {
  const client = makeJiraClient(http)
  const keyOf = (id) => jiraKeyFromId(id)
  return {
    loadDetail: (id) => loadJiraDetail(client, keyOf(id), getMeta()),
    loadComments: (id) => loadJiraComments(client, keyOf(id)),
    addComment: (id, _project, html) => addJiraComment(client, keyOf(id), html),
    loadRawFields: (id) => loadJiraRawFields(client, keyOf(id)),
    async saveField(id, field, value) {
      const meta = getMeta()
      const t = jiraPatchFromAdoField(field, value, { people: getPeople(), priorities: meta.priorities || [] })
      if (t.transition) { await transitionJiraIssue(client, keyOf(id), t.transition); return }
      await updateJiraIssue(client, keyOf(id), t.patch, meta)
    },
    moveToCategory: (id, category, item) => transitionJiraIssue(client, keyOf(id), { category }, { currentState: item?.state }),
    async availableTargetStates(id) {
      return (await listJiraTransitions(client, keyOf(id))).map(t => t.toName)
    },
    webUrl: (item) => `${getSite()}/browse/${encodeURIComponent(keyOf(item.id))}`,
    getCreateTypes: (projectKey) => fetchJiraCreateTypes(client, projectKey),
    getCreateFields: (projectKey, typeId) => fetchJiraCreateFields(client, projectKey, typeId, getMeta().fieldIds || {}),
    getLinkTypes: () => fetchJiraLinkTypes(client),
    createIssue: (input, extras) => createJiraIssue(client, input, extras),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/desktop test -- src/jira-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/jira-client.js apps/desktop/src/jira-client.test.js
git commit -m "feat(desktop): Jira config, IPC http adapter and Jira work-item source"
```

---

### Task 15: Desktop settings — Jira connection and display mode

**Files:**
- Create: `apps/desktop/src/jira-settings.jsx`
- Modify: `apps/desktop/src/desktop-settings.jsx` (import; `tab === 'integrations'` block)
- Test: `apps/desktop/src/jira-settings.test.jsx`

**Interfaces:**
- Consumes: `getJiraConfig`, `saveJiraConfig`, `createJiraHttpAdapter` (Task 14); `makeJiraClient` from `@nexusmd/core`; `SettField`, `settInputStyle` from `./desktop-settings.jsx`; `getProfileKey` from `./profile-keys.js`; `CardFrame`, `Icon` from `@nexusmd/ui`.
- Produces:
  - `JiraConnectionCard({ onRefreshData })`
  - `WorkItemsDisplayCard()`, which writes `localStorage[getProfileKey('nexusmd.wi.displayMode')] = JSON.stringify('merged'|'separate')`, the same format `usePersisted` reads.

- [ ] **Step 1: Write the failing test**

```jsx
// apps/desktop/src/jira-settings.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
const jira = vi.hoisted(() => ({
  config: { site: '', email: '', apiToken: '', projectKeys: [], jql: '', enabled: true },
  save: vi.fn(),
  routes: {},
}))
vi.mock('./jira-client.js', () => ({
  getJiraConfig: () => jira.config,
  saveJiraConfig: jira.save,
  createJiraHttpAdapter: () => ({
    fetch: async (path) => {
      const body = Object.entries(jira.routes).find(([p]) => path.includes(p))?.[1]
      const text = JSON.stringify(body ?? {})
      return { ok: !!body, status: body ? 200 : 401, headers: { get: () => null }, text: async () => text, json: async () => body ?? {} }
    },
  }),
}))

import { JiraConnectionCard, WorkItemsDisplayCard } from './jira-settings.jsx'

afterEach(() => { cleanup(); jira.save.mockReset(); jira.routes = {}; localStorage.clear() })

describe('JiraConnectionCard', () => {
  it('tests the connection, shows who is connected and offers projects', async () => {
    jira.routes = {
      'rest/api/3/myself': { displayName: 'Me Person' },
      'rest/api/3/project/search': { values: [{ key: 'ABC', name: 'Alpha' }, { key: 'DEF', name: 'Delta' }] },
    }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@acme.io' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText('Connected as Me Person')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('ABC — Alpha'))
    expect(screen.getByLabelText('Project keys').value).toBe('ABC')
  })

  it('shows the Jira error when the test fails', async () => {
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText(/^Error: .*credentials/)).toBeTruthy())
  })

  it('saves, keeping the existing token when the field is blank, then refreshes', async () => {
    const onRefreshData = vi.fn(() => Promise.resolve())
    render(<JiraConnectionCard onRefreshData={onRefreshData} />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@acme.io' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'abc, def' } })
    fireEvent.click(screen.getByText('Save & connect'))
    expect(jira.save).toHaveBeenLastCalledWith({
      site: 'acme', email: 'me@acme.io', projectKeys: ['abc', 'def'], jql: '', enabled: true,
    })
    expect(onRefreshData).toHaveBeenCalled()
  })
})

describe('WorkItemsDisplayCard', () => {
  it('stores the display mode under the Work Items view key', () => {
    render(<WorkItemsDisplayCard />)
    fireEvent.click(screen.getByText('Separate'))
    expect(localStorage.getItem('nexusmd.wi.displayMode')).toBe('"separate"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/desktop test -- src/jira-settings`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```jsx
// apps/desktop/src/jira-settings.jsx — Jira Cloud connection + work-item display settings.
import React from 'react'
import { CardFrame, Icon } from '@nexusmd/ui'
import { makeJiraClient } from '@nexusmd/core'
import { SettField, settInputStyle } from './desktop-settings.jsx'
import { getJiraConfig, saveJiraConfig, createJiraHttpAdapter } from './jira-client.js'
import { getProfileKey } from './profile-keys.js'

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'
const splitKeys = (s) => s.split(/[,\s]+/).map(k => k.trim()).filter(Boolean)

export function JiraConnectionCard({ onRefreshData }) {
  const [site, setSite]         = React.useState('')
  const [email, setEmail]       = React.useState('')
  const [token, setToken]       = React.useState('')
  const [keys, setKeys]         = React.useState('')
  const [jql, setJql]           = React.useState('')
  const [enabled, setEnabled]   = React.useState(true)
  const [available, setAvailable] = React.useState([])
  const [status, setStatus]     = React.useState('')
  const [busy, setBusy]         = React.useState(false)

  React.useEffect(() => {
    const c = getJiraConfig()
    setSite(c.site || '')
    setEmail(c.email || '')
    setKeys((c.projectKeys || []).join(', '))
    setJql(c.jql || '')
    setEnabled(c.enabled !== false)
  }, [])

  const connectionValues = () => ({
    site: site.trim(), email: email.trim(), ...(token.trim() ? { apiToken: token.trim() } : {}),
  })

  const testConnection = async () => {
    setBusy(true)
    setStatus('Testing…')
    try {
      saveJiraConfig(connectionValues())
      const client = makeJiraClient(createJiraHttpAdapter())
      const me = await client.get('rest/api/3/myself')
      setStatus(`Connected as ${me?.displayName || 'unknown user'}`)
      const projects = await client.get('rest/api/3/project/search?maxResults=100&orderBy=name').catch(() => null)
      setAvailable((projects?.values || []).map(p => ({ key: p.key, name: p.name })))
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'connection failed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleKey = (key) => {
    const current = splitKeys(keys)
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    setKeys(next.join(', '))
  }

  const save = () => {
    saveJiraConfig({ ...connectionValues(), projectKeys: splitKeys(keys), jql: jql.trim(), enabled })
    setToken('')
    setStatus('Saved! Loading data…')
    onRefreshData?.().catch(() => {})
    setTimeout(() => setStatus(''), 3000)
  }

  const isError = status.startsWith('Error')
  const selected = new Set(splitKeys(keys).map(k => k.toUpperCase()))

  return (
    <CardFrame title="Jira Cloud Connection" icon={<Icon name="settings" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Load Jira work items
        </label>
        <SettField label="Site" hint="yoursite, yoursite.atlassian.net, or a full Jira URL">
          <input aria-label="Site" value={site} onChange={e => setSite(e.target.value)} placeholder="yoursite" style={settInputStyle} />
        </SettField>
        <SettField label="Email" hint="The Atlassian account email the API token belongs to">
          <input aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={settInputStyle} />
        </SettField>
        <SettField label="API token" hint="Leave blank to keep the existing token.">
          <input aria-label="API token" type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="Leave blank to keep existing token" style={settInputStyle} />
          <a href={TOKEN_URL} target="_blank" rel="noopener" style={{ fontSize: 11.5 }}
            onClick={e => { if (window.electronAPI?.openLink) { e.preventDefault(); window.electronAPI.openLink(TOKEN_URL) } }}>
            Create an API token
          </a>
        </SettField>
        <SettField label="Project keys" hint="Comma-separated, e.g. ABC, DEF. Test the connection to pick from a list.">
          <input aria-label="Project keys" value={keys} onChange={e => setKeys(e.target.value)} placeholder="ABC, DEF" style={settInputStyle} />
        </SettField>
        {available.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {available.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" aria-label={`${p.key} — ${p.name}`} checked={selected.has(p.key)} onChange={() => toggleKey(p.key)} />
                <span className="mono">{p.key}</span> {p.name}
              </label>
            ))}
          </div>
        )}
        <details>
          <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>Advanced</summary>
          <SettField label="Extra JQL filter" hint="ANDed with the project filter, e.g. assignee in membersOf(&quot;my-team&quot;)">
            <input aria-label="Extra JQL filter" value={jql} onChange={e => setJql(e.target.value)} style={settInputStyle} />
          </SettField>
        </details>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={testConnection} disabled={busy}>
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>Save &amp; connect</button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>{status}</span>
          )}
        </div>
      </div>
    </CardFrame>
  )
}

const DISPLAY_KEY = 'nexusmd.wi.displayMode'

export function WorkItemsDisplayCard() {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(getProfileKey(DISPLAY_KEY)) || '"merged"') } catch { return 'merged' }
  }
  const [mode, setMode] = React.useState(read)
  const choose = (m) => {
    setMode(m)
    try { localStorage.setItem(getProfileKey(DISPLAY_KEY), JSON.stringify(m)) } catch { /* quota */ }
  }
  return (
    <CardFrame title="Work Items Display" icon={<Icon name="list" size={16} />}>
      <SettField label="When both ADO and Jira are connected" hint="Also switchable from the Work Items toolbar.">
        <div style={{ display: 'flex', gap: 6 }}>
          {[['merged', 'Merged'], ['separate', 'Separate']].map(([v, l]) => (
            <button key={v} className={`btn sm ${mode === v ? 'primary' : 'ghost'}`} aria-pressed={mode === v} onClick={() => choose(v)}>{l}</button>
          ))}
        </div>
      </SettField>
    </CardFrame>
  )
}
```

In `apps/desktop/src/desktop-settings.jsx`, add this import below the `./ado-client.js` import:

```js
import { JiraConnectionCard, WorkItemsDisplayCard } from './jira-settings.jsx'
```

and change the integrations block from:

```jsx
          {tab === 'integrations' && (
            <>
              <AdoConnectionCard onRefreshData={onRefreshData} />
              <DatabaseConnectionCard />
```

to:

```jsx
          {tab === 'integrations' && (
            <>
              <AdoConnectionCard onRefreshData={onRefreshData} />
              <JiraConnectionCard onRefreshData={onRefreshData} />
              <WorkItemsDisplayCard />
              <DatabaseConnectionCard />
```

`AdoConnectionCard.test.jsx` and `desktop-settings.test.jsx` mock `@nexusmd/ui` with a fixed component list and may now fail on `CardFrame`/`Icon` from the new import. If so, add this to each file:

```js
vi.mock('./jira-settings.jsx', () => ({ JiraConnectionCard: () => null, WorkItemsDisplayCard: () => null }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w apps/desktop test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/jira-settings.jsx apps/desktop/src/jira-settings.test.jsx apps/desktop/src/desktop-settings.jsx apps/desktop/src/AdoConnectionCard.test.jsx apps/desktop/src/desktop-settings.test.jsx
git commit -m "feat(desktop): Jira connection and work-item display settings"
```

---

### Task 16: Desktop data wiring — refresh, merged snapshot, routed source

**Files:**
- Create: `apps/desktop/src/work-item-data.js`
- Modify: `apps/desktop/src/main.jsx`
- Test: `apps/desktop/src/work-item-data.test.js`

**Interfaces:**
- Consumes: `loadCachedAdoData`, `loadCachedJiraData`, `mergeWorkItemData`, `readProviderStatus`, `recordProviderStatus`, `adoStateForCategory`, `CATEGORY_LABELS`, `displayIdOf`, `loadJiraData` from `@nexusmd/core`; `createRoutedWorkItemSource` from `@nexusmd/ui`; `getJiraConfig`, `isJiraActive`, `createJiraHttpAdapter`, `createJiraWorkItemSource` (Task 14).
- Produces:
  - `buildSnapshot({ adoConfig, adoConfigured, jiraConfig, jiraActive, storage, empty }) → snapshot`
  - `refreshProviders({ storage, providers: { [id]: { configured, run } } }) → Promise<void>` (never throws; records status per provider)
  - `adoMoveToCategory({ item, category, meta, saveState }) → { state, stateCategory }`
  - `defaultCreateProvider({ readJson, adoAvailable, jiraAvailable }) → 'ado'|'jira'`
  - In `main.jsx`: `refreshAllData()` replaces `refreshAdoData()`; `nexusDataValue.workItemSource` is the routed source.

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/work-item-data.test.js
import { describe, it, expect, vi } from 'vitest'
import { JIRA_CACHE_KEY, ADO_CACHE_KEY, WORK_ITEM_STATUS_KEY } from '@nexusmd/core'
import { buildSnapshot, refreshProviders, adoMoveToCategory, defaultCreateProvider } from './work-item-data.js'

function storage(seed = {}) {
  const s = { ...seed }
  return { get: k => s[k] ?? null, set: (k, v) => { s[k] = v }, _s: s }
}
const EMPTY = { WORK_ITEMS: [], TEAM: [], PRS: [] }

describe('buildSnapshot', () => {
  it('merges the ADO and Jira caches over the empty shape, keeping ADO-only fields', () => {
    const st = storage({
      [ADO_CACHE_KEY]: { ORG: 'o', WORK_ITEMS: [{ id: 1, state: 'Active' }], PRS: [{ id: 9 }], TEAM: [] },
      [JIRA_CACHE_KEY]: { SITE: 'https://a.atlassian.net', WORK_ITEMS: [{ id: 'jira:A-1', source: 'jira' }], PEOPLE: [] },
    })
    const snap = buildSnapshot({
      adoConfig: { org: 'o' }, adoConfigured: true,
      jiraConfig: { site: 'https://a.atlassian.net' }, jiraActive: true,
      storage: st, empty: EMPTY,
    })
    expect(snap.WORK_ITEMS.map(w => w.id)).toEqual([1, 'jira:A-1'])
    expect(snap.PRS).toEqual([{ id: 9 }])
    expect(snap.WORK_ITEM_PROVIDERS.map(p => p.id)).toEqual(['ado', 'jira'])
  })

  it('ignores the Jira cache when Jira is not active', () => {
    const st = storage({ [JIRA_CACHE_KEY]: { SITE: 's', WORK_ITEMS: [{ id: 'jira:A-1' }] } })
    const snap = buildSnapshot({ adoConfig: {}, adoConfigured: false, jiraConfig: { site: 's' }, jiraActive: false, storage: st, empty: EMPTY })
    expect(snap.WORK_ITEMS).toEqual([])
  })
})

describe('refreshProviders', () => {
  it('runs configured providers, records each outcome and never throws', async () => {
    const st = storage()
    const ado = vi.fn(async () => {})
    const jira = vi.fn(async () => { throw Object.assign(new Error('nope'), { status: 401 }) })
    const skipped = vi.fn()
    await refreshProviders({ storage: st, providers: {
      ado: { configured: true, run: ado },
      jira: { configured: true, run: jira },
      other: { configured: false, run: skipped },
    } })
    expect(ado).toHaveBeenCalled()
    expect(skipped).not.toHaveBeenCalled()
    expect(st._s[WORK_ITEM_STATUS_KEY]).toMatchObject({ ado: { status: 'ok' }, jira: { status: 'error', error: 'auth failed — check settings' } })
  })
})

describe('adoMoveToCategory', () => {
  const meta = { typeStates: { Bug: ['New', 'Active', 'Closed'] }, stateCategoryByName: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' } }
  it('saves the first state in the category for the item type', async () => {
    const saveState = vi.fn(async () => {})
    expect(await adoMoveToCategory({ item: { type: 'bug' }, category: 'Completed', meta, saveState })).toEqual({ state: 'Closed', stateCategory: 'Completed' })
    expect(saveState).toHaveBeenCalledWith('Closed')
  })
  it('falls back to "Done" for Completed when metadata is missing', async () => {
    const saveState = vi.fn(async () => {})
    expect(await adoMoveToCategory({ item: { type: 'bug' }, category: 'Completed', meta: {}, saveState })).toEqual({ state: 'Done', stateCategory: 'Completed' })
  })
  it('throws when no state fits', async () => {
    await expect(adoMoveToCategory({ item: { type: 'bug' }, category: 'Resolved', meta, saveState: vi.fn() }))
      .rejects.toThrow('No Resolved state for bug in ADO')
  })
})

describe('defaultCreateProvider', () => {
  const reader = (values) => (k, d) => (k in values ? values[k] : d)
  it('uses the active tab in separate mode', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.displayMode': 'separate', 'nexusmd.wi.sourceTab': 'jira' }), adoAvailable: true, jiraAvailable: true })).toBe('jira')
  })
  it('uses the last provider used otherwise', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'jira' }), adoAvailable: true, jiraAvailable: true })).toBe('jira')
  })
  it('falls back to whichever provider is available', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'ado' }), adoAvailable: false, jiraAvailable: true })).toBe('jira')
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'jira' }), adoAvailable: true, jiraAvailable: false })).toBe('ado')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/desktop test -- src/work-item-data`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `work-item-data.js`**

```js
// apps/desktop/src/work-item-data.js — combine provider caches into the snapshot the
// shared views read, and refresh providers independently (one failing never blocks
// the other; its last cache stays visible, marked stale).
import {
  loadCachedAdoData, loadCachedJiraData, mergeWorkItemData,
  readProviderStatus, recordProviderStatus, adoStateForCategory, CATEGORY_LABELS,
} from '@nexusmd/core'

export function buildSnapshot({ adoConfig, adoConfigured, jiraConfig, jiraActive, storage, empty }) {
  const ado = loadCachedAdoData(adoConfig, { storage })
  const jira = jiraActive ? loadCachedJiraData(jiraConfig, { storage }) : null
  const merged = mergeWorkItemData({
    ado, jira, status: readProviderStatus(storage), configured: { ado: !!adoConfigured, jira: !!jiraActive },
  })
  return { ...empty, ...(ado || {}), ...merged }
}

export async function refreshProviders({ storage, providers }) {
  await Promise.all(Object.entries(providers)
    .filter(([, p]) => p?.configured)
    .map(([id, p]) => Promise.resolve()
      .then(() => p.run())
      .then(
        () => recordProviderStatus(storage, id, { ok: true }),
        (error) => recordProviderStatus(storage, id, { ok: false, error }),
      )))
}

export async function adoMoveToCategory({ item, category, meta, saveState }) {
  const state = adoStateForCategory(item, category, meta || {}) || (category === 'Completed' ? 'Done' : null)
  if (!state) throw new Error(`No ${CATEGORY_LABELS[category] || category} state for ${item?.type || 'this type'} in ADO`)
  await saveState(state)
  return { state, stateCategory: category }
}

export function defaultCreateProvider({ readJson, adoAvailable, jiraAvailable }) {
  const preferred = readJson('nexusmd.wi.displayMode', 'merged') === 'separate'
    ? readJson('nexusmd.wi.sourceTab', 'ado')
    : readJson('nexusmd.wi.createProvider', 'ado')
  if (preferred === 'jira' && jiraAvailable) return 'jira'
  if (adoAvailable) return 'ado'
  return jiraAvailable ? 'jira' : 'ado'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/desktop test -- src/work-item-data`
Expected: PASS

- [ ] **Step 5: Wire `main.jsx`**

Make these edits in `apps/desktop/src/main.jsx`:

1. Imports. Extend the `@nexusmd/core` import to:

```js
import {
  initCore, createNoOpAdapters, core, loadCachedAdoData, loadAdoData,
  loadCachedJiraData, loadJiraData, displayIdOf,
} from '@nexusmd/core'
```

Add `createRoutedWorkItemSource` to the `@nexusmd/ui` import list. Below the `./ado-client.js` import, add:

```js
import { getJiraConfig, isJiraActive, createJiraHttpAdapter, createJiraWorkItemSource } from './jira-client.js'
import { buildSnapshot, refreshProviders, adoMoveToCategory, defaultCreateProvider } from './work-item-data.js'
```

2. Replace the whole `async function refreshAdoData() { … }` with:

```js
// Manual + timed refresh for every work-item provider. ADO also loads PRs/builds/
// tests. Each provider records its own outcome; a failure keeps its cached data.
async function refreshAllData() {
  try {
    await refreshProviders({
      storage: localStorageAdapter,
      providers: {
        ado: {
          configured: isAdoConfigured(),
          run: () => {
            const priorData = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
            return loadAdoData(
              getAdoConfig(),
              { http: createAdoHttpAdapter(), storage: localStorageAdapter },
              { isRefresh: !!priorData && (priorData.TEAM?.length ?? 0) > 0, priorData },
            )
          },
        },
        jira: {
          configured: isJiraActive(),
          run: () => {
            const priorData = loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter })
            return loadJiraData(
              getJiraConfig(),
              { http: createJiraHttpAdapter(), storage: localStorageAdapter },
              { isRefresh: !!priorData?._jiraMeta, priorData },
            )
          },
        },
      },
    })
  } finally { core._emit?.('data:updated') }
  // Check GitHub token health — fires nexusmd:github-401 event if expired
  try {
    const ghService = makeDesktopOAuthService('github')
    if (ghService?.getToken) {
      await ghService.getToken({ force: true }).catch(() => {})
    }
  } catch {}
}
```

Then run `grep -n "refreshAdoData" apps/desktop/src/main.jsx` and rename every remaining occurrence to `refreshAllData`. These are the F5 handler, the refresh-interval tick, `api: { load: … }`, and the settings `onRefreshData` prop.

3. Add these two methods to `desktopWorkItemSource`, after `createWorkItem`:

```js
  async moveToCategory(id, category, item) {
    const meta = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })?._adoMeta
    return adoMoveToCategory({ item, category, meta, saveState: (state) => this.saveField(id, 'System.State', state) })
  },
  webUrl(item) {
    const { org } = getAdoConfig()
    if (!org || !item?.project) return null
    const proj = String(item.project).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/edit/${item.id}`
  },
```

4. In `useNexusSnapshot`, replace the body of `refresh`'s `try` with:

```js
    try {
      setSnapshot(buildSnapshot({
        adoConfig: getAdoConfig(), adoConfigured: isAdoConfigured(),
        jiraConfig: getJiraConfig(), jiraActive: isJiraActive(),
        storage: localStorageAdapter, empty: EMPTY_NEXUS_DATA,
      }))
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
```

5. In `nexusDataValue`, replace `workItemSource: desktopWorkItemSource,` with:

```js
    workItemSource: createRoutedWorkItemSource({
      ado: desktopWorkItemSource,
      jira: isJiraActive() ? createJiraWorkItemSource() : null,
    }),
```

6. In `DesktopDetailDrawer`:
   - Add `const { workItemSource } = useNexusData()` at the top.
   - Change the `adoUrl` computation's `kind === 'wi'` branch to `kind === 'wi' ? workItemSource.webUrl(d)`. Keep the `pr` and `build` branches as they are.
   - Replace `markDone` with:

```js
  const markDone = async () => {
    try {
      const r = await workItemSource.moveToCategory(d.id, 'Completed', d)
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: r.state, stateCategory: r.stateCategory } : w))
      toast?.('Marked done', 'success')
      onClose()
    } catch (e) {
      toast?.('Could not update: ' + (e?.message || 'unknown error'), 'error')
    }
  }
```

   - In the `wi` badge, change `#{d.id}` to `{displayIdOf(d)}`.
   - Change the open-link button label `Open in {kind === 'wi' || kind === 'build' ? 'ADO' : 'browser'}` to:

```jsx
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? (d?.source === 'jira' ? 'Jira' : 'ADO') : kind === 'build' ? 'ADO' : 'browser'}
```

7. In `ViewBody`, Jira-only users have no ADO config, so the dashboard should not show the ADO welcome card for them. Change the `configured` line to:

```js
  const configured = activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() || isJiraActive() } catch { return false } })()
```

- [ ] **Step 6: Run the desktop suite and build**

Run: `npm -w apps/desktop test`
Expected: PASS

Run: `npm -w apps/desktop run build` (or the repo's desktop build script if named differently in `apps/desktop/package.json`)
Expected: build succeeds with no unresolved imports.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/work-item-data.js apps/desktop/src/work-item-data.test.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): refresh ADO and Jira independently and serve a merged snapshot"
```

---

### Task 17: Work Items view — display mode, source tabs, status pills, id links, category board

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/workitems-providers.test.jsx`

**Interfaces:**
- Consumes: `CATEGORY_LANES`, `CATEGORY_LABELS`, `itemCategory`, `displayIdOf`, `isJiraId` from `@nexusmd/core`. Snapshot fields `WORK_ITEM_PROVIDERS` and `WI_TYPE_STATES_BY_SOURCE` (Task 10). `workItemSource.moveToCategory`, `availableTargetStates` and `webUrl` (Task 12). `patchWorkItem` returning a boolean (Task 12).
- Produces:
  - `WorkItemIdLink({ w, fontSize })` exported from `@nexusmd/ui`.
  - Persisted view keys `nexusmd.wi.displayMode` (`'merged'|'separate'`) and `nexusmd.wi.sourceTab` (`'ado'|'jira'`).
  - `WIBoard` / `BoardLanes` accept `laneMode` (`'state'|'category'`); `BoardLanes` accepts `reachable` (`Set|null`).

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/workitems-providers.test.jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView, WorkItemIdLink } from '../src/index.js'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/toast.jsx', () => ({ toast, ToastHost: () => null }))

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const ADO_ITEM = { id: 7, source: 'ado', displayId: '#7', type: 'bug', title: 'ADO bug', project: 'web', state: 'Active', stateCategory: 'InProgress', assignee: null, priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '1h' }
const JIRA_ITEM = { id: 'jira:ABC-1', source: 'jira', displayId: 'ABC-1', type: 'story', title: 'Jira story', project: 'abc', state: 'To Do', stateCategory: 'Proposed', assignee: null, priority: 3, points: 0, tags: [], comments: 0, prs: 0, updated: '2h' }
const PROVIDERS = [
  { id: 'ado', label: 'Azure DevOps', status: 'ok', error: null },
  { id: 'jira', label: 'Jira', status: 'stale', error: 'auth failed — check settings' },
]

function renderView({ seed = {}, source = {}, items = [ADO_ITEM, JIRA_ITEM], providers = PROVIDERS, setItems = () => {} } = {}) {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify('board'), ...seed })
  const workItemSource = { saveField: vi.fn(async () => {}), webUrl: (w) => (w.source === 'jira' ? `https://a.atlassian.net/browse/${w.displayId}` : null), ...source }
  render(
    <NexusDataProvider value={{
      storage, getProfileKey: k => k, pushPref: () => {}, workItemSource,
      data: {
        ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: items, WORK_ITEM_PROVIDERS: providers,
        WI_TYPE_STATES_BY_SOURCE: { jira: { story: ['To Do', 'In Progress', 'Done'] } },
      },
    }}>
      <WorkItemsView items={items} setItems={setItems} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  return { workItemSource, storage }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); toast.mockReset() })

it('shows category lanes on the merged board when two providers are connected', () => {
  renderView()
  for (const label of ['Proposed', 'In Progress', 'Resolved', 'Completed']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByText('ADO bug')).toBeTruthy()
  expect(screen.getByText('Jira story')).toBeTruthy()
})

it('shows the provider status pill for a stale provider', () => {
  renderView()
  expect(screen.getByText('Jira: auth failed — check settings (showing cached)')).toBeTruthy()
})

it('in separate mode shows source tabs and only that source\'s items, with its real states as lanes', () => {
  renderView({ seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"jira"' } })
  expect(screen.getByRole('tab', { name: /Jira/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('ADO bug')).toBeNull()
  expect(screen.getByText('Jira story')).toBeTruthy()
  expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('tab', { name: /Azure DevOps/ }))
  expect(screen.getByRole('tab', { name: /Azure DevOps/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('Jira story')).toBeNull()
})

it('keeps today\'s single-provider UI when only one provider is connected', () => {
  renderView({ items: [ADO_ITEM], providers: [PROVIDERS[0]] })
  expect(screen.queryByRole('group', { name: 'Display mode' })).toBeNull()
  expect(screen.queryByText('Proposed')).toBeNull()
})

it('moves a card by category on drop and applies the returned state', async () => {
  const moveToCategory = vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' }))
  const setItems = vi.fn()
  renderView({ source: { moveToCategory }, setItems })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('Completed').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(moveToCategory).toHaveBeenCalledWith('jira:ABC-1', 'Completed', expect.objectContaining({ id: 'jira:ABC-1' })))
  await waitFor(() => expect(setItems).toHaveBeenCalled())
})

it('toasts and leaves the card when a category move fails', async () => {
  const moveToCategory = vi.fn(async () => { throw new Error('No transition from "To Do" to "Completed" in this workflow') })
  renderView({ source: { moveToCategory } })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('Completed').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('No transition'), 'error'))
})

it('renders Jira keys and links via the source', () => {
  const storage = memStorage()
  render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, data: { ORG: 'o', WORK_ITEM_PROVIDERS: PROVIDERS }, workItemSource: { webUrl: () => 'https://a.atlassian.net/browse/ABC-1' } }}>
      <WorkItemIdLink w={JIRA_ITEM} />
    </NexusDataProvider>
  )
  const link = screen.getByText('ABC-1')
  expect(link.getAttribute('href')).toBe('https://a.atlassian.net/browse/ABC-1')
  expect(screen.getByText('Jira')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/ui test -- workitems-providers`
Expected: FAIL — `WorkItemIdLink` is not exported; no category lanes.

- [ ] **Step 3: Implement the view changes**

All edits are in `packages/ui/src/views/view-workitems.jsx` unless noted.

**3a. Imports.** Extend the `@nexusmd/core` import line with `CATEGORY_LANES, CATEGORY_LABELS, itemCategory, displayIdOf, isJiraId`.

**3b. New components.** Add these after the `ActiveFilterChip` function:

```jsx
const SOURCE_LABELS = { ado: 'ADO', jira: 'Jira' };

const adoItemUrl = (org, w) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(String(w.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${w.id}`;

// Id link for a work item: "#123" for ADO, "ABC-12" for Jira, with a source badge
// when more than one provider is connected.
export function WorkItemIdLink({ w, fontSize = 12 }) {
  const { data: NexusMDData, workItemSource } = useNexusData();
  const multi = (NexusMDData.WORK_ITEM_PROVIDERS || []).length > 1;
  const url = workItemSource?.webUrl?.(w) || adoItemUrl(NexusMDData.ORG, w);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {multi && (
        <span data-source={w.source || 'ado'} style={{ fontSize: 9.5, padding: '0 5px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {SOURCE_LABELS[w.source || 'ado']}
        </span>
      )}
      <a href={url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
        style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize }}>{displayIdOf(w)}</a>
    </span>
  );
}

function ProviderStatusPills({ providers = [] }) {
  return providers.filter(p => p.status === 'error' || p.status === 'stale').map(p => (
    <span key={p.id} role="status" title={p.error || ''}
      style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--danger)', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
      {p.label}: {p.error || 'load failed'}{p.status === 'stale' ? ' (showing cached)' : ''}
    </span>
  ));
}
```

**3c. Replace the two hard-coded ADO id anchors.**
- In `WITable`'s id cell, replace the `<a href={`https://dev.azure.com/…`} …>#{w.id}</a>` element with `<WorkItemIdLink w={w} />`.
- In `BoardCard`'s `board-card-head`, replace the `<a …>#{w.id}</a>` element (it spans three lines) with:

```jsx
        <WorkItemIdLink w={w} fontSize={11.5} />
        {showState && <span className="muted" style={{ fontSize: 10.5 }}>{w.state}</span>}
```

Then add `showState = false` to `BoardCard`'s props.

**3d. View state.** In `WorkItemsView`, after the `boardColumnConfig` `usePersisted` line, add:

```js
  const [displayMode, setDisplayMode] = usePersisted('nexusmd.wi.displayMode', 'merged');
  const [sourceTab,   setSourceTab]   = usePersisted('nexusmd.wi.sourceTab',   'ado');
```

**3e. Source filtering.** Replace the `allItems` memo (and the comment above it) with:

```js
  const providers = NexusMDData.WORK_ITEM_PROVIDERS || [];
  const multiProvider = providers.length > 1;
  const separate = multiProvider && displayMode === 'separate';
  const activeSource = separate ? (providers.some(p => p.id === sourceTab) ? sourceTab : providers[0].id) : null;
  const laneMode = multiProvider && !separate ? 'category' : 'state';
  const sourceItems = useMemoW(
    () => (activeSource ? items.filter(i => (i.source || 'ado') === activeSource) : items),
    [items, activeSource],
  );
  const jiraLanes = useMemoW(() => {
    const fromMeta = [...new Set(Object.values(NexusMDData.WI_TYPE_STATES_BY_SOURCE?.jira || {}).flat())];
    return fromMeta.length ? fromMeta : [...new Set(sourceItems.map(w => w.state).filter(Boolean))];
  }, [NexusMDData.WI_TYPE_STATES_BY_SOURCE, sourceItems]);

  // Merged view: prop items (initial load + background refresh) + any extra pages loaded,
  // each annotated with its real linked-PR count. In separate mode, only the active source.
  const allItems = useMemoW(() => {
    const seen = new Set(sourceItems.map(i => i.id));
    const merged = [...sourceItems, ...extraItems.filter(i => !seen.has(i.id))];
    return merged.map(i => ({ ...i, prs: prIndex.get(i.id)?.length ?? 0 }));
  }, [sourceItems, extraItems, prIndex]);
```

**3f. Toolbar.** Inside `<div className="page-head-actions">`, before the Table/Board toggle `<div>`, add:

```jsx
          {multiProvider && (
            <div role="group" aria-label="Display mode" style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 6, padding: 2 }}>
              {[['merged', 'Merged'], ['separate', 'Separate']].map(([v, l]) => (
                <button key={v} className="btn sm ghost" aria-pressed={displayMode === v} onClick={() => setDisplayMode(v)}
                  style={displayMode === v ? { background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' } : null}>{l}</button>
              ))}
            </div>
          )}
          <ProviderStatusPills providers={providers} />
```

**3g. Source tabs.** Directly after the closing `</div>` of `page-head`, before `{initialNewCount > 0 && …}`, add:

```jsx
      {separate && (
        <div role="tablist" aria-label="Work item source" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {providers.map(p => (
            <button key={p.id} role="tab" aria-selected={activeSource === p.id} className="btn sm ghost"
              onClick={() => setSourceTab(p.id)}
              style={activeSource === p.id ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : null}>
              {p.label} <span className="muted mono" style={{ fontSize: 11 }}>{items.filter(i => (i.source || 'ado') === p.id).length}</span>
            </button>
          ))}
        </div>
      )}
```

**3h. Board props.** Change the `WIBoard` usage's `lanes=` prop, and add `laneMode`:

```jsx
        : <WIBoard items={filtered} updateItem={updateItem} moveState={moveState}
                   onOpen={onOpen} grouping={boardGrouping} team={TEAM} showEmptyAssignees={showEmptyAssignees}
                   laneMode={laneMode}
                   lanes={laneMode === 'category' ? CATEGORY_LANES
                     : activeSource === 'jira' ? jiraLanes
                     : getActiveLanes(boardColumnConfig, activeProject, PROJECTS, BOARD_LANES)}
                   newItemIds={newItemIds}/>
```

**3i. Lane colours.** Add these entries to `BOARD_LANE_COLORS`:

```js
  'Proposed':    'var(--text-muted)',
  'InProgress':  'var(--info)',
  'Completed':   'var(--success)',
```

**3j. `DragContextBar`.** Add a `laneLabel = (s) => s` prop. Inside its `lanes.map(state => …)`, change the visible text `{state}` to `{laneLabel(state)}`. Keep `key={state}` and `onDropState(state)` unchanged.

**3k. `BoardLanes`.** Add `laneMode = 'state'` and `reachable = null` to its props. Replace the `laneItems` line and lane header, and merge the dim style:

```jsx
      {lanes.map(state => {
        const laneItems = laneMode === 'category'
          ? items.filter(w => itemCategory(w) === state)
          : items.filter(w => w.state === state || adoStateToNexusMD(w.state) === state);
        const laneLabel = laneMode === 'category' ? CATEGORY_LABELS[state] : state;
        const dimmed = !!reachable && !reachable.has(state);
        const isOver = overKey === `${groupKey}::${state}`;
        return (
          <div
            key={state}
            className="lane"
            onDragOver={e => { e.preventDefault(); onLaneOver(`${groupKey}::${state}`); }}
            onDrop={e => { e.preventDefault(); onLaneDrop(state, groupKey); }}
            style={{
              ...(isOver ? { background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' } : {}),
              ...(dimmed ? { opacity: 0.4 } : {}),
            }}
          >
            <div className="lane-head">
              <span className="lane-dot" style={{ background: laneColor(state) }}/>
              <h4>{laneLabel}</h4>
```

Pass `showState={laneMode === 'category'}` to each `<BoardCard …>` rendered in `BoardLanes`.

**3l. `WIBoard`.** Add `laneMode = 'state'` to its props. Replace `onDragStart`, `onDragEnd`, `onLaneDrop` and `onDropState` with the code below, and add `laneMode` and `reachable` to `laneProps`:

```js
  const [reachable, setReachable] = useStateW(null);
  const dragRef = React.useRef(null);

  // On a state-lane board, dim columns a Jira item's workflow can't reach.
  const onDragStart = (id) => {
    setDragId(id);
    dragRef.current = id;
    setReachable(null);
    if (laneMode === 'state' && isJiraId(id) && workItemSource?.availableTargetStates) {
      const current = items.find(w => w.id === id)?.state;
      workItemSource.availableTargetStates(id)
        .then(states => { if (states && dragRef.current === id) setReachable(new Set([...states, current])); })
        .catch(() => {});
    }
  };
  const endDrag = () => { setDragId(null); setOverKey(null); setReachable(null); dragRef.current = null; };
  const onDragEnd = endDrag;

  const moveToCategory = async (id, category) => {
    const item = items.find(w => w.id === id);
    if (!item || itemCategory(item) === category) return;
    if (!workItemSource?.moveToCategory) { toast?.('✗ Moving between categories is not supported here', 'error'); return; }
    try {
      const r = await workItemSource.moveToCategory(id, category, item);
      updateItem(id, { state: r.state, stateCategory: r.stateCategory });
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Move failed'), 'error');
    }
  };

  // Drop on a lane column — also updates grouping field when card crosses swimlanes
  const onLaneDrop = async (state, groupKey) => {
    if (dragId == null) return;
    const id = dragId;
    const prev = items.find(w => w.id === id);
    endDrag();
    const assigneeChange = grouping === 'assignee' && groupKey && groupKey !== '__all__';
    const assigneeId = assigneeChange ? (groupKey === 'unassigned' ? null : groupKey) : undefined;
    const member = assigneeChange ? team.find(t => t.id === assigneeId) : null;
    if (laneMode === 'category') {
      await moveToCategory(id, state);
      if (assigneeChange && prev?.assignee !== assigneeId) {
        updateItem(id, { assignee: assigneeId });
        if (!(await patchWI(id, [['/fields/System.AssignedTo', member?.name || null]]))) updateItem(id, { assignee: prev?.assignee ?? null });
      }
      return;
    }
    const patches = [['/fields/System.State', state]];
    const updates = { state };
    if (assigneeChange) {
      patches.push(['/fields/System.AssignedTo', member?.name || null]);
      updates.assignee = assigneeId;
    }
    updateItem(id, updates);
    if (!(await patchWI(id, patches)) && prev) updateItem(id, { state: prev.state, assignee: prev.assignee });
  };

  // Drop on the context bar — state target
  const onDropState = async (state) => {
    if (dragId == null) return;
    const id = dragId;
    const prev = items.find(w => w.id === id);
    endDrag();
    if (laneMode === 'category') { await moveToCategory(id, state); return; }
    moveState(id, state);
    if (!(await patchWI(id, [['/fields/System.State', state]])) && prev) updateItem(id, { state: prev.state });
  };
```

`onDropAssignee` stays as it is, except replace its trailing `setDragId(null); setOverKey(null);` with `endDrag();`.

Change `laneProps` to:

```js
  const laneProps = { dragId, overKey, onDragStart, onDragEnd, onLaneOver, onLaneDrop, onOpen, lanes, team, onAssign: onAssignCard, onTagsChange: onTagsCard, grouping, projects: PROJECTS, newItemIds, laneMode, reachable };
```

Pass the label function to the board's `DragContextBar`:

```jsx
      <DragContextBar
        visible={dragId != null}
        team={team}
        lanes={lanes}
        laneLabel={laneMode === 'category' ? (s => CATEGORY_LABELS[s]) : undefined}
        onDropState={onDropState}
        onDropAssignee={onDropAssignee}
      />
```

**3m. `WITable` table drag and bulk mark-done.** Replace `WITable`'s `onDropState` with:

```js
  const onDropState = async (state) => {
    if (!tableDragId) return;
    const id = tableDragId;
    const prev = items.find(w => w.id === id);
    setTableDragId(null);
    updateItem(id, { state });
    if (!(await patchWI(id, [['/fields/System.State', state]])) && prev) updateItem(id, { state: prev.state });
  };
```

Replace the `onMarkDone` handler passed to `BulkBar` with:

```js
          onMarkDone={async () => {
            const selected = items.filter(w => selection.has(w.id));
            setSelection(new Set());
            const failures = [];
            await Promise.all(selected.map(async w => {
              try {
                if (workItemSource?.moveToCategory) {
                  const r = await workItemSource.moveToCategory(w.id, 'Completed', w);
                  updateItem(w.id, { state: r.state, stateCategory: r.stateCategory });
                } else {
                  updateItem(w.id, { state: 'Done' });
                  if (!(await patchWI(w.id, [['/fields/System.State', 'Done']]))) failures.push(`${displayIdOf(w)}: save failed`);
                }
              } catch (e) {
                failures.push(`${displayIdOf(w)}: ${e?.message || 'failed'}`);
              }
            }));
            if (failures.length) toast?.(`✗ ${failures.length} of ${selected.length} not marked done — ${failures.join('; ')}`, 'error');
          }}
```

**3n. Export.** In `packages/ui/src/index.js`, change the WorkItemsView export line to:

```js
export { WorkItemsView, WorkItemIdLink, WI_TYPE_STATES_CACHE_KEY } from './views/view-workitems.jsx'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/ui test`
Expected: PASS — new tests plus all existing work-item tests (`workitem-pagination`, `wi-table-fields`, `board-card-fields`, `workitem-linked-prs`, `views`). If `board-card-fields` or `wi-table-fields` assert on the old `#7` anchor `href`, they still pass: with no `webUrl` on the source, `WorkItemIdLink` falls back to the same dev.azure.com URL and `#7` text.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/src/index.js packages/ui/tests/workitems-providers.test.jsx
git commit -m "feat(ui): merged/separate work-item views with category board and provider status"
```

---

### Task 18: Fields editor — per-source states, priorities and people

**Files:**
- Modify: `packages/ui/src/views/work-item-detail.jsx` (`WorkItemFieldsEditor`)
- Test: `packages/ui/tests/work-item-fields-jira.test.jsx`

**Interfaces:**
- Consumes: snapshot `WI_TYPE_STATES_BY_SOURCE`, `PRIORITIES_BY_SOURCE`, `JIRA_PEOPLE`, `TEAM` (Task 10); `slugify` from `@nexusmd/core`; `workItemSource.saveField` (routed, Task 12).
- Produces: no new exports. Jira items get their type's states, Jira priority names, and Jira-assignable people, and the Area row is hidden. ADO items are unchanged.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/work-item-fields-jira.test.jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemFieldsEditor } from '../src/index.js'

vi.mock('../src/toast.jsx', () => ({ toast: vi.fn(), ToastHost: () => null }))

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const DATA = {
  STATES: ['New', 'Active', 'Closed', 'To Do', 'In Progress', 'Done'],
  TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }, { id: 'ado-only', name: 'Ado Only' }],
  WORK_ITEMS: [],
  WI_TYPE_STATES_BY_SOURCE: { jira: { story: ['To Do', 'In Progress', 'Done'] } },
  PRIORITIES_BY_SOURCE: { jira: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }] },
  JIRA_PEOPLE: [{ accountId: 'a1', displayName: 'Alex Doe' }, { accountId: 'j1', displayName: 'Jira Person' }],
}

function renderEditor(item, saveField = vi.fn(async () => {})) {
  render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, data: DATA, workItemSource: { saveField } }}>
      <WorkItemFieldsEditor item={item} />
    </NexusDataProvider>
  )
  return saveField
}

afterEach(() => cleanup())

const JIRA = { id: 'jira:ABC-1', source: 'jira', type: 'story', state: 'To Do', priority: 2, priorityName: 'High', assignee: null, tags: [] }

it('offers the Jira item type\'s states and Jira priority names, and hides Area', () => {
  renderEditor(JIRA)
  const selects = screen.getAllByRole('combobox')
  const stateOpts = Array.from(selects[0].options).map(o => o.value)
  expect(stateOpts).toEqual(['To Do', 'In Progress', 'Done'])
  expect(screen.getByRole('option', { name: 'High' })).toBeTruthy()
  expect(screen.queryByText('Area')).toBeNull()
})

it('lists Jira-assignable people and saves by display name', async () => {
  const saveField = renderEditor(JIRA)
  const assignee = screen.getAllByRole('combobox')[1]
  expect(Array.from(assignee.options).map(o => o.textContent)).toEqual(['Unassigned', 'Alex Doe', 'Jira Person'])
  fireEvent.change(assignee, { target: { value: 'Jira Person' } })
  await waitFor(() => expect(saveField).toHaveBeenCalledWith('jira:ABC-1', 'System.AssignedTo', 'Jira Person'))
})

it('saves a Jira priority by rank', async () => {
  const saveField = renderEditor(JIRA)
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: '1' } })
  await waitFor(() => expect(saveField).toHaveBeenCalledWith('jira:ABC-1', 'Microsoft.VSTS.Common.Priority', 1))
})

it('leaves ADO items as they were', () => {
  renderEditor({ id: 7, source: 'ado', type: 'bug', state: 'Active', priority: 2, assignee: null, tags: [] })
  expect(screen.getByText('Area')).toBeTruthy()
  expect(screen.getByRole('option', { name: '2 – High' })).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w packages/ui test -- work-item-fields-jira`
Expected: FAIL — Jira item shows every state and `1 – Critical`-style priorities; Area row present.

- [ ] **Step 3: Implement**

In `packages/ui/src/views/work-item-detail.jsx`, add `slugify` to the `@nexusmd/core` import (or add `import { slugify } from '@nexusmd/core';` if the file has no core import). In `WorkItemFieldsEditor`, replace:

```js
  const STATES = data.STATES || [];
  const TEAM = data.TEAM || [];
```

with:

```js
  const TEAM = data.TEAM || [];
  const isJira = item.source === 'jira';
  const typeStates = data.WI_TYPE_STATES_BY_SOURCE?.[item.source || 'ado']?.[item.type];
  const STATES = (() => {
    const base = typeStates?.length ? typeStates : (data.STATES || []);
    return item.state && !base.includes(item.state) ? [item.state, ...base] : base;
  })();
  const jiraPriorities = isJira ? (data.PRIORITIES_BY_SOURCE?.jira || []) : null;
  // Jira assignee options come from the site's assignable users; ADO from the team.
  const assigneeOptions = isJira
    ? (data.JIRA_PEOPLE || []).map(p => ({ id: TEAM.find(t => t.name === p.displayName)?.id || slugify(p.displayName), name: p.displayName }))
    : TEAM;
```

Change `const assignee = TEAM.find(t => t.id === local.assignee);` to:

```js
  const assignee = assigneeOptions.find(t => t.id === local.assignee);
```

Replace the Assignee `<dd>` contents with:

```jsx
          <select value={assignee?.name || ''} style={sel}
            onChange={e => {
              const name = e.target.value;
              const member = assigneeOptions.find(t => t.name === name);
              patch('System.AssignedTo', name || '', { assignee: member?.id || null });
            }}>
            <option value="">Unassigned</option>
            {assigneeOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
```

Replace the Priority `<select>` with:

```jsx
          {jiraPriorities ? (
            <select value={String(local.priority || 3)} style={sel}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const p = jiraPriorities.find(x => x.rank === v);
                patch('Microsoft.VSTS.Common.Priority', v, { priority: v, priorityName: p?.name || null });
              }}>
              {jiraPriorities.map(p => <option key={p.id} value={p.rank}>{p.name}</option>)}
            </select>
          ) : (
            <select value={String(local.priority || 3)} style={sel}
              onChange={e => { const v = parseInt(e.target.value, 10); patch('Microsoft.VSTS.Common.Priority', v, { priority: v }); }}>
              <option value="1">1 – Critical</option>
              <option value="2">2 – High</option>
              <option value="3">3 – Medium</option>
              <option value="4">4 – Low</option>
            </select>
          )}
```

Phase 0 may already have made the ADO priority options dynamic. If so, keep its ADO branch exactly as Phase 0 left it, and add only the `jiraPriorities ? … :` wrapper.

Wrap the Area `<dt>`/`<dd>` pair so it only renders for ADO:

```jsx
        {!isJira && (
          <>
            <dt>Area</dt>
            <dd>
              <AreaTreePicker compact areas={areas} value={local.area || ''}
                onChange={val => patch('Custom.Area', val, { area: val })}/>
            </dd>
          </>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w packages/ui test`
Expected: PASS (including the existing `work-item-detail.test.jsx`)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/work-item-detail.jsx packages/ui/tests/work-item-fields-jira.test.jsx
git commit -m "feat(ui): Jira-aware state, priority and assignee editing in the detail drawer"
```

---

### Task 19: Create drawer — provider switch and Jira create form

**Files:**
- Create: `apps/desktop/src/jira-create-form.jsx`
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `apps/desktop/src/main.jsx` (the `<CreateWorkItemDrawer …>` element)
- Test: `apps/desktop/src/jira-create-form.test.jsx`

**Interfaces:**
- Consumes: `layoutCreateFields` from `@nexusmd/core`; `mdToHtml`, `Drawer`, `Icon` from `@nexusmd/ui`; `MarkdownField` from `./create-work-item-drawer.jsx`; `SettField`, `settInputStyle` from `./desktop-settings.jsx`. The Jira source methods `getCreateTypes`, `getCreateFields`, `getLinkTypes`, `createIssue` (Task 14), and `defaultCreateProvider` (Task 16).
- Produces:
  - `JiraCreateForm({ source, projectKeys, people, site, initialTitle, onCreated })`. `onCreated(result)` receives `{ id, key, warnings }`.
  - `CreateWorkItemDrawer` gains optional props `jira = { source, projectKeys, people, site } | null`, `adoAvailable = true`, `defaultProvider = 'ado'`, `onProviderChange(provider)` and `onJiraCreated(result)`.

- [ ] **Step 1: Write the failing test**

```jsx
// apps/desktop/src/jira-create-form.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { JiraCreateForm } from './jira-create-form.jsx'

afterEach(() => cleanup())

function makeSource(fields) {
  return {
    getCreateTypes: vi.fn(async () => [{ id: '10001', name: 'Story' }, { id: '10002', name: 'Bug' }]),
    getCreateFields: vi.fn(async () => fields),
    getLinkTypes: vi.fn(async () => [{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }]),
    createIssue: vi.fn(async () => ({ id: 'jira:ABC-9', key: 'ABC-9', warnings: [] })),
  }
}

const FIELDS = [
  { key: 'description', name: 'Description', required: false, kind: 'richtext', role: 'description', allowedValues: [] },
  { key: 'assignee', name: 'Assignee', required: false, kind: 'user', role: 'assignee', allowedValues: [] },
  { key: 'priority', name: 'Priority', required: false, kind: 'option', role: 'priority', allowedValues: [{ id: '2', name: 'High' }] },
  { key: 'customfield_1', name: 'Team', required: true, kind: 'option', role: null, allowedValues: [{ id: '7', name: 'Core' }] },
]
const PEOPLE = [{ accountId: 'u1', displayName: 'Alex Doe' }]

describe('JiraCreateForm', () => {
  it('loads types and fields, then creates with the chosen values', async () => {
    const source = makeSource(FIELDS)
    const onCreated = vi.fn()
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site="https://a.atlassian.net" initialTitle="From planner" onCreated={onCreated} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalledWith('ABC', '10001'))
    expect(screen.getByLabelText('Summary').value).toBe('From planner')
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Team *'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '**bold**' } })
    fireEvent.click(screen.getByText('Create issue'))
    await waitFor(() => expect(source.createIssue).toHaveBeenCalled())
    const [input, extras] = source.createIssue.mock.calls[0]
    expect(input).toMatchObject({ projectKey: 'ABC', typeId: '10001', summary: 'From planner', fields: FIELDS })
    expect(input.values).toMatchObject({ assignee: 'u1', customfield_1: '7' })
    expect(input.values.description).toContain('<strong>bold</strong>')
    expect(extras).toEqual({ attachments: [], links: [] })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'jira:ABC-9', key: 'ABC-9', warnings: [] }))
    expect(screen.getByText('Created ABC-9.')).toBeTruthy()
  })

  it('requires a summary and the required fields', async () => {
    const source = makeSource(FIELDS)
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site="s" onCreated={() => {}} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Create issue'))
    expect(screen.getByText('Summary is required.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Create issue'))
    expect(screen.getByText('Fill in: Team')).toBeTruthy()
    expect(source.createIssue).not.toHaveBeenCalled()
  })

  it('offers Open in Jira instead of submitting when a required field is unsupported', async () => {
    const source = makeSource([{ key: 'customfield_9', name: 'Weird', required: true, kind: null, role: null, allowedValues: [] }])
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={[]} site="https://a.atlassian.net" onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Weird/)).toBeTruthy())
    expect(screen.getByText('Open project in Jira').getAttribute('href')).toBe('https://a.atlassian.net/browse/ABC')
    expect(screen.queryByText('Create issue')).toBeNull()
  })

  it('reloads fields when the type changes', async () => {
    const source = makeSource(FIELDS)
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={[]} site="s" onCreated={() => {}} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: '10002' } })
    await waitFor(() => expect(source.getCreateFields).toHaveBeenLastCalledWith('ABC', '10002'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/desktop test -- src/jira-create-form`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `jira-create-form.jsx`**

```jsx
// apps/desktop/src/jira-create-form.jsx — generic Jira issue form driven by the
// normalised create-meta from @nexusmd/core (core fields first, then required,
// then optional extras under "More fields").
import React from 'react'
import { mdToHtml } from '@nexusmd/ui'
import { layoutCreateFields } from '@nexusmd/core'
import { MarkdownField } from './create-work-item-drawer.jsx'
import { SettField, settInputStyle } from './desktop-settings.jsx'

function JiraFieldInput({ field, value, onChange, people }) {
  const label = `${field.name}${field.required ? ' *' : ''}`
  switch (field.kind) {
    case 'richtext':
      return <MarkdownField label={field.name} required={field.required} value={value || ''} onChange={onChange} />
    case 'user':
      return (
        <SettField label={label}>
          <select aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle}>
            <option value="">Unassigned</option>
            {people.map(p => <option key={p.accountId} value={p.accountId}>{p.displayName}</option>)}
          </select>
        </SettField>
      )
    case 'option':
      return (
        <SettField label={label}>
          <select aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle}>
            <option value="" />
            {field.allowedValues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </SettField>
      )
    case 'multi-option':
      return (
        <SettField label={label}>
          <select aria-label={label} multiple value={value || []} style={{ ...settInputStyle, minHeight: 64 }}
            onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}>
            {field.allowedValues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </SettField>
      )
    case 'number':
      return (
        <SettField label={label}>
          <input aria-label={label} type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'date':
      return (
        <SettField label={label}>
          <input aria-label={label} type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'labels':
      return (
        <SettField label={label} hint="Comma-separated. Spaces become hyphens.">
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'parent':
      return (
        <SettField label={label} hint="Parent or epic key, e.g. ABC-12">
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    default:
      return (
        <SettField label={label}>
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
  }
}

export function JiraCreateForm({ source, projectKeys = [], people = [], site = '', initialTitle = '', onCreated }) {
  const [projectKey, setProjectKey] = React.useState(projectKeys[0] || '')
  const [types, setTypes] = React.useState([])
  const [typeId, setTypeId] = React.useState('')
  const [fields, setFields] = React.useState([])
  const [values, setValues] = React.useState({})
  const [summary, setSummary] = React.useState(initialTitle || '')
  const [linkTypes, setLinkTypes] = React.useState([])
  const [links, setLinks] = React.useState([])
  const [linkType, setLinkType] = React.useState('')
  const [linkKey, setLinkKey] = React.useState('')
  const [files, setFiles] = React.useState([])
  const [error, setError] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!projectKey) return
    setError('')
    source.getCreateTypes(projectKey)
      .then(t => { setTypes(t); setTypeId(t[0]?.id || '') })
      .catch(e => setError(e?.message || 'Could not load issue types'))
  }, [projectKey, source])

  React.useEffect(() => {
    if (!projectKey || !typeId) return
    setValues({})
    source.getCreateFields(projectKey, typeId)
      .then(setFields)
      .catch(e => setError(e?.message || 'Could not load fields'))
  }, [projectKey, typeId, source])

  React.useEffect(() => {
    source.getLinkTypes()
      .then(t => { setLinkTypes(t); setLinkType(t[0]?.name || '') })
      .catch(() => {})
  }, [source])

  const layout = layoutCreateFields(fields)
  const setValue = (key, v) => setValues(prev => ({ ...prev, [key]: v }))
  const renderField = (f) => <JiraFieldInput key={f.key} field={f} value={values[f.key]} onChange={v => setValue(f.key, v)} people={people} />

  const submit = async () => {
    if (!summary.trim()) { setError('Summary is required.'); return }
    const missing = [...layout.core, ...layout.required].filter(f => f.required && (values[f.key] === undefined || values[f.key] === '' || (Array.isArray(values[f.key]) && !values[f.key].length)))
    if (missing.length) { setError(`Fill in: ${missing.map(f => f.name).join(', ')}`); return }
    setError('')
    setSaving(true)
    setStatus('Creating…')
    try {
      const prepared = { ...values }
      fields.filter(f => f.kind === 'richtext' && prepared[f.key]).forEach(f => { prepared[f.key] = mdToHtml(prepared[f.key]) })
      const result = await source.createIssue(
        { projectKey, typeId, summary: summary.trim(), values: prepared, fields },
        { attachments: files, links },
      )
      setStatus(result.warnings?.length ? `Created ${result.key} — ${result.warnings.join('; ')}` : `Created ${result.key}.`)
      onCreated?.(result)
    } catch (e) {
      setStatus('')
      setError('Error: ' + (e?.message || 'Failed to create'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SettField label="Project">
          <select aria-label="Project" value={projectKey} onChange={e => setProjectKey(e.target.value)} style={settInputStyle}>
            {projectKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </SettField>
        <SettField label="Issue type">
          <select aria-label="Issue type" value={typeId} onChange={e => setTypeId(e.target.value)} style={settInputStyle}>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </SettField>
      </div>
      <SettField label="Summary *">
        <input aria-label="Summary" value={summary} onChange={e => setSummary(e.target.value)} autoFocus style={settInputStyle} />
      </SettField>

      {layout.unsupportedRequired.length > 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          This issue type needs {layout.unsupportedRequired.map(f => f.name).join(', ')}, which NexusMD can&apos;t set yet.{' '}
          <a href={`${site}/browse/${encodeURIComponent(projectKey)}`} target="_blank" rel="noopener"
            onClick={e => { if (window.electronAPI?.openLink) { e.preventDefault(); window.electronAPI.openLink(`${site}/browse/${encodeURIComponent(projectKey)}`) } }}>
            Open project in Jira
          </a>
        </div>
      ) : (
        <>
          {layout.core.map(renderField)}
          {layout.required.map(renderField)}
          {layout.more.length > 0 && (
            <details>
              <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>More fields</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>{layout.more.map(renderField)}</div>
            </details>
          )}

          <div className="drawer-section">
            <h4>Links</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              <select aria-label="Link type" value={linkType} onChange={e => setLinkType(e.target.value)} style={{ ...settInputStyle, width: 'auto' }}>
                {linkTypes.map(t => <option key={t.id} value={t.name}>{t.outward}</option>)}
              </select>
              <input aria-label="Linked issue key" value={linkKey} onChange={e => setLinkKey(e.target.value)} placeholder="ABC-12" style={settInputStyle} />
              <button type="button" className="btn sm" disabled={!linkKey.trim() || !linkType}
                onClick={() => { setLinks(l => [...l, { typeName: linkType, key: linkKey.trim().toUpperCase() }]); setLinkKey('') }}>Add</button>
            </div>
            {links.map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, marginTop: 4 }}>
                {linkTypes.find(t => t.name === l.typeName)?.outward || l.typeName} <span className="mono">{l.key}</span>
                <button type="button" className="btn icon ghost sm" title="Remove link" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <h4>Attachments</h4>
            <input aria-label="Attachments" type="file" multiple onChange={e => setFiles(Array.from(e.target.files || []))} />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create issue'}</button>
            {status && <span style={{ fontSize: 12.5, color: 'var(--success)' }}>{status}</span>}
          </div>
        </>
      )}
      {error && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/desktop test -- src/jira-create-form`
Expected: PASS

- [ ] **Step 5: Add the provider switch to `CreateWorkItemDrawer`**

In `apps/desktop/src/create-work-item-drawer.jsx`, import the form:

```js
import { JiraCreateForm } from './jira-create-form.jsx'
```

Change the component signature to:

```js
export function CreateWorkItemDrawer({
  open, title: initialTitle, project: projectsList, team, onClose, onCreate,
  jira = null, adoAvailable = true, defaultProvider = 'ado', onProviderChange, onJiraCreated,
}) {
```

Directly after the existing `const [titleError, setTitleError] = React.useState('')` line, and before `if (!open) return null`, add:

```js
  const [provider, setProvider] = React.useState(defaultProvider)
  React.useEffect(() => {
    if (open) setProvider(jira ? defaultProvider : 'ado')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const chooseProvider = (p) => { setProvider(p); onProviderChange?.(p) }
  const providerSwitch = jira && adoAvailable ? (
    <div role="group" aria-label="Create in" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
      {[['ado', 'Azure DevOps'], ['jira', 'Jira']].map(([v, l]) => (
        <button key={v} type="button" className={`btn sm ${provider === v ? 'primary' : 'ghost'}`} aria-pressed={provider === v} onClick={() => chooseProvider(v)}>{l}</button>
      ))}
    </div>
  ) : null
```

The ADO load effect calls `load(projectsList[0] …)` whenever the drawer opens. When ADO isn't configured (Jira-only users) that call would fail, so change the start of that effect body from `if (!open) return` to:

```js
    if (!open || !adoAvailable) return
```

Directly after `if (!open) return null`, add the Jira branch:

```jsx
  if (jira && (provider === 'jira' || !adoAvailable)) {
    return (
      <Drawer open={open} onClose={onClose} defaultWidth={820} title="New Jira issue">
        {providerSwitch}
        <JiraCreateForm
          source={jira.source}
          projectKeys={jira.projectKeys}
          people={jira.people}
          site={jira.site}
          initialTitle={initialTitle}
          onCreated={(result) => onJiraCreated?.(result)}
        />
      </Drawer>
    )
  }
```

For the ADO branch, add `{providerSwitch}` as the first child inside the existing `<Drawer …>`, before `{loadError && …}`.

- [ ] **Step 6: Wire it in `main.jsx`**

Replace the `<CreateWorkItemDrawer …/>` element in `App` with:

```jsx
      <CreateWorkItemDrawer
        open={!!createWI}
        title={createWI?.title}
        project={getAdoConfig().projects || []}
        team={snapshot.TEAM || []}
        adoAvailable={isAdoConfigured()}
        jira={isJiraActive() ? {
          source: nexusDataValue.workItemSource.jira,
          projectKeys: getJiraConfig().projectKeys,
          people: snapshot.JIRA_PEOPLE || [],
          site: getJiraConfig().site,
        } : null}
        defaultProvider={defaultCreateProvider({
          readJson: (k, d) => { try { const v = localStorage.getItem(getProfileKey(k)); return v == null ? d : JSON.parse(v) } catch { return d } },
          adoAvailable: isAdoConfigured(),
          jiraAvailable: isJiraActive(),
        })}
        onProviderChange={(p) => { try { localStorage.setItem(getProfileKey('nexusmd.wi.createProvider'), JSON.stringify(p)) } catch {} }}
        onJiraCreated={(result) => {
          if (!result.warnings?.length) setTimeout(() => setCreateWI(null), 600)
          refreshAllData()
        }}
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

- [ ] **Step 7: Run the desktop suite**

Run: `npm -w apps/desktop test`
Expected: PASS, including the existing `create-work-item-drawer.test.jsx`. Its renders pass no `jira` prop, so `providerSwitch` is `null` and the ADO branch renders exactly as before.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/jira-create-form.jsx apps/desktop/src/jira-create-form.test.jsx apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/main.jsx
git commit -m "feat(desktop): create Jira issues from the work-item drawer"
```

---

### Task 20: Full verification and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run every suite**

```bash
npm test
npm -w packages/core test
npm -w packages/ui test
npm -w apps/desktop test
npm -w apps/web test
npm -w apps/app test
```

Expected: all PASS. `apps/web` and `apps/app` are untouched by this plan, but they consume `@nexusmd/core` and `@nexusmd/ui`, and these runs confirm nothing regressed for them.

- [ ] **Step 2: Manual smoke test against a real Jira Cloud site**

Run the desktop app (`apps/desktop/Start-Dev.ps1` or `npm -w apps/desktop run dev`) and check each item. Record any failure as a bug before calling Phase 1 done.

1. **Settings → Integrations → Jira Cloud Connection**
   - Enter site, email and API token, then click Test connection.
   - Expect "Connected as …" and a project list. Tick a project and click Save & connect.
2. **Work Items** with both ADO and Jira configured:
   - Merged mode shows both sources with ADO/Jira badges, and Jira keys like `ABC-12`.
   - The board columns are Proposed / In Progress / Resolved / Completed.
3. **Category move:** drag a Jira card to Completed.
   - It moves, and the card chip shows the real Jira status.
   - Drag one to a category its workflow can't reach. Expect a toast naming the workflow, and the card stays put.
4. **Separate mode:**
   - Switch the toolbar to Separate. The ADO tab shows the existing board; the Jira tab shows Jira status columns.
   - While dragging a Jira card, unreachable columns are dimmed.
5. **Detail drawer** on a Jira issue:
   - The description renders.
   - Comments load. Add a comment with **bold** and a list, and check it in Jira's web UI.
   - Change state, assignee, priority and tags, and check each in Jira.
   - "Open in Jira" opens `/browse/KEY`. "Mark done" transitions the issue.
6. **Create:** click New work item and switch to Jira.
   - Create a Story with description, assignee, priority, a label with a space, one attachment, and a "blocks" link to another issue.
   - In Jira, check the issue reads "<new> blocks <other>". If the direction is reversed, swap `inwardIssue`/`outwardIssue` in `createJiraIssue` and its test.
7. **Bad credentials:** change the token to a bad value and refresh.
   - Expect "Jira: auth failed — check settings (showing cached)", Jira items still visible, and ADO still refreshing.
8. **Jira switched off:** untick "Load Jira work items" and save.
   - The Work Items view returns to the ADO-only UI, with no display toggle.
9. **ADO-only profile** (Jira never configured): no visible change anywhere compared with before this branch.

- [ ] **Step 3: Commit any smoke-test fixes**

Each fix gets its own commit with a test, following the owning task's style.
