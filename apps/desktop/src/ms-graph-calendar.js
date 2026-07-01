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

// Formats a Date using its local wall-clock components (not UTC). Used to build
// Graph event start/end strings that pair correctly with the local IANA timeZone
// createCalendarEvent attaches below — unlike `date.toISOString()`, which is
// always UTC and would silently shift the event by the caller's UTC offset.
export function toLocalDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
