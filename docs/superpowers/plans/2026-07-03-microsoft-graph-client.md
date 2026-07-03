# Shared Microsoft Graph Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared, token-agnostic Microsoft Graph client (`graphFetch`/`graphJSON`/`graphList`) that both the desktop app and the web/shared UI package call through, replacing the two divergent hand-rolled Graph-calling patterns that exist today (`apps/desktop/src/ms-graph-calendar.js`'s raw-token functions and `packages/ui/src/views/view-calendar.jsx`'s MSAL-driven `OutlookService`).

**Architecture:** New module `packages/ui/src/graph/graph-client.js` exports three functions built around a `getToken({force}) => Promise<string>` callback — the same shape `apps/desktop/src/cloud-auth.js`'s OAuth services already expose. `graphFetch` does the request + single 401-retry; `graphJSON` adds `.json()` parsing; `graphList` follows `@odata.nextLink` pagination. `ms-graph-calendar.js` and `OutlookService` are refactored to call through it instead of raw `fetch`.

**Tech Stack:** Plain ESM JS (no TypeScript), React, Vitest, `@azure/msal-browser` (web), Electron (desktop). No new dependencies.

## Global Constraints
- No new npm dependencies (per spec: no `@microsoft/microsoft-graph-client`).
- No new Microsoft Graph scopes requested (spec: scopes stay minimal, added only when a feature needs them).
- `packages/ui/src/cloud/providers.js` (`authedFetch`, `OneDriveProvider`, `GoogleDriveProvider`) is out of scope — do not modify it.
- Base Graph URL is always `https://graph.microsoft.com/v1.0`.
- Every step that touches test files must be run and shown passing before moving to the next step.

---

### Task 1: Shared Graph client

**Files:**
- Create: `packages/ui/src/graph/graph-client.js`
- Create: `packages/ui/src/graph/graph-client.test.js`
- Modify: `packages/ui/src/index.js`

**Interfaces:**
- Produces: `graphFetch(getToken, path, opts = {}) => Promise<Response>`, `graphJSON(getToken, path, opts = {}) => Promise<any>`, `graphList(getToken, path, opts = {}) => Promise<any[]>`, where `getToken` is `({force}?) => Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/graph/graph-client.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { graphFetch, graphJSON, graphList } from './graph-client.js'

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('graphFetch', () => {
  it('prefixes the Graph base URL for a relative path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    await graphFetch(getToken, '/me')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me')
  })

  it('does not re-prefix an already-absolute URL (pagination links)', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    await graphFetch(getToken, 'https://graph.microsoft.com/v1.0/me/messages?$skip=10')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/messages?$skip=10')
  })

  it('sends the Bearer token from getToken', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'my-token')
    await graphFetch(getToken, '/me')
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer my-token')
  })

  it('retries exactly once with a forced token refresh on 401, then succeeds', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) })
    const getToken = vi.fn(async ({ force } = {}) => (force ? 'fresh-token' : 'stale-token'))
    const res = await graphFetch(getToken, '/me')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(getToken).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenNthCalledWith(2, { force: true })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('throws if the retried request is still a 401', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    const getToken = vi.fn(async () => 'tok')
    await expect(graphFetch(getToken, '/me')).rejects.toThrow('Graph request failed (401): /me')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-401 non-ok response without retrying', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 })
    const getToken = vi.fn(async () => 'tok')
    await expect(graphFetch(getToken, '/me/drive')).rejects.toThrow('Graph request failed (403): /me/drive')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('graphJSON', () => {
  it('calls /me — the minimal-permission (User.Read-only) example — and returns parsed JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: 'abc', displayName: 'Ada Lovelace', userPrincipalName: 'ada@example.com' }),
    })
    const getToken = vi.fn(async () => 'tok')
    const me = await graphJSON(getToken, '/me')
    expect(global.fetch.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me')
    expect(me).toEqual({ id: 'abc', displayName: 'Ada Lovelace', userPrincipalName: 'ada@example.com' })
  })
})

describe('graphList', () => {
  it('concatenates value arrays across @odata.nextLink pages', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ value: [{ id: 1 }, { id: 2 }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=2' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ value: [{ id: 3 }] }),
      })
    const getToken = vi.fn(async () => 'tok')
    const all = await graphList(getToken, '/me/messages')
    expect(all).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns an empty array when value is absent', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    const all = await graphList(getToken, '/me/messages')
    expect(all).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=@nexusmd/ui -- graph-client` (or `cd packages/ui && npx vitest run src/graph/graph-client.test.js`)
