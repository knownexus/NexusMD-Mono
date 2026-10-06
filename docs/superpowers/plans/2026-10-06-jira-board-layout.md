# Jira Board Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Work Items board's Jira tab, show the columns of a Jira board the user picks in Settings, each column grouping one or more statuses as on the real board.

**Architecture:** Core gains `jira/boards.js`, which reads the board list and board column configuration from the Jira Agile REST API and maps status ids to names (ids now recorded in metadata). The loader publishes `BOARD_COLUMNS` (or `BOARD_ERROR`), which the merge passes through as `JIRA_BOARD_COLUMNS` / `JIRA_BOARD_ERROR`, plus a provider warning. The Work Items board adds a third lane mode, `'jira-columns'`, in which a lane is a board column. Drops go through a new routed `moveToStatuses` operation, backed by core's `transitionJiraIssueToAny`.

**Tech Stack:** JavaScript ES modules, React 18, Vitest (core: node; ui/desktop: jsdom), @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-06-jira-board-layout-design.md`

## Prerequisite

Branch `feat/wi-collapse-hide-people` (grouped-table collapse controls plus hidden people) must be finished and is the base for this work. It edits `view-workitems.jsx`, `work-item-data.js` and `main.jsx`. Work on a new branch `feat/jira-board-layout` created from it.

## Global Constraints

- Board layout applies only to the Jira tab: `activeSource === 'jira'`, or a profile where Jira is the only provider. Merged mode, the ADO tab, table view and profiles with no board chosen behave exactly as today.
- Items shown are unchanged (project keys and extra JQL). The board's own filter is not applied.
- Statuses not on the board go in a trailing lane keyed `__other__`, labelled `Other`, rendered only when it has cards.
- Agile REST paths: `rest/agile/1.0/board?projectKeyOrId=<key>&maxResults=50` and `rest/agile/1.0/board/{id}/configuration`. Board columns are fetched on every full load and refresh.
- Board failure never fails the Jira load: `BOARD_COLUMNS: null` plus `BOARD_ERROR`, and the provider warning text is exactly `Jira board unavailable — using status columns`.
- New optional source method `moveToStatuses(id, statuses, item) → { state, stateCategory }`. A routed source lacking it rejects with exactly `Moving between columns is not supported for this item`.
- No-match transition error text: `No transition from "<current>" to any status in this column`.
- Config key `getProfileKey('jira.boardId')`, default `''`. Settings select default option label: `Status columns (default)`. Board-list failure hint: `Couldn't load boards`.
- Tests: prefix every command with `NODE_OPTIONS=--no-experimental-webstorage`. packages/ui has 3 known pre-existing failures (tests/build-source, tests/builds-table-fields, tests/tests-table-fields).
- Style: core no semicolons; packages/ui view files semicolons; desktop `.js`/`.jsx` no semicolons.
- The user's main checkout has unrelated uncommitted edits (README.md, apps/app/src/app.jsx, apps/web/src/app.jsx, apps/desktop/src/desktop-settings.jsx). Never stage or modify them. Stage files by explicit path only.

## Review Focus

