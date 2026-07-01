# Desktop Calendar — Design

**Date:** 2026-07-01
**Scope:** `apps/desktop/src/views/view-calendar.jsx` (new), `apps/desktop/src/google-calendar.js` (new), `apps/desktop/src/ms-graph-calendar.js` (new), `apps/desktop/src/main.jsx`, `apps/web/server/Controllers/MicrosoftAuthController.cs`

## Background

The desktop Electron app has no Calendar view. Web (`apps/web/src/view-calendar.jsx`) and mobile (`apps/app/src/views/view-calendar.jsx`) both have one, built on shared primitives in `packages/ui/src/views/view-calendar.jsx` (`WeekGrid`, `MonthView`, `YearView`, `AgendaView`, `EventDetailModal`, `OutlookBanner`, and date-math helpers). Neither existing implementation's auth wiring fits desktop as-is:

- Web/mobile's Outlook integration uses the shared `OutlookService` — an MSAL.js client the user configures with their own Azure app registration (client-side, self-service, via `OutlookBanner`). This is a separate Microsoft sign-in from the one desktop already uses for OneDrive.
- Web's Google Calendar integration proxies through the ASP.NET backend (`/api/google/calendar/events`) because a browser can't call `googleapis.com` directly (CORS). Desktop has no such restriction and already has a working native Google OAuth flow used for Drive/Gmail.
- Desktop's existing Microsoft OAuth (`makeDesktopOAuthService('microsoft')` in `apps/desktop/src/cloud-auth.js`, used today for OneDrive) is a backend-proxied flow, currently scoped to `Files.ReadWrite` only.

This design adds a desktop-native `CalendarView` that reuses the shared UI primitives but sources data through desktop-appropriate auth: the existing native Google token (already scoped for Calendar) and an extended version of the existing Microsoft token (adding Calendar scope).

---

## Section 1 — Backend: extend Microsoft OAuth scope

**File:** `apps/web/server/Controllers/MicrosoftAuthController.cs`

Change the `Scope` constant from:
```csharp
private const string Scope = "openid email offline_access Files.ReadWrite";
```
to:
```csharp
private const string Scope = "openid email offline_access Files.ReadWrite Calendars.ReadWrite";
```

This is the only backend change. It affects all platforms that use this same Microsoft OAuth app (currently just desktop's OneDrive integration). Users who already connected Microsoft on desktop will need to reconnect once to pick up the new scope — the existing "Microsoft" integration card in Settings already has connect/disconnect UI, no new UI needed here.

---

## Section 2 — `ms-graph-calendar.js`: Outlook Calendar client

**New file:** `apps/desktop/src/ms-graph-calendar.js`

Exports two functions, both taking a Bearer token (obtained by the caller via `makeDesktopOAuthService('microsoft').getToken()`) rather than managing auth themselves — this file has zero MSAL dependency, unlike the shared `OutlookService`.

```js
export async function fetchCalendarEvents(token, startISO, endISO) {
  const url = ['https://graph.microsoft.com/v1.0/me/calendarView',
    `?startDateTime=${encodeURIComponent(startISO)}`, `&endDateTime=${encodeURIComponent(endISO)}`,
    '&$select=id,subject,start,end,location,body', '&$top=100', '&$orderby=start/dateTime'].join('')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } })
  if (!res.ok) throw new Error(`Graph calendarView failed: ${res.status}`)
  const data = await res.json()
  const toISO = (s) => (s && !s.endsWith('Z') ? s + 'Z' : s)
  return (data.value || []).map((ev) => ({
    id: `outlook-${ev.id}`, title: ev.subject || '(No title)',
    start: toISO(ev.start?.dateTime), end: toISO(ev.end?.dateTime),
    type: 'meeting', personId: null, personName: null, plannerSection: null,
    description: ev.location?.displayName || '', source: 'outlook',
  }))
}

export async function createCalendarEvent(token, { title, start, end, description = '' }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const body = {
    subject: title,
    start: { dateTime: start.replace('Z', ''), timeZone: tz },
    end:   { dateTime: end.replace('Z', ''),   timeZone: tz },
    body:  { contentType: 'text', content: description },
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Graph createEvent failed: ${res.status}`)
  return res.json()
}
```

This is a deliberate near-duplicate of `OutlookService`'s internal `fetchWeekEvents`/`createEvent` logic (same Graph endpoints, same event-shape mapping) — the duplication is the seam between "MSAL manages its own token" (web/mobile) and "desktop already has a token from a different OAuth flow" (desktop). Keeping them separate avoids modifying the shared `OutlookService` to support an injectable-token mode it doesn't otherwise need.

---

## Section 3 — `google-calendar.js`: Google Calendar client

**New file:** `apps/desktop/src/google-calendar.js`

```js
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
    id: `google-${ev.id}`, title: ev.summary || '(No title)',
    start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date,
    type: 'meeting', source: 'google', description: ev.location || '',
    personName: null, personId: null, plannerSection: null,
  }))
}

