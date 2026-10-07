import { htmlToAdf } from './adf.js'
import { categoryOfJiraStatus } from './metadata.js'

const issuePath = (key) => `rest/api/3/issue/${encodeURIComponent(key)}`

export async function loadJiraDetail(client, key, meta = {}) {
  const ids = meta.fieldIds || {}
  const fields = ['description', ids.acceptanceCriteria, ids.reproSteps].filter(Boolean).join(',')
  const issue = await client.get(`${issuePath(key)}?fields=${fields}&expand=renderedFields`)
  const r = issue?.renderedFields || {}
  return {
    description: r.description || null,
    acceptanceCriteria: ids.acceptanceCriteria ? (r[ids.acceptanceCriteria] || null) : null,
    reproSteps: ids.reproSteps ? (r[ids.reproSteps] || null) : null,
  }
}

export async function loadJiraComments(client, key) {
  const res = await client.get(`${issuePath(key)}/comment?orderBy=created&maxResults=100&expand=renderedBody`)
  return (res?.comments || []).map(c => ({
    id: c.id, author: c.author?.displayName || '', text: c.renderedBody || '', createdDate: c.created || '',
  }))
}

export async function addJiraComment(client, key, html) {
  const c = await client.post(`${issuePath(key)}/comment?expand=renderedBody`, { body: htmlToAdf(html) })
  return {
    id: c?.id,
    author: c?.author?.displayName || '',
    text: c?.renderedBody || html,
    createdDate: c?.created || new Date().toISOString(),
  }
}

export async function loadJiraRawFields(client, key) {
  const issue = await client.get(`${issuePath(key)}?expand=names`)
  const names = issue?.names || {}
  const out = {}
  for (const [k, v] of Object.entries(issue?.fields || {})) {
    out[names[k] && names[k] !== k ? `${names[k]} (${k})` : k] = v
  }
  return out
}

const toLabel = (t) => String(t).trim().replace(/\s+/g, '-')

export function buildJiraFieldsPayload(patch, meta = {}) {
  const ids = meta.fieldIds || {}
  const fields = {}
  if ('title' in patch) fields.summary = patch.title
  if ('description' in patch) fields.description = patch.description ? htmlToAdf(patch.description) : null
  if ('acceptanceCriteria' in patch) {
    if (!ids.acceptanceCriteria) throw new Error('This Jira site has no Acceptance Criteria field')
    fields[ids.acceptanceCriteria] = patch.acceptanceCriteria ? htmlToAdf(patch.acceptanceCriteria) : null
  }
  if ('assigneeAccountId' in patch) fields.assignee = patch.assigneeAccountId ? { accountId: patch.assigneeAccountId } : null
  if ('priorityName' in patch) fields.priority = { name: patch.priorityName }
  if ('tags' in patch) fields.labels = patch.tags.map(toLabel).filter(Boolean)
  if ('points' in patch) {
    // The board's estimation field (what the board and our cards display) wins over
    // the site-wide story points field, or an edit would "snap back".
    const pointsId = meta.pointsFieldId || ids.storyPoints
    if (!pointsId) throw new Error('This Jira site has no story points field')
    fields[pointsId] = patch.points === '' || patch.points == null ? null : Number(patch.points)
  }
  return fields
}

export async function updateJiraIssue(client, key, patch, meta) {
  const fields = buildJiraFieldsPayload(patch, meta)
  if (Object.keys(fields).length === 0) return
  await client.put(issuePath(key), { fields })
}

export async function listJiraTransitions(client, key) {
  const res = await client.get(`${issuePath(key)}/transitions`)
  return (res?.transitions || []).map(t => ({
    id: String(t.id), name: t.name, toName: t.to?.name || '', toCategory: categoryOfJiraStatus(t.to),
  }))
}

export function pickTransition(transitions, { state, category } = {}) {
  if (state) {
    const s = String(state).toLowerCase()
    return transitions.find(t => t.toName.toLowerCase() === s) || null
  }
  if (category) return transitions.find(t => t.toCategory === category) || null
  return null
}

export async function transitionJiraIssue(client, key, target, { currentState = '' } = {}) {
  const t = pickTransition(await listJiraTransitions(client, key), target)
  if (!t) {
    throw new Error(`No transition from "${currentState || 'its current status'}" to "${target.state || target.category}" in this workflow`)
  }
  await client.post(`${issuePath(key)}/transitions`, { transition: { id: t.id } })
  return { state: t.toName, stateCategory: t.toCategory }
}

// Move an issue into whichever of `statuses` (a board column) its workflow can
// reach first, trying the column's statuses in order.
export async function transitionJiraIssueToAny(client, key, statuses, { currentState = '' } = {}) {
  const transitions = await listJiraTransitions(client, key)
  let chosen = null
  for (const status of statuses || []) {
    chosen = pickTransition(transitions, { state: status })
    if (chosen) break
  }
  if (!chosen) {
    throw new Error(`No transition from "${currentState || 'its current status'}" to any status in this column`)
  }
  await client.post(`${issuePath(key)}/transitions`, { transition: { id: chosen.id } })
  return { state: chosen.toName, stateCategory: chosen.toCategory }
}

// The shared views write ADO field names (saveField(id, 'System.State', v)).
// Translate one such write into a Jira transition or a normalised field patch.
export function jiraPatchFromAdoField(field, value, { people = [], priorities = [] } = {}) {
  switch (field) {
    case 'System.State':
      return { transition: { state: String(value) } }
    case 'System.Title':
      return { patch: { title: String(value ?? '') } }
    case 'System.Description':
      return { patch: { description: value || '' } }
    case 'Microsoft.VSTS.Common.AcceptanceCriteria':
      return { patch: { acceptanceCriteria: value || '' } }
    case 'System.Tags':
      return { patch: { tags: String(value || '').split(';').map(t => t.trim()).filter(Boolean) } }
    case 'Microsoft.VSTS.Scheduling.StoryPoints':
      return { patch: { points: value } }
    case 'Microsoft.VSTS.Common.Priority': {
      const p = priorities.find(x => x.rank === Number(value))
      if (!p) throw new Error(`Jira has no priority ranked ${value}`)
      return { patch: { priorityName: p.name } }
    }
    case 'System.AssignedTo': {
      if (!value) return { patch: { assigneeAccountId: null } }
      const name = String(value).toLowerCase()
      const person = people.find(p => p.displayName.toLowerCase() === name)
      if (!person) throw new Error(`${value} can't be assigned in Jira — they aren't an assignable user on these projects`)
      return { patch: { assigneeAccountId: person.accountId } }
    }
    default:
      throw new Error(`${field} can't be edited on Jira items`)
  }
}
