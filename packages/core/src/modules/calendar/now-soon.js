// now-soon.js — which badge a calendar event gets: 'now' while it is on, 'soon' when it starts within
// the soon window, otherwise null. Shared by the phone and desktop calendars.
//
// Event shape (the same on both): `start` and optional `end` are ISO strings (local 'YYYY-MM-DDTHH:mm'
// or full ISO). An all-day event has a date-only `start` (10 characters) and never gets a badge.
// An event with no `end` is taken to last one hour.
export const SOON_MINUTES = 30
const DEFAULT_LENGTH_MS = 3600000

export function eventBadge(event, now = Date.now(), soonMinutes = SOON_MINUTES) {
  if (typeof event?.start === 'string' && event.start.length === 10) return null
  const s = new Date(event?.start).getTime()
  if (Number.isNaN(s)) return null
  const e = event.end ? new Date(event.end).getTime() : s + DEFAULT_LENGTH_MS
  if (now >= s && now < e) return 'now'
  if (s > now && s - now <= soonMinutes * 60000) return 'soon'
  return null
}