export async function createGoogleCalendarEvent({ title, start, end, description = '' }) {
  const token = await googleAuth.getToken({})
  if (!token) throw new Error('Not connected to Google.')
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, description, start: { dateTime: start }, end: { dateTime: end } }),
  })
  if (!res.ok) throw new Error(`Google Calendar create failed: ${res.status}`)
  return res.json()
}

export async function deleteGoogleCalendarEvent(eventId) {
  const token = await googleAuth.getToken({})
  if (!token) throw new Error('Not connected to Google.')
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 410) throw new Error(`Google Calendar delete failed: ${res.status}`)
}

export function isGoogleConnected() {
  return googleAuth.isConnected()
}
```

`makeNativeGoogleBinding()` is already exported from `cloud-auth.js` (Section: existing code, unchanged) and already grants the `calendar` scope alongside Drive/Gmail (see `apps/desktop/electron/oauth/config.cjs`'s scopes list) — no new OAuth wiring needed for Google.

---

## Section 4 — `apps/desktop/src/views/view-calendar.jsx`: the CalendarView orchestrator

Mirrors `apps/web/src/view-calendar.jsx`'s `CalendarView` structure and behavior (view switcher: Year/Month/Week/Work Week/Agenda; offset navigation; event-by-day map; header title; drag-to-reschedule via `onMoveEvent`), with these substitutions:

- Outlook data: instead of `OutlookService.init`/`fetchWeekEvents`, use `makeDesktopOAuthService('microsoft')` for connection state/token and `fetchCalendarEvents`/`createCalendarEvent` from `ms-graph-calendar.js`.
- Google data: instead of the web's `/api/google/calendar/events` fetch + `GoogleAuth` import, use `fetchGoogleCalendarEvents`/`createGoogleCalendarEvent`/`deleteGoogleCalendarEvent`/`isGoogleConnected` from `google-calendar.js`.
- Local events: `usePersistedState('nexusmd.calendar.events', [])` (desktop's existing local-storage-backed state helper already defined in `main.jsx`, passed down as a prop) instead of web's `usePersisted`.
- No `OutlookBanner`/Azure-app-setup UI: connection status/connect/disconnect for Microsoft is surfaced via the existing Settings "Microsoft" integration card (Section 1's scope change applies there) — the calendar page header shows a simple connected/disconnected indicator + "Connect in Settings" link instead of the web's inline MSAL setup form. A small `MicrosoftCalendarBanner` (analogous to web's `GoogleCalendarBanner`) shows sync status and a refresh button, reusing the connection state from `makeDesktopOAuthService('microsoft')`.
- Google connection banner: same simple status/refresh pattern (`isGoogleConnected()`), pointing users to the existing Google integration in Settings rather than a separate calendar-specific connect flow.
- "New event" button: matches web exactly — visible only when Google is connected, opens a `NewGoogleEventModal` (same fields as web's: title, date, start time, duration, description) that calls `createGoogleCalendarEvent`. No equivalent button for Outlook or local events on this page, matching web's current calendar-page feature set (Outlook event creation only happens via the Planner's "Schedule 1:1" action, per Section 5).

Component signature: `CalendarView({ calendarEvents, setCalendarEvents, onNavigatePlanner })` — `calendarEvents`/`setCalendarEvents` passed down from `main.jsx`'s `usePersistedState('nexusmd.calendar.events', [])`, matching how other views already receive their persisted state from `App`. Unlike web's `CalendarView` (which receives `onUpdateEvent`/`onDeleteEvent`/`onMoveEvent` as external callback props from `app.jsx`), desktop's version implements local-event update/move/delete internally using `setCalendarEvents` directly — there's no equivalent external handler layer in `main.jsx` to thread through, and the logic is a straightforward array update in all three cases. Outlook/Google event updates via drag-to-reschedule are out of scope (matches web: `onMoveEvent` there only ever mutates `calendarEvents`, i.e. local events — dragging a Google/Outlook event chip has no effect in either implementation).

---

## Section 5 — Wiring into `main.jsx`

- Add to `NAV` (after `dashboard`, before `work`): `{ id: 'calendar', label: 'Calendar', icon: 'calendar' }`.
- Add `import { CalendarView } from './views/view-calendar.jsx'` and a `case 'calendar':` in `ViewBody`'s switch, passing `calendarEvents`/`setCalendarEvents` (new `usePersistedState('nexusmd.calendar.events', [])` in `App`, threaded through `ViewBody` the same way `plannerData`/`localItems` already are) and `onNavigatePlanner={() => window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))}` (matches the existing navigation-event pattern used elsewhere in `main.jsx`).
- Rewire `handleScheduleOneOnOne` (currently calls `OutlookService.createEvent`/`isConnected()`, both permanently inert on desktop since `OutlookService.init` is never called): replace with `makeDesktopOAuthService('microsoft').isConnected()` + `createCalendarEvent` from `ms-graph-calendar.js`, using a token from `makeDesktopOAuthService('microsoft').getToken()`. This makes that existing planner action actually create an Outlook event on desktop for the first time.
- Remove the now-unused `OutlookService` import from `main.jsx` if nothing else in the file references it after this change (grep to confirm before removing).

`packages/ui/src/icons.jsx`'s registered icon set has no `'calendar'` glyph; use `NAV`'s existing `'clock'` icon for the Calendar entry rather than adding a new glyph (out of scope — see Out of Scope below).

---

## Section 6 — Testing

- `apps/desktop/src/ms-graph-calendar.test.js` — unit tests for `fetchCalendarEvents`/`createCalendarEvent` with mocked `global.fetch`, following the same convention as `ado-workitem-types.test.js` (success case, non-ok response throws, event-shape mapping).
- `apps/desktop/src/google-calendar.test.js` — same pattern for the three Google functions, mocking `makeNativeGoogleBinding`'s `getToken`/`isConnected`.
- `apps/desktop/src/views/view-calendar.test.jsx` — component tests with `@testing-library/react`: view switching (Week/Month/Year/Agenda) renders the right shared component, event-by-day mapping combines local + mocked Outlook + mocked Google events correctly, "New event" modal stages and calls the right create function based on selected destination.

---

## Out of scope

- Adding a new `'calendar'` icon glyph to `packages/ui`'s icon set if one doesn't already exist — reuse an existing icon.
- Changing web/mobile's existing Outlook (MSAL) or Google Calendar implementations — this design only adds desktop's own, without touching the shared `OutlookService` or web's server-proxied Google flow.
- Recurring-event editing/exceptions, meeting invites/attendees, or any Graph/Google Calendar feature beyond view + create + delete (matching web's current feature set, not exceeding it).
