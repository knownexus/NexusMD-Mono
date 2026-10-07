import { slugify, adoTypeToHelm } from '../ado/helpers.js'
import { deriveActivity } from '../ado/derive.js'

export const PROVIDER_LABELS = { ado: 'Azure DevOps', jira: 'Jira' }

const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?'
const union = (...lists) => Array.from(new Set(lists.flat().filter(Boolean)))

function slugKeyed(typeStates = {}, toSlug) {
  const out = {}
  for (const [type, states] of Object.entries(typeStates || {})) {
    const k = toSlug(type)
    out[k] = union(out[k] || [], states)
  }
  return out
}

function mergeTypeStates(a = {}, b = {}) {
  const out = { ...(a || {}) }
  for (const [type, states] of Object.entries(b || {})) out[type] = union(out[type] || [], states)
  return out
}

// Same display name in both providers → one member (ADO member ids are already
// slugify(name), as are Jira item assignees). Only Jira-only people who have Jira
// work loaded (or are "me") are added, so the team list isn't flooded with every
// assignable user on the site.
export function mergeTeam(adoTeam = [], jiraPeople = [], jiraItems = [], jiraMe = null) {
  const team = adoTeam.map(m => ({ ...m }))
  const byName = new Map(team.map(m => [String(m.name || '').toLowerCase(), m]))
  const relevant = new Set(jiraItems.map(w => w.assigneeAccountId).filter(Boolean))
  if (jiraMe?.accountId) relevant.add(jiraMe.accountId)
  for (const p of jiraPeople) {
    const existing = byName.get(p.displayName.toLowerCase())
    if (existing) { existing.jiraAccountId = p.accountId; continue }
    if (!relevant.has(p.accountId)) continue
    const member = {
      id: slugify(p.displayName) || `jira-${p.accountId}`,
      name: p.displayName, displayName: p.displayName, initials: initialsOf(p.displayName),
      role: 'Developer', tz: 'UTC', focus: '',
      jiraAccountId: p.accountId, avatarUrl: p.avatarUrl, source: 'jira',
    }
    team.push(member)
    byName.set(p.displayName.toLowerCase(), member)
  }
  return team
}

export function mergeWorkItemData({ ado = null, jira = null, status = {}, configured = {} } = {}) {
  const adoItems = (ado?.WORK_ITEMS || []).map(w => ({
    ...w, source: 'ado', displayId: `#${w.id}`, stateCategory: w.stateCategory ?? w.adoStateCategory ?? null,
  }))
  const jiraItems = jira?.WORK_ITEMS || []

  const providers = ['ado', 'jira'].filter(id => configured[id]).map(id => {
    const s = status[id] || {}
    const hasData = id === 'ado' ? !!ado : !!jira
    const state = s.status === 'error' ? (hasData ? 'stale' : 'error') : (hasData ? 'ok' : 'loading')
    const warning = id === 'jira'
      ? (jira?.BOARD_ERROR ? 'Jira board unavailable — using status columns' : null)
      : (ado?.PR_ERROR || null)
    return { id, label: PROVIDER_LABELS[id], status: state, error: s.status === 'error' ? (s.error || null) : null, warning }
  })

  return {
    WORK_ITEMS: [...adoItems, ...jiraItems],
    WORK_ITEMS_BY_SOURCE: { ado: adoItems, jira: jiraItems },
    ACTIVITY: deriveActivity([...adoItems, ...jiraItems]),
    PROJECTS: [...(ado?.PROJECTS || []), ...(jira?.PROJECTS || [])],
    TEAM: mergeTeam(ado?.TEAM || [], jira?.PEOPLE || [], jiraItems, jira?.ME || null),
    STATES: union(ado?.STATES || [], jira?.STATES || []),
    TYPES: union(ado?.TYPES || [], jira?.TYPES || []),
    WI_TYPE_STATES: mergeTypeStates(ado?.WI_TYPE_STATES, jira?.WI_TYPE_STATES),
    WI_TYPE_STATES_BY_SOURCE: {
      ado: slugKeyed(ado?.WI_TYPE_STATES, adoTypeToHelm),
      jira: slugKeyed(jira?.WI_TYPE_STATES, t => slugify(t) || 'task'),
    },
    STATE_CATEGORIES_BY_SOURCE: {
      ado: ado?._adoMeta?.stateCategoryByName || {},
      jira: jira?._jiraMeta?.stateCategoryByName || {},
    },
    PRIORITIES_BY_SOURCE: { ado: ado?.PRIORITIES || [], jira: jira?.PRIORITIES || [] },
    RESOLVED_WI: [...(ado?.RESOLVED_WI || []), ...(jira?.RESOLVED_WI || [])]
      .sort((a, b) => new Date(b.closedDate || 0) - new Date(a.closedDate || 0))
      .slice(0, 15),
    WORK_ITEM_PROVIDERS: providers,
    JIRA_SITE: jira?.SITE || '',
    JIRA_PEOPLE: jira?.PEOPLE || [],
    JIRA_BOARD_COLUMNS: jira?.BOARD_COLUMNS || null,
    JIRA_BOARD_ERROR: jira?.BOARD_ERROR || null,
  }
}
