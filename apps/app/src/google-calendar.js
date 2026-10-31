// google-calendar.js — read-only Google Calendar events for the app calendar.
// The server (/api/google/calendar/events) takes the Google access token and a
// start/end date and returns [{ id, title, start, end, location }]. A 401 means the
// token expired, so retry once with a refreshed one.
import { getOAuthToken } from './cloud-auth.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'
const day = (d) => d.toISOString().slice(0, 10)

export function toCalendarEvent(e) {
  return {
    id: `google-${e.id}`, title: e.title || '(No title)', start: e.start, end: e.end,
    type: 'meeting', source: 'google', description: e.location || '',
    personName: null, personId: null, plannerSection: null,
  }
}

export async function fetchGoogleEvents(startD, endD, { token = getOAuthToken, fetchFn = fetch } = {}) {
  const call = async (force) => {
    const t = await token('google', { force })
    if (!t) return { status: 401 }
    const url = `${API_BASE}/api/google/calendar/events?token=${encodeURIComponent(t)}&start=${day(startD)}&end=${day(endD)}`
    return fetchFn(url, { signal: AbortSignal.timeout(12_000) })
  }
  let res = await call(false)
  if (res.status === 401) res = await call(true)
  if (!res.ok) {
    let msg = res.status
    try { msg = (await res.json())?.error || msg } catch {}
    throw new Error(String(msg))
  }
  return (await res.json()).map(toCalendarEvent)
}
