# Desktop Work Item & Pull Request Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Work Item field editing (State/Assignee/Priority/Area/Tags) and rich Pull Request support (description edit, comment threads with add/reply/resolve/reopen, commits list, changed-files list with diffs) to the desktop app's drawer, without touching mobile (`apps/app/src/app.jsx`).

**Architecture:** Port the relevant logic and UI from `apps/app/src/app.jsx` into shared, headless functions in `packages/core/src/modules/ado/pr-collab.js` and shared React components in `packages/ui`, then wire desktop (`apps/desktop/src/main.jsx`) to consume them. Mobile keeps its existing inline implementation untouched — nothing in `apps/app` is modified by this plan.

**Tech Stack:** React (function components + hooks), Vitest + @testing-library/react for tests, Azure DevOps REST API (direct, via `createAdoHttpAdapter`), existing `@nexusmd/core`/`@nexusmd/ui` package structure.

## Global Constraints

- Tests for `packages/core` run via `vitest run` from `packages/core/` (not repo root) — workspace/jsdom config only resolves correctly per-package.
- Tests for `packages/ui` run via `vitest run` from `packages/ui/` (jsdom environment configured in `packages/ui/vitest.config.js`).
- Do not modify `apps/app/src/app.jsx` in this plan — mobile's existing inline PR/WI code stays as-is.
- All new ADO HTTP calls go through an injected `http.fetch(path, options)` adapter (never a module-global fetch), matching the existing pattern in `packages/core/src/modules/ado/loader.js`.
- Every new PR/WI mutation follows the existing optimistic-update convention: snapshot local state → apply immediately → call the API → roll back and `toast(...)` an error on failure.

---

### Task 1: `pr-collab.js` — shared PR REST helpers in `packages/core`

**Files:**
- Create: `packages/core/src/modules/ado/pr-collab.js`
- Modify: `packages/core/src/modules/ado/index.js`
- Test: `packages/core/tests/ado/pr-collab.test.js`

**Interfaces:**
- Produces (consumed by Task 8's `desktopPRSource` and Task 6's `PRTabs`):
  - `fetchPRThreads(http, { project, repoId, prId }) → Promise<Array<Thread>>` — `Thread` has ADO's native shape (`id`, `status`, `comments: [{ id, content, author, publishedDate, commentType, isDeleted }]`, `threadContext`).
  - `postPRThread(http, { project, repoId, prId, content }) → Promise<Thread>`
  - `postPRReply(http, { project, repoId, prId, threadId, parentCommentId, content }) → Promise<Comment>`
  - `setPRThreadStatus(http, { project, repoId, prId, threadId, status }) → Promise<Thread>` — `status` is `'active'` or `'fixed'`.
  - `fetchPRCommits(http, { project, repoId, prId }) → Promise<Array<Commit>>`
  - `fetchPRFileChanges(http, { project, repoId, prId }) → Promise<{ files: Array<ChangeEntry>, srcCommit: string|null, baseCommit: string|null }>`
  - `fetchFileContent(http, { project, repoId, path, commitId }) → Promise<string>` — returns `''` if `commitId` is falsy.
  - `updatePRDescription(http, { project, repoId, prId, description }) → Promise<PR>`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/ado/pr-collab.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import {
  fetchPRThreads, postPRThread, postPRReply, setPRThreadStatus,
  fetchPRCommits, fetchPRFileChanges, fetchFileContent, updatePRDescription,
} from '../../src/modules/ado/pr-collab.js'

function makeHttp(responses) {
  const calls = []
  return {
    calls,
    fetch: vi.fn(async (path, options) => {
      calls.push({ path, options })
      const match = responses.find(r => path.includes(r.match))
      if (!match) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      return {
        ok: match.ok !== false,
        status: match.status || 200,
        json: async () => match.json ?? {},
        text: async () => match.text ?? '',
      }
    }),
  }
}

describe('fetchPRThreads', () => {
  it('fetches threads and filters out deleted / commentless threads', async () => {
    const http = makeHttp([{
      match: '/threads?api-version',
      json: { value: [
        { id: 1, isDeleted: false, comments: [{ commentType: 1, isDeleted: false }] },
        { id: 2, isDeleted: true, comments: [{ commentType: 1, isDeleted: false }] },
        { id: 3, isDeleted: false, comments: [{ commentType: 2, isDeleted: false }] },
        { id: 4, isDeleted: false, comments: [] },
      ] },
    }])
    const threads = await fetchPRThreads(http, { project: 'Proj', repoId: 'repo1', prId: 42 })
    expect(threads.map(t => t.id)).toEqual([1])
    expect(http.calls[0].path).toBe('Proj/_apis/git/repositories/repo1/pullRequests/42/threads?api-version=7.0')
  })

  it('throws on non-ok response', async () => {
    const http = makeHttp([{ match: '/threads?api-version', ok: false, status: 500 }])
    await expect(fetchPRThreads(http, { project: 'Proj', repoId: 'r', prId: 1 }))
      .rejects.toThrow('HTTP 500')
  })
})

describe('postPRThread', () => {
  it('POSTs a new thread with the given content', async () => {
    const http = makeHttp([{ match: '/threads?api-version', json: { id: 9, status: 'active' } }])
    const thread = await postPRThread(http, { project: 'Proj', repoId: 'r1', prId: 5, content: 'hello' })
    expect(thread).toEqual({ id: 9, status: 'active' })
    const call = http.calls[0]
    expect(call.path).toBe('Proj/_apis/git/repositories/r1/pullRequests/5/threads?api-version=7.0')
    expect(call.options.method).toBe('POST')
    const body = JSON.parse(call.options.body)
    expect(body).toEqual({ comments: [{ parentCommentId: 0, content: 'hello', commentType: 1 }], status: 1 })
  })
})

describe('postPRReply', () => {
  it('POSTs a reply comment under the given thread', async () => {
    const http = makeHttp([{ match: '/threads/7/comments?api-version', json: { id: 20 } }])
    const comment = await postPRReply(http, {
      project: 'Proj', repoId: 'r1', prId: 5, threadId: 7, parentCommentId: 3, content: 'reply text',
    })
    expect(comment).toEqual({ id: 20 })
    const call = http.calls[0]
    expect(call.path).toBe('Proj/_apis/git/repositories/r1/pullRequests/5/threads/7/comments?api-version=7.0')
    expect(JSON.parse(call.options.body)).toEqual({ parentCommentId: 3, content: 'reply text', commentType: 1 })
  })
})

describe('setPRThreadStatus', () => {
  it('PATCHes the thread status', async () => {
    const http = makeHttp([{ match: '/threads/7?api-version', json: { id: 7, status: 'fixed' } }])
    const thread = await setPRThreadStatus(http, { project: 'Proj', repoId: 'r1', prId: 5, threadId: 7, status: 'fixed' })
    expect(thread.status).toBe('fixed')
    const call = http.calls[0]
    expect(call.options.method).toBe('PATCH')
    expect(JSON.parse(call.options.body)).toEqual({ status: 'fixed' })
  })
})

describe('fetchPRCommits', () => {
  it('returns the commits list', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [{ commitId: 'abc123' }] } }])
    const commits = await fetchPRCommits(http, { project: 'Proj', repoId: 'r1', prId: 5 })
    expect(commits).toEqual([{ commitId: 'abc123' }])
  })
})

describe('fetchPRFileChanges', () => {
  it('resolves the latest iteration then fetches its changes', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [
        { id: 1, sourceRefCommit: { commitId: 'old' }, targetRefCommit: { commitId: 'base-old' } },
        { id: 2, sourceRefCommit: { commitId: 'src2' }, targetRefCommit: { commitId: 'base2' } },
      ] } },
      { match: '/iterations/2/changes', json: { changeEntries: [{ item: { path: '/a.js' }, changeType: 'edit' }] } },
    ])
    const result = await fetchPRFileChanges(http, { project: 'Proj', repoId: 'r1', prId: 5 })
    expect(result).toEqual({
      files: [{ item: { path: '/a.js' }, changeType: 'edit' }],
      srcCommit: 'src2',
      baseCommit: 'base2',
    })
  })

  it('throws when there are no iterations', async () => {
    const http = makeHttp([{ match: '/iterations?api-version', json: { value: [] } }])
    await expect(fetchPRFileChanges(http, { project: 'Proj', repoId: 'r1', prId: 5 }))
      .rejects.toThrow('No PR iterations found.')
  })
})

