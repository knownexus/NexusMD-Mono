// google-calendar.js — read-only Google Calendar events for the app calendar, fetched straight from Google's
// Calendar API with the signed-in token (no server of ours). A 401 means the token expired, so retry once with a
// refreshed one.
import { getOAuthToken } from './cloud-auth.js'

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

// A Google event (timed events carry start.dateTime, all-day ones start.date, which is a 10-character day the
// calendar already treats as all-day) -> the calendar's event shape.
export function toCalendarEvent(e) {
  return {
    id: `google-${e.id}`, title: e.summary || '(No title)',
    start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
    type: 'meeting', source: 'google', description: e.location || '',
    personName: null, personId: null, plannerSection: null,
  }
}

export async function fetchGoogleEvents(startD, endD, { token = getOAuthToken, fetchFn = fetch } = {}) {
  const url = `${EVENTS_URL}?${new URLSearchParams({
    timeMin: startD.toISOString(), timeMax: endD.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  })}`
  const call = async (force) => {
    const t = await token('google', { force })
    if (!t) return { status: 401 }
    return fetchFn(url, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(12_000) })
  }
  let res = await call(false)
  if (res.status === 401) res = await call(true)
  if (!res.ok) {
    let msg = res.status
    try { msg = (await res.json())?.error?.message || msg } catch {}
    throw new Error(String(msg))
  }
  return ((await res.json()).items || []).filter(e => e.status !== 'cancelled').map(toCalendarEvent)
}
