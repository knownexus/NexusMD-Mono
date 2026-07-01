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
