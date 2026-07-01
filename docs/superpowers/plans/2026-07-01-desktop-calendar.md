# Desktop Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Calendar view to the desktop Electron app, matching web/mobile's feature set (Year/Month/Week/Work Week/Agenda views, Outlook + Google Calendar data, local events), using desktop-native auth instead of either platform's existing approach.

**Architecture:** Two small, framework-free API-client modules (`ms-graph-calendar.js`, `google-calendar.js`) wrap Microsoft Graph and Google Calendar REST calls using tokens from desktop's existing OAuth services (`makeDesktopOAuthService('microsoft')`, `makeNativeGoogleBinding()`) — no MSAL, no server proxy. A new `views/view-calendar.jsx` composes the shared UI primitives already in `@nexusmd/ui` (`WeekGrid`, `MonthView`, `YearView`, `AgendaView`, `EventDetailModal`) with these two clients plus a `usePersistedState`-backed local-events array. `main.jsx` wires it into the nav and fixes a pre-existing dormant bug (`handleScheduleOneOnOne` calling an Outlook client that's never initialized on desktop) along the way.

**Tech Stack:** React 18, Vitest 4 + jsdom + `@testing-library/react` (established `apps/desktop` harness), Microsoft Graph REST API v1.0, Google Calendar API v3, ASP.NET Core (one-line backend change).

## Global Constraints

- Neither new client module (`ms-graph-calendar.js`, `google-calendar.js`) manages auth itself — both take/fetch a token from the existing desktop OAuth services and make direct `fetch` calls. Neither imports `@azure/msal-browser` or the shared `OutlookService`.
- `apps/web/server/Controllers/MicrosoftAuthController.cs`'s `Scope` constant changes from `"openid email offline_access Files.ReadWrite"` to `"openid email offline_access Files.ReadWrite Calendars.ReadWrite"` — the only backend change.
- No new `'calendar'` icon glyph — the `NAV` entry uses the existing `'clock'` icon (`packages/ui/src/icons.jsx:44`).
- `calendarEvents`/`setCalendarEvents` state lives inside `ViewBody` (`apps/desktop/src/main.jsx`), created via the existing local `usePersistedState('nexusmd.calendar.events', [])` hook — matching the established pattern for `needsMeCriteria`/`acknowledgedBuilds`/`customTeam` (all created directly inside `ViewBody`, not threaded down from `App`). This corrects the design spec's Section 5, which assumed the `plannerData`/`localItems` threaded-from-`App` pattern; the actual precedent in this file for view-local persisted state is the local-to-`ViewBody` pattern.
- The "New event" button/modal is Google-only, matching web's current calendar-page feature set exactly — no Outlook or local "new event" UI on the calendar page itself (Outlook event creation only happens via the Planner's "Schedule 1:1" action).
- No new npm dependencies.

---

## Section: File Structure

- **Modify** `apps/web/server/Controllers/MicrosoftAuthController.cs` — scope string only.
- **Create** `apps/desktop/src/ms-graph-calendar.js` — Outlook Calendar REST client (token passed in, no auth management).
- **Create** `apps/desktop/src/ms-graph-calendar.test.js` — tests for the above.
- **Create** `apps/desktop/src/google-calendar.js` — Google Calendar REST client (uses `makeNativeGoogleBinding()` internally for its token).
- **Create** `apps/desktop/src/google-calendar.test.js` — tests for the above.
- **Create** `apps/desktop/src/views/view-calendar.jsx` — `CalendarView` and its small sub-components (`MicrosoftCalendarBanner`, `GoogleCalendarBanner`, `NewGoogleEventModal`).
- **Create** `apps/desktop/src/views/view-calendar.test.jsx` — tests for the above.
- **Modify** `apps/desktop/src/main.jsx` — `NAV` entry, import, `ViewBody`'s `calendarEvents` state + `case 'calendar'`, `handleScheduleOneOnOne` rewrite, remove now-unused `OutlookService` import.

---

## Task 1: Backend — extend Microsoft OAuth scope

**Files:**
- Modify: `apps/web/server/Controllers/MicrosoftAuthController.cs:14`

**Interfaces:**
- Produces: the Microsoft OAuth app now requests `Calendars.ReadWrite` in addition to its existing scopes — consumed implicitly by Task 2's Graph calls (a token obtained after this change carries Calendar permission; a token obtained before it does not).

This repo has no C# test project (verified: no `*Test*.cs` files exist under `apps/web/server`), so this task has no automated test — it's a single-line, no-logic string constant change.

- [ ] **Step 1: Change the scope constant**

```csharp
// apps/web/server/Controllers/MicrosoftAuthController.cs:14
private const string Scope = "openid email offline_access Files.ReadWrite Calendars.ReadWrite";
```

- [ ] **Step 2: Verify the change**

Run: `grep -n "private const string Scope" apps/web/server/Controllers/MicrosoftAuthController.cs`
Expected: `private const string Scope = "openid email offline_access Files.ReadWrite Calendars.ReadWrite";`

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/Controllers/MicrosoftAuthController.cs
git commit -m "feat(web): add Calendars.ReadWrite to Microsoft OAuth scope"
```

---

## Task 2: `ms-graph-calendar.js` — Outlook Calendar client

**Files:**
- Create: `apps/desktop/src/ms-graph-calendar.js`
- Test: `apps/desktop/src/ms-graph-calendar.test.js`

**Interfaces:**
- Produces:
  - `fetchCalendarEvents(token: string, startISO: string, endISO: string): Promise<{id, title, start, end, type, personId, personName, plannerSection, description, source}[]>`
  - `createCalendarEvent(token: string, {title, start, end, description}): Promise<object>` (returns the raw Graph API response)
  Both are consumed by Task 6 (`CalendarView`'s Outlook wiring) and Task 7 (`main.jsx`'s `handleScheduleOneOnOne` fix). Neither function manages auth — the caller obtains `token` from `makeDesktopOAuthService('microsoft').getToken()`.

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/src/ms-graph-calendar.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCalendarEvents, createCalendarEvent } from './ms-graph-calendar.js'

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
    const result = await fetchCalendarEvents('fake-token', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
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
    const result = await fetchCalendarEvents('fake-token', 'a', 'b')
    expect(result[0].title).toBe('(No title)')
  })

  it('sends the Bearer token and date range in the request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await fetchCalendarEvents('fake-token', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toContain('calendarView')
    expect(url).toContain(encodeURIComponent('2026-07-01T00:00:00.000Z'))
    expect(options.headers.Authorization).toBe('Bearer fake-token')
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    await expect(fetchCalendarEvents('fake-token', 'a', 'b')).rejects.toThrow('Graph calendarView failed: 401')
  })
})

describe('createCalendarEvent', () => {
  it('POSTs the event to Graph and returns the response body', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'new-event-id' }) })
    const result = await createCalendarEvent('fake-token', { title: '1:1 with Alex', start: '2026-07-02T10:00Z', end: '2026-07-02T11:00Z', description: 'Weekly sync' })
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
    await expect(createCalendarEvent('fake-token', { title: 'x', start: 'a', end: 'b' })).rejects.toThrow('Graph createEvent failed: 403')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- ms-graph-calendar`