Expected: FAIL — `Failed to resolve import "./graph-client.js"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/graph/graph-client.js`:

```js
// graph-client.js — shared, token-agnostic Microsoft Graph client. Both desktop
// (native PKCE binding) and web (MSAL) pass a getToken({force}) => Promise<string>
// callback; this module owns the request shape, 401-retry, and pagination —
// callers don't re-derive fetch/retry logic per platform or per feature.
const BASE = 'https://graph.microsoft.com/v1.0'

// Run a Graph request; on 401 refresh the token once (force) and retry.
export async function graphFetch(getToken, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const run = async (token) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  let token = await getToken()
  let res = await run(token)
  if (res.status === 401) {
    token = await getToken({ force: true })
    res = await run(token)
  }
  if (!res.ok) throw new Error(`Graph request failed (${res.status}): ${path}`)
  return res
}

export async function graphJSON(getToken, path, opts = {}) {
  const res = await graphFetch(getToken, path, opts)
  return res.json()
}

// Follows @odata.nextLink, concatenating each page's `value` array.
export async function graphList(getToken, path, opts = {}) {
  let out = []
  let next = path
  while (next) {
    const page = await graphJSON(getToken, next, opts)
    out = out.concat(page.value || [])
    next = page['@odata.nextLink'] || null
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx vitest run src/graph/graph-client.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Export from the package barrel**

In `packages/ui/src/index.js`, add a new export block near the cloud-sync exports (after the `makeGoogleDriveProvider, makeOneDriveProvider` line, around line 32):

```js
// Shared, token-agnostic Microsoft Graph client (desktop + web call through this).
export { graphFetch, graphJSON, graphList } from './graph/graph-client.js'
```

- [ ] **Step 6: Run the full packages/ui test suite to check for regressions**

Run: `cd packages/ui && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/graph/graph-client.js packages/ui/src/graph/graph-client.test.js packages/ui/src/index.js
git commit -m "feat(ui): add shared token-agnostic Microsoft Graph client"
```

---

### Task 2: Refactor desktop `ms-graph-calendar.js` onto the shared client

**Files:**
- Modify: `apps/desktop/src/ms-graph-calendar.js`
- Modify: `apps/desktop/src/ms-graph-calendar.test.js`

**Interfaces:**
- Consumes: `graphJSON(getToken, path, opts)`, `graphFetch(getToken, path, opts)` from `@nexusmd/ui` (Task 1).
- Produces: `fetchCalendarEvents(getToken, startISO, endISO) => Promise<Event[]>`, `createCalendarEvent(getToken, { title, start, end, description }) => Promise<object>` — **signature change**: first param is now `getToken` (a `({force}) => Promise<string>` function), not a raw token string. `toLocalDateTimeString(date)` is unchanged.

- [ ] **Step 1: Write the failing tests (replace the existing raw-token tests)**

Replace the contents of `apps/desktop/src/ms-graph-calendar.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCalendarEvents, createCalendarEvent, toLocalDateTimeString } from './ms-graph-calendar.js'

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('fetchCalendarEvents', () => {
  it('maps Graph calendarView events to the app event shape', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          { id: 'abc123', subject: 'Sprint Planning', start: { dateTime: '2026-07-02T09:00:00.0000000' }, end: { dateTime: '2026-07-02T10:00:00.0000000' }, location: { displayName: 'Room 4' } },
        ],
      }),
    })
    const getToken = vi.fn(async () => 'fake-token')
    const result = await fetchCalendarEvents(getToken, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    expect(result).toEqual([
      {
        id: 'outlook-abc123', title: 'Sprint Planning',
        start: '2026-07-02T09:00:00.0000000Z', end: '2026-07-02T10:00:00.0000000Z',
        type: 'meeting', personId: null, personName: null, plannerSection: null,
        description: 'Room 4', source: 'outlook',
      },
    ])
  })

  it('defaults the title when subject is missing', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ value: [{ id: 'x', start: { dateTime: '2026-07-02T09:00:00' }, end: { dateTime: '2026-07-02T10:00:00' } }] }),
    })
    const getToken = vi.fn(async () => 'fake-token')
    const result = await fetchCalendarEvents(getToken, 'a', 'b')
    expect(result[0].title).toBe('(No title)')
  })

  it('sends the Bearer token from getToken and the date range in the request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    const getToken = vi.fn(async () => 'fake-token')
    await fetchCalendarEvents(getToken, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toContain('calendarView')
    expect(url).toContain(encodeURIComponent('2026-07-01T00:00:00.000Z'))
    expect(options.headers.Authorization).toBe('Bearer fake-token')
  })

  it('retries once via a forced token refresh on 401', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [] }) })
    const getToken = vi.fn(async ({ force } = {}) => (force ? 'fresh-token' : 'stale-token'))
    await fetchCalendarEvents(getToken, 'a', 'b')
    expect(getToken).toHaveBeenCalledTimes(2)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 })
    const getToken = vi.fn(async () => 'fake-token')
    await expect(fetchCalendarEvents(getToken, 'a', 'b')).rejects.toThrow(/Graph request failed \(403\)/)
  })
})

