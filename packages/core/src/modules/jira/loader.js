import { core } from '../../core.js'
import { PROJECT_COLORS } from '../ado/helpers.js'
import { makeJiraClient } from './client.js'
import { fetchJiraMetadata, fillMetadataFromIssues } from './metadata.js'
import { mapJiraIssue, mapResolvedJiraIssue } from './mappers.js'

export const JIRA_CACHE_KEY = 'nexusmd.jira.cache.v1'
export const JIRA_BASE_FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'priority', 'labels', 'components', 'project', 'updated', 'created']
const RESOLVED_FIELDS = ['summary', 'issuetype', 'status', 'created', 'resolutiondate']
const MAX_ACTIVE = 500
const MAX_RESOLVED = 100

const quoteKey = (k) => `"${String(k).replace(/"/g, '\\"')}"`
const scope = (keys) => `project in (${keys.map(quoteKey).join(', ')})`
const extra = (jql) => (String(jql || '').trim() ? ` AND (${String(jql).trim()})` : '')

export function buildActiveJql(projectKeys, extraJql = '') {
  return `${scope(projectKeys)} AND statusCategory != Done${extra(extraJql)} ORDER BY updated DESC`
}

export function buildResolvedJql(projectKeys, extraJql = '') {
  return `${scope(projectKeys)} AND statusCategory = Done AND resolved >= -14d${extra(extraJql)} ORDER BY resolved DESC`
}

export async function searchAllIssues(client, jql, fields, max) {
  const out = []
  let nextPageToken
  do {
    const page = await client.post('rest/api/3/search/jql', {
      jql, fields, maxResults: Math.min(100, max - out.length),
      ...(nextPageToken ? { nextPageToken } : {}),
    })
    out.push(...(page?.issues || []))
    nextPageToken = page?.nextPageToken
  } while (nextPageToken && out.length < max)
  return out.slice(0, max)
}

export function loadCachedJiraData(config, { storage }) {
  try {
    const raw = storage.get(JIRA_CACHE_KEY)
    if (!raw) return null
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!c || !Array.isArray(c.WORK_ITEMS)) return null
    if (c.SITE && config?.site && c.SITE !== config.site) return null
    return c
  } catch (_) { return null }
}

// Colours count down from the end of the palette so they rarely clash with ADO
// projects, whose colours count up from the start.
function deriveJiraProjects(items) {
  const seen = new Map()
  items.forEach(w => { if (!seen.has(w.project)) seen.set(w.project, { key: w.projectKey, name: w.projectName }) })
  const n = PROJECT_COLORS.length
  return Array.from(seen.entries()).map(([id, p], i) => ({
    id, name: p.name, key: p.key, source: 'jira', color: PROJECT_COLORS[n - 1 - (i % n)],
  }))
}

// A refresh reuses the cached metadata only while it still describes the configured
// projects and is complete; otherwise new projects, people or priorities would never
// be picked up. `projectKeys` is already sorted.
function canReuseMeta(isRefresh, priorData, projectKeys) {
  const meta = priorData?._jiraMeta
  if (!isRefresh || !meta) return false
  const prior = Array.isArray(priorData.PROJECT_KEYS) ? [...priorData.PROJECT_KEYS].sort() : null
  if (!prior || prior.length !== projectKeys.length || prior.some((k, i) => k !== projectKeys[i])) return false
  return !!(meta.people?.length && meta.priorities?.length)
}

export async function loadJiraData(config, { http, storage, sleep } = {}, { isRefresh = false, priorData = null } = {}) {
  if (!config?.site) throw new Error('loadJiraData: config.site is required')
  if (!http) throw new Error('loadJiraData: http adapter is required')

  const client = makeJiraClient(http, sleep ? { sleep } : undefined)
  const keys = config.projectKeys || []
  const projectKeys = [...keys].sort()

  let meta = canReuseMeta(isRefresh, priorData, projectKeys) ? priorData._jiraMeta : await fetchJiraMetadata(client, keys)
  const fields = [...JIRA_BASE_FIELDS, ...Object.values(meta.fieldIds || {}).filter(Boolean)]

  const [active, resolved] = await Promise.all([
    searchAllIssues(client, buildActiveJql(keys, config.jql), fields, MAX_ACTIVE),
    searchAllIssues(client, buildResolvedJql(keys, config.jql), RESOLVED_FIELDS, MAX_RESOLVED).catch(() => []),
  ])

  meta = fillMetadataFromIssues(meta, active)
  const items = []
  active.forEach(issue => { try { items.push(mapJiraIssue(issue, { meta })) } catch (_) {} })

  const data = {
    SITE: config.site,
    PROJECT_KEYS: projectKeys,
    WORK_ITEMS: items,
    PROJECTS: deriveJiraProjects(items),
    TYPES: meta.types,
    STATES: meta.states,
    WI_TYPE_STATES: meta.typeStates,
    PRIORITIES: meta.priorities,
    PEOPLE: meta.people,
    ME: meta.me,
    RESOLVED_WI: resolved.map(mapResolvedJiraIssue),
    loadedAt: Date.now(),
    _jiraMeta: meta,
  }

  if (storage) {
    try { storage.set(JIRA_CACHE_KEY, data) } catch (_) {}
  }
  core._emit(isRefresh ? 'jira:updated' : 'jira:loaded', data)
  return data
}
