# API Client: Response Viewer, Body Types & History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the in-app API client's response viewer and request body editor to Postman/Bruno-level quality, and add per-request send history — without adding any new runtime dependency.

**Architecture:** Three additive changes to the existing `packages/core/src/modules/api-client/` module and `packages/ui/src/views/view-api-client.jsx`: (1) a new `history-store.js` core module for local, git-excluded per-request history; (2) a `bodyType`/`bodyLanguage` field on the request definition plus body serialization logic in `request-builder.js` (raw/urlencoded/formdata, formdata via the platform's native `FormData`); (3) UI changes — a body-type selector, a tabbed Body/Headers response viewer using a new dependency-free `JsonPretty` tree component, and a History tab. All existing saved requests (no `bodyType` field) keep sending exactly as they do today.

**Tech Stack:** React 18 (`packages/ui`), plain JS core module (`packages/core`, no runtime deps), Vitest + `@testing-library/react` for tests, Electron/Chromium + Node 18+ (both provide global `FormData`).

## Global Constraints

- No new runtime dependencies in `packages/core` or `packages/ui` (confirmed: `packages/core` has zero runtime deps; `packages/ui` deps are `@azure/msal-browser`, `dompurify`, `flatpickr`, `jszip`, `marked` — none of these help here).
- Run `packages/core` tests from `packages/core/` and `packages/ui` tests from `packages/ui/` (not repo root) — this repo's Vitest workspace/jsdom config only resolves correctly from each package's own directory.
- Existing saved request files (no `bodyType` field) must continue to send with their current behavior: string body sent as-is, no auto `Content-Type` header.
- ID/timestamp convention already used in this module: plain `Date.now()`, no uuid/nanoid library.
- Core module test files live at `packages/core/tests/api-client/<name>.test.js`, one per source file, using the shared `memFile`/`memStorage` helpers from `packages/core/tests/helpers/memory-adapters.js`.

---

### Task 1: `history-store.js` core module

**Files:**
- Create: `packages/core/src/modules/api-client/history-store.js`
- Modify: `packages/core/src/modules/api-client/index.js` (barrel export)
- Modify: `packages/core/src/index.js:47-58` (top-level named export list)
- Test: `packages/core/tests/api-client/history-store.test.js`

**Interfaces:**
- Consumes: `IFileAdapter` shape (`read`, `write`, `exists`, `list`, `delete`, `mkdir`) already defined in `packages/core/src/adapters/index.js`.
- Produces: `appendHistoryEntry(file, dir, refId, entry) -> Promise<entry[]>`, `readHistory(file, dir, refId) -> Promise<entry[]>`, `clearHistory(file, dir, refId) -> Promise<void>`. `entry` is caller-defined plain data (Task 6 defines its exact shape) — this module treats it opaquely.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/api-client/history-store.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { appendHistoryEntry, readHistory, clearHistory } from '../../src/modules/api-client/history-store.js'
import { memFile } from '../helpers/memory-adapters.js'

describe('history-store', () => {
  it('readHistory returns an empty array when no history file exists yet', async () => {
    const file = memFile()
    expect(await readHistory(file, '/col', 'req1')).toEqual([])
  })

  it('appendHistoryEntry stores and returns entries in order, newest last', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1, status: 'passed' })
    const next = await appendHistoryEntry(file, '/col', 'req1', { sentAt: 2, status: 'failed' })

    expect(next).toEqual([{ sentAt: 1, status: 'passed' }, { sentAt: 2, status: 'failed' }])
    expect(await readHistory(file, '/col', 'req1')).toEqual(next)
  })

  it('caps history at 50 entries, dropping the oldest first (FIFO)', async () => {
    const file = memFile()
    for (let i = 0; i < 55; i++) {
      await appendHistoryEntry(file, '/col', 'req1', { sentAt: i })
    }
    const history = await readHistory(file, '/col', 'req1')
    expect(history).toHaveLength(50)
    expect(history[0]).toEqual({ sentAt: 5 })
    expect(history[49]).toEqual({ sentAt: 54 })
  })

  it('writes a self-excluding .gitignore in the history dir on first append, and does not clobber it later', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    expect(await file.read('/col/.history/.gitignore')).toBe('*\n')

    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 2 })
    expect(await file.read('/col/.history/.gitignore')).toBe('*\n')
  })

  it('keeps separate history per refId', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    await appendHistoryEntry(file, '/col', 'req2', { sentAt: 2 })

    expect(await readHistory(file, '/col', 'req1')).toEqual([{ sentAt: 1 }])
    expect(await readHistory(file, '/col', 'req2')).toEqual([{ sentAt: 2 }])
  })

  it('clearHistory removes stored entries so readHistory goes back to empty', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    await clearHistory(file, '/col', 'req1')
    expect(await readHistory(file, '/col', 'req1')).toEqual([])
  })

  it('clearHistory on a refId with no history is a safe no-op', async () => {
    const file = memFile()
    await expect(clearHistory(file, '/col', 'missing')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/api-client/history-store.test.js`
Expected: FAIL — `history-store.js` does not exist (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/modules/api-client/history-store.js`:

```js
// history-store.js — local, per-request send history for the api-client
// module. Deliberately kept OUT of collection.json/requests/*.json (which
// are meant to be git-tracked and diff-friendly) — every send would
// otherwise churn the tracked files. Instead each request's history lives
// in its own file under a `.history/` directory that self-excludes from
// git via a generated .gitignore, so no manual git configuration is needed.
//
// Layout:
//   <dir>/.history/.gitignore      "*"  (written once, on first append)
//   <dir>/.history/<refId>.json    array of entries, oldest first, capped

const HISTORY_DIR = '.history'
const MAX_ENTRIES = 50

const join = (...parts) => parts.join('/')

async function ensureGitignore(file, dir) {
  const path = join(dir, HISTORY_DIR, '.gitignore')
  if (!(await file.exists(path))) await file.write(path, '*\n')
}

/** Appends `entry` to refId's history, capping at the most recent MAX_ENTRIES. Returns the resulting list. */
export async function appendHistoryEntry(file, dir, refId, entry) {
  await file.mkdir(join(dir, HISTORY_DIR))
  await ensureGitignore(file, dir)

  const path = join(dir, HISTORY_DIR, `${refId}.json`)
  let existing = []
  try { existing = JSON.parse(await file.read(path)) } catch { existing = [] }

  const next = [...existing, entry].slice(-MAX_ENTRIES)
  await file.write(path, JSON.stringify(next, null, 2))
  return next
}

export async function readHistory(file, dir, refId) {
  try {
    return JSON.parse(await file.read(join(dir, HISTORY_DIR, `${refId}.json`)))
  } catch {
    return []
  }
}

export async function clearHistory(file, dir, refId) {
  try { await file.delete(join(dir, HISTORY_DIR, `${refId}.json`)) } catch { /* nothing to clear */ }
}
```

Modify `packages/core/src/modules/api-client/index.js` — add this line among the existing `export * from './...'` lines (after `export * from './runner.js'`):

```js
export * from './history-store.js'
```

Modify `packages/core/src/index.js` — extend the existing api-client named export block (lines 47-58) by adding `appendHistoryEntry, readHistory, clearHistory,` after the `importPostmanCollection,` line:

```js
export {
  getApiClientAdapters,
  createCollection, readCollectionMeta, writeCollectionMeta,
  listRequestIds, readRequest, writeRequest, deleteRequest,
  listEnvironmentNames, readEnvironment, writeEnvironment, deleteEnvironment,
  loadCollection, addTreeNode, removeTreeNode, findTreeNode, flattenRequestRefs,
  resolveVars, resolveObjectVars, resolveEnvironment,
  secretStorageKey, setSecretVar, removeSecretVar,
  buildRequest, executeRequest,
  buildRunEntries, runCollection,
  importPostmanCollection,
  appendHistoryEntry, readHistory, clearHistory,
} from './modules/api-client/index.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/api-client/history-store.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full core test suite to check nothing else broke**

Run: `cd packages/core && npx vitest run`
Expected: PASS (all existing + new tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/api-client/history-store.js packages/core/src/modules/api-client/index.js packages/core/src/index.js packages/core/tests/api-client/history-store.test.js
git commit -m "feat(core): add per-request history-store with self-excluding .gitignore"
```

---

### Task 2: Body type serialization in `request-builder.js`

**Files:**
- Modify: `packages/core/src/modules/api-client/request-builder.js`
- Test: `packages/core/tests/api-client/request-builder.test.js`

**Interfaces:**
- Consumes: `resolveObjectVars` from `./var-resolve.js` (unchanged).
- Produces: `buildRequest(requestDef, opts)` now reads `requestDef.bodyType` (`'none'|'raw'|'urlencoded'|'formdata'`, default `'raw'`) and `requestDef.bodyLanguage` (`'json'|'text'|'xml'`, default `'text'`). For `urlencoded`/`formdata`, `requestDef.body` must be an array of `{key, value}` pairs (same shape Task 4's UI produces); for `raw`/`none` it stays a string/undefined as before. Return shape (`{ request, vars, preScriptError, preScriptLogs }`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/api-client/request-builder.test.js` (add this `describe` block after the existing `describe('buildRequest', ...)` block, before the final closing of the file):

```js
describe('body serialization', () => {
  it('defaults to raw/text when bodyType is missing (back-compat: string body, no auto header)', async () => {
    const { request } = await buildRequest({ url: '/x', body: 'plain text' }, {})
    expect(request.body).toBe('plain text')
    expect(request.headers['Content-Type']).toBeUndefined()
  })

  it('bodyType raw + json sets Content-Type: application/json', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'raw', bodyLanguage: 'json', body: '{"a":1}' }, {})
    expect(request.body).toBe('{"a":1}')
    expect(request.headers['Content-Type']).toBe('application/json')
  })

  it('bodyType raw + xml sets Content-Type: application/xml', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'raw', bodyLanguage: 'xml', body: '<a/>' }, {})
    expect(request.headers['Content-Type']).toBe('application/xml')
  })

  it('does not override an explicitly set Content-Type header', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'raw', bodyLanguage: 'json', headers: { 'Content-Type': 'application/vnd.custom+json' }, body: '{}' },
      {},
    )
    expect(request.headers['Content-Type']).toBe('application/vnd.custom+json')
  })

  it('bodyType urlencoded serializes key/value pairs and sets the form Content-Type', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'urlencoded', body: [{ key: 'a', value: '1' }, { key: 'b', value: 'x y' }] },
      {},
    )
    expect(request.body).toBe('a=1&b=x%20y')
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('bodyType urlencoded resolves {{vars}} inside pair values', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'urlencoded', body: [{ key: 'token', value: '{{t}}' }] },
      { vars: { t: 'abc' } },
    )
    expect(request.body).toBe('token=abc')
  })

  it('bodyType formdata builds a real FormData instance with no Content-Type header set', async () => {
    const { request } = await buildRequest(
      { url: '/x', bodyType: 'formdata', body: [{ key: 'file', value: 'contents' }] },
      {},
    )
    expect(request.body).toBeInstanceOf(FormData)
    expect(request.body.get('file')).toBe('contents')
    expect(request.headers['Content-Type']).toBeUndefined()
  })

  it('bodyType none sends no body and no Content-Type', async () => {
    const { request } = await buildRequest({ url: '/x', bodyType: 'none', body: 'ignored' }, {})
    expect(request.body).toBeUndefined()
    expect(request.headers['Content-Type']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/api-client/request-builder.test.js`
Expected: FAIL — new assertions fail (e.g. `Content-Type` undefined vs expected `'application/json'`, `formdata`/`urlencoded` bodies not serialized).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `packages/core/src/modules/api-client/request-builder.js`:

```js
import { resolveObjectVars } from './var-resolve.js'

function toBase64(str) {
  if (typeof btoa === 'function') return btoa(str)
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64')
  throw new Error('No base64 encoder available in this environment')
}

function buildUrl(url, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!entries.length) return url
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** Applies an auth block on top of already-resolved headers/params. */
function applyAuth(headers, params, auth) {
  if (!auth || auth.type === 'none' || !auth.type) return { headers, params }
  const nextHeaders = { ...headers }
  const nextParams = { ...params }
  switch (auth.type) {
    case 'bearer':
      nextHeaders.Authorization = `Bearer ${auth.token || ''}`
      break
    case 'basic':
      nextHeaders.Authorization = `Basic ${toBase64(`${auth.username || ''}:${auth.password || ''}`)}`
      break
    case 'apikey':
      if (auth.in === 'query') nextParams[auth.key] = auth.value
      else nextHeaders[auth.key] = auth.value
      break
    case 'oauth2':
      nextHeaders.Authorization = `Bearer ${auth.accessToken || ''}`
      break
    default:
      break
  }
  return { headers: nextHeaders, params: nextParams }
}

/**
 * Content-Type to auto-set for a given body mode, or null to set none.
 * 'raw'+'text' deliberately returns null — that's the shape a request had
 * before bodyType existed (a plain string body, no header), so old saved
 * requests (bodyType missing -> defaults below) keep sending exactly as
 * before.
 */
function autoContentType(bodyType, bodyLanguage) {
  if (bodyType === 'raw') {
    if (bodyLanguage === 'json') return 'application/json'
    if (bodyLanguage === 'xml') return 'application/xml'
    return null
  }
  if (bodyType === 'urlencoded') return 'application/x-www-form-urlencoded'
  return null
}

/**
 * Turns a resolved body value into what actually gets sent.
 * - raw: the string as-is
 * - urlencoded: an array of {key,value} pairs -> a "k=v&k2=v2" string
 * - formdata: an array of {key,value} pairs -> a real FormData instance, so
 *   fetch generates the multipart boundary itself (no Content-Type header
 *   is set for this mode — see buildRequest)
 * - none: undefined
 */
function serializeBody(bodyType, body) {
  switch (bodyType) {
    case 'raw':
      return typeof body === 'string' ? body : ''
    case 'urlencoded':
      return (Array.isArray(body) ? body : [])
        .filter(p => p.key)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    case 'formdata': {
      const fd = new FormData()
      for (const p of Array.isArray(body) ? body : []) {
        if (p.key) fd.append(p.key, p.value ?? '')
      }
      return fd
    }
    case 'none':
    default:
      return undefined
  }
}

/**
 * Resolves {{vars}} across a request definition, applies auth, serializes
 * the body per requestDef.bodyType, and runs the pre-request script (if
 * any) via adapters.scriptRunner. Returns the request ready to send, plus
 * whatever vars the script updated (e.g. a token it set) so callers/executor
 * can carry them forward.
 */
export async function buildRequest(requestDef, { vars = {}, adapters = {} } = {}) {
  const bodyType = requestDef.bodyType || 'raw'
  const bodyLanguage = requestDef.bodyLanguage || 'text'

  const resolved = resolveObjectVars(
    {
      method:  requestDef.method || 'GET',
      url:     requestDef.url || '',
      params:  requestDef.params || {},
      headers: requestDef.headers || {},
      body:    requestDef.body,
    },
    vars,
  )

  const { headers, params } = applyAuth(resolved.headers, resolved.params, requestDef.auth)

  const finalHeaders = { ...headers }
  const contentType = autoContentType(bodyType, bodyLanguage)
  if (contentType && !Object.keys(finalHeaders).some(h => h.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = contentType
  }

  let request = {
    method:  resolved.method,
    url:     buildUrl(resolved.url, params),
    headers: finalHeaders,
    body:    serializeBody(bodyType, resolved.body),
  }

  let nextVars = vars
  let preScriptError = null
  let preScriptLogs = []

  if (requestDef.preRequestScript && adapters.scriptRunner) {
    const outcome = await adapters.scriptRunner.run(requestDef.preRequestScript, { vars: { ...vars }, request })
    preScriptLogs = outcome?.logs || []
    if (outcome?.error) {
      preScriptError = outcome.error
    } else {
      nextVars = outcome?.context?.vars ?? vars
      request = outcome?.context?.request ?? request
    }
  }

  return { request, vars: nextVars, preScriptError, preScriptLogs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/api-client/request-builder.test.js`
Expected: PASS (all existing + 8 new tests)

- [ ] **Step 5: Run the full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/api-client/request-builder.js packages/core/tests/api-client/request-builder.test.js
git commit -m "feat(core): serialize request body by bodyType (raw/urlencoded/formdata/none)"
```

---

### Task 3: `JsonPretty` component

**Files:**
- Create: `packages/ui/src/json-pretty.jsx`
- Test: `packages/ui/tests/json-pretty.test.jsx`

**Interfaces:**
- Consumes: nothing beyond React.
- Produces: `JsonPretty({ text })` — a React component. `text` is a raw string (e.g. an HTTP response body). Renders a collapsible tree if `text` parses as JSON; otherwise renders the original string inside a `<pre>`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/tests/json-pretty.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { JsonPretty } from '../src/json-pretty.jsx'

afterEach(cleanup)

describe('JsonPretty', () => {
  it('renders a collapsible tree for valid JSON', () => {
    const { container, getByText } = render(<JsonPretty text={JSON.stringify({ name: 'Ada', active: true })} />)
    expect(getByText('"Ada"')).toBeTruthy()
    expect(container.textContent).toContain('active')
  })

  it('falls back to a plain <pre> block for non-JSON text', () => {
    const { container } = render(<JsonPretty text="<xml><a/></xml>" />)
    const pre = container.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre.textContent).toBe('<xml><a/></xml>')
  })

  it('collapses a nested node on toggle click', () => {
    const { container, getByText } = render(<JsonPretty text={JSON.stringify({ a: { b: 1 } })} />)
    expect(getByText('1')).toBeTruthy()
    const toggles = container.querySelectorAll('button')
    fireEvent.click(toggles[1]) // the nested { b: 1 } object's own toggle
    expect(container.textContent).toContain('…')
  })

  it('renders an empty array without a toggle', () => {
    const { container } = render(<JsonPretty text={JSON.stringify({ items: [] })} />)
    expect(container.textContent).toContain('[]')
  })

  it('treats an empty string as non-JSON (falls back to an empty <pre>)', () => {
    const { container } = render(<JsonPretty text="" />)
    expect(container.querySelector('pre')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/json-pretty.test.jsx`
Expected: FAIL — `../src/json-pretty.jsx` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/json-pretty.jsx`:

```jsx
import React from 'react'

const toggleStyle = { border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px 0 0', color: 'var(--text-muted)', fontSize: 10 }

function JsonValue({ value }) {
  const [collapsed, setCollapsed] = React.useState(false)

  if (Array.isArray(value)) {
    if (!value.length) return <span>[]</span>
    return (
      <span>
        <button type="button" onClick={() => setCollapsed(c => !c)} style={toggleStyle}>{collapsed ? '▶' : '▼'}</button>
        [{collapsed ? '…' : (
          <div style={{ paddingLeft: 16 }}>
            {value.map((v, i) => (
              <div key={i}>
                <JsonValue value={v} />
                {i < value.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
        )}]
      </span>
    )
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return <span>{'{}'}</span>
    return (
      <span>
        <button type="button" onClick={() => setCollapsed(c => !c)} style={toggleStyle}>{collapsed ? '▶' : '▼'}</button>
        {'{'}{collapsed ? '…' : (
          <div style={{ paddingLeft: 16 }}>
            {entries.map(([k, v], i) => (
              <div key={k}>
                <span style={{ color: 'var(--accent, #1d6fcc)' }}>"{k}"</span>: <JsonValue value={v} />
                {i < entries.length - 1 ? ',' : ''}
              </div>
            ))}
          </div>
        )}{'}'}
      </span>
    )
  }

  if (typeof value === 'string') return <span style={{ color: 'var(--success, #2a2)' }}>"{value}"</span>
  if (typeof value === 'number' || typeof value === 'boolean') return <span style={{ color: 'var(--warning, #b58900)' }}>{String(value)}</span>
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>null</span>
  return <span>{String(value)}</span>
}

/**
 * Renders `text` as a collapsible JSON tree when it parses as JSON;
 * otherwise falls back to a plain monospace block (XML/HTML/text bodies).
 */
export function JsonPretty({ text }) {
  const parsed = React.useMemo(() => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false }
    try { return { ok: true, value: JSON.parse(text) } } catch { return { ok: false } }
  }, [text])

  if (!parsed.ok) {
    return (
      <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300, margin: 0 }}>
        {text}
      </pre>
    )
  }

  return (
    <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 300, fontFamily: 'monospace' }}>
      <JsonValue value={parsed.value} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/json-pretty.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/json-pretty.jsx packages/ui/tests/json-pretty.test.jsx
git commit -m "feat(ui): add dependency-free JsonPretty collapsible JSON tree component"
```

---

### Task 4: Body type selector in the request editor

**Files:**
- Modify: `packages/ui/src/views/view-api-client.jsx`
- Modify: `packages/ui/tests/view-api-client.test.jsx` (this file **already exists** with 6 passing tests — see below; extended in Tasks 5 and 6 too)

**Interfaces:**
- Consumes: `KvEditor` (existing, unchanged interface: `{ pairs: {key,value}[], onChange: (pairs) => void }`), `createCollection/loadCollection/writeCollectionMeta/writeRequest` from `@nexusmd/core` (unchanged).
- Produces: `draft.bodyType`, `draft.bodyLanguage` fields feeding into Task 2's `buildRequest`. A module-scope `hydrateRequest(saved)` helper (used by `selectRequest`) that later tasks' code does not need to touch. Two new test helpers, `renderApiClient(opts)` and `openCollectionAndCreateRequest(rr)`, added to `view-api-client.test.jsx` in this task — Tasks 5 and 6 reuse both.

> **Important:** `packages/ui/tests/view-api-client.test.jsx` is pre-existing, not created by this plan. Read it first. It already defines `memFile()` and `fakeScriptRunner()` helpers and imports `{ ApiClientProvider, ApiClientView }` from `'../src/index.js'` (the package barrel — not direct relative paths) with **no** `NexusDataProvider` wrapper (the view's `usePersisted` hook falls back to safe in-memory defaults when unwrapped, per `packages/ui/src/data-context.jsx`'s `React.createContext(DEFAULTS)`). Do not replace the file, add a `NexusDataProvider`, or redefine `memFile`/`fakeScriptRunner` — reuse what's there. Existing tests use `getByTitle('New request')` for the "+" button, not a `title` CSS selector.

- [ ] **Step 1: Write the failing tests**

First, extend the top import lines of `packages/ui/tests/view-api-client.test.jsx` — change:

```js
import { ApiClientProvider, ApiClientView } from '../src/index.js'
```

to:

```js
import { ApiClientProvider, ApiClientView } from '../src/index.js'
import { createCollection, writeRequest, writeCollectionMeta } from '@nexusmd/core'
```

Then, directly below the existing `fakeScriptRunner` function, add these two shared helpers (used by this task's tests and reused by Tasks 5 and 6):

```js
function renderApiClient({ file, apiHttp, scriptRunner } = {}) {
  const adapters = {
    file: file || memFile(),
    scriptRunner: scriptRunner || fakeScriptRunner(),
    secureStorage: { get: async () => null, set: async () => {}, remove: async () => {} },
    apiHttp: apiHttp || { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => '' }) },
  }
  return render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>,
  )
}

async function openCollectionAndCreateRequest(rr) {
  const { getByPlaceholderText, getByText, getByTitle } = rr
  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/col' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByTitle('New request'))
  fireEvent.click(getByTitle('New request'))
  await waitFor(() => getByText('Save'))
}
```

Then append these four `it(...)` blocks at the end of the file (after the last existing `it(...)` block, matching the file's existing flat-`it`-no-`describe` style):

```js
it('starts with no body and shows "This request has no body."', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText } = rr

  fireEvent.click(getByText('Body'))
  expect(getByText('This request has no body.')).toBeTruthy()
})