Expected: FAIL with "Failed to resolve import ./ms-graph-calendar.js" (file doesn't exist)

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/src/ms-graph-calendar.js
// ms-graph-calendar.js — desktop Outlook Calendar client. Takes a caller-supplied
// Bearer token (from makeDesktopOAuthService('microsoft')) rather than managing its
// own auth — unlike the shared @nexusmd/ui OutlookService, which is MSAL-only.

export async function fetchCalendarEvents(token, startISO, endISO) {
  const url = [
    'https://graph.microsoft.com/v1.0/me/calendarView',
    `?startDateTime=${encodeURIComponent(startISO)}`,
    `&endDateTime=${encodeURIComponent(endISO)}`,
    '&$select=id,subject,start,end,location,body',
    '&$top=100',
    '&$orderby=start/dateTime',
  ].join('')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } })
  if (!res.ok) throw new Error(`Graph calendarView failed: ${res.status}`)
  const data = await res.json()
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

export async function createCalendarEvent(token, { title, start, end, description = '' }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const body = {
    subject: title,
    start: { dateTime: start.replace('Z', ''), timeZone: tz },
    end: { dateTime: end.replace('Z', ''), timeZone: tz },
    body: { contentType: 'text', content: description },
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Graph createEvent failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- ms-graph-calendar`
Expected: PASS — `6 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ms-graph-calendar.js apps/desktop/src/ms-graph-calendar.test.js
git commit -m "feat(desktop): add Outlook Calendar Graph API client"
```

---

## Task 3: `google-calendar.js` — Google Calendar client

**Files:**
- Create: `apps/desktop/src/google-calendar.js`
- Test: `apps/desktop/src/google-calendar.test.js`

**Interfaces:**
- Consumes: `makeNativeGoogleBinding` from `./cloud-auth.js` (already exists — exported `{ isConnected(): boolean, connect(): Promise<void>, disconnect(): Promise<void>, getToken({force}?): Promise<string|null> }`).
- Produces:
  - `fetchGoogleCalendarEvents(startISO: string, endISO: string): Promise<{id, title, start, end, type, source, description, personName, personId, plannerSection}[]>`
  - `createGoogleCalendarEvent({title, start, end, description}): Promise<object>`
  - `deleteGoogleCalendarEvent(eventId: string): Promise<void>`
  - `isGoogleConnected(): boolean`
  All four are consumed by Task 6 (`CalendarView`'s Google wiring).

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/src/google-calendar.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBinding = {
  isConnected: vi.fn(() => true),
  getToken: vi.fn(async () => 'fake-google-token'),
}
vi.mock('./cloud-auth.js', () => ({ makeNativeGoogleBinding: () => mockBinding }))

import { fetchGoogleCalendarEvents, createGoogleCalendarEvent, deleteGoogleCalendarEvent, isGoogleConnected } from './google-calendar.js'

beforeEach(() => {
  global.fetch = vi.fn()
  mockBinding.isConnected.mockReturnValue(true)
  mockBinding.getToken.mockResolvedValue('fake-google-token')
})

describe('fetchGoogleCalendarEvents', () => {
  it('maps Google events to the app event shape', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ items: [{ id: 'g1', summary: 'Design Review', start: { dateTime: '2026-07-02T09:00:00Z' }, end: { dateTime: '2026-07-02T10:00:00Z' }, location: 'HQ' }] }),
    })
    const result = await fetchGoogleCalendarEvents('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    expect(result).toEqual([
      { id: 'google-g1', title: 'Design Review', start: '2026-07-02T09:00:00Z', end: '2026-07-02T10:00:00Z', type: 'meeting', source: 'google', description: 'HQ', personName: null, personId: null, plannerSection: null },
    ])
  })

  it('returns an empty array without calling fetch when there is no token', async () => {
    mockBinding.getToken.mockResolvedValue(null)
    const result = await fetchGoogleCalendarEvents('a', 'b')
    expect(result).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchGoogleCalendarEvents('a', 'b')).rejects.toThrow('Google Calendar events failed: 500')
  })
})

describe('createGoogleCalendarEvent', () => {
  it('POSTs the event and returns the response body', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'new-g-id' }) })
    const result = await createGoogleCalendarEvent({ title: 'Standup', start: '2026-07-02T09:00:00Z', end: '2026-07-02T09:15:00Z', description: 'Daily' })
    expect(result).toEqual({ id: 'new-g-id' })
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body)
    expect(body.summary).toBe('Standup')
  })

  it('throws when there is no token', async () => {
    mockBinding.getToken.mockResolvedValue(null)
    await expect(createGoogleCalendarEvent({ title: 'x', start: 'a', end: 'b' })).rejects.toThrow('Not connected to Google.')
  })
})

describe('deleteGoogleCalendarEvent', () => {
  it('sends a DELETE request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await deleteGoogleCalendarEvent('g1')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toContain('/events/g1')
    expect(options.method).toBe('DELETE')
  })

  it('treats a 410 Gone response as success', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 410 })
    await expect(deleteGoogleCalendarEvent('g1')).resolves.toBeUndefined()
  })

  it('throws on other non-ok responses', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(deleteGoogleCalendarEvent('g1')).rejects.toThrow('Google Calendar delete failed: 500')
  })
})

describe('isGoogleConnected', () => {
  it('delegates to the native Google binding', () => {
    mockBinding.isConnected.mockReturnValue(false)
    expect(isGoogleConnected()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- google-calendar`
Expected: FAIL with "Failed to resolve import ./google-calendar.js"

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/src/google-calendar.js
// google-calendar.js — desktop Google Calendar client. Uses the existing native
// Google OAuth binding (already scoped for Calendar alongside Drive/Gmail — see
// apps/desktop/electron/oauth/config.cjs) for its token; no separate auth flow.
import { makeNativeGoogleBinding } from './cloud-auth.js'

const googleAuth = makeNativeGoogleBinding()

export async function fetchGoogleCalendarEvents(startISO, endISO) {
  const token = await googleAuth.getToken({})
  if (!token) return []
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startISO)}&timeMax=${encodeURIComponent(endISO)}&singleEvents=true&orderBy=startTime`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google Calendar events failed: ${res.status}`)
  const data = await res.json()
  return (data.items || []).map((ev) => ({
    id: `google-${ev.id}`,
    title: ev.summary || '(No title)',
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    type: 'meeting',
    source: 'google',
    description: ev.location || '',
    personName: null,
    personId: null,
    plannerSection: null,
  }))
}

