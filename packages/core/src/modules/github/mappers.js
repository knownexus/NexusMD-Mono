// packages/core/src/modules/github/mappers.js — GitHub issues, PRs and Actions runs
// mapped onto the shapes the Jira/ADO mappers produce, plus GitHub-specific extras.
import { slugify, timeAgo } from '../ado/helpers.js'
import { toGithubId } from '../workitems/ids.js'

const labelName = (l) => (typeof l === 'string' ? l : l?.name || '')

export function githubTypeFromLabels(labels = [], nativeType = null) {
  if (nativeType) return slugify(nativeType)
  const names = (labels || []).map(l => labelName(l).toLowerCase())
  for (const n of names) {
    if (n === 'bug') return 'bug'
    if (n === 'enhancement' || n === 'feature') return 'feature'
    if (n === 'documentation') return 'documentation'
    if (n === 'question') return 'question'
  }
  return 'issue'
}

export function mapGithubIssue(issue, repo, { nameToId = {} } = {}) {
  const labels = (issue.labels || []).map(labelName).filter(Boolean)
  const nativeType = issue.type?.name || null
  const type = githubTypeFromLabels(labels, nativeType)
  const closed = issue.state === 'closed'
  const login = issue.assignee?.login || issue.assignees?.[0]?.login || null
  const changed = issue.updated_at || ''
  return {
    id: toGithubId(repo, issue.number),
    displayId: `${repo}#${issue.number}`,
    key: `${repo}#${issue.number}`,
    number: issue.number,
    source: 'github',
    type,
    typeName: nativeType || type,
    title: issue.title || '',
    project: slugify(repo),
    projectKey: repo,
    projectName: repo,
    state: closed ? 'Closed' : 'Open',
    stateCategory: closed ? 'Completed' : (login ? 'InProgress' : 'Proposed'),
    assignee: login ? (nameToId[login] || slugify(login)) : null,
    priority: 3,
    priorityName: null,
    points: 0,
    flagged: false,
    tags: labels,
    updated: timeAgo(changed),
    changedMs: changed ? new Date(changed).getTime() : null,
    sprint: issue.milestone?.state === 'open',
    iterationPath: issue.milestone?.title || '',
    areaPath: '',
    area: '',
    comments: issue.comments || 0,
    prs: 0,
    isNew: changed ? (Date.now() - new Date(changed).getTime()) < 86_400_000 : false,
    url: issue.html_url || '',
    closeReason: issue.state_reason || null,
  }
}

const VOTES = { APPROVED: 10, CHANGES_REQUESTED: -10 }

export function mapGithubPR(pr, repo, { reviews = [], meLogin = '' } = {}) {
  const latest = new Map()
  const sorted = [...reviews]
    .filter(r => r.user?.login && r.state !== 'PENDING')
    .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0))
  for (const r of sorted) {
    // A bare comment does not replace an earlier approval or change request.
    if (r.state === 'COMMENTED' && latest.has(r.user.login)) continue
    latest.set(r.user.login, VOTES[r.state] || 0)
  }
  for (const r of pr.requested_reviewers || []) {
    if (r?.login && !latest.has(r.login)) latest.set(r.login, 0)
  }
  const reviewerDetails = [...latest].map(([name, vote]) => ({ name, vote, id: slugify(name) }))
  const reviewers = reviewerDetails.map(r => r.id)
  const approvals = reviewerDetails.filter(r => r.vote === 10).length
  const needs = reviewerDetails.filter(r => r.vote <= 0).length
  const needsMe = meLogin ? reviewerDetails.some(r => r.name === meLogin && r.vote === 0) : false
  let status = 'active'
  if (pr.merged_at) status = 'merged'
  else if (pr.state === 'closed') status = 'abandoned'
  else if (pr.draft) status = 'draft'
  const login = pr.user?.login || ''
  return {
    id: toGithubId(repo, pr.number),
    displayId: `${repo}#${pr.number}`,
    source: 'github',
    number: pr.number,
    title: pr.title || '',
    repo,
    branch: pr.head?.ref || '',
    sourceBranch: pr.head?.ref || '',
    targetBranch: pr.base?.ref || '',
    author: slugify(login || 'unknown'),
    authorName: login,
    status, draft: !!pr.draft, reviewers, reviewerDetails, approvals, needs,
    comments: (pr.comments || 0) + (pr.review_comments || 0),
    unresolvedComments: 0,
    threads: [], additions: pr.additions || 0, deletions: pr.deletions || 0, ciStatus: null,
    age: timeAgo(pr.created_at), needsMe,
    hasConflicts: pr.mergeable_state === 'dirty',
    repoId: repo, project: slugify(repo),
    url: pr.html_url || '', description: pr.body || '',
    linkedWorkItems: [], lastActivity: pr.updated_at || null,
  }
}

const RUN_RESULT = {
  success: 'success',
  failure: 'failed', timed_out: 'failed', startup_failure: 'failed',
  cancelled: 'cancelled',
  neutral: 'partial', skipped: 'partial', action_required: 'partial',
}

function formatDuration(from, to) {
  if (!from || !to) return '—'
  const s = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000))
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function mapGithubRun(run, repo) {
  const status = run.status !== 'completed' ? 'running' : (RUN_RESULT[run.conclusion] || 'success')
  const when = run.updated_at || run.run_started_at || run.created_at || null
  return {
    id: run.id,
    project: slugify(repo),
    projectName: repo,
    pipeline: run.name || run.display_title || 'Workflow',
    definitionId: run.workflow_id || 0,
    status,
    duration: formatDuration(run.run_started_at, run.updated_at),
    actor: slugify(run.actor?.login || run.triggering_actor?.login || 'system'),
    commit: (run.head_sha || '').substring(0, 7) || '—',
    finishTime: when,
    when: timeAgo(when),
    branch: run.head_branch || 'main',
    reason: run.event || '',
    failureReason: null,
    url: run.html_url || '',
    source: 'github',
  }
}