describe('fetchFileContent', () => {
  it('returns empty string when commitId is falsy', async () => {
    const http = makeHttp([])
    const content = await fetchFileContent(http, { project: 'Proj', repoId: 'r1', path: '/a.js', commitId: null })
    expect(content).toBe('')
    expect(http.calls).toHaveLength(0)
  })

  it('fetches raw text content for a given commit', async () => {
    const http = makeHttp([{ match: '/items?path=', text: 'console.log(1)' }])
    const content = await fetchFileContent(http, { project: 'Proj', repoId: 'r1', path: '/a.js', commitId: 'src2' })
    expect(content).toBe('console.log(1)')
  })
})

describe('updatePRDescription', () => {
  it('PATCHes the PR description', async () => {
    const http = makeHttp([{ match: 'pullRequests/5?api-version', json: { id: 5, description: 'new desc' } }])
    const pr = await updatePRDescription(http, { project: 'Proj', repoId: 'r1', prId: 5, description: 'new desc' })
    expect(pr.description).toBe('new desc')
    const call = http.calls[0]
    expect(call.options.method).toBe('PATCH')
    expect(JSON.parse(call.options.body)).toEqual({ description: 'new desc' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/core/`): `npx vitest run tests/ado/pr-collab.test.js`
Expected: FAIL — `Cannot find module '../../src/modules/ado/pr-collab.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/modules/ado/pr-collab.js`:

```js
// pr-collab.js — headless Azure DevOps PR collaboration helpers (threads,
// comments, resolve/reopen, commits, file changes, description edits).
// Every function takes an injected `http.fetch(path, options)` adapter,
// mirroring the pattern in loader.js. Ported from apps/app/src/app.jsx's
// PRDetail/PRCommitsTab/PRFilesTab so both desktop and (eventually) mobile
// can share one implementation; mobile is not migrated to this in this pass.

async function getJson(http, path) {
  const res = await http.fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function mutate(http, path, method, body) {
  const res = await http.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function repoBase(project, repoId, prId) {
  return `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/pullRequests/${prId}`
}

export async function fetchPRThreads(http, { project, repoId, prId }) {
  const data = await getJson(http, `${repoBase(project, repoId, prId)}/threads?api-version=7.0`)
  return (data.value || []).filter(t =>
    !t.isDeleted && (t.comments || []).some(c => c.commentType === 1 && !c.isDeleted)
  )
}

export async function postPRThread(http, { project, repoId, prId, content }) {
  return mutate(http, `${repoBase(project, repoId, prId)}/threads?api-version=7.0`, 'POST', {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: 1,
  })
}

export async function postPRReply(http, { project, repoId, prId, threadId, parentCommentId, content }) {
  return mutate(
    http,
    `${repoBase(project, repoId, prId)}/threads/${threadId}/comments?api-version=7.0`,
    'POST',
    { parentCommentId, content, commentType: 1 },
  )
}

export async function setPRThreadStatus(http, { project, repoId, prId, threadId, status }) {
  return mutate(http, `${repoBase(project, repoId, prId)}/threads/${threadId}?api-version=7.0`, 'PATCH', { status })
}

export async function fetchPRCommits(http, { project, repoId, prId }) {
  const data = await getJson(http, `${repoBase(project, repoId, prId)}/commits?api-version=7.0`)
  return data.value || []
}

export async function fetchPRFileChanges(http, { project, repoId, prId }) {
  const base = repoBase(project, repoId, prId)
  const iData = await getJson(http, `${base}/iterations?api-version=7.0`)
  const iterations = iData.value || []
  if (!iterations.length) throw new Error('No PR iterations found.')
  const latest = iterations[iterations.length - 1]
  const srcCommit = latest.sourceRefCommit?.commitId || null
  const baseCommit = latest.targetRefCommit?.commitId || null
  const cData = await getJson(http, `${base}/iterations/${latest.id}/changes?$top=200&api-version=7.0`)
  return { files: cData.changeEntries || [], srcCommit, baseCommit }
}

export async function fetchFileContent(http, { project, repoId, path, commitId }) {
  if (!commitId) return ''
  const res = await http.fetch(
    `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/items` +
    `?path=${encodeURIComponent(path)}` +
    `&versionDescriptor%5BversionType%5D=commit&versionDescriptor%5Bversion%5D=${commitId}` +
    `&%24format=text&api-version=7.0`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function updatePRDescription(http, { project, repoId, prId, description }) {
  return mutate(
    http,
    `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/pullRequests/${prId}?api-version=7.0`,
    'PATCH',
    { description },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ado/pr-collab.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Export from the ado module index**

Modify `packages/core/src/modules/ado/index.js` — add after the `pr-links.js` export line:

```js
export {
  fetchPRThreads, postPRThread, postPRReply, setPRThreadStatus,
  fetchPRCommits, fetchPRFileChanges, fetchFileContent, updatePRDescription,
} from './pr-collab.js'
```

- [ ] **Step 6: Run the full core test suite**

Run (from `packages/core/`): `npx vitest run`
Expected: PASS (all existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/ado/pr-collab.js packages/core/src/modules/ado/index.js packages/core/tests/ado/pr-collab.test.js
git commit -m "feat(core): add shared PR thread/commit/file/description ADO helpers"
```

---

### Task 2: `project-areas.js` — shared area-path tree data

**Files:**
- Create: `packages/ui/src/project-areas.js`
- Test: `packages/ui/src/project-areas.test.js`

**Interfaces:**
- Consumes: nothing (pure module + hook using `localStorage`-shaped storage).
- Produces (consumed by Task 3's `AreaTreePicker` usage and Task 4's `WorkItemFieldsEditor`):
  - `DEFAULT_PROJECT_AREAS: Array<AreaNode>` where `AreaNode = { id: string, name: string, items: string[], children: AreaNode[] }`.
  - `useProjectAreas({ storage, getProfileKey }) → [areas, setAreas]` — a React hook. Loads from `storage.getItem(getProfileKey('nexusmd.projectAreas.v1'))` on mount (parsed JSON, falling back to `DEFAULT_PROJECT_AREAS`), and persists via `storage.setItem` on every change, mirroring `apps/app/src/app.jsx:1427-1440`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/project-areas.test.js`:

```js
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { DEFAULT_PROJECT_AREAS, useProjectAreas } from './project-areas.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: k => m.delete(k),
    _map: m,
  }
}

function Harness({ storage, getProfileKey, onReady }) {
  const [areas, setAreas] = useProjectAreas({ storage, getProfileKey })
  onReady(areas, setAreas)
  return <div data-testid="count">{areas.length}</div>
}

describe('DEFAULT_PROJECT_AREAS', () => {
  it('is a non-empty array of area nodes with id/name/items/children', () => {
    expect(Array.isArray(DEFAULT_PROJECT_AREAS)).toBe(true)
    expect(DEFAULT_PROJECT_AREAS.length).toBeGreaterThan(0)
    for (const node of DEFAULT_PROJECT_AREAS) {
      expect(typeof node.id).toBe('string')
      expect(typeof node.name).toBe('string')
      expect(Array.isArray(node.items)).toBe(true)
      expect(Array.isArray(node.children)).toBe(true)
    }
  })
})

describe('useProjectAreas', () => {
  it('falls back to DEFAULT_PROJECT_AREAS when storage is empty', () => {
    const storage = memStorage()
    let latest
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(a) => { latest = a }} />)
    expect(latest).toEqual(DEFAULT_PROJECT_AREAS)
  })

  it('loads a previously persisted tree from storage', () => {
    const custom = [{ id: 'x', name: 'X', items: ['a'], children: [] }]
    const storage = memStorage({ 'nexusmd.projectAreas.v1': JSON.stringify(custom) })
    let latest
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(a) => { latest = a }} />)
    expect(latest).toEqual(custom)
  })

  it('persists changes back to storage', () => {
    const storage = memStorage()
    let setter
    render(<Harness storage={storage} getProfileKey={k => k} onReady={(_, s) => { setter = s }} />)
    const next = [{ id: 'y', name: 'Y', items: [], children: [] }]
    act(() => setter(next))
    expect(JSON.parse(storage._map.get('nexusmd.projectAreas.v1'))).toEqual(next)
  })

  it('scopes the storage key through getProfileKey', () => {
    const storage = memStorage()
    render(<Harness storage={storage} getProfileKey={k => 'profileA.' + k} onReady={() => {}} />)
    expect(storage._map.has('profileA.nexusmd.projectAreas.v1')).toBe(false) // nothing written yet
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run src/project-areas.test.js`
Expected: FAIL — `Cannot find module './project-areas.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/project-areas.js`. Port `DEFAULT_PROJECT_AREAS` verbatim from `apps/app/src/app.jsx:78` (copy the full constant — same module/service tree), then add the hook:

```js
import React from 'react'

// project-areas.js — the org's area-path tree. This is NOT fetched from ADO;
// it's a hand-maintained constant describing the module/service structure,
// optionally overridden per-profile via storage. Ported from
// apps/app/src/app.jsx's DEFAULT_PROJECT_AREAS + the projectAreas useState/
// useEffect pair (app.jsx:1427-1440), decoupled from the HelmData global.

export const DEFAULT_PROJECT_AREAS = [
  // ... verbatim copy of apps/app/src/app.jsx:78-... (the full DEFAULT_PROJECT_AREAS tree) ...
]

const STORAGE_KEY = 'nexusmd.projectAreas.v1'

export function useProjectAreas({ storage, getProfileKey }) {
  const key = getProfileKey(STORAGE_KEY)
  const [areas, setAreas] = React.useState(() => {
    try {
      const raw = storage.getItem(key)
      return raw ? JSON.parse(raw) : DEFAULT_PROJECT_AREAS
    } catch {
      return DEFAULT_PROJECT_AREAS
    }
  })

  React.useEffect(() => {
    try { storage.setItem(key, JSON.stringify(areas)) } catch { /* ignore */ }
  }, [key, areas])

  return [areas, setAreas]
}
```

**Note for the implementer:** copy the actual `DEFAULT_PROJECT_AREAS` array body from `apps/app/src/app.jsx` lines 78 through the line just before `function detectDefaultSidebar` reappears is wrong — copy through the matching closing `];` for the constant (search for the line `function SettField` or similar that follows it, and take everything between `const DEFAULT_PROJECT_AREAS = [` and its closing `];`). Do not paraphrase the data — it must be byte-identical to mobile's tree so both apps show the same area paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/project-areas.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/project-areas.js packages/ui/src/project-areas.test.js
git commit -m "feat(ui): add shared project-areas data + useProjectAreas hook"
```

---

### Task 3: `wi-field-pickers.jsx` — shared `TagInput` and `AreaTreePicker`

**Files:**
- Create: `packages/ui/src/views/wi-field-pickers.jsx`
- Test: `packages/ui/src/views/wi-field-pickers.test.jsx`

**Interfaces:**
- Consumes: `Icon` from `../icons.jsx`.
- Produces (consumed by Task 4's `WorkItemFieldsEditor`):
  - `TagInput({ value, onChange, knownTags, style })` — `value` is a `;`-joined string, `onChange(nextValueString)`, `knownTags: string[]` (caller-supplied, e.g. derived from `data.WORK_ITEMS`).
  - `AreaTreePicker({ value, onChange, areas, compact })` — `value` is a `;`-joined string of paths, `onChange(nextValueString)`, `areas: AreaNode[]` (from `useProjectAreas()`).

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/views/wi-field-pickers.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TagInput, AreaTreePicker } from './wi-field-pickers.jsx'

afterEach(cleanup)

describe('TagInput', () => {
  it('renders existing tags as chips', () => {
    render(<TagInput value="alpha; beta" onChange={vi.fn()} knownTags={[]} />)
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
  })

  it('adds a new tag on Enter and calls onChange with the joined string', () => {
    const onChange = vi.fn()
    render(<TagInput value="alpha" onChange={onChange} knownTags={[]} />)
    const input = screen.getByPlaceholderText('Add tags…')
    fireEvent.change(input, { target: { value: 'gamma' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('alpha; gamma')
  })

  it('removes a tag when its × is clicked', () => {
    const onChange = vi.fn()
    render(<TagInput value="alpha; beta" onChange={onChange} knownTags={[]} />)
    fireEvent.mouseDown(screen.getByText('×', { selector: 'span' }) || screen.getAllByText('×')[0])
    expect(onChange).toHaveBeenCalledWith('beta')
  })
})

describe('AreaTreePicker', () => {
  const areas = [
    { id: 'a', name: 'Alpha', items: ['leaf1'], children: [] },
  ]

  it('shows "— None —" when nothing is selected', () => {
    render(<AreaTreePicker value="" onChange={vi.fn()} areas={areas} />)
    expect(screen.getByText('— None —')).toBeTruthy()
  })

  it('opens the tree and selects a top-level node on click', () => {
    const onChange = vi.fn()
    render(<AreaTreePicker value="" onChange={onChange} areas={areas} />)
    fireEvent.click(screen.getByText('— None —'))
    fireEvent.mouseDown(screen.getByText('Alpha'))
    expect(onChange).toHaveBeenCalledWith('Alpha')
  })

  it('renders a chip for an already-selected path', () => {
    render(<AreaTreePicker value="Alpha" onChange={vi.fn()} areas={areas} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run src/views/wi-field-pickers.test.jsx`
Expected: FAIL — `Cannot find module './wi-field-pickers.jsx'`

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/views/wi-field-pickers.jsx`. Port `TagInput` (`apps/app/src/app.jsx:789-902`) and `AreaTreePicker` (`apps/app/src/app.jsx:1163-1333`) verbatim, with two changes: (1) accept `knownTags`/`areas` as props instead of reading `HelmData.WORK_ITEMS`/`HelmData.PROJECT_AREAS`, (2) drop the `useMemo` that computed `knownTags` from `HelmData` since it's now a prop:

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'

const { useState, useEffect, useRef, useMemo } = React

// ── TagInput ──────────────────────────────────────────────────────────────────
// Ported from apps/app/src/app.jsx's TagInput. `knownTags` (for autocomplete)
// is now an explicit prop instead of reading the HelmData.WORK_ITEMS global,
// so this can run on any platform via useNexusData().data.WORK_ITEMS.
export function TagInput({ value, onChange, knownTags = [], style }) {
  const selected = (value || '').split(';').map(t => t.trim()).filter(Boolean)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const filtered = knownTags.filter(t =>
    !selected.includes(t) && (!query || t.toLowerCase().includes(query.toLowerCase()))
  )
  const canCreate = query.trim() && !knownTags.some(t => t.toLowerCase() === query.trim().toLowerCase()) && !selected.includes(query.trim())

  const add = (tag) => {
    const tr = tag.trim()
    if (!tr || selected.includes(tr)) return
    onChange([...selected, tr].join('; '))
    setQuery('')
    inputRef.current?.focus()
  }

  const remove = (tag) => {
    onChange(selected.filter(t => t !== tag).join('; '))
  }

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && query.trim()) {
      e.preventDefault()
      add(query.trim())
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const baseStyle = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minHeight: 32, padding: '3px 8px', cursor: 'text',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    ...(style || {}),
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={baseStyle} onClick={() => { setOpen(true); inputRef.current?.focus() }}>
        {selected.map(t => (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--accent-soft, rgba(99,102,241,0.12))', color: 'var(--accent, #6366f1)',
            borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
          }}>
            {t}
            <span onMouseDown={e => { e.stopPropagation(); e.preventDefault(); remove(t) }}
              style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? '' : 'Add tags…'}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)',
            flex: '1 1 80px', minWidth: 80, height: 24, padding: 0,
          }}
        />
      </div>
      {open && (filtered.length > 0 || canCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: 'var(--shadow-pop)', maxHeight: 180, overflowY: 'auto',
        }}>
          {filtered.map(t => (
            <div key={t} onMouseDown={e => { e.preventDefault(); add(t); setOpen(false) }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}>
              {t}
            </div>
          ))}
          {canCreate && (
            <div onMouseDown={e => { e.preventDefault(); add(query.trim()); setOpen(false) }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--accent, #6366f1)', borderTop: filtered.length ? '1px solid var(--border)' : 'none' }}>
              + Create "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AreaTreePicker ────────────────────────────────────────────────────────────
// Multi-select tree picker. value is a semicolon-separated string of paths.
// Ported from apps/app/src/app.jsx's AreaTreePicker; `areas` is now an
// explicit prop (from useProjectAreas()) instead of HelmData.PROJECT_AREAS.
export function AreaTreePicker({ value, onChange, areas = [], compact = false }) {
  const selected = useMemo(
    () => new Set((value || '').split(';').map(s => s.trim()).filter(Boolean)),
    [value]
  )

  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(areas.map(n => n.id)))
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggleExpand = (e, id) => {
    e.stopPropagation(); e.preventDefault()
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const togglePath = (path) => {
    const next = new Set(selected)
    next.has(path) ? next.delete(path) : next.add(path)
    onChange([...next].join('; '))
  }

  const removePath = (path) => {
    const next = new Set(selected)
    next.delete(path)
    onChange([...next].join('; '))
  }

  const renderNodes = (nodes, prefix) => nodes.map(n => {
    const path = prefix ? `${prefix}\\${n.name}` : n.name
    const children = n.children || []
    const items = n.items || []
    const hasContent = children.length > 0 || items.length > 0
    const isExpanded = expanded.has(n.id)
    const isSelected = selected.has(path)
    const depth = prefix ? prefix.split('\\').length : 0

    return (
      <React.Fragment key={n.id}>
        <button
          onMouseDown={e => { e.preventDefault(); togglePath(path) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, width: '100%',
            textAlign: 'left', border: 'none', borderRadius: 6,
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--accent)' : depth === 0 ? 'var(--text)' : 'var(--text-muted)',
            fontWeight: depth === 0 ? 600 : 500,
            padding: `5px 8px 5px ${8 + depth * 14}px`,
            cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
          }}
        >
          <span
            style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}
            onMouseDown={e => hasContent && toggleExpand(e, n.id)}
          >
            {hasContent ? <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={10}/> : null}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
          {isSelected && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
        </button>
        {hasContent && isExpanded && (
          <React.Fragment>
            {renderNodes(children, path)}
            {items.map((item, i) => {
              const itemPath = `${path}\\${item}`
              const itemSel = selected.has(itemPath)
              const itemDepth = depth + 1
              return (
                <button key={i}
                  onMouseDown={e => { e.preventDefault(); togglePath(itemPath) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    textAlign: 'left', border: 'none', borderRadius: 6,
                    background: itemSel ? 'var(--accent-soft)' : 'transparent',
                    color: itemSel ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 400,
                    padding: `4px 8px 4px ${8 + itemDepth * 14}px`,
                    cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
                  }}
                >
                  <span style={{ width: 14, flexShrink: 0 }}/>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
                  {itemSel && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
                </button>
              )
            })}
          </React.Fragment>
        )}
      </React.Fragment>
    )
  })

  const selectedArr = [...selected]

  const triggerBase = compact ? {
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '3px 6px', fontFamily: 'var(--sans)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
    width: '100%', boxSizing: 'border-box', minHeight: 28, textAlign: 'left',
  } : {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    gap: 4, cursor: 'pointer', minHeight: 36, width: '100%', boxSizing: 'border-box',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(v => !v)} style={triggerBase}>
        {selectedArr.length > 0
          ? selectedArr.map(path => {
              const label = path.split('\\').pop()
              return (
                <span key={path} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
                }}>
                  {label}
                  <span
                    onMouseDown={e => { e.stopPropagation(); e.preventDefault(); removePath(path) }}
                    style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}
                  >×</span>
                </span>
              )
            })
          : <span style={{ fontSize: 13, color: 'var(--text-subtle)', flex: 1 }}>— None —</span>
        }
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-subtle)' }}/>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 260,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          maxHeight: 280, overflowY: 'auto', padding: 4, zIndex: 300,
        }}>
          {selectedArr.length > 0 && (
            <button
              onMouseDown={e => { e.preventDefault(); onChange('') }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, width: '100%', border: 'none', borderRadius: 6,
                background: 'transparent', color: 'var(--danger)',
                padding: '5px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)', marginBottom: 2,
              }}
            >
              <span style={{ width: 14 }}/>
              Clear all
            </button>
          )}
          {renderNodes(areas, '')}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/wi-field-pickers.test.jsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/wi-field-pickers.jsx packages/ui/src/views/wi-field-pickers.test.jsx
git commit -m "feat(ui): add shared TagInput and AreaTreePicker components"
```

---

### Task 4: `WorkItemFieldsEditor` — State/Assignee/Priority/Area/Tags editor

**Files:**
- Modify: `packages/ui/src/views/work-item-detail.jsx`
- Test: `packages/ui/src/views/work-item-detail.test.jsx`

**Interfaces:**
- Consumes: `useNexusData()` (for `workItemSource`, `data.STATES`, `data.TEAM`, `data.WORK_ITEMS`, `storage`, `getProfileKey`), `TagInput`/`AreaTreePicker` from `./wi-field-pickers.jsx`, `useProjectAreas` from `../project-areas.js`, `toast` from `../toast.jsx`.
- Produces (consumed by Task 8's `DesktopDetailDrawer`):
  - `WorkItemFieldsEditor({ item, onItemUpdated })` — `item` is the work-item object from the item list (`{ id, state, assignee, priority, area, tags: string[] }`), `onItemUpdated(patch)` is called with the locally-applied patch after a successful save so the caller can update its own list (mirrors `setItems` usage already in desktop).

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/views/work-item-detail.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WorkItemFieldsEditor } from './work-item-detail.jsx'
import { NexusDataProvider } from '../data-context.jsx'

afterEach(cleanup)

function renderEditor({ item, workItemSource, onItemUpdated = vi.fn() }) {
  const data = {
    STATES: ['To Do', 'Active', 'Done'],
    TEAM: [{ id: 'u1', name: 'Alex' }, { id: 'u2', name: 'Sam' }],
    WORK_ITEMS: [],
  }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  return render(
    <NexusDataProvider value={{ data, storage, getProfileKey: k => k, pushPref: () => {}, workItemSource }}>
      <WorkItemFieldsEditor item={item} onItemUpdated={onItemUpdated} />
    </NexusDataProvider>
  )
}

describe('WorkItemFieldsEditor', () => {
  it('renders current State/Assignee/Priority values', () => {
    renderEditor({ item: { id: 1, state: 'Active', assignee: 'u1', priority: 2, area: '', tags: [] } })
    expect(screen.getByDisplayValue('Active')).toBeTruthy()
    expect(screen.getByDisplayValue('Alex')).toBeTruthy()
    expect(screen.getByDisplayValue('2 – High')).toBeTruthy()
  })

  it('saves a State change optimistically and calls onItemUpdated on success', async () => {
    const saveField = vi.fn().mockResolvedValue()
    const onItemUpdated = vi.fn()
    renderEditor({
      item: { id: 1, state: 'To Do', assignee: null, priority: 3, area: '', tags: [] },
      workItemSource: { saveField },
      onItemUpdated,
    })
    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'Active' } })
    await waitFor(() => expect(saveField).toHaveBeenCalledWith(1, 'System.State', 'Active'))
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalledWith({ state: 'Active' }))
  })

  it('rolls back the State select on save failure', async () => {
    const saveField = vi.fn().mockRejectedValue(new Error('boom'))
    renderEditor({
      item: { id: 1, state: 'To Do', assignee: null, priority: 3, area: '', tags: [] },
      workItemSource: { saveField },
    })
    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'Active' } })
    await waitFor(() => expect(saveField).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByDisplayValue('To Do')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run src/views/work-item-detail.test.jsx`
Expected: FAIL — `WorkItemFieldsEditor is not exported`

- [ ] **Step 3: Write the implementation**

In `packages/ui/src/views/work-item-detail.jsx`, add these imports at the top (alongside the existing ones):

```jsx
import { useProjectAreas } from '../project-areas.js';
import { TagInput, AreaTreePicker } from './wi-field-pickers.jsx';
```

Then add this new exported component, placed after `RawFieldsInspector` (end of file), ported from `WIDetail`'s `<dl className="kv">` block in `apps/app/src/app.jsx:2229-2305`:

```jsx
// ── WorkItemFieldsEditor ──────────────────────────────────────────────────────
// State/Assignee/Priority/Area/Tags editor block. Ported from WIDetail's
// details section in apps/app/src/app.jsx:2229-2305, generalised to read
// STATES/TEAM/WORK_ITEMS from useNexusData() instead of the HelmData global,
// and to use the shared TagInput/AreaTreePicker from wi-field-pickers.jsx.

export function WorkItemFieldsEditor({ item, onItemUpdated }) {
  const { data, storage, getProfileKey, workItemSource } = useNexusData();
  const STATES = data.STATES || [];
  const TEAM = data.TEAM || [];
  const [areas] = useProjectAreas({ storage, getProfileKey });

  const [local, setLocal] = React.useState(item);
  React.useEffect(() => { setLocal(item); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const knownTags = React.useMemo(() => {
    const s = new Set();
    (data.WORK_ITEMS || []).forEach(wi => {
      (wi.tags || []).forEach(t => { if (t) s.add(t); });
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [data.WORK_ITEMS]);

  const patch = async (field, adoValue, localPatch) => {
    const prev = local;
    setLocal(l => ({ ...l, ...localPatch }));
    try {
      await workItemSource.saveField(item.id, field, adoValue);
      onItemUpdated?.(localPatch);
      toast?.('Saved', 'success');
    } catch (e) {
      setLocal(prev);
      toast?.('✗ ' + (e.message || 'Save failed'), 'error');
    }
  };

  const assignee = TEAM.find(t => t.id === local.assignee);

  const sel = {
    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
    padding: '1px 18px 1px 3px', fontSize: 13, color: 'var(--text)',
    cursor: 'pointer', appearance: 'none', outline: 'none',
    fontFamily: 'var(--sans)', maxWidth: '100%',
  };

  return (
    <div className="drawer-section">
      <h4>Details</h4>
      <dl className="kv">
        <dt>State</dt>
        <dd>
          <select value={local.state || ''} style={sel}
            onChange={e => { const v = e.target.value; patch('System.State', v, { state: v }); }}>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </dd>

        <dt>Assignee</dt>
        <dd>
          <select value={assignee?.name || ''} style={sel}
            onChange={e => {
              const name = e.target.value;
              const member = TEAM.find(t => t.name === name);
              patch('System.AssignedTo', name || '', { assignee: member?.id || null });
            }}>
            <option value="">Unassigned</option>
            {TEAM.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </dd>

        <dt>Priority</dt>
        <dd>
          <select value={String(local.priority || 3)} style={sel}
            onChange={e => { const v = parseInt(e.target.value, 10); patch('Microsoft.VSTS.Common.Priority', v, { priority: v }); }}>
            <option value="1">1 – Critical</option>
            <option value="2">2 – High</option>
            <option value="3">3 – Medium</option>
            <option value="4">4 – Low</option>
          </select>
        </dd>

        <dt>Area</dt>
        <dd>
          <AreaTreePicker compact areas={areas} value={local.area || ''}
            onChange={val => patch('Custom.Area', val, { area: val })}/>
        </dd>

        <dt>Tags</dt>
        <dd>
          <TagInput
            value={(local.tags || []).join('; ')}
            knownTags={knownTags}
            onChange={str => {
              const tags = str.split(';').map(t => t.trim()).filter(Boolean);
              patch('System.Tags', str.trim(), { tags });
            }}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 28, padding: '1px 6px' }}
          />
        </dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/work-item-detail.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full packages/ui test suite**

Run: `npx vitest run`
Expected: PASS (no regressions in existing `work-item-detail`-adjacent tests — there are none yet, but confirm no other suite broke)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/work-item-detail.jsx packages/ui/src/views/work-item-detail.test.jsx
git commit -m "feat(ui): add WorkItemFieldsEditor (State/Assignee/Priority/Area/Tags)"
```

---

### Task 5: `pr-tabs.jsx` part 1 — Commits and Files tabs

**Files:**
- Create: `packages/ui/src/views/pr-tabs.jsx`
- Test: `packages/ui/src/views/pr-tabs.test.jsx`

**Interfaces:**
- Consumes: `fetchPRCommits`, `fetchPRFileChanges`, `fetchFileContent` from `@nexusmd/core`; `Icon` from `../icons.jsx`; `timeAgo` from `@nexusmd/core`.
- Produces (internal to this file for now; exported for direct testing, composed into `PRTabs` in Task 6):
  - `PRCommitsTab({ pr, http })` — `pr` has `{ id, repoId, project, org, repo }`, `http` is the ADO adapter.
  - `PRFilesTab({ pr, http })`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/views/pr-tabs.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRCommitsTab, PRFilesTab } from './pr-tabs.jsx'

afterEach(cleanup)

function makeHttp(responses) {
  return {
    fetch: vi.fn(async (path) => {
      const match = responses.find(r => path.includes(r.match))
      if (!match) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      return { ok: match.ok !== false, status: match.status || 200, json: async () => match.json ?? {}, text: async () => match.text ?? '' }
    }),
  }
}

const pr = { id: 5, repoId: 'r1', project: 'Proj', repo: 'myrepo' }

describe('PRCommitsTab', () => {
  it('shows a loading state then the commit list', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [
      { commitId: 'abcdef1234567', comment: 'Fix bug\n\nDetails', author: { name: 'Alex', date: '2026-01-01T00:00:00Z' } },
    ] } }])
    render(<PRCommitsTab pr={pr} http={http} />)
    expect(screen.getByText('Loading commits…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Fix bug')).toBeTruthy())
    expect(screen.getByText('abcdef1')).toBeTruthy()
  })

  it('shows an empty state when there are no commits', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [] } }])
    render(<PRCommitsTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('No commits found.')).toBeTruthy())
  })
})

describe('PRFilesTab', () => {
  it('lists changed files and expands a diff on click', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [{ id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'base1' } }] } },
      { match: '/iterations/1/changes', json: { changeEntries: [{ item: { path: '/src/a.js' }, changeType: 'edit' }] } },
      { match: '/items?path=', text: 'line1\nline2' },
    ])
    render(<PRFilesTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('1 file changed')).toBeTruthy())
    fireEvent.click(screen.getByText('a.js'))
    await waitFor(() => expect(screen.getByText('line1')).toBeTruthy())
  })

  it('shows an empty state when there are no file changes', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [{ id: 1, sourceRefCommit: {}, targetRefCommit: {} }] } },
      { match: '/iterations/1/changes', json: { changeEntries: [] } },
    ])
    render(<PRFilesTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('No file changes found.')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run src/views/pr-tabs.test.jsx`
Expected: FAIL — `Cannot find module './pr-tabs.jsx'`

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/views/pr-tabs.jsx`. Port `diffLines`, `PRCommitsTab`, `PRFilesTab` from `apps/app/src/app.jsx:2311-2549`, replacing the module-level `adoGet`/`HelmData.ORG` calls with an injected `http` prop and `pr-collab.js` functions:

```jsx
import React from 'react';
import { fetchPRCommits, fetchPRFileChanges, fetchFileContent, timeAgo } from '@nexusmd/core';
import { Icon } from '../icons.jsx';

const { useState, useEffect } = React;

// ── diffLines ─────────────────────────────────────────────────────────────────
// Simple LCS-based line diff. Ported from apps/app/src/app.jsx:2312-2336.
function diffLines(oldLines, newLines) {
  const N = oldLines.length, M = newLines.length;
  const MAX = 400;
  if (N > MAX || M > MAX) return null;
  const lcs = new Int32Array((N + 1) * (M + 1));
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      const idx = i * (M + 1) + j;
      if (oldLines[i] === newLines[j]) lcs[idx] = 1 + lcs[(i + 1) * (M + 1) + (j + 1)];
      else lcs[idx] = Math.max(lcs[(i + 1) * (M + 1) + j], lcs[i * (M + 1) + (j + 1)]);
    }
  }
  const result = [];
  let i = 0, j = 0;
  while (i < N || j < M) {
    if (i < N && j < M && oldLines[i] === newLines[j]) {
      result.push({ t: '=', v: oldLines[i] }); i++; j++;
    } else if (j < M && (i >= N || lcs[(i + 1) * (M + 1) + j] >= lcs[i * (M + 1) + (j + 1)])) {
      result.push({ t: '+', v: newLines[j] }); j++;
    } else {
      result.push({ t: '-', v: oldLines[i] }); i++;
    }
  }
  return result;
}

// ── PRCommitsTab ──────────────────────────────────────────────────────────────
export function PRCommitsTab({ pr, http }) {
  const [state, setState] = useState({ status: 'idle', commits: [], error: null });

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', commits: [], error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', commits: [], error: null });
    fetchPRCommits(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(commits => setState({ status: 'ok', commits, error: null }))
      .catch(e => setState({ status: 'error', commits: [], error: e.message }));
  }, [pr.id, pr.repoId, pr.project, http]);

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading commits…</div>;
  if (state.status === 'error') return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;
  if (!state.commits.length) return <div className="drawer-section empty">No commits found.</div>;

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.commits.map(c => {
          const shortId = (c.commitId || '').slice(0, 7);
          const adoUrl = pr.org && pr.project
            ? `https://dev.azure.com/${encodeURIComponent(pr.org)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/commit/${c.commitId}`
            : null;
          const authorName = c.author?.name || c.committer?.name || '';
          const authorDate = c.author?.date || c.committer?.date || null;
          const message = (c.comment || '').split('\n')[0];
          return (
            <div key={c.commitId} style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0, lineHeight: 1.4 }}>{message || '(no message)'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {adoUrl
                  ? <a href={adoUrl} target="_blank" rel="noopener" className="mono muted" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{shortId}</a>
                  : <span className="mono muted" style={{ fontSize: 11 }}>{shortId}</span>}
                {authorName && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{authorName}</span>}
                {authorDate && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(authorDate)} ago</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PRFilesTab ────────────────────────────────────────────────────────────────
export function PRFilesTab({ pr, http }) {
  const [state, setState] = useState({ status: 'idle', files: [], srcCommit: null, baseCommit: null, error: null });
  const [expanded, setExpanded] = useState({});
  const [fileContents, setFileContents] = useState({});

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', files: [], srcCommit: null, baseCommit: null, error: null });
    fetchPRFileChanges(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(({ files, srcCommit, baseCommit }) => setState({ status: 'ok', files, srcCommit, baseCommit, error: null }))
      .catch(e => setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: e.message }));
  }, [pr.id, pr.repoId, pr.project, http]);

  const toggleFile = async (file) => {
    const path = file.item?.path;
    if (!path) return;
    const key = path;
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    if (fileContents[key] || !state.srcCommit) return;
    const changeType = (file.changeType || '').toLowerCase();

    const fetchContent = async (commitId) => {
      try { return await fetchFileContent(http, { project: pr.project, repoId: pr.repoId, path, commitId }); }
      catch (_) { return null; }
    };

    try {
      let oldText = '', newText = '';
      if (changeType === 'add') {
        newText = (await fetchContent(state.srcCommit)) ?? '';
      } else if (changeType === 'delete') {
        oldText = (await fetchContent(state.baseCommit)) ?? '';
      } else {
        [oldText, newText] = await Promise.all([
          fetchContent(state.baseCommit).then(t => t ?? ''),
          fetchContent(state.srcCommit).then(t => t ?? ''),
        ]);
      }
      setFileContents(prev => ({ ...prev, [key]: { oldText, newText, changeType } }));
    } catch (e) {
      setFileContents(prev => ({ ...prev, [key]: { error: e.message } }));
    }
  };

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading files…</div>;
  if (state.status === 'error') return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;
  if (!state.files.length) return <div className="drawer-section empty">No file changes found.</div>;

  const changeIcon = { add: { icon: '+', color: 'var(--success)' }, delete: { icon: '−', color: 'var(--danger)' }, edit: { icon: '~', color: 'var(--info)' }, rename: { icon: 'R', color: 'var(--warning)' } };

  return (
    <div className="drawer-section">
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
        {state.files.length} file{state.files.length !== 1 ? 's' : ''} changed
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.files.map((file, idx) => {
          const path = file.item?.path || '';
          const ct = (file.changeType || 'edit').toLowerCase();
          const ind = changeIcon[ct] || changeIcon.edit;
          const isOpen = expanded[path];
          const contents = fileContents[path];
          const filename = path.split('/').pop();
          const dir = path.slice(0, path.lastIndexOf('/') + 1);

          return (
            <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-2)', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleFile(file)}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ind.color, minWidth: 12, textAlign: 'center' }}>{ind.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{dir}</span><span style={{ fontWeight: 600 }}>{filename}</span>
                </span>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
              </div>

              {isOpen && (
                <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', overflow: 'auto', maxHeight: 480 }}>
                  {!contents && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>Loading diff…</div>}
                  {contents?.error && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--danger)' }}>{contents.error}</div>}
                  {contents && !contents.error && (() => {
                    const oldLines = (contents.oldText || '').split('\n');
                    const newLines = (contents.newText || '').split('\n');
                    const diff = diffLines(oldLines, newLines);
                    if (!diff) {
                      return (
                        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>
                          File too large to diff inline.{' '}
                          {pr.org && pr.project
                            ? <a href={`https://dev.azure.com/${encodeURIComponent(pr.org)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/pullrequest/${pr.id}?_a=files`} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>View in ADO</a>
                            : null}
                        </div>
                      );
                    }
                    const ctx = 3;
                    const visible = [];
                    let sameRun = [];
                    const flush = () => {
                      if (!sameRun.length) return;
                      const start = visible.length - sameRun.length;
                      if (sameRun.length <= ctx * 2 + 1) { visible.push(...sameRun); sameRun = []; return; }
                      const keep = sameRun.slice(0, ctx).concat([{ t: '…', v: `… ${sameRun.length - ctx * 2} unchanged lines …` }]).concat(sameRun.slice(-ctx));
                      visible.length = start;
                      visible.push(...keep);
                      sameRun = [];
                    };
                    diff.forEach(line => {
                      if (line.t === '=') { sameRun.push(line); }
                      else { flush(); visible.push(line); }
                    });
                    flush();

                    return (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        <tbody>
                          {visible.map((line, i) => {
                            if (line.t === '…') return (
                              <tr key={i} style={{ background: 'var(--surface-2)' }}>
                                <td colSpan={2} style={{ padding: '3px 12px', color: 'var(--text-subtle)', fontSize: 11, textAlign: 'center' }}>{line.v}</td>
                              </tr>
                            );
                            const bg = line.t === '+' ? 'rgba(34,197,94,0.12)' : line.t === '-' ? 'rgba(239,68,68,0.12)' : 'transparent';
                            const fg = line.t === '+' ? 'rgba(34,197,94,0.8)' : line.t === '-' ? 'rgba(239,68,68,0.8)' : 'var(--text-subtle)';
                            return (
                              <tr key={i} style={{ background: bg }}>
                                <td style={{ padding: '1px 8px', color: fg, userSelect: 'none', minWidth: 16, textAlign: 'center', borderRight: '1px solid var(--border)', fontSize: 11 }}>
                                  {line.t === '+' ? '+' : line.t === '-' ? '−' : ''}
                                </td>
                                <td style={{ padding: '1px 10px', color: 'var(--text)', whiteSpace: 'pre', overflowWrap: 'normal' }}>{line.v || ' '}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/pr-tabs.test.jsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/pr-tabs.jsx packages/ui/src/views/pr-tabs.test.jsx
git commit -m "feat(ui): add PRCommitsTab and PRFilesTab"
```

---

### Task 6: `pr-tabs.jsx` part 2 — comment threads, description edit, and the `PRTabs` shell

**Files:**
- Modify: `packages/ui/src/views/pr-tabs.jsx`
- Modify: `packages/ui/src/views/pr-tabs.test.jsx`

**Interfaces:**
- Consumes: `fetchPRThreads`, `postPRThread`, `postPRReply`, `setPRThreadStatus`, `updatePRDescription` from `@nexusmd/core`; `mdToHtml`, `renderContent` from `./render-content.js`; `toast` from `../toast.jsx`; `Avatar`, `TypeIcon`, `StateDot` from `../app-components.jsx`/`../components.jsx`; `PRCommitsTab`/`PRFilesTab` from this same file (Task 5).
- Produces (consumed by Task 8's `DesktopDetailDrawer`):
  - `PRTabs({ pr, http })` — the full tabbed PR view (Overview/Commits/Files). `pr` has the shape from `mapPR` (`id, repoId, project, org, repo, title, status, draft, description, reviewerDetails, linkedWorkItems, url, ...`).

- [ ] **Step 1: Extend the failing test**

Add to `packages/ui/src/views/pr-tabs.test.jsx` (append before the final closing, alongside existing imports — update the import line to include `PRTabs`):

```jsx
import { PRCommitsTab, PRFilesTab, PRTabs } from './pr-tabs.jsx'
```

```jsx
describe('PRTabs', () => {
  const pr = {
    id: 5, repoId: 'r1', project: 'Proj', org: 'myorg', repo: 'myrepo',
    title: 'Add feature', status: 'active', draft: false,
    description: 'Some description', reviewerDetails: [], linkedWorkItems: [], url: 'https://x',
  }

  it('renders the description and switches to the Files tab', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    expect(screen.getByText('Some description')).toBeTruthy()
    fireEvent.click(screen.getByText('Files'))
    expect(screen.getByText('Loading files…')).toBeTruthy()
  })

  it('lets the user edit and save the description', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
      { match: 'pullRequests/5?api-version', json: { id: 5, description: 'Updated text' } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox', { name: '' }) || screen.getAllByRole('textbox')[0]
    fireEvent.change(textarea, { target: { value: 'Updated text' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeTruthy())
  })

  it('posts a new top-level comment', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    const box = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(box, { target: { value: 'Looks good' } })
    fireEvent.click(screen.getByText('Post comment'))
    await waitFor(() => expect(screen.getByText('Looks good')).toBeTruthy())
  })

  it('resolves an open thread', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [
        { id: 1, status: 'active', comments: [{ id: 10, commentType: 1, content: 'A comment', author: { displayName: 'Alex' } }] },
      ] } },
      { match: '/threads/1?api-version', json: { id: 1, status: 'fixed' } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('Resolve')).toBeTruthy())
    fireEvent.click(screen.getByText('Resolve'))
    await waitFor(() => expect(screen.getByText('Re-open')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run src/views/pr-tabs.test.jsx`
Expected: FAIL — `PRTabs is not exported`

- [ ] **Step 3: Write the implementation**

Append to `packages/ui/src/views/pr-tabs.jsx`. First, update the top imports to add the new dependencies:

```jsx
import { fetchPRCommits, fetchPRFileChanges, fetchFileContent, fetchPRThreads, postPRThread, postPRReply, setPRThreadStatus, updatePRDescription, timeAgo } from '@nexusmd/core';
import { renderContent, mdToHtml } from './render-content.js';
import { toast } from '../toast.jsx';
```

Then append these new pieces at the end of the file:

```jsx
// ── PRDescriptionField ────────────────────────────────────────────────────────
// Write/Preview/Save editor for a PR description, mirroring HtmlField's shape
// in work-item-detail.jsx but backed by updatePRDescription instead of a
// work-item field PATCH.
function PRDescriptionField({ pr, http, description, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => { setText(description || ''); }, [description]);

  const save = async () => {
    setSaving(true); setStatus('Saving…');
    try {
      await updatePRDescription(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, description: text });
      onSaved?.(text);
      setStatus('✓ Saved');
      toast?.('Description updated', 'success');
      setTimeout(() => { setEditing(false); setPreview(false); setStatus(''); }, 1200);
    } catch (e) {
      setStatus('✗ ' + (e.message || 'Save failed'));
    } finally { setSaving(false); }
  };

  const statusColor = status.startsWith('✓') ? 'var(--success)' : status.startsWith('✗') ? 'var(--danger)' : 'var(--text-muted)';
  const tabStyle = (active) => ({
    fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)', cursor: 'pointer', lineHeight: '20px',
  });

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Description</h4>
        {!editing && (
          <button className="btn sm ghost" style={{ fontSize: 11.5 }}
            onClick={() => { setText(description || ''); setPreview(false); setStatus(''); setEditing(true); }}>
            <Icon name="edit" size={11}/> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
            <button style={tabStyle(preview)} onClick={() => setPreview(true)}>Preview</button>
          </div>
          {preview ? (
            <div className="wi-html-content" style={{
              minHeight: 100, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
              color: text.trim() ? 'var(--text)' : 'var(--text-subtle)', overflowWrap: 'break-word',
            }} dangerouslySetInnerHTML={{ __html: text.trim() ? mdToHtml(text) : '<em>Nothing to preview</em>' }} />
          ) : (
            <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
              style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn sm ghost" onClick={() => { setEditing(false); setPreview(false); setStatus(''); }}>Cancel</button>
            {status && <span style={{ fontSize: 12, color: statusColor }}>{status}</span>}
          </div>
        </div>
      ) : (
        <div className="wi-html-content" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', overflowWrap: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: renderContent(description) }} />
      )}
    </div>
  );
}

// ── PRThreadsPanel ────────────────────────────────────────────────────────────
// Comment thread list: add top-level comment, reply, resolve/reopen.
// Ported from PRDetail's thread state/handlers in apps/app/src/app.jsx:2561-2704.
function PRThreadsPanel({ pr, http }) {
  const [threadState, setThreadState] = useState({ status: 'idle', threads: [], error: null });
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyOpen, setReplyOpen] = useState({});
  const [replyText, setReplyText] = useState({});
  const [replyPosting, setReplyPosting] = useState({});
  const [resolving, setResolving] = useState({});

  useEffect(() => {
    if (!pr.repoId || !pr.project) return;
    setThreadState({ status: 'loading', threads: [], error: null });
    fetchPRThreads(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(threads => setThreadState({ status: 'ok', threads, error: null }))
      .catch(e => setThreadState({ status: 'error', threads: [], error: e.message }));
  }, [pr.id, pr.repoId, pr.project, http]);

  const postComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const data = await postPRThread(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, content: comment.trim() });
      setComment('');
      setThreadState(prev => ({ ...prev, threads: [...prev.threads, data] }));
      toast?.('Comment posted', 'success');
    } catch (e) {
      toast?.('Failed to post comment: ' + e.message, 'error');
    } finally { setPosting(false); }
  };

  const resolveThread = async (threadId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'fixed' : 'active';
    setResolving(r => ({ ...r, [threadId]: true }));
    try {
      await setPRThreadStatus(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, threadId, status: newStatus });
      setThreadState(prev => ({ ...prev, threads: prev.threads.map(t => t.id === threadId ? { ...t, status: newStatus } : t) }));
    } catch (e) {
      toast?.('Failed to update thread: ' + e.message, 'error');
    } finally {
      setResolving(r => ({ ...r, [threadId]: false }));
    }
  };

  const postReply = async (threadId) => {
    const text = (replyText[threadId] || '').trim();
    if (!text) return;
    const thread = threadState.threads.find(t => t.id === threadId);
    const parentCommentId = Math.max(...(thread?.comments || []).filter(c => c.commentType === 1).map(c => c.id), 0);
    setReplyPosting(r => ({ ...r, [threadId]: true }));
    try {
      const data = await postPRReply(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, threadId, parentCommentId, content: text });
      setThreadState(prev => ({ ...prev, threads: prev.threads.map(t => t.id === threadId ? { ...t, comments: [...(t.comments || []), data] } : t) }));
      setReplyText(r => ({ ...r, [threadId]: '' }));
      setReplyOpen(r => ({ ...r, [threadId]: false }));
    } catch (e) {
      toast?.('Failed to post reply: ' + e.message, 'error');
    } finally {
      setReplyPosting(r => ({ ...r, [threadId]: false }));
    }
  };

  if (threadState.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading comments…</div>;
  if (threadState.status === 'error') return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{threadState.error}</div>;

  const openCount = threadState.threads.filter(t => t.status === 'active').length;

  return (
    <div className="drawer-section">
      <h4>
        Comments
        {threadState.threads.length > 0 && (
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            ({threadState.threads.length}{openCount > 0 ? ` · ${openCount} open` : ''})
          </span>
        )}
      </h4>
      {threadState.threads.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>No comments yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {threadState.threads.map(t => {
          const isOpen = t.status === 'active';
          const filePath = t.threadContext?.filePath;
          const visibleComments = (t.comments || []).filter(c => c.commentType === 1 && !c.isDeleted);
          const isReplying = replyOpen[t.id];
          return (
            <div key={t.id} style={{
              border: '1px solid var(--border)', borderLeft: `3px solid ${isOpen ? 'var(--warning)' : 'var(--border)'}`,
              borderRadius: 8, background: 'var(--surface-2)', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600, background: isOpen ? 'rgba(234,179,8,0.15)' : 'var(--success-soft)', color: isOpen ? 'var(--warning)' : 'var(--success)' }}>
                  {isOpen ? 'Open' : 'Resolved'}
                </span>
                {filePath
                  ? <span className="mono muted truncate" style={{ fontSize: 10.5, flex: 1 }}>{filePath}</span>
                  : <span className="muted" style={{ fontSize: 10.5, flex: 1 }}>General</span>}
                <button className="btn sm ghost" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                  disabled={!!resolving[t.id]} onClick={() => resolveThread(t.id, t.status)}>
                  {resolving[t.id] ? '…' : isOpen ? 'Resolve' : 'Re-open'}
                </button>
              </div>
              <div>
                {visibleComments.map((c, idx) => (
                  <div key={c.id || idx} style={{ padding: '10px 12px', borderBottom: idx < visibleComments.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.author?.displayName || 'Unknown'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.publishedDate ? timeAgo(c.publishedDate) + ' ago' : ''}</span>
                    </div>
                    <div className="wi-html-content" style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, overflowWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ __html: renderContent(c.content || '') }} />
                  </div>
                ))}
              </div>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                {!isReplying ? (
                  <button className="btn sm ghost" style={{ fontSize: 11.5 }} onClick={() => setReplyOpen(r => ({ ...r, [t.id]: true }))}>Reply</button>
                ) : (
                  <div>
                    <textarea
                      value={replyText[t.id] || ''}
                      onChange={e => setReplyText(r => ({ ...r, [t.id]: e.target.value }))}
                      rows={2}
                      placeholder="Write a reply…"
                      style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sm primary" disabled={replyPosting[t.id]} onClick={() => postReply(t.id)}>
                        {replyPosting[t.id] ? 'Posting…' : 'Post reply'}
                      </button>
                      <button className="btn sm ghost" onClick={() => setReplyOpen(r => ({ ...r, [t.id]: false }))}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          placeholder="Add a comment…"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button className="btn sm primary" onClick={postComment} disabled={posting || !comment.trim()}>
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PRTabs ────────────────────────────────────────────────────────────────────
// Top-level tabbed PR view: Overview (description, reviewers, linked work
// items, comment threads), Commits, Files. Replaces desktop's read-only
// DesktopPRDetail. Ported/composed from apps/app/src/app.jsx's PRDetail
// (2551-2930-ish), backed by the shared pr-collab.js functions.
export function PRTabs({ pr, http }) {
  const [tab, setTab] = useState('overview');
  const [description, setDescription] = useState(pr.description || '');

  const tabBtnStyle = (active) => ({
    fontSize: 12, fontWeight: active ? 600 : 500, padding: '5px 12px', borderRadius: 6,
    border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-fg, #fff)' : 'var(--text-muted)',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, padding: '0 0 8px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
        {[['overview', 'Overview'], ['commits', 'Commits'], ['files', 'Files']].map(([id, label]) => (
          <button key={id} style={tabBtnStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <PRDescriptionField pr={pr} http={http} description={description} onSaved={setDescription} />

          {(pr.reviewerDetails || []).length > 0 && (
            <div className="drawer-section">
              <h4>Reviewers</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pr.reviewerDetails.map((r, i) => {
                  const label = r.vote === 10 || r.vote === 5 ? 'Approved' : r.vote === -10 ? 'Rejected' : r.vote === -5 ? 'Waiting for author' : 'Pending';
                  const color = r.vote === 10 || r.vote === 5 ? 'var(--success)' : r.vote === -10 ? 'var(--danger)' : r.vote === -5 ? 'var(--warning)' : 'var(--text-subtle)';
                  return (
                    <div key={`${r.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{r.name || r.id}</span>
                      <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(pr.linkedWorkItems || []).length > 0 && (
            <div className="drawer-section">
              <h4>Linked work items</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pr.linkedWorkItems.map(wi => (
                  <div key={wi.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12.5 }}>
                    <span className="mono muted" style={{ fontSize: 11 }}>#{wi.id}</span>
                    <span style={{ flex: 1, minWidth: 0 }} className="truncate">{wi.title || `Work Item #${wi.id}`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <PRThreadsPanel pr={pr} http={http} />
        </div>
      )}

      {tab === 'commits' && <PRCommitsTab pr={pr} http={http} />}
      {tab === 'files' && <PRFilesTab pr={pr} http={http} />}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/pr-tabs.test.jsx`
Expected: PASS (8 tests total across both parts of the file)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/pr-tabs.jsx packages/ui/src/views/pr-tabs.test.jsx
git commit -m "feat(ui): add PR description editing, comment threads, and PRTabs shell"
```

---

### Task 7: wire `prSource`/exports through `data-context.jsx` and `index.js`

**Files:**
- Modify: `packages/ui/src/data-context.jsx`
- Modify: `packages/ui/src/index.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by Task 8): `useNexusData().prSource` available with a safe default (`null`) like other optional fields; `WorkItemFieldsEditor`, `PRTabs`, `TagInput`, `AreaTreePicker`, `DEFAULT_PROJECT_AREAS`, `useProjectAreas` importable from `@nexusmd/ui`.

- [ ] **Step 1: Add `prSource` to the context defaults**

Modify `packages/ui/src/data-context.jsx`, in the `DEFAULTS` object (after the `workItemSource` line):

```js
  workItemSource: apiWorkItemSource, // data ops for WorkItemDetail (web/desktop: /api; app: ado-client)
  prSource: null,            // optional: platform's PR http adapter passthrough (desktop only for now)
```

No provider/context-value logic changes are needed beyond this — `NexusDataProvider`'s existing `{ ...DEFAULTS, ...value }` merge already threads any `prSource` a caller supplies.

- [ ] **Step 2: Export the new symbols from the package index**

Modify `packages/ui/src/index.js`:

Change:
```js
export { WorkItemDetail } from './views/work-item-detail.jsx'
```
to:
```js
export { WorkItemDetail, WorkItemFieldsEditor } from './views/work-item-detail.jsx'
```

Add near it:
```js
export { TagInput, AreaTreePicker } from './views/wi-field-pickers.jsx'
export { PRTabs, PRCommitsTab, PRFilesTab } from './views/pr-tabs.jsx'
export { DEFAULT_PROJECT_AREAS, useProjectAreas } from './project-areas.js'
```

- [ ] **Step 3: Run the full packages/ui test suite**

Run (from `packages/ui/`): `npx vitest run`
Expected: PASS (all existing suites + the ones added in Tasks 2-6)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/data-context.jsx packages/ui/src/index.js
git commit -m "feat(ui): expose prSource context slot and new WI/PR components from package index"
```

---

### Task 8: wire it all into the desktop app drawer

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `WorkItemFieldsEditor`, `PRTabs` from `@nexusmd/ui` (added to the existing import block); `createAdoHttpAdapter` (already imported); `WorkItemDetail` (already imported/used).
- Produces: nothing further downstream — this is the terminal integration point.

- [ ] **Step 1: Add the new imports**

In `apps/desktop/src/main.jsx`, find the existing `@nexusmd/ui` import block (the one starting `NexusDataProvider, useNexusData, ToastHost, toast,` around line 10) and add `WorkItemFieldsEditor, PRTabs` to it.

- [ ] **Step 2: Remove `DesktopPRDetail` and replace `DesktopDetailDrawer`'s body**

Delete the entire `DesktopPRDetail` function (`main.jsx:261-323`) — it's fully superseded by `PRTabs`.

Replace `DesktopDetailDrawer` (`main.jsx:325-376`) with:

```jsx
function DesktopDetailDrawer({ drawer, onClose, setItems }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' && d?.project && org
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent((d.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${d.id}`
    : kind === 'pr' ? d?.url : null

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
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.electronAPI.openLink(adoUrl)}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? 'ADO' : 'browser'}
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
      {kind === 'pr' && d && <PRTabs pr={d} http={createAdoHttpAdapter()} />}
    </Drawer>
  )
}
```

- [ ] **Step 3: Start the desktop app and manually verify**

Run: `cd apps/desktop && npm run dev` (or the project's existing dev script — check `apps/desktop/package.json` `scripts` if `dev` isn't the right name)

Manually verify, with ADO configured in Settings:
- Open a Work Item from the dashboard/list → the drawer shows State/Assignee/Priority/Area/Tags selects above the existing Description/Discussion — change the State and confirm a "Saved" toast appears and the underlying list row updates.
- Open a Pull Request → the drawer shows Overview/Commits/Files tabs. Overview shows the description with an Edit button; click Edit, change text, Save, confirm a "Description updated" toast. Add a top-level comment and confirm it appears. If any existing comment thread is open, click Resolve and confirm it flips to "Re-open". Switch to Commits and Files tabs and confirm they load; expand a file to see its diff.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): wire WorkItemFieldsEditor and PRTabs into the app drawer"
```

---

## Post-plan note

This plan intentionally does not touch `apps/app/src/app.jsx`. If a future task wants mobile to consume the new shared `pr-collab.js`/`PRTabs`/`WorkItemFieldsEditor` instead of its own inline code (removing duplication), that should be its own plan/spec — it's a riskier change to already-working code and wasn't requested here.