export async function createGoogleCalendarEvent({ title, start, end, description = '' }) {
  const token = await googleAuth.getToken({})
  if (!token) throw new Error('Not connected to Google.')
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, description, start: { dateTime: start }, end: { dateTime: end } }),
  })
  if (!res.ok) throw new Error(`Google Calendar create failed: ${res.status}`)
  return res.json()
}

export async function deleteGoogleCalendarEvent(eventId) {
  const token = await googleAuth.getToken({})
  if (!token) throw new Error('Not connected to Google.')
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 410) throw new Error(`Google Calendar delete failed: ${res.status}`)
}

export function isGoogleConnected() {
  return googleAuth.isConnected()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- google-calendar`
Expected: PASS — `9 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/google-calendar.js apps/desktop/src/google-calendar.test.js
git commit -m "feat(desktop): add Google Calendar API client"
```

---

## Task 4: `views/view-calendar.jsx` — banners and new-event modal

**Files:**
- Create: `apps/desktop/src/views/view-calendar.jsx`
- Create: `apps/desktop/src/views/view-calendar.test.jsx`

**Interfaces:**
- Consumes: `Icon`, `toast` from `@nexusmd/ui`; `createGoogleCalendarEvent`, `isGoogleConnected` from `../google-calendar.js`.
- Produces: `MicrosoftCalendarBanner({ connected, syncing, error, onRefresh })`, `GoogleCalendarBanner({ syncing, error, onRefresh })`, `NewGoogleEventModal({ open, defaultDate, defaultTime, onClose, onCreated })` — all consumed by `CalendarView` (Task 5).

- [ ] **Step 1: Write the failing tests**

```jsx
// apps/desktop/src/views/view-calendar.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../google-calendar.js', () => ({
  createGoogleCalendarEvent: vi.fn(),
  isGoogleConnected: vi.fn(() => true),
  fetchGoogleCalendarEvents: vi.fn(async () => []),
  deleteGoogleCalendarEvent: vi.fn(),
}))

import * as googleCalendar from '../google-calendar.js'
import { MicrosoftCalendarBanner, GoogleCalendarBanner, NewGoogleEventModal } from './view-calendar.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })
// vi.clearAllMocks() resets call history but NOT mockReturnValue/mockImplementation
// overrides set by individual tests (e.g. `.mockReturnValue(false)`), which would
// otherwise silently leak into later tests. Reset the shared default explicitly.
beforeEach(() => { googleCalendar.isGoogleConnected.mockReturnValue(true) })