1. **A cached `_jiraMeta` from before this change has no `statusNameById`,** so a refresh would map every board status id to nothing and show empty columns. Expected: a full metadata refetch whenever a board is chosen and the ids map is missing. Test: Task 4.
2. **A status name differing only in case between the board config and the issue** (e.g. "In progress" vs "In Progress") must still place the card in its column. Test: Task 2 (`jiraColumnForStatus`) and Task 7.
3. **A board with zero columns, or with all statuses unmapped,** must not produce a blank board with nowhere to see cards. Expected: an empty `BOARD_COLUMNS` falls back to status lanes. Test: Task 7.
4. **Dropping a card into the column it is already in** must not send a transition. Test: Task 7.
5. **A chosen board that the user later loses access to** must still load items and show the warning pill. Test: Task 4 (loader) and Task 5 (pill).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/modules/jira/boards.js` (new) | Board list, board column config, status-to-column lookup |
| `packages/core/src/modules/jira/metadata.js` | Record `statusNameById` |
| `packages/core/src/modules/jira/config.js` | `boardId` setting |
| `packages/core/src/modules/jira/issues.js` | `transitionJiraIssueToAny` |
| `packages/core/src/modules/jira/loader.js` | Publish `BOARD_ID` / `BOARD_COLUMNS` / `BOARD_ERROR`; refetch meta when ids missing |
| `packages/core/src/modules/jira/index.js` | Barrel exports |
| `packages/core/src/modules/workitems/merge.js` | `JIRA_BOARD_COLUMNS`, `JIRA_BOARD_ERROR`, provider `warning` |
| `packages/ui/src/views/work-item-source.js` | Routed `moveToStatuses` |
| `packages/ui/src/views/view-workitems.jsx` | Warning pill; `'jira-columns'` lane mode |
| `apps/desktop/src/jira-client.js` | `moveToStatuses`, `getBoards` on the Jira source |
| `apps/desktop/src/jira-settings.jsx` | Board select |

---

### Task 1: Status ids in metadata, and the `boardId` setting

**Files:**
- Modify: `packages/core/src/modules/jira/metadata.js` (`emptyJiraMeta`, the project-statuses loop in `fetchJiraMetadata`, `fillMetadataFromIssues`)
- Modify: `packages/core/src/modules/jira/config.js` (`getJiraConfig`, `saveJiraConfig`)
- Test: `packages/core/tests/jira/metadata.test.js`, `packages/core/tests/jira/config.test.js`

**Interfaces:**
- Produces:
  - `JiraMeta.statusNameById: { [statusId: string]: statusName }`
  - `getJiraConfig().boardId: string` (default `''`)
  - `saveJiraConfig({ boardId })`, which stores `String(boardId)` under the key `boardId`

- [ ] **Step 1: Write the failing tests**

In `metadata.test.js`, add ids to the existing `STATUSES` fixture's statuses: `{ id: '1', name: 'To Do', … }`, `{ id: '3', name: 'In Progress', … }`, `{ id: '10001', name: 'Done', … }`, and for Bug `{ id: '4', name: 'Open', … }`, `{ id: '10001', name: 'Done', … }`. Then add:

```js
describe('statusNameById', () => {
  it('maps status ids to names from project statuses', async () => {
    const meta = await fetchJiraMetadata(makeClient({
      'project/ABC/statuses': [{ name: 'Story', statuses: [
        { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
        { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      ] }],
      'rest/api/3/priority': [], 'rest/api/3/field': [], 'rest/api/3/myself': null, 'multiProjectSearch': [],
    }), ['ABC'])
    expect(meta.statusNameById).toEqual({ 1: 'To Do', 3: 'In Progress' })
  })
  it('is empty in emptyJiraMeta and filled from issues when status metadata failed', () => {
    expect(emptyJiraMeta().statusNameById).toEqual({})
    const meta = fillMetadataFromIssues(emptyJiraMeta(), [
      { fields: { issuetype: { name: 'Task' }, status: { id: '7', name: 'Doing', statusCategory: { key: 'indeterminate' } } } },
    ])
    expect(meta.statusNameById).toEqual({ 7: 'Doing' })
  })
})
```

The existing test `'fails soft on every call'` compares with `emptyJiraMeta()`, so it keeps passing once `emptyJiraMeta` gains the field.

In `config.test.js`:
- Add `boardId: ''` to the expected object in `'round-trips values through namespaced keys'`.
- Add:

```js
  it('stores the chosen board id as a string', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    expect(cfg.getJiraConfig().boardId).toBe('')
    cfg.saveJiraConfig({ boardId: 42 })
    expect(cfg.getJiraConfig().boardId).toBe('42')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/core tests/jira/metadata tests/jira/config`
Expected: FAIL. `statusNameById` is undefined and `boardId` is missing.

- [ ] **Step 3: Implement**

`metadata.js`:
- In `emptyJiraMeta`, add `statusNameById: {},` after `states: [],`.
- In the project-statuses loop of `fetchJiraMetadata`, right after `names.push(s.name)`, add:

```js
        if (s.id != null) meta.statusNameById[String(s.id)] = s.name
```

- In `fillMetadataFromIssues`, change `const next = { ...meta, typeStates: {}, stateCategoryByName: { ...meta.stateCategoryByName } }` to:

```js
  const next = { ...meta, typeStates: {}, stateCategoryByName: { ...meta.stateCategoryByName }, statusNameById: { ...(meta.statusNameById || {}) } }
```

- Inside its loop, after the `stateCategoryByName` line, add:

```js
    if (status.id != null) next.statusNameById[String(status.id)] = status.name
```

`config.js`:
- In `getJiraConfig`'s returned object, after `jql:`, add `boardId:     get('boardId')  || '',`.
- In `saveJiraConfig`, add `if (values.boardId     !== undefined) set('boardId',     String(values.boardId))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/core test`
Expected: PASS (the full core suite).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/metadata.js packages/core/src/modules/jira/config.js packages/core/tests/jira/metadata.test.js packages/core/tests/jira/config.test.js
git commit -m "feat(core): record Jira status ids and a chosen board id"
```

---

### Task 2: Jira boards module

**Files:**
- Create: `packages/core/src/modules/jira/boards.js`
- Modify: `packages/core/src/modules/jira/index.js`
- Test: `packages/core/tests/jira/boards.test.js`

**Interfaces:**
- Consumes: a `client` from `makeJiraClient` (`get(path)`).
- Produces:
  - `fetchJiraBoards(client, projectKeys) → Promise<[{ id: string, name, type, projectKey }]>`
  - `fetchJiraBoardColumns(client, boardId, statusNameById) → Promise<[{ name, statuses: string[] }]>`, which throws on HTTP failure
  - `jiraColumnForStatus(columns, statusName) → column | null`
  - All three are re-exported from `@nexusmd/core`.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/jira/boards.test.js
import { describe, it, expect, vi } from 'vitest'
import { fetchJiraBoards, fetchJiraBoardColumns, jiraColumnForStatus } from '../../src/modules/jira/boards.js'

function client(routes) {
  return { get: vi.fn(async (path) => {
    for (const [p, v] of Object.entries(routes)) if (path.includes(p)) { if (v instanceof Error) throw v; return v }
    throw new Error(`unexpected ${path}`)
  }) }
}

describe('fetchJiraBoards', () => {
  it('merges boards across projects, de-duplicating by id', async () => {
    const c = client({
      'projectKeyOrId=ABC': { values: [{ id: 1, name: 'ABC board', type: 'scrum', location: { projectKey: 'ABC' } }, { id: 9, name: 'Shared', type: 'kanban', location: { projectKey: 'ABC' } }] },
      'projectKeyOrId=DEF': { values: [{ id: 9, name: 'Shared', type: 'kanban', location: { projectKey: 'ABC' } }] },
    })
    expect(await fetchJiraBoards(c, ['ABC', 'DEF'])).toEqual([
      { id: '1', name: 'ABC board', type: 'scrum', projectKey: 'ABC' },
      { id: '9', name: 'Shared', type: 'kanban', projectKey: 'ABC' },
    ])
    expect(c.get).toHaveBeenCalledWith('rest/agile/1.0/board?projectKeyOrId=ABC&maxResults=50')
  })
  it('fails soft per project', async () => {
    const c = client({ 'projectKeyOrId=ABC': new Error('403'), 'projectKeyOrId=DEF': { values: [{ id: 2, name: 'D', type: 'scrum', location: { projectKey: 'DEF' } }] } })
    expect((await fetchJiraBoards(c, ['ABC', 'DEF'])).map(b => b.id)).toEqual(['2'])
  })
})

describe('fetchJiraBoardColumns', () => {
  const names = { 1: 'To Do', 3: 'In Progress', 4: 'Code Review', 10001: 'Done' }
  it('maps column status ids to names, dropping unknown ids and keeping empty columns', async () => {
    const c = client({ 'board/7/configuration': { columnConfig: { columns: [
      { name: 'Backlog', statuses: [] },
      { name: 'To Do', statuses: [{ id: '1' }] },
      { name: 'In Progress', statuses: [{ id: '3' }, { id: '4' }, { id: '999' }] },
      { name: 'Done', statuses: [{ id: '10001' }] },
    ] } } })
    expect(await fetchJiraBoardColumns(c, '7', names)).toEqual([
      { name: 'Backlog', statuses: [] },
      { name: 'To Do', statuses: ['To Do'] },
      { name: 'In Progress', statuses: ['In Progress', 'Code Review'] },
      { name: 'Done', statuses: ['Done'] },
    ])
    expect(c.get).toHaveBeenCalledWith('rest/agile/1.0/board/7/configuration')
  })
  it('throws when the configuration cannot be read', async () => {
    await expect(fetchJiraBoardColumns(client({ 'board/7/configuration': new Error('Not found in Jira (404)') }), '7', names))
      .rejects.toThrow('404')
  })
  it('returns [] for a configuration with no columns', async () => {
    expect(await fetchJiraBoardColumns(client({ 'board/7/configuration': {} }), '7', names)).toEqual([])
  })
})

describe('jiraColumnForStatus', () => {
  const cols = [{ name: 'To Do', statuses: ['To Do'] }, { name: 'In Progress', statuses: ['In Progress', 'Code Review'] }]
  it('finds the column containing the status, case-insensitively', () => {
    expect(jiraColumnForStatus(cols, 'code review').name).toBe('In Progress')
    expect(jiraColumnForStatus(cols, 'In progress').name).toBe('In Progress')
  })
  it('returns null when no column holds the status or input is empty', () => {
    expect(jiraColumnForStatus(cols, 'Blocked')).toBeNull()
    expect(jiraColumnForStatus(null, 'To Do')).toBeNull()
    expect(jiraColumnForStatus(cols, '')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/core tests/jira/boards`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// packages/core/src/modules/jira/boards.js — the user's Jira board layout, via
// the Jira Agile REST API: which boards exist, and which statuses sit in each
// column of one board.

export async function fetchJiraBoards(client, projectKeys = []) {
  const byId = new Map()
  await Promise.all(projectKeys.map(async (key) => {
    let res
    try { res = await client.get(`rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}&maxResults=50`) } catch (_) { return }
    for (const b of res?.values || []) {
      const id = String(b.id)
      if (!byId.has(id)) byId.set(id, { id, name: b.name, type: b.type, projectKey: b.location?.projectKey || key })
    }
  }))
  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id))
}

export async function fetchJiraBoardColumns(client, boardId, statusNameById = {}) {
  const res = await client.get(`rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`)
  return (res?.columnConfig?.columns || []).map(col => ({
    name: col.name,
    statuses: (col.statuses || []).map(s => statusNameById[String(s.id)]).filter(Boolean),
  }))
}

export function jiraColumnForStatus(columns, statusName) {
  if (!Array.isArray(columns) || !statusName) return null
  const s = String(statusName).toLowerCase()
  return columns.find(c => c.statuses.some(x => x.toLowerCase() === s)) || null
}
```

The merge test expects boards sorted by id: `'1'` before `'9'`, which the code above guarantees.

In `packages/core/src/modules/jira/index.js`, add:

```js
export { fetchJiraBoards, fetchJiraBoardColumns, jiraColumnForStatus } from './boards.js'
```

If `packages/core/tests/public-api.test.js` enumerates exported names, add these three to its expected list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/boards.js packages/core/src/modules/jira/index.js packages/core/tests/jira/boards.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): read Jira boards and their column layout"
```

(Leave `public-api.test.js` out of the `git add` if unchanged.)

---

### Task 3: Transition into any status of a column

**Files:**
- Modify: `packages/core/src/modules/jira/issues.js` (append)
- Modify: `packages/core/src/modules/jira/index.js`
- Test: `packages/core/tests/jira/issues.test.js` (append)

**Interfaces:**
- Consumes: `listJiraTransitions(client, key) → [{ id, name, toName, toCategory }]` (existing, same file).
- Produces: `transitionJiraIssueToAny(client, key, statuses, { currentState }) → Promise<{ state, stateCategory }>`, re-exported from `@nexusmd/core`.

- [ ] **Step 1: Write the failing test**

Append to `issues.test.js`. It reuses that file's `makeClient` helper, and adds `transitionJiraIssueToAny` to the import list at the top.

```js
describe('transitionJiraIssueToAny', () => {
  const TRANSITIONS = { transitions: [
    { id: '21', name: 'Review', to: { name: 'Code Review', statusCategory: { key: 'indeterminate' } } },
    { id: '11', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  ] }
  it('takes the first transition in the column\'s status order', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect(await transitionJiraIssueToAny(client, 'ABC-1', ['In Progress', 'Code Review'], { currentState: 'To Do' }))
      .toEqual({ state: 'In Progress', stateCategory: 'InProgress' })
    expect(client.post).toHaveBeenCalledWith('rest/api/3/issue/ABC-1/transitions', { transition: { id: '11' } })
  })
  it('matches status names case-insensitively', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    expect((await transitionJiraIssueToAny(client, 'ABC-1', ['code review'])).state).toBe('Code Review')
  })
  it('throws without posting when no transition reaches the column', async () => {
    const client = makeClient({ '/transitions': TRANSITIONS })
    await expect(transitionJiraIssueToAny(client, 'ABC-1', ['Done'], { currentState: 'To Do' }))
      .rejects.toThrow('No transition from "To Do" to any status in this column')
    expect(client.post).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/core tests/jira/issues`
Expected: FAIL, `transitionJiraIssueToAny` is not exported.

- [ ] **Step 3: Implement**

Append to `issues.js`:

```js
// Move an issue into whichever of `statuses` (a board column) its workflow can
// reach first, trying the column's statuses in order.
export async function transitionJiraIssueToAny(client, key, statuses, { currentState = '' } = {}) {
  const transitions = await listJiraTransitions(client, key)
  let chosen = null
  for (const status of statuses || []) {
    chosen = pickTransition(transitions, { state: status })
    if (chosen) break
  }
  if (!chosen) {
    throw new Error(`No transition from "${currentState || 'its current status'}" to any status in this column`)
  }
  await client.post(`${issuePath(key)}/transitions`, { transition: { id: chosen.id } })
  return { state: chosen.toName, stateCategory: chosen.toCategory }
}
```

In `jira/index.js`, add `transitionJiraIssueToAny` to the existing `./issues.js` export list. Update `public-api.test.js` if it enumerates names.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/issues.js packages/core/src/modules/jira/index.js packages/core/tests/jira/issues.test.js
git commit -m "feat(core): transition a Jira issue into any status of a board column"
```

---

### Task 4: Loader publishes the board layout; merge passes it through

**Files:**
- Modify: `packages/core/src/modules/jira/loader.js` (`canReuseMeta`, `loadJiraData`)
- Modify: `packages/core/src/modules/workitems/merge.js` (`mergeWorkItemData`)
- Test: `packages/core/tests/jira/loader.test.js`, `packages/core/tests/workitems/merge.test.js`

**Interfaces:**
- Consumes: `fetchJiraBoardColumns` (Task 2); `JiraMeta.statusNameById` and `config.boardId` (Task 1).
- Produces:
  - Jira data gains `BOARD_ID: string`, `BOARD_COLUMNS: [{ name, statuses }] | null` and `BOARD_ERROR: string | null`.
  - The merged snapshot gains `JIRA_BOARD_COLUMNS` and `JIRA_BOARD_ERROR`.
  - Each `WORK_ITEM_PROVIDERS` entry gains `warning: string | null`. For Jira it is `'Jira board unavailable — using status columns'` when `BOARD_ERROR` is set; otherwise, and for ADO, it is `null`.

- [ ] **Step 1: Write the failing tests**

In `loader.test.js`, extend `makeHttp` so it answers the board configuration route. Add a `board` option to its parameter list:

```js
function makeHttp({ searchPages = [[ISSUE('ABC-1')]], resolved = [], board = null } = {}) {
```

and, inside its `fetch`, before the final `throw`:

```js
      if (path.includes('rest/agile/1.0/board/')) {
        if (board instanceof Error) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '', json: async () => ({}) }
        return res(board || { columnConfig: { columns: [] } })
      }
```

Also give the `/statuses` route an id (`{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }`). Then add:

```js
describe('loadJiraData board layout', () => {
  it('publishes the chosen board\'s columns', async () => {
    const http = makeHttp({ board: { columnConfig: { columns: [{ name: 'Todo', statuses: [{ id: '1' }] }] } } })
    const data = await loadJiraData({ ...CONFIG, boardId: '7' }, { http, storage: makeStorage() })
    expect(data.BOARD_ID).toBe('7')
    expect(data.BOARD_COLUMNS).toEqual([{ name: 'Todo', statuses: ['To Do'] }])
    expect(data.BOARD_ERROR).toBeNull()
  })
  it('keeps loading items when the board cannot be read', async () => {
    const data = await loadJiraData({ ...CONFIG, boardId: '7' }, { http: makeHttp({ board: new Error('gone') }), storage: makeStorage() })
    expect(data.WORK_ITEMS).toHaveLength(1)
    expect(data.BOARD_COLUMNS).toBeNull()
    expect(data.BOARD_ERROR).toMatch(/404/)
  })
  it('makes no Agile call when no board is chosen', async () => {
    const http = makeHttp()
    const data = await loadJiraData(CONFIG, { http, storage: makeStorage() })
    expect(data.BOARD_COLUMNS).toBeNull()
    expect(http.fetch.mock.calls.some(([p]) => p.includes('rest/agile'))).toBe(false)
  })
  it('refetches metadata on refresh when a board is chosen but cached meta lacks status ids', async () => {
    const http = makeHttp({ board: { columnConfig: { columns: [] } } })
    const priorMeta = { types: ['Story'], typeStates: {}, stateCategoryByName: {}, states: [], priorities: [{ id: '3', name: 'Medium', rank: 1 }], fieldIds: {}, me: null, people: [{ accountId: 'a', displayName: 'A', avatarUrl: '' }] }
    await loadJiraData({ ...CONFIG, boardId: '7' }, { http, storage: makeStorage() }, { isRefresh: true, priorData: { _jiraMeta: priorMeta, PROJECT_KEYS: ['ABC'] } })
    expect(http.fetch.mock.calls.some(([p]) => p.includes('/statuses'))).toBe(true)
  })
})
```

In `merge.test.js`:
- Add `warning: null` to each expected entry in the existing `WORK_ITEM_PROVIDERS` `toEqual` assertion.
- Add:

```js
describe('board layout passthrough', () => {
  it('passes Jira board columns and error through, with a provider warning', () => {
    const cols = [{ name: 'Todo', statuses: ['To Do'] }]
    const ok = mergeWorkItemData({ ado: null, jira: { ...JIRA, BOARD_COLUMNS: cols, BOARD_ERROR: null }, configured: { jira: true } })
    expect(ok.JIRA_BOARD_COLUMNS).toEqual(cols)
    expect(ok.WORK_ITEM_PROVIDERS[0].warning).toBeNull()
    const bad = mergeWorkItemData({ ado: null, jira: { ...JIRA, BOARD_COLUMNS: null, BOARD_ERROR: 'Not found in Jira (404)' }, configured: { jira: true } })
    expect(bad.JIRA_BOARD_COLUMNS).toBeNull()
    expect(bad.JIRA_BOARD_ERROR).toBe('Not found in Jira (404)')
    expect(bad.WORK_ITEM_PROVIDERS[0].warning).toBe('Jira board unavailable — using status columns')
  })
  it('defaults to null when Jira has no board data', () => {
    const m = mergeWorkItemData({ ado: null, jira: null, configured: {} })
    expect(m.JIRA_BOARD_COLUMNS).toBeNull()
    expect(m.JIRA_BOARD_ERROR).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/core tests/jira/loader tests/workitems/merge`
Expected: FAIL

- [ ] **Step 3: Implement**

`loader.js`:
- Add `import { fetchJiraBoardColumns } from './boards.js'`.
- Change `canReuseMeta` to take the board id, and require status ids when a board is chosen:

```js
function canReuseMeta(isRefresh, priorData, projectKeys, boardId) {
  const meta = priorData?._jiraMeta
  if (!isRefresh || !meta) return false
  const prior = Array.isArray(priorData.PROJECT_KEYS) ? [...priorData.PROJECT_KEYS].sort() : null
  if (!prior || prior.length !== projectKeys.length || prior.some((k, i) => k !== projectKeys[i])) return false
  if (boardId && !meta.statusNameById) return false
  return !!(meta.people?.length && meta.priorities?.length)
}
```

- Update its call to `canReuseMeta(isRefresh, priorData, projectKeys, config.boardId)`.
- After `meta = fillMetadataFromIssues(meta, active)`, add:

```js
  let boardColumns = null
  let boardError = null
  if (config.boardId) {
    try { boardColumns = await fetchJiraBoardColumns(client, config.boardId, meta.statusNameById || {}) }
    catch (e) { boardError = String(e?.message || e || 'board unavailable').slice(0, 200) }
  }
```

- Add to the `data` object, after `PROJECT_KEYS: projectKeys,`:

```js
    BOARD_ID: config.boardId || '',
    BOARD_COLUMNS: boardColumns,
    BOARD_ERROR: boardError,
```

`merge.js`:
- In the `providers` map, add `warning` to the returned object:

```js
    const warning = id === 'jira' && jira?.BOARD_ERROR ? 'Jira board unavailable — using status columns' : null
    return { id, label: PROVIDER_LABELS[id], status: state, error: s.status === 'error' ? (s.error || null) : null, warning }
```

- In the returned object, after `JIRA_PEOPLE`, add:

```js
    JIRA_BOARD_COLUMNS: jira?.BOARD_COLUMNS || null,
    JIRA_BOARD_ERROR: jira?.BOARD_ERROR || null,
```

Check other tests that `toEqual` a `WORK_ITEM_PROVIDERS` entry (`grep -rn "label: 'Jira'" packages apps --include=*.test.*`). Add `warning: null` wherever an exact-equality assertion needs it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/core test && NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/jira/loader.js packages/core/src/modules/workitems/merge.js packages/core/tests/jira/loader.test.js packages/core/tests/workitems/merge.test.js
git commit -m "feat(core): load the chosen Jira board's columns without failing the load"
```

---

### Task 5: Routed `moveToStatuses` and the warning pill

**Files:**
- Modify: `packages/ui/src/views/work-item-source.js` (`createRoutedWorkItemSource`)
- Modify: `packages/ui/src/views/view-workitems.jsx` (`ProviderStatusPills`)
- Test: `packages/ui/tests/work-item-source-routing.test.js`, `packages/ui/tests/workitems-providers.test.jsx`

**Interfaces:**
- Consumes: provider entries with `warning` (Task 4).
- Produces: `routed.moveToStatuses(id, statuses, item) → Promise<{ state, stateCategory }>`.

- [ ] **Step 1: Write the failing tests**

In `work-item-source-routing.test.js`, add:

```js
  it('routes moveToStatuses to the item\'s provider and rejects when unsupported', async () => {
    const jira = { ...fakeSource('jira'), moveToStatuses: vi.fn(async () => ({ state: 'Code Review', stateCategory: 'InProgress' })) }
    const s = createRoutedWorkItemSource({ ado: fakeSource('ado'), jira })
    expect(await s.moveToStatuses('jira:A-1', ['In Progress', 'Code Review'], { state: 'To Do' }))
      .toEqual({ state: 'Code Review', stateCategory: 'InProgress' })
    expect(jira.moveToStatuses).toHaveBeenCalledWith('jira:A-1', ['In Progress', 'Code Review'], { state: 'To Do' })
    await expect(s.moveToStatuses(7, ['Done'], {})).rejects.toThrow('Moving between columns is not supported for this item')
  })
```

In `workitems-providers.test.jsx`, add:

```js
it('shows a provider warning pill when the Jira board is unavailable', () => {
  renderView({ providers: [{ id: 'ado', label: 'Azure DevOps', status: 'ok', error: null, warning: null }, { id: 'jira', label: 'Jira', status: 'ok', error: null, warning: 'Jira board unavailable — using status columns' }] })
  expect(screen.getByText('Jira: Jira board unavailable — using status columns')).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/ui tests/work-item-source-routing tests/workitems-providers`
Expected: FAIL

- [ ] **Step 3: Implement**

In `createRoutedWorkItemSource`, after the `moveToCategory` method, add:

```js
  routed.moveToStatuses = async (id, statuses, item) => {
    const s = pick(id)
    if (!s.moveToStatuses) throw new Error('Moving between columns is not supported for this item')
    return s.moveToStatuses(id, statuses, item)
  }
```

Replace `ProviderStatusPills` with:

```jsx
function ProviderStatusPills({ providers = [] }) {
  const pills = [];
  providers.forEach(p => {
    if (p.status === 'error' || p.status === 'stale') {
      pills.push(
        <span key={`${p.id}:err`} role="status" title={p.error || ''}
          style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--danger)', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
          {p.label}: {p.error || 'load failed'}{p.status === 'stale' ? ' (showing cached)' : ''}
        </span>
      );
    }
    if (p.warning) {
      pills.push(
        <span key={`${p.id}:warn`} role="status" title={p.warning}
          style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--warning, var(--border))', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {p.label}: {p.warning}
        </span>
      );
    }
  });
  return pills;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/ui test`
Expected: only the 3 known pre-existing failures.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/work-item-source.js packages/ui/src/views/view-workitems.jsx packages/ui/tests/work-item-source-routing.test.js packages/ui/tests/workitems-providers.test.jsx
git commit -m "feat(ui): route moveToStatuses and show provider warnings"
```

---

### Task 6: Desktop — Jira source methods and the Board setting

**Files:**
- Modify: `apps/desktop/src/jira-client.js` (`createJiraWorkItemSource`)
- Modify: `apps/desktop/src/jira-settings.jsx` (`JiraConnectionCard`)
- Test: `apps/desktop/src/jira-client.test.js`, `apps/desktop/src/jira-settings.test.jsx`

**Interfaces:**
- Consumes: `transitionJiraIssueToAny` (Task 3), `fetchJiraBoards` (Task 2), `getJiraConfig().boardId` / `saveJiraConfig({ boardId })` (Task 1).
- Produces: Jira source `moveToStatuses(id, statuses, item)` and `getBoards(projectKeys)`. Settings persist `boardId`.

- [ ] **Step 1: Write the failing tests**

In `jira-client.test.js`, inside `describe('createJiraWorkItemSource', …)`:

```js
  it('moves into the first reachable status of a column', async () => {
    const { invoke, source } = makeSource({
      'GET https://acme.atlassian.net/rest/api/3/issue/ABC-1/transitions': ipcReply(200, { transitions: [
        { id: '21', to: { name: 'Code Review', statusCategory: { key: 'indeterminate' } } },
      ] }),
    })
    expect(await source.moveToStatuses('jira:ABC-1', ['In Progress', 'Code Review'], { state: 'To Do' }))
      .toEqual({ state: 'Code Review', stateCategory: 'InProgress' })
    const post = invoke.mock.calls.find(([r]) => r.method === 'POST')[0]
    expect(JSON.parse(post.body)).toEqual({ transition: { id: '21' } })
  })

  it('lists boards for project keys', async () => {
    const { source } = makeSource({
      'GET https://acme.atlassian.net/rest/agile/1.0/board?projectKeyOrId=ABC': ipcReply(200, { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] }),
    })
    expect(await source.getBoards(['ABC'])).toEqual([{ id: '7', name: 'Team board', type: 'scrum', projectKey: 'ABC' }])
  })
```

In `jira-settings.test.jsx`:
- Add `boardId: ''` to the mocked `jira.config`.
- Add `boardId: ''` to the expected object in `'saves, keeping the existing token when the field is blank, then refreshes'`.
- Add:

```jsx
  it('offers the boards for the entered projects after Test connection and saves the choice', async () => {
    jira.routes = {
      'rest/api/3/myself': { displayName: 'Me Person' },
      'rest/api/3/project/search': { values: [{ key: 'ABC', name: 'Alpha' }] },
      'rest/agile/1.0/board?projectKeyOrId=ABC': { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] },
    }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Team board (ABC, scrum)' })).toBeTruthy())
    expect(screen.getByRole('option', { name: 'Status columns (default)' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: '7' } })
    fireEvent.click(screen.getByText('Save & connect'))
    expect(jira.save).toHaveBeenLastCalledWith(expect.objectContaining({ boardId: '7' }))
  })

  it('explains when boards could not be loaded', async () => {
    jira.routes = { 'rest/api/3/myself': { displayName: 'Me Person' }, 'rest/api/3/project/search': { values: [] } }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText("Couldn't load boards")).toBeTruthy())
  })
```

The mocked adapter in `jira-settings.test.jsx` returns `ok: false` / `401` for routes not listed. That makes `fetchJiraBoards`'s per-project call fail soft and return `[]`. The card must therefore show the hint both when the board call throws and when it returns no boards for a non-empty key list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test -- src/jira-client src/jira-settings`
Expected: FAIL

- [ ] **Step 3: Implement**

`jira-client.js`:
- Add `transitionJiraIssueToAny, fetchJiraBoards` to the `@nexusmd/core` import.
- In the object returned by `createJiraWorkItemSource`, after `moveToCategory`, add:

```js
    moveToStatuses: (id, statuses, item) => transitionJiraIssueToAny(client, keyOf(id), statuses, { currentState: item?.state }),
    getBoards: (projectKeys) => fetchJiraBoards(client, projectKeys),
```

`jira-settings.jsx`:
- Add `fetchJiraBoards` to the `@nexusmd/core` import.
- Add state:

```js
  const [boardId, setBoardId]   = React.useState('')
  const [boards, setBoards]     = React.useState([])
  const [boardHint, setBoardHint] = React.useState('')
```

- In the mount effect, add `setBoardId(c.boardId || '')`.
- In `testConnection`, inside the `try` and after `setAvailable(...)`, add:

```js
      const keyList = splitKeys(keys).map(k => k.toUpperCase())
      const found = keyList.length ? await fetchJiraBoards(client, keyList).catch(() => []) : []
      setBoards(found)
      setBoardHint(keyList.length && !found.length ? "Couldn't load boards" : '')
```

- In `save`, add `boardId` to the saved values: `saveJiraConfig({ ...connectionValues(), projectKeys: splitKeys(keys), jql: jql.trim(), enabled, boardId })`.
- Render the select directly before `<details>`:

```jsx
        <SettField label="Board" hint={boardHint || 'Columns for the Jira tab on the Work Items board. Test the connection to list boards.'}>
          <select aria-label="Board" value={boardId} onChange={e => setBoardId(e.target.value)} style={settInputStyle}>
            <option value="">Status columns (default)</option>
            {boardId && !boards.some(b => b.id === boardId) && <option value={boardId}>Board {boardId}</option>}
            {boards.map(b => <option key={b.id} value={b.id}>{`${b.name} (${b.projectKey}, ${b.type})`}</option>)}
          </select>
        </SettField>
```

The `Board {boardId}` option keeps a previously saved board selectable before Test connection has run.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/jira-client.js apps/desktop/src/jira-settings.jsx apps/desktop/src/jira-client.test.js apps/desktop/src/jira-settings.test.jsx
git commit -m "feat(desktop): choose a Jira board in Settings and move cards between its columns"
```

---

### Task 7: The `'jira-columns'` lane mode on the board

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx` (lane-mode derivation and `WIBoard` usage in `WorkItemsView`; `BoardLanes`; `WIBoard`)
- Test: `packages/ui/tests/workitems-board-columns.test.jsx` (new)

**Interfaces:**
- Consumes:
  - `NexusMDData.JIRA_BOARD_COLUMNS` (Task 4)
  - `jiraColumnForStatus` from `@nexusmd/core` (Task 2)
  - `workItemSource.moveToStatuses` and `workItemSource.availableTargetStates` (Task 5, existing)
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/workitems-board-columns.test.jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/toast.jsx', () => ({ toast, ToastHost: () => null }))

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const item = (key, state) => ({ id: `jira:${key}`, source: 'jira', displayId: key, type: 'story', title: `T ${key}`, project: 'abc', state, stateCategory: 'InProgress', assignee: null, priority: 3, points: 0, tags: [], comments: 0, prs: 0, updated: '1h' })
const COLUMNS = [
  { name: 'To Do', statuses: ['To Do'] },
  { name: 'In Progress', statuses: ['In Progress', 'Code Review'] },
  { name: 'Done', statuses: ['Done'] },
]
const JIRA_ONLY = [{ id: 'jira', label: 'Jira', status: 'ok', error: null, warning: null }]

function renderBoard({ items, columns = COLUMNS, source = {} } = {}) {
  const workItemSource = { saveField: vi.fn(async () => {}), ...source }
  render(
    <NexusDataProvider value={{
      storage: memStorage({ 'nexusmd.wi.view': JSON.stringify('board') }), getProfileKey: k => k, pushPref: () => {}, workItemSource,
      data: { ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: items, WORK_ITEM_PROVIDERS: JIRA_ONLY, JIRA_BOARD_COLUMNS: columns, WI_TYPE_STATES_BY_SOURCE: { jira: {} } },
    }}>
      <WorkItemsView items={items} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  return workItemSource
}

const laneOf = (text) => screen.getByText(text).closest('.lane')
const laneHeads = () => Array.from(document.querySelectorAll('.lane .lane-head h4')).map(h => h.textContent)

afterEach(() => { cleanup(); toast.mockReset() })

it('renders the Jira board columns in order and places cards by status, case-insensitively', () => {
  renderBoard({ items: [item('A-1', 'code review'), item('A-2', 'To Do')] })
  expect(laneHeads()).toEqual(['To Do', 'In Progress', 'Done'])
  expect(laneOf('T A-1').querySelector('h4').textContent).toBe('In Progress')
  expect(laneOf('T A-2').querySelector('h4').textContent).toBe('To Do')
})

it('adds an Other lane only for statuses not on the board', () => {
  renderBoard({ items: [item('A-1', 'Blocked'), item('A-2', 'Done')] })
  expect(laneHeads()).toEqual(['To Do', 'In Progress', 'Done', 'Other'])
  cleanup()
  renderBoard({ items: [item('A-2', 'Done')] })
  expect(laneHeads()).not.toContain('Other')
})

it('falls back to status lanes when the board has no columns', () => {
  renderBoard({ items: [item('A-1', 'Doing')], columns: [] })
  expect(laneHeads()).not.toContain('In Progress')
})

it('moves a card into a column through moveToStatuses with that column\'s statuses', async () => {
  const moveToStatuses = vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' }))
  renderBoard({ items: [item('A-1', 'In Progress')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[2], { dataTransfer: {} })
  await waitFor(() => expect(moveToStatuses).toHaveBeenCalledWith('jira:A-1', ['Done'], expect.objectContaining({ id: 'jira:A-1' })))
})

it('does nothing when a card is dropped into the column it is already in', async () => {
  const moveToStatuses = vi.fn()
  renderBoard({ items: [item('A-1', 'Code Review')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[1], { dataTransfer: {} })
  await new Promise(r => setTimeout(r, 0))
  expect(moveToStatuses).not.toHaveBeenCalled()
})

it('toasts when the move fails', async () => {
  const moveToStatuses = vi.fn(async () => { throw new Error('No transition from "In Progress" to any status in this column') })
  renderBoard({ items: [item('A-1', 'In Progress')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[2], { dataTransfer: {} })
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('No transition'), 'error'))
})

it('dims columns the workflow cannot reach', async () => {
  const availableTargetStates = vi.fn(async () => ['Done'])
  renderBoard({ items: [item('A-1', 'In Progress')], source: { availableTargetStates, moveToStatuses: vi.fn() } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  await waitFor(() => expect(document.querySelectorAll('.lane')[0].style.opacity).toBe('0.4'))
  expect(document.querySelectorAll('.lane')[1].style.opacity).toBe('')
  expect(document.querySelectorAll('.lane')[2].style.opacity).toBe('')
})
```

Lanes are addressed by index (`querySelectorAll('.lane')[n]`) wherever a column name could also appear as a status chip or context-bar label. `laneOf` is only used with card titles, which are unique.

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --root packages/ui tests/workitems-board-columns`
Expected: FAIL. The lanes are status lanes, and there's no Other lane.

- [ ] **Step 3: Implement**

All edits are in `packages/ui/src/views/view-workitems.jsx`.

**3a.** Add `jiraColumnForStatus` to the `@nexusmd/core` import.

**3b.** In `WorkItemsView`, replace the `laneMode` line with the code below, and add the board-column lanes after the `jiraLanes` memo:

```js
  const boardColumns = Array.isArray(NexusMDData.JIRA_BOARD_COLUMNS) && NexusMDData.JIRA_BOARD_COLUMNS.length
    ? NexusMDData.JIRA_BOARD_COLUMNS : null;
  const jiraOnly = providers.length === 1 && providers[0].id === 'jira';
  const jiraTab = activeSource === 'jira' || jiraOnly;
  const laneMode = jiraTab && boardColumns ? 'jira-columns' : (multiProvider && !separate ? 'category' : 'state');
```

```js
  const jiraColumnLanes = useMemoW(() => {
    if (!boardColumns) return [];
    const names = boardColumns.map(c => c.name);
    const hasOther = sourceItems.some(w => !jiraColumnForStatus(boardColumns, w.state));
    return hasOther ? [...names, '__other__'] : names;
  }, [boardColumns, sourceItems]);
```

**3c.** Change the `WIBoard` usage:

```jsx
                   laneMode={laneMode}
                   boardColumns={boardColumns}
                   lanes={laneMode === 'jira-columns' ? jiraColumnLanes
                     : laneMode === 'category' ? CATEGORY_LANES
                     : activeSource === 'jira' ? jiraLanes
                     : getActiveLanes(boardColumnConfig, activeProject, PROJECTS, BOARD_LANES)}
```

**3d.** `BoardLanes`: add `boardColumns = null` to its props. Replace the `laneItems` and `laneLabel` lines with:

```jsx
        const laneItems = laneMode === 'category'
          ? items.filter(w => itemCategory(w) === state)
          : laneMode === 'jira-columns'
            ? items.filter(w => (jiraColumnForStatus(boardColumns, w.state)?.name ?? '__other__') === state)
            : items.filter(w => w.state === state || adoStateToNexusMD(w.state) === state);
        const laneLabel = laneMode === 'category' ? CATEGORY_LABELS[state] : state === '__other__' ? 'Other' : state;
```

Change `showState={laneMode === 'category'}` to `showState={laneMode === 'category' || laneMode === 'jira-columns'}`.

**3e.** `WIBoard`: add `boardColumns = null` to its props and add `boardColumns` to `laneProps`. Replace `onDragStart` with:

```js
  // On a state- or column-lane board, dim lanes a Jira item's workflow can't reach.
  const onDragStart = (id) => {
    setDragId(id);
    dragRef.current = id;
    setReachable(null);
    if ((laneMode === 'state' || laneMode === 'jira-columns') && isJiraId(id) && workItemSource?.availableTargetStates) {
      const current = items.find(w => w.id === id)?.state;
      workItemSource.availableTargetStates(id)
        .then(states => {
          if (!states || dragRef.current !== id) return;
          if (laneMode === 'jira-columns') {
            const ok = new Set([...states, current].map(s => String(s || '').toLowerCase()));
            setReachable(new Set(boardColumns.filter(c => c.statuses.some(s => ok.has(s.toLowerCase()))).map(c => c.name)));
          } else {
            setReachable(new Set([...states, current]));
          }
        })
        .catch(() => {});
    }
  };
```

In column mode the `__other__` lane is never in the reachable set, so it is dimmed during a drag.

Add a column mover next to `moveToCategory`:

```js
  const moveToColumn = async (id, laneKey) => {
    const item = items.find(w => w.id === id);
    const column = boardColumns?.find(c => c.name === laneKey);
    if (!item || !column) return; // "Other" isn't a drop target
    if (jiraColumnForStatus([column], item.state)) return; // already in this column
    if (!workItemSource?.moveToStatuses) { toast?.('✗ Moving between columns is not supported here', 'error'); return; }
    try {
      const r = await workItemSource.moveToStatuses(id, column.statuses, item);
      updateItem(id, { state: r.state, stateCategory: r.stateCategory });
    } catch (e) {
      toast?.('✗ ' + (e?.message || 'Move failed'), 'error');
    }
  };
```

In `onLaneDrop`, directly after the `if (laneMode === 'category') { … return; }` block, add the column branch. It handles the assignee swimlane change the same way the category branch does:

```js
    if (laneMode === 'jira-columns') {
      await moveToColumn(id, state);
      if (assigneeChange && prev?.assignee !== assigneeId) {
        updateItem(id, { assignee: assigneeId });
        if (!(await patchWI(id, [['/fields/System.AssignedTo', member?.name || null]]))) updateItem(id, { assignee: prev?.assignee ?? null });
      }
      return;
    }
```

In `onDropState`, after the category early return, add:

```js
    if (laneMode === 'jira-columns') { await moveToColumn(id, state); return; }
```

Change the `DragContextBar` props so it labels lanes correctly and leaves out Other:

```jsx
        lanes={laneMode === 'jira-columns' ? lanes.filter(l => l !== '__other__') : lanes}
        laneLabel={laneMode === 'category' ? (s => CATEGORY_LABELS[s]) : undefined}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w packages/ui test`
Expected: only the 3 known pre-existing failures. All existing work-item tests stay green: merged and ADO boards are unchanged, because `laneMode` only becomes `'jira-columns'` on the Jira tab when board columns are present.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/tests/workitems-board-columns.test.jsx
git commit -m "feat(ui): show the chosen Jira board's columns on the Jira tab"
```

---

### Task 8: Verify and build

**Files:** none

- [ ] **Step 1: Run every suite**

```bash
NODE_OPTIONS=--no-experimental-webstorage npm -w packages/core test
NODE_OPTIONS=--no-experimental-webstorage npm -w packages/ui test
NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test
```

Expected: core and desktop pass; ui has only the 3 known pre-existing failures.

- [ ] **Step 2: Production build**

Close any NexusMD instance running from `dist\desktop\release` first, since a running copy locks the output file. Then:

```bash
NODE_OPTIONS=--use-system-ca npm -w apps/desktop run build:win
```

Expected: both `NexusMD Setup 1.0.0.exe` and `NexusMD 1.0.0.exe` are rebuilt in `dist/desktop/release`.

- [ ] **Step 3: Manual check (user)**

1. Settings → Integrations → Jira: Test connection, pick your board, then Save & connect.
2. Work Items → Separate mode → Jira tab: the columns should match the Jira board's names and order, and cards should sit in the right column.
3. Drag a card to another column. Its status should change in Jira, and unreachable columns should be dimmed.
4. Set the board back to "Status columns (default)": you should get per-status columns again.
