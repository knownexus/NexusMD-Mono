import { slugify, adoTypeToHelm, timeAgo } from '../ado/helpers.js'
import { isDoneItem } from './classify.js'
import { deriveActivity } from '../ado/derive.js'

export const PROVIDER_LABELS = { ado: 'Azure DevOps', jira: 'Jira', github: 'GitHub' }

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
export function mergeTeam(adoTeam = [], jiraPeople = [], jiraItems = [], jiraMe = null, githubPeople = [], githubMe = null) {
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
  // GitHub logins: a login equal to an existing member's name is that member.
  const ghLogins = [...githubPeople.map(p => ({ login: p.login, avatarUrl: p.avatarUrl })), githubMe?.login ? { login: githubMe.login, avatarUrl: githubMe.avatarUrl } : null]
  for (const p of ghLogins) {
    if (!p?.login) continue
    const key = p.login.toLowerCase()
    const existing = byName.get(key)
    if (existing) { existing.githubLogin = p.login; continue }
    const member = {
      id: slugify(p.login) || `github-${p.login}`,
      name: p.login, displayName: p.login, initials: initialsOf(p.login),
      role: 'Developer', tz: 'UTC', focus: '',
      githubLogin: p.login, avatarUrl: p.avatarUrl || '', source: 'github',
    }
    team.push(member)
    byName.set(key, member)
  }
  return team
}

function githubWarningDetail(errors = []) {
  if (!errors.length) return null
  return errors.map(e => `${e.repo}: ${e.message}`).join('; ')
}

// Per-member workload over the merged items (the ADO loader computes these from ADO
// items only, so Jira-only work would show as 0). Same rules and format as there.
function withWorkload(team, items) {
  return team.map(member => {
    const assigned = items.filter(w => w.assignee === member.id && !isDoneItem(w))
    const latest = assigned.reduce((best, w) => (!best || (w.changedMs && w.changedMs > (best.changedMs || 0))) ? w : best, null)
    return {
      ...member,
      assignedCount: assigned.length,
      lastActiveAgo: latest?.changedMs ? timeAgo(new Date(latest.changedMs).toISOString()) : '—',
    }
  })
}

export function mergeWorkItemData({ ado = null, jira = null, github = null, status = {}, configured = {} } = {}) {
  const adoItems = (ado?.WORK_ITEMS || []).map(w => ({
    ...w, source: 'ado', displayId: `#${w.id}`, stateCategory: w.stateCategory ?? w.adoStateCategory ?? null,
  }))
  const jiraItems = jira?.WORK_ITEMS || []

  const githubItems = github?.WORK_ITEMS || []

  const providers = ['ado', 'jira', 'github'].filter(id => configured[id]).map(id => {
    const s = status[id] || {}
    const hasData = id === 'ado' ? !!ado : id === 'jira' ? !!jira : !!github
    const state = s.status === 'error' ? (hasData ? 'stale' : 'error') : (hasData ? 'ok' : 'loading')
    const warning = id === 'jira'
      ? (jira?.BOARD_ERROR ? 'Jira board unavailable — using status columns' : null)
      : id === 'github' ? (github?.PR_ERROR || null) : (ado?.PR_ERROR || null)
    const warningDetail = id === 'ado' && warning ? (ado?.PR_ERROR_DETAIL || null)
      : id === 'github' ? githubWarningDetail(github?.REPO_ERRORS) : null
    return { id, label: PROVIDER_LABELS[id], status: state, error: s.status === 'error' ? (s.error || null) : null, warning, warningDetail }
  })

  const allItems = [...adoItems, ...jiraItems, ...githubItems]

  return {
    WORK_ITEMS: allItems,
    WORK_ITEMS_BY_SOURCE: { ado: adoItems, jira: jiraItems, github: githubItems },
    ACTIVITY: deriveActivity(allItems),
    PROJECTS: [...(ado?.PROJECTS || []), ...(jira?.PROJECTS || []), ...(github?.PROJECTS || [])],
    TEAM: withWorkload(mergeTeam(ado?.TEAM || [], jira?.PEOPLE || [], jiraItems, jira?.ME || null, github?.PEOPLE || [], github?.ME || null), allItems),
    STATES: union(ado?.STATES || [], jira?.STATES || [], github?.STATES || []),
    TYPES: union(ado?.TYPES || [], jira?.TYPES || [], github?.TYPES || []),
    WI_TYPE_STATES: mergeTypeStates(mergeTypeStates(ado?.WI_TYPE_STATES, jira?.WI_TYPE_STATES), github?.WI_TYPE_STATES),
    WI_TYPE_STATES_BY_SOURCE: {
      ado: slugKeyed(ado?.WI_TYPE_STATES, adoTypeToHelm),
      jira: slugKeyed(jira?.WI_TYPE_STATES, t => slugify(t) || 'task'),
      github: slugKeyed(github?.WI_TYPE_STATES, t => slugify(t) || 'issue'),
    },
    STATE_CATEGORIES_BY_SOURCE: {
      ado: ado?._adoMeta?.stateCategoryByName || {},
      jira: jira?._jiraMeta?.stateCategoryByName || {},
      github: { Open: 'InProgress', Closed: 'Completed' },
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
