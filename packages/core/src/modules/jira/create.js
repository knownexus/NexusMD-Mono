import { htmlToAdf } from './adf.js'
import { toJiraId } from '../workitems/ids.js'

// Set by the form itself (summary/type/project) or by Jira (reporter default),
// or handled on their own tabs (attachments, links).
const SKIP = new Set(['summary', 'issuetype', 'project', 'reporter', 'attachment', 'issuelinks'])
const CORE_ROLES = ['description', 'assignee', 'priority', 'labels', 'points', 'parent']

export function classifyJiraField(f, fieldIds = {}) {
  const id = f.fieldId || f.key
  const s = f.schema || {}
  const hasValues = Array.isArray(f.allowedValues) && f.allowedValues.length > 0
  if (id === 'description' || (id && (id === fieldIds.acceptanceCriteria || id === fieldIds.reproSteps))) return 'richtext'
  if (id === 'labels') return 'labels'
  if (id === 'parent') return 'parent'
  if (id && id === fieldIds.sprint) return 'sprint'
  if (id && id === fieldIds.storyPoints) return 'number'
  if (s.type === 'user') return 'user'
  if (s.type === 'array' && hasValues) return 'multi-option'
  if (s.type === 'priority' || s.type === 'option' || hasValues) return 'option'
  if (s.type === 'number') return 'number'
  if (s.type === 'date' || s.type === 'datetime') return 'date'
  if (s.type === 'string') return String(s.custom || '').endsWith(':textarea') ? 'richtext' : 'text'
  return null
}

function roleOf(key, kind, fieldIds) {
  if (['description', 'assignee', 'priority', 'labels', 'parent'].includes(key)) return key
  if (key === fieldIds.storyPoints) return 'points'
  if (kind === 'sprint') return 'sprint'
  return null
}

export function normaliseCreateFields(rawFields = [], fieldIds = {}) {
  return rawFields
    .filter(f => !SKIP.has(f.fieldId || f.key))
    .map(f => {
      const key = f.fieldId || f.key
      const kind = classifyJiraField(f, fieldIds)
      return {
        key,
        name: f.name,
        required: !!f.required && !f.hasDefaultValue,
        kind,
        role: roleOf(key, kind, fieldIds),
        allowedValues: (f.allowedValues || []).map(v => ({ id: String(v.id), name: v.name ?? v.value ?? String(v.id) })),
      }
    })
}

export function layoutCreateFields(fields = []) {
  const core = CORE_ROLES.map(r => fields.find(f => f.role === r)).filter(Boolean)
  const rest = fields.filter(f => !core.includes(f))
  const usable = (f) => f.kind && f.role !== 'sprint'
  return {
    core,
    required: rest.filter(f => f.required && usable(f)),
    more: rest.filter(f => !f.required && usable(f)),
    unsupportedRequired: rest.filter(f => f.required && !usable(f)),
  }
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const toLabels = (v) => (Array.isArray(v) ? v : String(v).split(/[,;]/))
  .map(t => String(t).trim().replace(/\s+/g, '-')).filter(Boolean)

export function buildJiraCreatePayload({ projectKey, typeId, summary, values = {}, fields = [] }) {
  const out = { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary: String(summary).trim() }
  for (const f of fields) {
    const v = values[f.key]
    if (isEmpty(v)) continue
    switch (f.kind) {
      case 'richtext': out[f.key] = htmlToAdf(v); break
      case 'text': out[f.key] = String(v); break
      case 'number': out[f.key] = Number(v); break
      case 'date': out[f.key] = String(v); break
      case 'user': out[f.key] = { accountId: v }; break
      case 'option': out[f.key] = { id: String(v) }; break
      case 'multi-option': out[f.key] = v.map(id => ({ id: String(id) })); break
      case 'labels': out[f.key] = toLabels(v); break
      case 'parent': out[f.key] = { key: String(v).trim().toUpperCase() }; break
      default: break
    }
  }
  return { fields: out }
}

const createmetaPath = (projectKey) => `rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`

export async function fetchJiraCreateTypes(client, projectKey) {
  const res = await client.get(`${createmetaPath(projectKey)}?maxResults=100`)
  return (res?.issueTypes || res?.values || []).map(t => ({ id: String(t.id), name: t.name, subtask: !!t.subtask }))
}

export async function fetchJiraCreateFields(client, projectKey, typeId, fieldIds = {}) {
  const res = await client.get(`${createmetaPath(projectKey)}/${encodeURIComponent(typeId)}?maxResults=200`)
  return normaliseCreateFields(res?.fields || res?.values || [], fieldIds)
}

export async function fetchJiraLinkTypes(client) {
  const res = await client.get('rest/api/3/issueLinkType')
  return (res?.issueLinkTypes || []).map(t => ({ id: String(t.id), name: t.name, outward: t.outward, inward: t.inward }))
}

// Jira's issueLink quirk: the inwardIssue reads with the link type's *outward*
// verb ("<inward> blocks <outward>"), so the new issue goes in inwardIssue to read
// as "<new issue> blocks <other>".
export async function createJiraIssue(client, input, { attachments = [], links = [] } = {}) {
  const created = await client.post('rest/api/3/issue', buildJiraCreatePayload(input))
  const key = created.key
  const warnings = []

  for (const file of attachments) {
    try {
      const data = await file.arrayBuffer()
      await client.send(`rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
        method: 'POST',
        headers: { 'X-Atlassian-Token': 'no-check' },
        attachment: { name: file.name, type: file.type || 'application/octet-stream', data },
      })
    } catch (e) {
      warnings.push(`attachment "${file.name}" failed: ${e.message}`)
    }
  }

  for (const link of links) {
    try {
      await client.post('rest/api/3/issueLink', {
        type: { name: link.typeName }, inwardIssue: { key }, outwardIssue: { key: link.key },
      })
    } catch (e) {
      warnings.push(`link to ${link.key} failed: ${e.message}`)
    }
  }

  return { id: toJiraId(key), key, warnings }
}