describe('createCalendarEvent', () => {
  it('POSTs the event to Graph and returns the response body', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'new-event-id' }) })
    const getToken = vi.fn(async () => 'fake-token')
    const result = await createCalendarEvent(getToken, { title: '1:1 with Alex', start: '2026-07-02T10:00Z', end: '2026-07-02T11:00Z', description: 'Weekly sync' })
    expect(result).toEqual({ id: 'new-event-id' })
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer fake-token')
    const body = JSON.parse(options.body)
    expect(body.subject).toBe('1:1 with Alex')
    expect(body.start.dateTime).toBe('2026-07-02T10:00')
    expect(body.body.content).toBe('Weekly sync')
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 })
    const getToken = vi.fn(async () => 'fake-token')
    await expect(createCalendarEvent(getToken, { title: 'x', start: 'a', end: 'b' })).rejects.toThrow(/Graph request failed \(403\)/)
  })
})

describe('toLocalDateTimeString', () => {
  it('formats a Date using its local components, not UTC', () => {
    const d = new Date(2026, 6, 3, 9, 5, 0) // July 3, 2026, 09:05 local time (month is 0-indexed)
    expect(toLocalDateTimeString(d)).toBe('2026-07-03T09:05')
  })
  it('pads single-digit month, day, hour, and minute', () => {
    const d = new Date(2026, 0, 5, 8, 3, 0) // Jan 5, 2026, 08:03 local time
    expect(toLocalDateTimeString(d)).toBe('2026-01-05T08:03')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/ms-graph-calendar.test.js`
Expected: FAIL — `fetchCalendarEvents`/`createCalendarEvent` still expect a raw token; error messages don't match `/Graph request failed/` yet.

- [ ] **Step 3: Write the implementation**

Replace `apps/desktop/src/ms-graph-calendar.js`:

```js
// ms-graph-calendar.js — desktop Outlook Calendar client. Calls through the
// shared @nexusmd/ui graph-client, so it gets 401-retry-once for free — unlike
// before this refactor, when it hand-rolled fetch with no retry.
import { graphJSON, graphFetch } from '@nexusmd/ui'

export async function fetchCalendarEvents(getToken, startISO, endISO) {
  const path = [
    '/me/calendarView',
    `?startDateTime=${encodeURIComponent(startISO)}`,
    `&endDateTime=${encodeURIComponent(endISO)}`,
    '&$select=id,subject,start,end,location,body',
    '&$top=100',
    '&$orderby=start/dateTime',
  ].join('')
  const data = await graphJSON(getToken, path, { headers: { Prefer: 'outlook.timezone="UTC"' } })
  const toISO = (s) => (s && !s.endsWith('Z') ? s + 'Z' : s)
  return (data.value || []).map((ev) => ({
    id: `outlook-${ev.id}`,
    title: ev.subject || '(No title)',
    start: toISO(ev.start?.dateTime),
    end: toISO(ev.end?.dateTime),
    type: 'meeting',
    personId: null,
    personName: null,
    plannerSection: null,
    description: ev.location?.displayName || '',
    source: 'outlook',
  }))
}

// Formats a Date using its local wall-clock components (not UTC). Used to build
// Graph event start/end strings that pair correctly with the local IANA timeZone
// createCalendarEvent attaches below — unlike `date.toISOString()`, which is
// always UTC and would silently shift the event by the caller's UTC offset.
export function toLocalDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export async function createCalendarEvent(getToken, { title, start, end, description = '' }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const body = {
    subject: title,
    start: { dateTime: start.replace('Z', ''), timeZone: tz },
    end: { dateTime: end.replace('Z', ''), timeZone: tz },
    body: { contentType: 'text', content: description },
  }
  const res = await graphFetch(getToken, '/me/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/ms-graph-calendar.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ms-graph-calendar.js apps/desktop/src/ms-graph-calendar.test.js
git commit -m "refactor(desktop): route ms-graph-calendar through the shared Graph client"
```

---

### Task 3: Update desktop call sites to pass `getToken`

**Files:**
- Modify: `apps/desktop/src/views/view-calendar.jsx:221-233`
- Modify: `apps/desktop/src/views/view-calendar.test.jsx:120-142`
- Modify: `apps/desktop/src/main.jsx:440-457`

**Interfaces:**
- Consumes: `fetchCalendarEvents(getToken, startISO, endISO)`, `createCalendarEvent(getToken, {...})` (Task 2's new signature). `msAuth.getToken` (from `makeDesktopOAuthService`, `apps/desktop/src/cloud-auth.js:191`) already matches the `({force}) => Promise<string>` shape needed.

- [ ] **Step 1: Update the failing test expectation first**

In `apps/desktop/src/views/view-calendar.test.jsx`, the existing assertion at line 141 checks the first arg passed to `fetchCalendarEvents` is the literal string `'ms-token'`. After this task, the first arg will be the `getToken` function itself. Update that test:

```js
  it('fetches Outlook events on mount when Microsoft is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    await waitFor(() => expect(msGraphCalendar.fetchCalendarEvents).toHaveBeenCalled())
    const passedGetToken = msGraphCalendar.fetchCalendarEvents.mock.calls[0][0]
    expect(typeof passedGetToken).toBe('function')
    await expect(passedGetToken()).resolves.toBe('ms-token')
  })
```

(Replaces the old two-line body of this `it` block; everything else in the file is unchanged.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/views/view-calendar.test.jsx -t "fetches Outlook events on mount"`
Expected: FAIL — `passedGetToken` is currently the string `'ms-token'`, so `typeof passedGetToken` is `'string'`, not `'function'`.

- [ ] **Step 3: Update the call sites**

In `apps/desktop/src/views/view-calendar.jsx`, replace lines 221-233:

```js
  React.useEffect(() => {
    if (!msConnected) return
    let cancelled = false
    setOutlookSyncing(true); setOutlookError(null)
    const { startD, endD } = rangeForView()
    fetchCalendarEvents(msAuth.getToken, startD.toISOString(), endD.toISOString())
      .then((evs) => { if (!cancelled) setOutlookEvents(evs) })
      .catch((e) => { if (!cancelled) setOutlookError(e.message) })
      .finally(() => { if (!cancelled) setOutlookSyncing(false) })
    return () => { cancelled = true }
  }, [msConnected, calView, offset, outlookTick]) // eslint-disable-line react-hooks/exhaustive-deps
```

In `apps/desktop/src/main.jsx`, replace lines 440-457 (`handleScheduleOneOnOne`):

```js
  const handleScheduleOneOnOne = (dev) => {
    const start = new Date()
    start.setHours(10, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 60 * 60000)
    const msAuth = makeDesktopOAuthService('microsoft')
    if (msAuth.isConnected()) {
      createCalendarEvent(msAuth.getToken, {
        title: `1:1 with ${dev.name}`,
        start: toLocalDateTimeString(start),
        end: toLocalDateTimeString(end),
      }).catch(console.error)
    }
    window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/views/view-calendar.test.jsx`
Expected: PASS, all tests in the file including the updated one.

- [ ] **Step 5: Run the full desktop test suite to check for regressions**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/view-calendar.jsx apps/desktop/src/views/view-calendar.test.jsx apps/desktop/src/main.jsx
git commit -m "refactor(desktop): pass getToken (not a resolved token) to the Graph calendar client"
```

---

### Task 4: Refactor web/shared `OutlookService` onto the shared client

**Files:**
- Modify: `packages/ui/src/views/view-calendar.jsx:16-80`
- Create: `packages/ui/tests/outlook-service.test.js`

**Interfaces:**
- Consumes: `graphJSON(getToken, path, opts)`, `graphFetch(getToken, path, opts)` from `./graph/graph-client.js` (Task 1, same package).
- Produces: `OutlookService` — same public shape as today (`init`, `reset`, `signIn`, `signOut`, `isConnected`, `getDisplayName`, `fetchWeekEvents`, `createEvent`); `_getToken` becomes the module's internal `getToken` adapter (same external behavior: try silent, fall back to popup on failure or when forced).

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/outlook-service.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutlookService } from '../src/index.js'

const acquireTokenSilent = vi.fn()
const acquireTokenPopup = vi.fn()
const getAllAccounts = vi.fn(() => [])
const setActiveAccount = vi.fn()
const initialize = vi.fn(async () => {})

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: vi.fn().mockImplementation(() => ({
    initialize,
    getAllAccounts,
    setActiveAccount,
    acquireTokenSilent,
    acquireTokenPopup,
  })),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
  OutlookService.reset()
  await OutlookService.init('client-id')
  acquireTokenPopup.mockResolvedValue({ accessToken: 'popup-token', account: { name: 'Ada' } })
  await OutlookService.signIn()
})

describe('OutlookService (MSAL + shared Graph client)', () => {
  it('fetchWeekEvents acquires a token silently and calls Graph calendarView', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token' })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('https://graph.microsoft.com/v1.0/me/calendarView')
    expect(opts.headers.Authorization).toBe('Bearer silent-token')
  })

  it('falls back to acquireTokenPopup when acquireTokenSilent rejects', async () => {
    acquireTokenSilent.mockRejectedValue(new Error('interaction required'))
    acquireTokenPopup.mockResolvedValue({ accessToken: 'popup-token-2', account: { name: 'Ada' } })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('a', 'b')
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer popup-token-2')
  })

  it('retries once via forced popup re-acquisition on a 401 from Graph', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'stale-token' })
    acquireTokenPopup.mockResolvedValue({ accessToken: 'fresh-token', account: { name: 'Ada' } })
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('a', 'b')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('createEvent POSTs to Graph with the silently-acquired token', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token' })
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'evt-1' }) })
    const result = await OutlookService.createEvent({ title: '1:1', start: '2026-07-02T10:00Z', end: '2026-07-02T11:00Z' })
    expect(result).toEqual({ id: 'evt-1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(opts.method).toBe('POST')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && npx vitest run tests/outlook-service.test.js`
Expected: FAIL — current `OutlookService.fetchWeekEvents`/`createEvent` build requests by hand (still works, but the 401-retry test fails since there's no retry logic yet; run confirms current behavior diverges).

- [ ] **Step 3: Refactor the implementation**

In `packages/ui/src/views/view-calendar.jsx`, replace the `OutlookService` block (lines 10-80):

```js
import React from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { Avatar } from '../app-components.jsx';
import { Icon } from '../icons.jsx';
import { graphJSON, graphFetch } from '../graph/graph-client.js';

// ── OutlookService — MSAL + shared Graph client ─────────────────
const OutlookService = (() => {
  const SCOPES = ['Calendars.ReadWrite'];
  let _app = null, _account = null;

  // getToken({force}) — matches the shape graphFetch/graphJSON expect. Tries
  // silent acquisition first; falls back to (or is forced into) an interactive
  // popup, same behavior as before this refactor.
  async function getToken({ force = false } = {}) {
    if (!_app) throw new Error('OutlookService not initialised');
    if (!force) {
      try {
        const r = await _app.acquireTokenSilent({ scopes: SCOPES, account: _account });
        return r.accessToken;
      } catch (_) { /* fall through to popup */ }
    }
    const r = await _app.acquireTokenPopup({ scopes: SCOPES });
    _account = r.account;
    _app.setActiveAccount(_account);
    return r.accessToken;
  }

  return {
    async init(clientId, tenantId = 'common', redirectUri = window.location.origin) {
      if (_app) return; if (!clientId) return;
      const config = {
        auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      };
      _app = new PublicClientApplication(config);
      await _app.initialize();
      const accounts = _app.getAllAccounts();
      if (accounts.length > 0) { _account = accounts[0]; _app.setActiveAccount(_account); }
    },
    reset() { _app = null; _account = null; },
    async signIn() {
      if (!_app) throw new Error('OutlookService not initialised');
      const r = await _app.acquireTokenPopup({ scopes: SCOPES });
      _account = r.account; _app.setActiveAccount(_account); return _account;
    },
    async signOut() {
      if (!_app || !_account) return;
      try { await _app.logoutPopup({ account: _account }); } catch (_) {}
      _account = null;
    },
    isConnected() { return _account != null; },
    getDisplayName() { return _account?.name || _account?.username || null; },
    async fetchWeekEvents(startISO, endISO) {
      const path = ['/me/calendarView',
        `?startDateTime=${encodeURIComponent(startISO)}`,`&endDateTime=${encodeURIComponent(endISO)}`,
        '&$select=id,subject,start,end,location,body','&$top=100','&$orderby=start/dateTime'].join('');
      const data = await graphJSON(getToken, path, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      const toISO = s => (s && !s.endsWith('Z') ? s + 'Z' : s);
      return (data.value || []).map(ev => ({
        id: `outlook-${ev.id}`, title: ev.subject || '(No title)',
        start: toISO(ev.start?.dateTime), end: toISO(ev.end?.dateTime),
        type:'meeting', personId:null, personName:null, plannerSection:null,
        description: ev.location?.displayName || '', source:'outlook',
      }));
    },
    async createEvent({ title, start, end, description = '' }) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body = { subject: title,
        start: { dateTime: start.replace('Z',''), timeZone: tz },
        end:   { dateTime: end.replace('Z',''),   timeZone: tz },
        body:  { contentType:'text', content: description } };
      const res = await graphFetch(getToken, '/me/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return res.json();
    },
  };
})();
```

Note: `signIn()` is unchanged (still calls `acquireTokenPopup` directly) — it's the explicit user-initiated connect action, distinct from `getToken`'s silent-first refresh path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && npx vitest run tests/outlook-service.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full packages/ui test suite to check for regressions**

Run: `cd packages/ui && npx vitest run`
Expected: PASS, no new failures (in particular `tests/calendar.test.jsx`, which imports `OutlookBanner`/date helpers from the same file, still passes).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-calendar.jsx packages/ui/tests/outlook-service.test.js
git commit -m "refactor(ui): route OutlookService through the shared Graph client"
```

---

### Task 5: Manual dev smoke script

**Files:**
- Create: `apps/desktop/scripts/graph-smoke-test.js`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `graphJSON` from `@nexusmd/ui` (Task 1).
- Produces: a `graph:smoke` npm script; not part of the automated suite, not consumed by any other task.

- [ ] **Step 1: Write the script**

Create `apps/desktop/scripts/graph-smoke-test.js`:

```js
#!/usr/bin/env node
'use strict';
// Manual, dev-only check that real OAuth + Graph wiring works end-to-end.
// GRAPH_TOKEN must be a live access token (copy one from a debug log during a
// real Microsoft sign-in). Calls /me — the lowest-permission Graph endpoint
// (User.Read only, already granted) — so it's usable without any extra scope
// consent. Not run in CI.
// Run: GRAPH_TOKEN=eyJ... npm run graph:smoke

const { graphJSON } = require('@nexusmd/ui');

async function main() {
  const token = process.env.GRAPH_TOKEN;
  if (!token) {
    console.error('Set GRAPH_TOKEN to a live Microsoft Graph access token first.');
    process.exit(1);
  }
  const me = await graphJSON(() => token, '/me');
  console.log('Graph /me responded:');
  console.log(JSON.stringify(me, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `apps/desktop/package.json`, add `"graph:smoke"` to the `scripts` block (after `"icons"`, line 15):

```json
    "icons": "node scripts/create-icons.js",
    "graph:smoke": "node scripts/graph-smoke-test.js",
```

- [ ] **Step 3: Verify the script fails cleanly without a token**

Run: `cd apps/desktop && npm run graph:smoke`
Expected: prints `Set GRAPH_TOKEN to a live Microsoft Graph access token first.` and exits non-zero (no network call attempted). This confirms the script and its `@nexusmd/ui` import resolve correctly without needing a real token.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/scripts/graph-smoke-test.js apps/desktop/package.json
git commit -m "chore(desktop): add manual Graph /me smoke-test script"
```

---

## Final check

- [ ] Run every workspace's tests once more end-to-end: `cd packages/ui && npx vitest run`, `cd apps/desktop && npx vitest run` — confirm all green.
- [ ] Skim the spec (`docs/superpowers/specs/2026-07-03-microsoft-graph-client-design.md`) section by section and confirm each item has a corresponding completed task above.
