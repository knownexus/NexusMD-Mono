// planner/dates.js — pure date + status helpers for the Planner v2 UI.
//
// Extracted verbatim from the duplicated planner-ui.jsx copies (App + Web). These
// are platform-agnostic value functions; the React chips that consume them live in
// @nexusmd/ui. All dates are 'YYYY-MM-DD' strings in local time.

export const PL_STATUSES = ['', 'To Do', 'In Progress', 'Blocked', 'Done', 'Deferred']
export const PL_PRIOS    = ['', '1 - Critical', '2 - High', '3 - Medium', '4 - Low']

/** A planner item is "open" unless it's Done or Deferred. */
export const PL_OPEN = (s) => s !== 'Done' && s !== 'Deferred'

/** Today at local midnight. */
export function plTodayDate() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Parse a 'YYYY-MM-DD' string to a local Date, or null if malformed. */
export function plParseYmd(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Format a Date as 'YYYY-MM-DD' (local). */
export function plFmtYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** True when `due` is before today AND the item is still open. */
export function plIsOverdueYmd(due, status) {
  const d = plParseYmd(due)
  return !!d && PL_OPEN(status || '') && d < plTodayDate()
}

/** True when `due` is today. */
export function plIsTodayYmd(due) {
  const d = plParseYmd(due)
  return !!d && d.toDateString() === plTodayDate().toDateString()
}

/**
 * Parse a quick-add due token ("today", "tmw", "fri", "12/03", "2026-01-15")
 * into a 'YYYY-MM-DD' string, or null if unrecognised.
 */
export function qaParseDue(token) {
  const t = String(token || '').toLowerCase()
  const base = plTodayDate()
  if (t === 'today') return plFmtYmd(base)
  if (t === 'tomorrow' || t === 'tmw') { base.setDate(base.getDate() + 1); return plFmtYmd(base) }
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const di = days.findIndex((d) => t.startsWith(d))
  if (di >= 0) {
    const cur = base.getDay()
    let delta = (di - cur + 7) % 7
    if (delta === 0) delta = 7
    base.setDate(base.getDate() + delta)
    return plFmtYmd(base)
  }
  const m = t.match(/^(\d{1,2})[/.](\d{1,2})$/)
  if (m) return `${base.getFullYear()}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  return null
}
