export const PROJECT_COLORS = [
  'oklch(0.62 0.13 230)', 'oklch(0.58 0.18 295)', 'oklch(0.62 0.14 150)',
  'oklch(0.6 0.18 25)',  'oklch(0.72 0.14 70)',  'oklch(0.65 0.15 180)', 'oklch(0.6 0.16 320)',
]

export const STATES = [
  'Backlog', 'To Do', 'Active', 'In Progress', 'In Review',
  'Blocked', 'Resolved', 'Done', 'Closed',
]

export function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 60) return m + 'm'
  if (h < 24) return h + 'h'
  return d + 'd'
}

// Absolute timestamp formatted as "HH:MM DD/MM/YY" (24-hour, local time).
// Returns an em-dash for null/unparseable input, matching timeAgo's placeholder.
export function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)}`
}

export function adoTypeToHelm(t) {
  const s = (t || '').toLowerCase()
  if (s === 'bug')        return 'bug'
  if (s === 'task')       return 'task'
  if (s === 'user story') return 'story'
  if (s === 'feature')    return 'feature'
  if (s === 'epic')       return 'epic'
  if (s === 'spike')      return 'spike'
  return (t && slugify(t)) || 'task'
}

export function adoStateToHelm(s) {
  const st = (s || '').toLowerCase()
  if (st === 'active' || st === 'in progress')             return 'In Progress'
  if (st === 'in review')                                  return 'In Review'
  if (st === 'resolved' || st === 'closed' || st === 'done') return 'Done'
  if (st === 'blocked')                                    return 'Blocked'
  if (st === 'new' || st === 'to do')                      return 'To Do'
  if (st === 'backlog')                                    return 'Backlog'
  return s || 'To Do'
}

export const isTerminalState = (s, adoCategory) => {
  if (adoCategory) return adoCategory === 'Resolved' || adoCategory === 'Completed' || adoCategory === 'Removed'
  return /^(done|closed|resolved|completed|removed)$/i.test(s || '')
}
export const isActiveState   = s => /^(active|in progress|in testing|specced|assigned)$/i.test(s || '')
export const isReviewState   = s => /^(in review|needs review|review|pull request|pr)$/i.test(s || '')
export const isBlockedState  = s => /^(blocked)$/i.test(s || '')
export const stateCategory   = (s, adoCategory) => {
  if (adoCategory === 'Completed' || adoCategory === 'Resolved' || adoCategory === 'Removed') return 'done'
  if (adoCategory === 'InProgress') return 'active'
  if (adoCategory === 'Proposed')   return 'todo'
  if (isTerminalState(s)) return 'done'
  if (isActiveState(s))   return 'active'
  if (isReviewState(s))   return 'review'
  if (isBlockedState(s))  return 'blocked'
  return 'todo'
}
