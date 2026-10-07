import { slugify } from '../ado/helpers.js'

// Hide people (e.g. leavers) from NexusMD only: drop them from the rosters and show
// their work items as Unassigned (and drop their Recent activity). TEAM_ALL keeps
// the full roster so the Team view can still offer a restore.
export function applyHiddenPeople(data, hiddenIds) {
  const hidden = new Set(hiddenIds || [])
  if (!hidden.size || !data) return data
  const out = { ...data }
  if (Array.isArray(data.TEAM)) {
    out.TEAM = data.TEAM.filter(m => !hidden.has(m.id))
    out.TEAM_ALL = data.TEAM
  }
  if (Array.isArray(data.JIRA_PEOPLE)) {
    const hiddenNames = new Set((data.TEAM || []).filter(m => hidden.has(m.id)).map(m => String(m.name || '').toLowerCase()))
    out.JIRA_PEOPLE = data.JIRA_PEOPLE.filter(p =>
      !hidden.has(slugify(p.displayName)) && !hiddenNames.has(String(p.displayName || '').toLowerCase()))
  }
  if (Array.isArray(data.WORK_ITEMS)) {
    out.WORK_ITEMS = data.WORK_ITEMS.map(w =>
      hidden.has(w.assignee) ? { ...w, assignee: null, assigneeAccountId: null } : w)
  }
  if (Array.isArray(data.ACTIVITY)) {
    out.ACTIVITY = data.ACTIVITY.filter(a => !hidden.has(a.who))
  }
  return out
}
