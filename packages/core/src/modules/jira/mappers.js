// packages/core/src/modules/jira/mappers.js — Jira issue → the internal work-item
// model produced by ado/mappers.js mapWorkItem, plus Jira-specific extras.
import { slugify, timeAgo } from '../ado/helpers.js'
import { toJiraId } from '../workitems/ids.js'
import { categoryOfJiraStatus } from './metadata.js'

export function pickSprint(sprints) {
  if (!Array.isArray(sprints) || sprints.length === 0) return null
  return sprints.find(s => s.state === 'active') || sprints[sprints.length - 1]
}

const projectKeyOf = (issue) => issue.fields?.project?.key || String(issue.key || '').split('-')[0]

export function mapJiraIssue(issue, { meta = {}, nameToId = {} } = {}) {
  const f = issue.fields || {}
  const fieldIds = meta.fieldIds || {}
  const statusName = f.status?.name || ''
  const assigneeName = f.assignee?.displayName || null
  const prio = (meta.priorities || []).find(p => p.name === f.priority?.name)
  const sprint = fieldIds.sprint ? pickSprint(f[fieldIds.sprint]) : null
  const points = fieldIds.storyPoints ? f[fieldIds.storyPoints] : null
  const flaggedValue = fieldIds.flagged ? f[fieldIds.flagged] : null
  const changed = f.updated || ''
  const projectKey = projectKeyOf(issue)
  return {
    id: toJiraId(issue.key),
    displayId: issue.key,
    key: issue.key,
    source: 'jira',
    type: f.issuetype?.name ? slugify(f.issuetype.name) : 'task',
    typeName: f.issuetype?.name || 'Task',
    title: f.summary || '',
    project: slugify(projectKey),
    projectKey,
    projectName: f.project?.name || projectKey,
    state: statusName,
    stateCategory: meta.stateCategoryByName?.[statusName] || categoryOfJiraStatus(f.status),
    assignee: assigneeName ? (nameToId[assigneeName] || slugify(assigneeName)) : null,
    assigneeAccountId: f.assignee?.accountId || null,
    priority: prio ? prio.rank : 3,
    priorityName: f.priority?.name || null,
    points: Math.round(parseFloat(points || 0) || 0),
    flagged: Array.isArray(flaggedValue) && flaggedValue.length > 0,
    tags: Array.isArray(f.labels) ? f.labels : [],
    updated: timeAgo(changed),
    changedMs: changed ? new Date(changed).getTime() : null,
    sprint: sprint?.state === 'active',
    iterationPath: sprint?.name || '',
    areaPath: (f.components || []).map(c => c.name).join(', '),
    area: '',
    comments: 0,
    prs: 0,
    isNew: changed ? (Date.now() - new Date(changed).getTime()) < 86_400_000 : false,
  }
}

export function mapResolvedJiraIssue(issue) {
  const f = issue.fields || {}
  return {
    id: toJiraId(issue.key),
    title: f.summary || '',
    type: f.issuetype?.name || '',
    state: f.status?.name || '',
    createdDate: f.created || null,
    closedDate: f.resolutiondate || null,
  }
}