it('switching body type to urlencoded shows key/value rows instead of the raw textarea', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText, getByLabelText, container } = rr

  fireEvent.click(getByText('Body'))
  fireEvent.change(getByLabelText('Body type'), { target: { value: 'urlencoded' } })

  expect(container.querySelector('textarea')).toBeNull()
  expect(container.querySelectorAll('input[placeholder="key"]').length).toBeGreaterThan(0)
})

it('raw body type shows a language picker and the raw textarea', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText, getByLabelText, container } = rr

  fireEvent.click(getByText('Body'))
  fireEvent.change(getByLabelText('Body type'), { target: { value: 'raw' } })

  expect(getByLabelText('Raw body language')).toBeTruthy()
  expect(container.querySelector('textarea')).toBeTruthy()
})

it('loading a legacy saved request (no bodyType field) with a body defaults to Raw so the body still shows', async () => {
  const file = memFile()
  await createCollection(file, '/col', { name: 'Col' })
  await writeRequest(file, '/col', 'legacy', { method: 'POST', url: '/x', body: 'legacy body text' })
  await writeCollectionMeta(file, '/col', {
    name: 'Col', description: '',
    tree: [{ type: 'request', name: 'Legacy', refId: 'legacy' }],
  })

  const rr = renderApiClient({ file })
  const { getByPlaceholderText, getByText, container } = rr
  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/col' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByText('Legacy'))
  fireEvent.click(getByText('Legacy'))

  fireEvent.click(getByText('Body'))
  expect(container.querySelector('textarea').value).toBe('legacy body text')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: FAIL on the 4 new tests — "This request has no body." text doesn't exist yet, `getByLabelText('Body type')` finds nothing, and the legacy-request test's textarea assertion errors (current code always shows one raw textarea, so that specific test may already pass by accident — don't worry about which of the 4 fail, just confirm the 6 pre-existing tests still pass and at least the body-type-selector ones fail).

- [ ] **Step 3: Write the implementation**

In `packages/ui/src/views/view-api-client.jsx`:

1. Add the `JsonPretty` import at the top (after the existing `@nexusmd/core` import):

```jsx
import { JsonPretty } from '../json-pretty.jsx'
```

2. Replace `EMPTY_REQUEST`:

```jsx
const EMPTY_REQUEST = {
  method: 'GET', url: '', params: {}, headers: {}, body: '',
  bodyType: 'none', bodyLanguage: 'json',
  auth: { type: 'none' }, preRequestScript: '', postResponseScript: '', tests: '',
}

const BODY_TYPES = ['none', 'raw', 'urlencoded', 'formdata']
const BODY_TYPE_LABELS = { none: 'None', raw: 'Raw', urlencoded: 'x-www-form-urlencoded', formdata: 'form-data' }
const RAW_LANGUAGES = ['json', 'text', 'xml']

function ensurePairs(pairs) {
  return Array.isArray(pairs) && pairs.length ? pairs : [{ key: '', value: '' }]
}

/**
 * Merges a saved request with EMPTY_REQUEST's defaults. A request saved
 * before bodyType existed has no bodyType field at all — treat that the
 * same way request-builder.js does (raw/text, i.e. "just send the string"),
 * so its body keeps showing instead of silently looking empty.
 */
function hydrateRequest(saved) {
  const merged = { ...EMPTY_REQUEST, ...saved }
  if (saved && saved.bodyType === undefined) {
    merged.bodyType = typeof saved.body === 'string' && saved.body ? 'raw' : 'none'
    merged.bodyLanguage = 'text'
  }
  return merged
}
```

3. In `selectRequest`, replace the body with:

```jsx
const selectRequest = (refId) => {
  setSelectedRefId(refId)
  setDraft(hydrateRequest(collection.requests[refId]))
  setResponse(null)
}
```

4. Replace the `{activeTab === 'Body' && (...)}` block with:

```jsx
{activeTab === 'Body' && (
  <div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
      <select
        aria-label="Body type"
        value={draft.bodyType || 'none'}
        onChange={e => {
          const bodyType = e.target.value
          const nextBody = bodyType === 'raw'
            ? (typeof draft.body === 'string' ? draft.body : '')
            : (bodyType === 'none' ? draft.body : ensurePairs(Array.isArray(draft.body) ? draft.body : []))
          setDraft({ ...draft, bodyType, body: nextBody })
        }}
        style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
      >
        {BODY_TYPES.map(t => <option key={t} value={t}>{BODY_TYPE_LABELS[t]}</option>)}
      </select>
      {draft.bodyType === 'raw' && (
        <select
          aria-label="Raw body language"
          value={draft.bodyLanguage || 'json'}
          onChange={e => setDraft({ ...draft, bodyLanguage: e.target.value })}
          style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
        >
          {RAW_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      )}
    </div>

    {(!draft.bodyType || draft.bodyType === 'none') && (
      <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>This request has no body.</div>
    )}

    {draft.bodyType === 'raw' && (
      <textarea value={draft.body || ''} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={10}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
    )}

    {(draft.bodyType === 'urlencoded' || draft.bodyType === 'formdata') && (
      <KvEditor pairs={ensurePairs(draft.body)} onChange={pairs => setDraft({ ...draft, body: pairs })}/>
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: PASS (10 tests: 6 pre-existing + 4 new)

- [ ] **Step 5: Run the full UI test suite**

Run: `cd packages/ui && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-api-client.jsx packages/ui/tests/view-api-client.test.jsx
git commit -m "feat(ui): add body-type selector (None/Raw/urlencoded/form-data) to request editor"
```

---

### Task 5: Tabbed response viewer (Body/Headers) with `JsonPretty`

**Files:**
- Modify: `packages/ui/src/views/view-api-client.jsx`
- Modify: `packages/ui/tests/view-api-client.test.jsx`

**Interfaces:**
- Consumes: `JsonPretty` from Task 3, `executeRequest` from `@nexusmd/core` (unchanged).
- Produces: no new exports; local `responseTab` state.

- [ ] **Step 1: Write the failing tests**

Append these two `it(...)` blocks to the end of `packages/ui/tests/view-api-client.test.jsx` (reuse the `renderApiClient`/`openCollectionAndCreateRequest` helpers added in Task 4; the file's own `waitFor` import, not an alias, is what's in scope):

```jsx
it('renders a pretty JSON tree for a JSON response body, with a Headers tab', async () => {
  const apiHttp = { fetch: async () => ({ status: 200, statusText: 'OK', headers: { 'X-Test': '1' }, text: async () => JSON.stringify({ ok: true }) }) }
  const rr = renderApiClient({ apiHttp })
  await openCollectionAndCreateRequest(rr)
  const { getByText, container } = rr

  fireEvent.click(getByText('Send'))
  await waitFor(() => getByText('passed'))

  expect(container.querySelector('pre')).toBeNull()
  expect(container.textContent).toContain('ok')
  expect(container.textContent).toContain('true')

  fireEvent.click(getByText('Headers'))
  expect(getByText('X-Test')).toBeTruthy()
})

it('falls back to a <pre> block for a non-JSON response body', async () => {
  const apiHttp = { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => '<xml/>' }) }
  const rr = renderApiClient({ apiHttp })
  await openCollectionAndCreateRequest(rr)
  const { getByText, container } = rr

  fireEvent.click(getByText('Send'))
  await waitFor(() => container.querySelector('pre'))
  expect(container.querySelector('pre').textContent).toBe('<xml/>')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: FAIL — response body still renders in a raw `<pre>` always (first test's `container.querySelector('pre')` is not null; no "Headers" tab button exists).

- [ ] **Step 3: Write the implementation**

In `packages/ui/src/views/view-api-client.jsx`:

1. Add state near the other `React.useState` declarations in `ApiClientView`:

```jsx
const [responseTab, setResponseTab] = React.useState('Body')
```

2. In `send`, reset the tab whenever a new response comes in — update the function to:

```jsx
const send = async () => {
  if (!draft) return
  setSending(true)
  setResponse(null)
  setResponseTab('Body')
  try {
    const vars = await resolvedVars()
    const result = await executeRequest(draft, { vars, adapters })
    setResponse(result)
  } finally {
    setSending(false)
  }
}
```

3. Replace the response-rendering block (the `{response && (...)}` block containing status/tests/`<pre>`) with:

```jsx
{response && (
  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
      <strong>{response.status}</strong>
      {response.response && <span>{response.response.status} {response.response.statusText} · {response.response.durationMs}ms</span>}
      {response.error && <span style={{ color: 'var(--danger, #d33)' }}>{response.error}</span>}
    </div>
    {response.tests && response.tests.length > 0 && (
      <div style={{ marginBottom: 8 }}>
        {response.tests.map((t, i) => (
          <div key={i} style={{ fontSize: 12.5, color: t.passed ? 'var(--success, #2a2)' : 'var(--danger, #d33)' }}>
            {t.passed ? '✓' : '✗'} {t.name}
          </div>
        ))}
      </div>
    )}
    {response.response && (
      <>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {['Body', 'Headers'].map(tab => (
            <button key={tab} onClick={() => setResponseTab(tab)}
              style={{
                padding: '4px 10px', border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: responseTab === tab ? '2px solid var(--accent, #1d6fcc)' : '2px solid transparent',
                fontWeight: responseTab === tab ? 600 : 400,
              }}>
              {tab}
            </button>
          ))}
        </div>
        {responseTab === 'Body' && <JsonPretty text={response.response.body}/>}
        {responseTab === 'Headers' && (
          <div>
            {Object.entries(response.response.headers || {}).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 6, fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <strong style={{ minWidth: 160 }}>{k}</strong><span>{v}</span>
              </div>
            ))}
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: PASS (12 tests total: 6 pre-existing + 4 from Task 4 + 2 new)

- [ ] **Step 5: Run the full UI test suite**

Run: `cd packages/ui && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-api-client.jsx packages/ui/tests/view-api-client.test.jsx
git commit -m "feat(ui): tabbed Body/Headers response viewer with pretty-printed JSON"
```

---

### Task 6: History tab

**Files:**
- Modify: `packages/ui/src/views/view-api-client.jsx`
- Modify: `packages/ui/tests/view-api-client.test.jsx`

**Interfaces:**
- Consumes: `appendHistoryEntry`, `readHistory`, `clearHistory` from `@nexusmd/core` (Task 1).
- Produces: no new exports; local `history`/`historyPreview` state and a `History` entry in the existing `TABS` array.

- [ ] **Step 1: Write the failing tests**

Append these two `it(...)` blocks to the end of `packages/ui/tests/view-api-client.test.jsx` (reuse `renderApiClient`/`openCollectionAndCreateRequest` from Task 4; use the file's own `waitFor` import):

```jsx
it('records a sent request in history and lets you reload it as a read-only preview', async () => {
  const apiHttp = { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => JSON.stringify({ n: 1 }) }) }
  const rr = renderApiClient({ apiHttp })
  await openCollectionAndCreateRequest(rr)
  const { getByText, getAllByRole, container } = rr

  fireEvent.click(getByText('Send'))
  await waitFor(() => getByText('passed'))

  fireEvent.click(getByText('History'))
  await waitFor(() => expect(container.textContent).toContain('1 sent'))

  const historyRows = getAllByRole('button', { name: /passed/ })
  expect(historyRows).toHaveLength(1)
  fireEvent.click(historyRows[0])

  expect(container.textContent).toContain('n')
})

it('clear history empties the list', async () => {
  const apiHttp = { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => '{}' }) }
  const rr = renderApiClient({ apiHttp })
  await openCollectionAndCreateRequest(rr)
  const { getByText, container } = rr

  fireEvent.click(getByText('Send'))
  await waitFor(() => getByText('passed'))
  fireEvent.click(getByText('History'))
  await waitFor(() => expect(container.textContent).toContain('1 sent'))

  fireEvent.click(getByText('Clear history'))
  await waitFor(() => expect(container.textContent).toContain('0 sent'))
  expect(container.textContent).toContain('No requests sent yet.')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: FAIL — no "History" tab exists yet (`getByText('History')` throws).

- [ ] **Step 3: Write the implementation**

In `packages/ui/src/views/view-api-client.jsx`:

1. Extend the imports from `@nexusmd/core`:

```jsx
import {
  loadCollection, createCollection, writeCollectionMeta, writeRequest,
  addTreeNode, buildRunEntries,
  resolveEnvironment, executeRequest, runCollection, importPostmanCollection,
  appendHistoryEntry, readHistory, clearHistory,
} from '@nexusmd/core'
```

2. Add `'History'` to the tab list:

```jsx
const TABS = ['Params', 'Headers', 'Body', 'Auth', 'Scripts', 'Tests', 'History']
```

3. Add state near the other `React.useState` declarations:

```jsx
const [history, setHistory] = React.useState([])
const [historyPreview, setHistoryPreview] = React.useState(null)
```

4. Update `selectRequest` to also load that request's history:

```jsx
const selectRequest = (refId) => {
  setSelectedRefId(refId)
  setDraft(hydrateRequest(collection.requests[refId]))
  setResponse(null)
  setHistoryPreview(null)
  readHistory(adapters.file, dirInput, refId).then(setHistory)
}
```

5. Update `send` to append a history entry after the request completes:

```jsx
const send = async () => {
  if (!draft) return
  setSending(true)
  setResponse(null)
  setResponseTab('Body')
  try {
    const vars = await resolvedVars()
    const result = await executeRequest(draft, { vars, adapters })
    setResponse(result)
    if (selectedRefId) {
      const entry = {
        sentAt: Date.now(),
        status: result.status,
        request: { method: draft.method, url: draft.url },
        response: result.response,
        error: result.error,
      }
      const nextHistory = await appendHistoryEntry(adapters.file, dirInput, selectedRefId, entry)
      setHistory(nextHistory)
    }
  } finally {
    setSending(false)
  }
}
```

6. Add a `clearRequestHistory` function alongside `send`:

```jsx
const clearRequestHistory = async () => {
  if (!selectedRefId) return
  await clearHistory(adapters.file, dirInput, selectedRefId)
  setHistory([])
  setHistoryPreview(null)
}
```

7. Add the `History` tab panel, right after the `{activeTab === 'Tests' && (...)}` block:

```jsx
{activeTab === 'History' && (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{history.length} sent</span>
      <button onClick={clearRequestHistory} disabled={!history.length}
        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
        Clear history
      </button>
    </div>
    {history.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>No requests sent yet.</div>}
    {[...history].reverse().map((entry, i) => (
      <button key={i} type="button" onClick={() => setHistoryPreview(entry)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
          fontSize: 12.5, marginBottom: 4, border: 'none', color: 'var(--text)',
          background: historyPreview === entry ? 'var(--surface-3, rgba(29,111,204,0.12))' : 'var(--surface-2)',
        }}>
        {entry.status} · {entry.request?.method} · {new Date(entry.sentAt).toLocaleTimeString()}
        {entry.response && ` · ${entry.response.durationMs}ms`}
      </button>
    ))}
    {historyPreview && (
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{historyPreview.request?.method} {historyPreview.request?.url}</div>
        {historyPreview.response
          ? <JsonPretty text={historyPreview.response.body}/>
          : <div style={{ color: 'var(--danger, #d33)', fontSize: 12.5 }}>{historyPreview.error}</div>}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/view-api-client.test.jsx`
Expected: PASS (14 tests total: 12 from Tasks 4-5 + 2 new)

- [ ] **Step 5: Run the full UI test suite, then the full core test suite**

Run: `cd packages/ui && npx vitest run`
Expected: PASS
Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-api-client.jsx packages/ui/tests/view-api-client.test.jsx
git commit -m "feat(ui): add per-request History tab (record on send, reload read-only, clear)"
```

---

## Plan Self-Review Notes

- **Spec coverage:** History persistence/capping/git-exclusion (Task 1) ✓; body serialization for all 4 modes incl. real multipart via `FormData` (Task 2) ✓; body-type selector + raw language picker in UI (Task 4) ✓; tabbed Body/Headers response viewer with dependency-free JSON tree (Tasks 3 & 5) ✓; History tab: record on send, reload as read-only preview, clear (Task 6) ✓; backward compatibility for requests with no `bodyType` (Tasks 2 & 4) ✓; no new dependencies (confirmed throughout) ✓.
- **Type consistency:** `entry` shape `{ sentAt, status, request: {method, url}, response, error }` is defined once in Task 6 Step 3.5 and used consistently in the History tab render and both history tests. `bodyType`/`bodyLanguage` field names match between Task 2 (core) and Task 4 (UI). `JsonPretty({ text })` prop name matches its two call sites (Task 5, Task 6).
- **Task ordering:** Task 4 (UI body editor) depends on Task 2 (core serialization) only at the data-shape level, not code — order preserved for logical clarity but Tasks 1-3 have no interdependencies and could be done in any order or in parallel.
