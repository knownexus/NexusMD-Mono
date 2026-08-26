import { slugify, timeAgo, adoTypeToHelm } from './helpers.js'

export function mapWorkItem(wi, nameToId = {}, stateCategoryByName = {}) {
  const f = wi.fields || wi
  const id        = wi.id || f['System.Id']
  const title     = f['System.Title']              || f.title      || ''
  const wiType    = f['System.WorkItemType']        || f.type       || 'Task'
  const state     = f['System.State']              || f.state      || ''
  const priorityRaw = parseInt(f['Microsoft.VSTS.Common.Priority'] ?? f.priority, 10)
  const priority  = Number.isFinite(priorityRaw) ? priorityRaw : 3
  const assignedTo = f['System.AssignedTo'] || f.assignedTo
  const tags      = (f['System.Tags'] || f.tags || '').split(';').map(t => t.trim()).filter(Boolean)
  const changed   = f['System.ChangedDate'] || f.changedDate || ''
  const iterPath  = f['System.IterationPath'] || f.iterationPath || ''
  const areaPath  = f['System.AreaPath']     || f.areaPath     || ''
  const area      = f['Custom.Area']         || f.area         || ''
  const projSlug  = slugify(areaPath.replace(/\//g, '\\').split('\\')[0] || 'default')
  const assigneeName = typeof assignedTo === 'string'
    ? assignedTo
    : (assignedTo?.displayName || assignedTo?.uniqueName || null)
  const assigneeId = assigneeName ? (nameToId[assigneeName] || null) : null
  const isNew  = changed ? (Date.now() - new Date(changed).getTime()) < 86_400_000 : false
  const isSprint = iterPath.toLowerCase().includes('sprint') || iterPath.toLowerCase().includes('iteration')
  return {
    id, type: adoTypeToHelm(wiType), title, project: projSlug,
    state, adoStateCategory: stateCategoryByName[state] || null,
    assignee: assigneeId,
    priority,
    points: Math.round(parseFloat(f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0) || 0),
    tags, updated: timeAgo(changed), changedMs: changed ? new Date(changed).getTime() : null,
    sprint: isSprint, iterationPath: iterPath, areaPath, area,
    comments: parseInt(f['System.CommentCount'] ?? f.commentCount ?? 0, 10) || 0,
    prs: 0, isNew,
  }
}

export function mapPR(pr, nameToId = {}, meName = '') {
  const authorId = nameToId[pr.author] || slugify(pr.author || 'unknown')
  const reviewers = (pr.reviewers || [])
    .map(r => { const n = r.name || r.displayName || r; return nameToId[n] || slugify(n) })
    .filter(Boolean)
  const reviewerDetails = (pr.reviewers || []).map(r => ({
    name: r.name || r.displayName || String(r),
    vote: r.vote || 0,
    id: nameToId[r.name || r.displayName || ''] || slugify(r.name || r.displayName || 'unknown'),
  }))
  const isDraft = pr.isDraft || (pr.title || '').startsWith('[WIP]') || (pr.title || '').startsWith('WIP:')
  let status = 'active'
  if (pr.status === 'completed')  status = 'merged'
  else if (pr.status === 'abandoned') status = 'abandoned'
  else if (isDraft) status = 'draft'
  const approvals = (pr.reviewers || []).filter(r => r.vote === 10 || r.vote === 5).length
  const needs     = (pr.reviewers || []).filter(r => r.vote === 0 || r.vote === -5 || r.vote === -10).length
  const needsMe   = meName
    ? (pr.reviewers || []).some(r => (r.name || r.displayName || '') === meName && r.vote === 0)
    : false
  const linkedWorkItems = (pr.linkedWorkItems || []).map(wi =>
    typeof wi === 'object'
      ? { id: wi.id, title: wi.title || '', state: wi.state || '', type: wi.type || '' }
      : { id: wi, title: '', state: '', type: '' }
  )
  return {
    id: pr.id, title: pr.title || '',
    repo: pr.repoName || pr.repo || '',
    branch:       (pr.sourceBranch || '').replace('refs/heads/', ''),
    sourceBranch: (pr.sourceBranch || '').replace('refs/heads/', ''),
    targetBranch: (pr.targetBranch || '').replace('refs/heads/', ''),
    author: authorId, authorName: pr.author || '',
    status, draft: isDraft, reviewers, reviewerDetails, approvals, needs,
    comments: pr.commentCount || 0, unresolvedComments: pr.unresolvedComments || 0,
    threads: pr.threads || [], additions: 0, deletions: 0, ciStatus: null,
    age: timeAgo(pr.created), needsMe,
    hasConflicts: pr.hasConflicts || false,
    repoId: pr.repoId || '', project: pr.project || '',
    url: pr.url || '', description: pr.description || '',
    linkedWorkItems, lastActivity: pr.lastActivity || null,
  }
}

export function mapBuild(b, proj = '') {
  const result = b.result || ''
  let status = 'success'
  if (result === 'failed')              status = 'failed'
  else if (result === 'partiallySucceeded') status = 'partial'
  else if (result === 'canceled' || b.status === 'cancelling') status = 'cancelled'
  else if (b.status === 'inProgress' || b.status === 'notStarted') status = 'running'
  return {
    id: b.id,
    // project is the slugified id — matches deriveProjects/ProjectChip lookup.
    // projectName is the raw ADO name needed for external URLs and API calls.
    project: slugify(proj),
    projectName: proj,
    pipeline: b.definition?.name || 'Pipeline',
    definitionId: b.definition?.id || 0,
    status,
    duration: b.duration || '—',
    actor: slugify(b.requestedBy?.displayName || b.requestedFor?.displayName || 'system'),
    commit: (b.sourceVersion || '').substring(0, 7) || '—',
    finishTime: b.finishTime || b.startTime || b.queueTime || null,
    when: timeAgo(b.finishTime || b.startTime || b.queueTime),
    branch: (b.sourceBranch || '').replace('refs/heads/', '') || 'main',
    reason: b.reason || '',
    failureReason: (status === 'failed' || status === 'partial') ? (b.statusDescription || null) : null,
  }
}

const TIMELINE_RECORD_TYPES = ['Stage', 'Phase', 'Job', 'Task']

export function mapBuildTimeline(raw) {
  const records = raw?.records || []
  const failedRecords = records
    .filter(r => r.result === 'failed' && TIMELINE_RECORD_TYPES.includes(r.type))
    .map(r => ({
      name: r.name || 'Unnamed',
      type: r.type,
      messages: (r.issues || []).map(i => i.message).filter(Boolean),
    }))
  return { failedRecords }
}

export function mapTestBuild(b, proj = '') {
  return {
    id: b.id, project: proj,
    pipeline: b.definition?.name || 'Pipeline',
    result: b.result || b.status || 'unknown',
    branch: (b.sourceBranch || '').replace('refs/heads/', '') || 'main',
    startTime: b.startTime || b.queueTime || null,
    when: timeAgo(b.finishTime || b.startTime || b.queueTime),
    duration: b.duration || '—',
    totalTests: null, passedTests: null, failedTests: null,
  }
}
