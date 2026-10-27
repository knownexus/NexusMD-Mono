// packages/core/src/modules/github/issues.js — issue detail, comments, write-back and create.
import { parseGithubId, toGithubId } from '../workitems/ids.js'

function ref(id) {
  const p = parseGithubId(id)
  if (!p) throw new Error(`Not a GitHub issue id: ${id}`)
  return p
}
const issuePath = (id) => { const { repo, number } = ref(id); return `repos/${repo}/issues/${number}` }

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const textToHtml = (s) => escapeHtml(s).replace(/\r?\n/g, '<br>')

const mapComment = (c, fallbackText = '') => ({
  id: c?.id,
  author: c?.user?.login || '',
  text: c?.body != null ? textToHtml(c.body) : textToHtml(fallbackText),
  createdDate: c?.created_at || '',
})

export async function loadGithubDetail(client, id) {
  const issue = await client.get(issuePath(id))
  return { description: issue?.body ? textToHtml(issue.body) : null }
}

export async function loadGithubComments(client, id) {
  try {
    const list = await client.getPaged(`${issuePath(id)}/comments`)
    return (list || []).map(c => mapComment(c))
  } catch {
    return []
  }
}

export async function addGithubComment(client, id, text) {
  const c = await client.post(`${issuePath(id)}/comments`, { body: text })
  const out = mapComment(c, text)
  if (!out.createdDate) out.createdDate = new Date().toISOString()
  return out
}

export async function updateGithubIssue(client, id, patch) {
  if (!patch || Object.keys(patch).length === 0) return
  await client.patch(issuePath(id), patch)
}

const CLOSED = new Set(['closed', 'done', 'completed'])

export function githubPatchFromAdoField(field, value) {
  switch (field) {
    case 'System.Title': return { title: String(value ?? '') }
    case 'System.Description': return { body: value || '' }
    case 'System.State': {
      const s = String(value || '').trim().toLowerCase()
      if (CLOSED.has(s)) return { state: 'closed', state_reason: 'completed' }
      if (s === 'removed') return { state: 'closed', state_reason: 'not_planned' }
      return { state: 'open' }
    }
    case 'System.AssignedTo': return { assignees: value ? [String(value)] : [] }
    case 'System.Tags':
      return { labels: String(value || '').split(';').map(t => t.trim()).filter(Boolean) }
    default:
      throw new Error(`Editing ${field} is not supported for GitHub issues`)
  }
}

export async function fetchGithubCreateMeta(client, repo) {
  const [labels, assignees, milestones] = await Promise.all([
    client.getPaged(`repos/${repo}/labels`),
    client.getPaged(`repos/${repo}/assignees`),
    client.getPaged(`repos/${repo}/milestones`),
  ])
  return {
    labels: labels.map(l => l.name),
    assignees: assignees.map(a => a.login),
    milestones: milestones.map(m => ({ number: m.number, title: m.title })),
  }
}

export async function createGithubIssue(client, { repo, title, body, labels, assignees, milestone }) {
  const payload = { title }
  if (body) payload.body = body
  if (labels?.length) payload.labels = labels
  if (assignees?.length) payload.assignees = assignees
  if (milestone) payload.milestone = milestone
  const issue = await client.post(`repos/${repo}/issues`, payload)
  return { id: toGithubId(repo, issue.number), url: issue.html_url || '', warnings: [] }
}