describe('MicrosoftCalendarBanner', () => {
  it('shows a syncing indicator when syncing', () => {
    render(<MicrosoftCalendarBanner connected syncing error={null} onRefresh={() => {}} />)
    expect(screen.getByText(/Outlook/)).toBeTruthy()
  })

  it('shows an error message when there is a sync error', () => {
    render(<MicrosoftCalendarBanner connected syncing={false} error="token expired" onRefresh={() => {}} />)
    expect(screen.getByTitle('token expired')).toBeTruthy()
  })

  it('renders nothing when not connected', () => {
    const { container } = render(<MicrosoftCalendarBanner connected={false} syncing={false} error={null} onRefresh={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('calls onRefresh when the refresh button is clicked', () => {
    const onRefresh = vi.fn()
    render(<MicrosoftCalendarBanner connected syncing={false} error={null} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTitle('Refresh Outlook Calendar'))
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('GoogleCalendarBanner', () => {
  it('renders nothing when Google is not connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(false)
    const { container } = render(<GoogleCalendarBanner syncing={false} error={null} onRefresh={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('shows connected status when Google is connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(true)
    render(<GoogleCalendarBanner syncing={false} error={null} onRefresh={() => {}} />)
    expect(screen.getByText('Google Calendar')).toBeTruthy()
  })
})

describe('NewGoogleEventModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<NewGoogleEventModal open={false} onClose={() => {}} onCreated={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('creates a Google event with the entered title and calls onCreated', async () => {
    googleCalendar.createGoogleCalendarEvent.mockResolvedValue({ id: 'new-id' })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(<NewGoogleEventModal open={true} defaultDate="2026-07-02" defaultTime="09:00" onClose={onClose} onCreated={onCreated} />)

    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Team sync' } })
    fireEvent.click(screen.getByText('Create event'))

    await waitFor(() => expect(googleCalendar.createGoogleCalendarEvent).toHaveBeenCalled())
    expect(googleCalendar.createGoogleCalendarEvent.mock.calls[0][0].title).toBe('Team sync')
    expect(onCreated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not submit with an empty title', () => {
    render(<NewGoogleEventModal open={true} onClose={() => {}} onCreated={() => {}} />)
    expect(screen.getByText('Create event').closest('button').disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: FAIL with "Failed to resolve import ./view-calendar.jsx"

- [ ] **Step 3: Write minimal implementation**

```jsx
// apps/desktop/src/views/view-calendar.jsx
// view-calendar.jsx — desktop Calendar view. Composes the shared calendar UI
// primitives from @nexusmd/ui with desktop-native Outlook/Google clients
// (../ms-graph-calendar.js, ../google-calendar.js) instead of the shared
// OutlookService (MSAL) or web's server-proxied Google fetch.
import React from 'react'
import { Icon, toast } from '@nexusmd/ui'
import { createGoogleCalendarEvent, isGoogleConnected } from '../google-calendar.js'

export function MicrosoftCalendarBanner({ connected, syncing, error, onRefresh }) {
  if (!connected) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {syncing && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> Outlook
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--danger)' }} title={error}>Outlook sync error</span>}
      {!syncing && !error && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          Outlook Calendar
        </span>
      )}
      <button className="btn sm ghost" onClick={onRefresh} title="Refresh Outlook Calendar" style={{ padding: '0 5px', height: 24 }}>
        <Icon name="refresh" size={11} />
      </button>
    </div>
  )
}

export function GoogleCalendarBanner({ syncing, error, onRefresh }) {
  const connected = isGoogleConnected()
  if (!connected) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {syncing && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> Google
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--danger)' }} title={error}>Google sync error</span>}
      {!syncing && !error && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          Google Calendar
        </span>
      )}
      <button className="btn sm ghost" onClick={onRefresh} title="Refresh Google Calendar" style={{ padding: '0 5px', height: 24 }}>
        <Icon name="refresh" size={11} />
      </button>
    </div>
  )
}

export function NewGoogleEventModal({ open, defaultDate, defaultTime, onClose, onCreated }) {
  const pad = (n) => String(n).padStart(2, '0')
  const nowH = new Date().getHours()
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState(defaultDate || '')
  const [startTime, setStartTime] = React.useState(defaultTime || `${pad(nowH < 23 ? nowH + 1 : nowH)}:00`)
  const [dur, setDur] = React.useState(60)
  const [desc, setDesc] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const nowH2 = new Date().getHours()
    setTitle(''); setDesc(''); setSaving(false)
    setDate(defaultDate || '')
    setStartTime(defaultTime || `${pad(nowH2 < 23 ? nowH2 + 1 : nowH2)}:00`)
    setDur(60)
  }, [open, defaultDate, defaultTime]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const submit = async () => {
    if (!title.trim()) return
    const startDt = new Date(`${date}T${startTime}`)
    const endDt = new Date(startDt.getTime() + Number(dur) * 60000)
    const fmtUTC = (d) => d.toISOString().slice(0, 19) + 'Z'
    setSaving(true)
    try {
      await createGoogleCalendarEvent({ title: title.trim(), start: fmtUTC(startDt), end: fmtUTC(endDt), description: desc.trim() || undefined })
      toast?.('Google Calendar event created.', 'success')
      onCreated?.()
      onClose()
    } catch {
      toast?.('Failed to create event.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const inp = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, outline: 'none' }
  const lbl = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-subtle)', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '.05em' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,.18)', width: 420, maxWidth: '92vw', overflow: 'hidden' }}>
        <div style={{ height: 4, background: 'var(--success)' }} />
        <div style={{ padding: '22px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', flex: 1 }}>New Google Calendar event</div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={lbl}>Title</label>
              <input autoFocus style={inp} value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
                placeholder="Event title" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1.4 }}>
                <label style={lbl}>Date</label>
                <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Start</label>
                <input type="time" style={inp} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div style={{ flex: 0.8 }}>
                <label style={lbl}>Mins</label>
                <input type="number" min={15} step={15} style={inp} value={dur} onChange={(e) => setDur(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={lbl}>Description</label>
              <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn sm ghost" onClick={onClose}>Cancel</button>
            <button className="btn sm primary" onClick={submit} disabled={!title.trim() || saving}>
              {saving ? 'Creating…' : 'Create event'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: PASS — `10 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/view-calendar.jsx apps/desktop/src/views/view-calendar.test.jsx
git commit -m "feat(desktop): add calendar sync banners and new Google event modal"
```

---

## Task 5: `views/view-calendar.jsx` — `CalendarView` shell (local events only)

**Files:**
- Modify: `apps/desktop/src/views/view-calendar.jsx`
- Modify: `apps/desktop/src/views/view-calendar.test.jsx`

**Interfaces:**
- Consumes: `WeekGrid`, `MonthView`, `YearView`, `AgendaView`, `EventDetailModal`, `getWeekDays`, `getMonthGrid`, `getYearMonths`, `getAgendaDays`, `nowTopPx`, `todayStr`, `isoDate`, `MONTH_NAMES`, `MONTH_SHORT` — all real, already-exported from `@nexusmd/ui` (`packages/ui/src/views/view-calendar.jsx`), with the exact signatures already used by web's `apps/web/src/view-calendar.jsx` (`getWeekDays(offset, workWeek)`, `getMonthGrid(offset) → {year, month, days}`, `getYearMonths(offset)`, `getAgendaDays(offset)`, `nowTopPx()`, `isoDate(date)`, `todayStr()`).
- Produces: `CalendarView({ calendarEvents, setCalendarEvents, onNavigatePlanner })` — this task wires local-event view switching, navigation, and CRUD (via `setCalendarEvents` directly, no external callback props); Task 6 adds Outlook/Google data on top of the same component. Consumed by `main.jsx` (Task 7).

- [ ] **Step 1: Write the failing tests**

```jsx
// append to apps/desktop/src/views/view-calendar.test.jsx
import { CalendarView } from './view-calendar.jsx'

describe('CalendarView (local events only)', () => {
  it('defaults to week view and shows a Today button', () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('switches to month view when the Month button is clicked', () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Month'))
    expect(document.querySelector('.cal-view-btn.active').textContent).toBe('Month')
  })

  it('renders a local event chip and opens the detail modal on click', () => {
    const events = [{ id: 'local-1', title: 'Retro', start: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`, end: `${new Date().toISOString().slice(0, 10)}T15:00:00.000Z`, source: 'local' }]
    render(<CalendarView calendarEvents={events} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Retro'))
    // EventDetailModal's root has id="modal-event-detail" — check for it directly rather than
    // re-querying the event title text, which now appears twice (chip + modal) and would throw.
    expect(document.getElementById('modal-event-detail')).toBeTruthy()
  })

  it('deletes a local event via the detail modal and updates calendarEvents', () => {
    const setCalendarEvents = vi.fn()
    const events = [{ id: 'local-1', title: 'Retro', start: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`, end: `${new Date().toISOString().slice(0, 10)}T15:00:00.000Z`, source: 'local' }]
    render(<CalendarView calendarEvents={events} setCalendarEvents={setCalendarEvents} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Retro'))
    // The modal's Delete button requires a two-step confirm: first click reveals
    // "Delete this event?" with a second Delete button; only the second click deletes.
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
    expect(setCalendarEvents).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: FAIL with "CalendarView is not exported"

- [ ] **Step 3: Write minimal implementation**

```jsx
// add to apps/desktop/src/views/view-calendar.jsx
import {
  WeekGrid, MonthView, YearView, AgendaView, EventDetailModal,
  getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, MONTH_SHORT,
} from '@nexusmd/ui'

const VIEWS = [
  { id: 'year', label: 'Year' },
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'workweek', label: 'Work Week' },
  { id: 'agenda', label: 'Agenda' },
]

export function CalendarView({ calendarEvents, setCalendarEvents, onNavigatePlanner }) {
  const [calView, setCalView] = React.useState('week')
  const [offset, setOffset] = React.useState(0)
  const [selectedEvent, setSelectedEvent] = React.useState(null)
  const [nowPx, setNowPx] = React.useState(nowTopPx)
  const scrollRef = React.useRef(null)

  const today = todayStr()

  React.useEffect(() => {
    const id = setInterval(() => setNowPx(nowTopPx()), 60000)
    return () => clearInterval(id)
  }, [])

  React.useEffect(() => {
    if ((calView !== 'week' && calView !== 'workweek') || offset !== 0 || !scrollRef.current) return
    const px = nowTopPx()
    if (px !== null) scrollRef.current.scrollTop = Math.max(0, px - 120)
  }, [calView, offset])

  const updateLocalEvent = (id, patch) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!oldEv || oldEv.source !== 'local') return
    setCalendarEvents((prev) => prev.map((e) => (String(e.id) === String(id) ? { ...e, ...patch } : e)))
    toast?.('Calendar entry updated', 'success')
  }

  const deleteLocalEvent = (id) => {
    const oldEv = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!oldEv || oldEv.source !== 'local') return
    setCalendarEvents((prev) => prev.filter((e) => String(e.id) !== String(id)))
    toast?.('Calendar entry deleted', 'success')
  }

  const moveLocalEvent = (id, newDateStr) => {
    const ev = (calendarEvents || []).find((e) => String(e.id) === String(id))
    if (!ev || !newDateStr || ev.source !== 'local') return
    if (ev.start && ev.start.slice(0, 10) === newDateStr) return
    const pad = (n) => String(n).padStart(2, '0')
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const time = ev.start ? ev.start.slice(11) : '09:00'
    const newStart = `${newDateStr}T${time || '09:00'}`
    let newEnd = ev.end
    if (ev.start && ev.end) {
      const durMs = new Date(ev.end) - new Date(ev.start)
      newEnd = fmt(new Date(new Date(newStart).getTime() + durMs))
    }
    updateLocalEvent(id, { start: newStart, end: newEnd })
  }

  const allEvents = React.useMemo(() => (calendarEvents || []).map((ev) => ({ source: 'local', ...ev })), [calendarEvents])

  const viewDays = React.useMemo(() => {
    if (calView === 'week') return getWeekDays(offset, false)
    if (calView === 'workweek') return getWeekDays(offset, true)
    if (calView === 'month') return getMonthGrid(offset).days
    if (calView === 'agenda') return getAgendaDays(offset)
    return []
  }, [calView, offset])

  const eventsByDay = React.useMemo(() => {
    const map = {}
    viewDays.forEach((d) => { map[isoDate(d)] = [] })
    allEvents.forEach((ev) => {
      if (!ev.start) return
      const k = ev.start.length === 10 ? ev.start : isoDate(new Date(ev.start))
      if (map[k]) map[k].push(ev)
    })
    return map
  }, [allEvents, viewDays])

  const headerTitle = React.useMemo(() => {
    if (calView === 'week') {
      const days = getWeekDays(offset, false)
      const opts = { month: 'short', day: 'numeric' }
      return `${days[0].toLocaleDateString([], opts)} – ${days[6].toLocaleDateString([], { ...opts, year: 'numeric' })}`
    }
    if (calView === 'workweek') {
      const days = getWeekDays(offset, true)
      const opts = { month: 'short', day: 'numeric' }
      return `${days[0].toLocaleDateString([], opts)} – ${days[4].toLocaleDateString([], { ...opts, year: 'numeric' })}`
    }
    if (calView === 'month') {
      const { year, month } = getMonthGrid(offset)
      return `${MONTH_NAMES[month]} ${year}`
    }
    if (calView === 'year') return `${new Date().getFullYear() + offset}`
    if (calView === 'agenda') {
      const ds = getAgendaDays(offset)
      return `${MONTH_SHORT[ds[0].getMonth()]} – ${MONTH_SHORT[ds[ds.length - 1].getMonth()]} ${ds[ds.length - 1].getFullYear()}`
    }
    return ''
  }, [calView, offset])

  const isCurrentPeriod = offset === 0
  const monthGrid = React.useMemo(() => (calView === 'month' ? getMonthGrid(offset) : null), [calView, offset])
  const yearMonths = React.useMemo(() => (calView === 'year' ? getYearMonths(offset) : null), [calView, offset])
  const agendaDays = React.useMemo(() => (calView === 'agenda' ? getAgendaDays(offset) : null), [calView, offset])
  const weekDays = React.useMemo(() => ((calView === 'week' || calView === 'workweek') ? getWeekDays(offset, calView === 'workweek') : null), [calView, offset])

  const handleViewChange = (v) => { setCalView(v); setOffset(0) }

  return (
    <div>
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} onOpenPlanner={(ev) => onNavigatePlanner?.(ev)}
          onUpdate={updateLocalEvent} onDelete={(id) => { deleteLocalEvent(id); setSelectedEvent(null) }} />
      )}

      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">{headerTitle}</div>
        </div>
        <div className="page-head-actions" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', padding: '3px 4px', gap: 2 }}>
            {VIEWS.map((v) => (
              <button key={v.id} className={`cal-view-btn${calView === v.id ? ' active' : ''}`} onClick={() => handleViewChange(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <button className="cal-nav-btn" onClick={() => setOffset((v) => v - 1)} title="Previous">
              <Icon name="chevron-left" size={14} />
            </button>
            <button onClick={() => setOffset(0)}
              style={{ height: 28, padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: isCurrentPeriod ? 'var(--accent)' : 'transparent', color: isCurrentPeriod ? 'var(--accent-fg)' : 'var(--text-muted)', fontSize: 12.5, fontWeight: 600 }}>
              Today
            </button>
            <button className="cal-nav-btn" onClick={() => setOffset((v) => v + 1)} title="Next">
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      </div>

      {(calView === 'week' || calView === 'workweek') && weekDays && (
        <WeekGrid days={weekDays} eventsByDay={eventsByDay} today={today} isCurrentPeriod={isCurrentPeriod} nowPx={nowPx}
          onEventClick={setSelectedEvent} scrollRef={scrollRef} onMoveEvent={moveLocalEvent} onUpdateEvent={updateLocalEvent} onNewGoogleEvent={null} />
      )}
      {calView === 'month' && monthGrid && (
        <MonthView eventsByDay={eventsByDay} monthGrid={monthGrid} today={today} onEventClick={setSelectedEvent} onMoveEvent={moveLocalEvent} />
      )}
      {calView === 'year' && (
        <YearView year={new Date().getFullYear() + offset} allEvents={allEvents} today={today}
          onDayClick={(key) => {
            const d = new Date(key)
            const now = new Date()
            const diffMonths = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
            handleViewChange('month'); setOffset(diffMonths)
          }} />
      )}
      {calView === 'agenda' && agendaDays && (
        <AgendaView agendaDays={agendaDays} eventsByDay={eventsByDay} today={today} onEventClick={setSelectedEvent} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: PASS — `14 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/view-calendar.jsx apps/desktop/src/views/view-calendar.test.jsx
git commit -m "feat(desktop): add CalendarView shell with local event view/nav/CRUD"
```

---

## Task 6: `views/view-calendar.jsx` — wire Outlook + Google data

**Files:**
- Modify: `apps/desktop/src/views/view-calendar.jsx`
- Modify: `apps/desktop/src/views/view-calendar.test.jsx`

**Interfaces:**
- Consumes: `fetchCalendarEvents`, `createCalendarEvent` (Task 2, via `../ms-graph-calendar.js`); `fetchGoogleCalendarEvents`, `deleteGoogleCalendarEvent`, `isGoogleConnected` (Task 3, via `../google-calendar.js`, already imported in Task 4); `makeDesktopOAuthService` from `../cloud-auth.js` (already exists — `makeDesktopOAuthService('microsoft')` returns `{ isConnected(), connect(), disconnect(), getToken({force}?) }`, same shape as `makeNativeGoogleBinding`).
- Produces: `CalendarView` now merges Outlook + Google + local events into `allEvents`/`eventsByDay`, fetches on view/offset change, and exposes the Google "New event" button + `NewGoogleEventModal` from Task 4. This is the final, complete `CalendarView` consumed by `main.jsx` (Task 7).

- [ ] **Step 1: Write the failing tests**

```jsx
// append to apps/desktop/src/views/view-calendar.test.jsx
vi.mock('../ms-graph-calendar.js', () => ({
  fetchCalendarEvents: vi.fn(async () => []),
  createCalendarEvent: vi.fn(),
}))
vi.mock('../cloud-auth.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    makeDesktopOAuthService: vi.fn(() => ({
      isConnected: vi.fn(() => true),
      getToken: vi.fn(async () => 'ms-token'),
    })),
  }
})

import * as msGraphCalendar from '../ms-graph-calendar.js'

describe('CalendarView Outlook + Google wiring', () => {
  it('fetches Outlook events on mount when Microsoft is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    await waitFor(() => expect(msGraphCalendar.fetchCalendarEvents).toHaveBeenCalled())
    expect(msGraphCalendar.fetchCalendarEvents.mock.calls[0][0]).toBe('ms-token')
  })

  it('fetches Google events on mount when Google is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    await waitFor(() => expect(googleCalendar.fetchGoogleCalendarEvents).toHaveBeenCalled())
  })

  it('renders a merged Outlook event chip', async () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    msGraphCalendar.fetchCalendarEvents.mockResolvedValueOnce([
      { id: 'outlook-1', title: 'All-Hands', start: `${todayIso}T13:00:00.000Z`, end: `${todayIso}T14:00:00.000Z`, type: 'meeting', personId: null, personName: null, plannerSection: null, description: '', source: 'outlook' },
    ])
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(await screen.findByText('All-Hands')).toBeTruthy()
  })

  it('shows the New event button and opens the modal when Google is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByTitle('New Google Calendar event'))
    expect(screen.getByText('New Google Calendar event', { selector: 'div' })).toBeTruthy()
  })

  it('does not show the New event button when Google is not connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(false)
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(screen.queryByTitle('New Google Calendar event')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: FAIL — Outlook/Google fetch functions never called (not wired yet), "New event" button not found

- [ ] **Step 3: Write minimal implementation**

```jsx
// add import at top of apps/desktop/src/views/view-calendar.jsx
import { fetchCalendarEvents, createCalendarEvent } from '../ms-graph-calendar.js'
import { fetchGoogleCalendarEvents, deleteGoogleCalendarEvent } from '../google-calendar.js'
import { makeDesktopOAuthService } from '../cloud-auth.js'

// add inside CalendarView, alongside the other useState hooks:
  const [msConnected, setMsConnected] = React.useState(false)
  const [outlookEvents, setOutlookEvents] = React.useState([])
  const [outlookSyncing, setOutlookSyncing] = React.useState(false)
  const [outlookError, setOutlookError] = React.useState(null)
  const [outlookTick, setOutlookTick] = React.useState(0)

  const [googleEvents, setGoogleEvents] = React.useState([])
  const [googleSyncing, setGoogleSyncing] = React.useState(false)
  const [googleError, setGoogleError] = React.useState(null)
  const [googleTick, setGoogleTick] = React.useState(0)

  const [newGoogleOpen, setNewGoogleOpen] = React.useState(false)
  const [newGoogleDate, setNewGoogleDate] = React.useState(null)
  const [newGoogleTime, setNewGoogleTime] = React.useState(null)

  const msAuth = React.useMemo(() => makeDesktopOAuthService('microsoft'), [])

  const rangeForView = React.useCallback(() => {
    let startD, endD
    if (calView === 'month') {
      const { days } = getMonthGrid(offset)
      startD = days[0]; endD = new Date(days[days.length - 1].getTime() + 86400000)
    } else if (calView === 'year') {
      const y = new Date().getFullYear() + offset
      startD = new Date(y, 0, 1); endD = new Date(y + 1, 0, 1)
    } else if (calView === 'agenda') {
      const ds = getAgendaDays(offset); startD = ds[0]; endD = new Date(ds[ds.length - 1].getTime() + 86400000)
    } else {
      const days = getWeekDays(offset, calView === 'workweek')
      startD = days[0]; endD = new Date(days[days.length - 1].getTime() + 86400000)
    }
    return { startD, endD }
  }, [calView, offset])

  React.useEffect(() => {
    setMsConnected(msAuth.isConnected())
  }, [msAuth])

  React.useEffect(() => {
    if (!msConnected) return
    let cancelled = false
    setOutlookSyncing(true); setOutlookError(null)
    const { startD, endD } = rangeForView()
    msAuth.getToken({}).then((token) => {
      if (!token) throw new Error('Not connected to Microsoft.')
      return fetchCalendarEvents(token, startD.toISOString(), endD.toISOString())
    }).then((evs) => { if (!cancelled) setOutlookEvents(evs) })
      .catch((e) => { if (!cancelled) setOutlookError(e.message) })
      .finally(() => { if (!cancelled) setOutlookSyncing(false) })
    return () => { cancelled = true }
  }, [msConnected, calView, offset, outlookTick]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!isGoogleConnected()) return
    let cancelled = false
    setGoogleSyncing(true); setGoogleError(null)
    const { startD, endD } = rangeForView()
    fetchGoogleCalendarEvents(startD.toISOString(), endD.toISOString())
      .then((evs) => { if (!cancelled) setGoogleEvents(evs) })
      .catch((e) => { if (!cancelled) setGoogleError(e.message) })
      .finally(() => { if (!cancelled) setGoogleSyncing(false) })
    return () => { cancelled = true }
  }, [calView, offset, googleTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const openNewGoogleEvent = (date, time) => {
    setNewGoogleDate(date || today)
    setNewGoogleTime(time || null)
    setNewGoogleOpen(true)
  }

  const handleDeleteEvent = async (id) => {
    const sid = String(id)
    if (sid.startsWith('google-')) {
      try {
        await deleteGoogleCalendarEvent(sid.slice(7))
        setGoogleEvents((evs) => evs.filter((e) => e.id !== sid))
        toast?.('Event deleted from Google Calendar.', 'success')
      } catch {
        toast?.('Failed to delete event.', 'error')
      }
    } else {
      deleteLocalEvent(id)
    }
    setSelectedEvent(null)
  }

// replace the `const allEvents = ...` block with:
  const allEvents = React.useMemo(() => {
    const local = (calendarEvents || []).map((ev) => ({ source: 'local', ...ev }))
    return [...local, ...outlookEvents, ...googleEvents]
  }, [calendarEvents, outlookEvents, googleEvents])

// replace the EventDetailModal's onDelete prop:
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} onOpenPlanner={(ev) => onNavigatePlanner?.(ev)}
          onUpdate={updateLocalEvent} onDelete={handleDeleteEvent} />
      )}

// add NewGoogleEventModal + banners + New event button into the page-head-actions block:
          <MicrosoftCalendarBanner connected={msConnected} syncing={outlookSyncing} error={outlookError} onRefresh={() => setOutlookTick((t) => t + 1)} />
          <GoogleCalendarBanner syncing={googleSyncing} error={googleError} onRefresh={() => setGoogleTick((t) => t + 1)} />
          {isGoogleConnected() && (
            <button className="btn sm ghost" onClick={() => openNewGoogleEvent(today, null)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }} title="New Google Calendar event">
              <Icon name="plus" size={11} /> New event
            </button>
          )}

// add the modal render, alongside the EventDetailModal:
      <NewGoogleEventModal open={newGoogleOpen} defaultDate={newGoogleDate} defaultTime={newGoogleTime}
        onClose={() => setNewGoogleOpen(false)} onCreated={() => setGoogleTick((t) => t + 1)} />

// pass onNewGoogleEvent through to WeekGrid:
          onEventClick={setSelectedEvent} scrollRef={scrollRef} onMoveEvent={moveLocalEvent} onUpdateEvent={updateLocalEvent}
          onNewGoogleEvent={isGoogleConnected() ? openNewGoogleEvent : null} />
```

**Note:** insert these additions at the correct points in the existing Task 5 code — hooks/state declarations go alongside the existing `useState`/`useMemo` calls (before any early return, though `CalendarView` has none), the `allEvents` memo replaces Task 5's version, and the JSX additions go into the already-existing `page-head-actions` div and the `EventDetailModal`/`WeekGrid` render calls. Do not introduce an early return anywhere above these new hooks — `CalendarView` has no `open`/conditional-render gate the way a drawer component does, but keep all hooks unconditional at the top of the function regardless.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npm test -- view-calendar`
Expected: PASS — `19 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/view-calendar.jsx apps/desktop/src/views/view-calendar.test.jsx
git commit -m "feat(desktop): wire Outlook and Google Calendar data into CalendarView"
```

---

## Task 7: Wire into `main.jsx`

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `CalendarView` (Task 6), `createCalendarEvent` from `./ms-graph-calendar.js` (Task 2), `makeDesktopOAuthService` (already imported at `main.jsx:22`).
- Produces: a working `calendar` nav entry; `handleScheduleOneOnOne` now actually creates an Outlook event on desktop (previously a silent no-op).

This task has no isolated automated test (`main.jsx` has no test harness — same situation as the prior create-work-item-drawer plan's `main.jsx` wiring task). It is verified via the full desktop test suite (regression check) and a manual smoke-test checklist.

- [ ] **Step 1: Add imports**

```js
// add near the top of apps/desktop/src/main.jsx, alongside the other local imports (e.g. after the CreateWorkItemDrawer import)
import { CalendarView } from './views/view-calendar.jsx'
import { createCalendarEvent } from './ms-graph-calendar.js'
```

Then remove `OutlookService` from the `@nexusmd/ui` import list at `main.jsx:16` (grep the file first — `grep -n "OutlookService" apps/desktop/src/main.jsx` — to confirm the only remaining reference after Step 3 below is the import line itself before deleting it).

- [ ] **Step 2: Add the NAV entry**

```js
// apps/desktop/src/main.jsx:198-209 — add after 'dashboard', before 'work'
const NAV = [
  { id: 'dashboard',     label: 'Dashboard',     icon: 'dashboard' },
  { id: 'calendar',      label: 'Calendar',      icon: 'clock' },
  { id: 'work',          label: 'Work Items',     icon: 'work' },
  { id: 'prs',           label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',        label: 'Builds',         icon: 'build' },
  { id: 'tests',         label: 'Tests',          icon: 'check' },
  { id: 'team',          label: 'Team',           icon: 'team' },
  { id: 'triage',        label: 'Triage',         icon: 'work' },
  { id: 'planner',       label: 'Planner',        icon: 'planner' },
  { id: 'markdown',      label: 'Notes',          icon: 'pin' },
  { id: 'settings',      label: 'Settings',       icon: 'settings' },
]
```

- [ ] **Step 3: Add `calendarEvents` state and the `calendar` case in `ViewBody`**

Add alongside the existing `usePersistedState` calls at `main.jsx:403-407`:
```js
  const [calendarEvents, setCalendarEvents] = usePersistedState('nexusmd.calendar.events', [])
```

Add a new case in the `switch (view)` block (`main.jsx:463` onward), placed after the `dashboard` case (matches the NAV order from Step 2):
```js
    case 'calendar':
      return (
        <CalendarView
          calendarEvents={calendarEvents}
          setCalendarEvents={setCalendarEvents}
          onNavigatePlanner={() => window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))}
        />
      )
```

- [ ] **Step 4: Fix `handleScheduleOneOnOne`**

Replace the body at `main.jsx:448-461`:
```js
  const handleScheduleOneOnOne = (dev) => {
    const start = new Date()
    start.setHours(10, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 60 * 60000)
    const msAuth = makeDesktopOAuthService('microsoft')
    if (msAuth.isConnected()) {
      msAuth.getToken({}).then((token) => {
        if (!token) return
        return createCalendarEvent(token, {
          title: `1:1 with ${dev.name}`,
          start: start.toISOString().slice(0, 16),
          end: end.toISOString().slice(0, 16),
        })
      }).catch(console.error)
    }
    window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))
  }
```

- [ ] **Step 5: Verify no `OutlookService` reference remains, then run the full suite and build**

```bash
grep -n "OutlookService" apps/desktop/src/main.jsx
```
Expected: no output (confirms Step 1's import removal was safe).

```bash
cd apps/desktop && npm test
```
Expected: all test files pass (existing suite + this plan's new `ms-graph-calendar`, `google-calendar`, `view-calendar` suites).

```bash
cd apps/desktop && npm run build:renderer
```
Expected: succeeds.

- [ ] **Step 6: Manual verification**

Run: `cd apps/desktop && npm run dev`
1. Open the app — confirm a "Calendar" nav item appears (second position, after Dashboard) and clicking it renders the calendar page without errors.
2. Confirm the view switcher (Year/Month/Week/Work Week/Agenda) and Today/prev/next navigation work.
3. If Microsoft is connected in Settings (post-scope-change reconnect), confirm Outlook events load and the Outlook banner shows sync status; if not connected, confirm no errors and no Outlook banner renders.
4. If Google is connected, confirm Google events load, the "New event" button appears, and creating an event via the modal succeeds and the new event appears after a refresh.
5. Create a local event by clicking on the week grid (if `WeekGrid` supports empty-slot click — verify against its actual behavior; if not, skip this specific check) or via drag-reschedule of an existing local event; confirm the change persists across a page reload (`nexusmd.calendar.events` in localStorage).
6. From the Planner, trigger "Schedule 1:1" for a team member with Microsoft connected — confirm an Outlook event is actually created (check the connected Outlook calendar) rather than silently doing nothing.
Expected: all six checks pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Calendar to nav and fix dormant Schedule 1:1 Outlook integration"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (backend scope) → Task 1. Section 2 (Outlook client) → Task 2. Section 3 (Google client) → Task 3. Section 4 (CalendarView orchestrator, incl. banners/modal) → Tasks 4-6. Section 5 (main.jsx wiring, incl. the Schedule 1:1 fix) → Task 7. Section 6 (testing) → each task's own test file.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `fetchCalendarEvents`, `createCalendarEvent`, `fetchGoogleCalendarEvents`, `createGoogleCalendarEvent`, `deleteGoogleCalendarEvent`, `isGoogleConnected`, `MicrosoftCalendarBanner`, `GoogleCalendarBanner`, `NewGoogleEventModal`, `CalendarView` are each defined once and referenced with identical names/signatures across Tasks 2-7.
