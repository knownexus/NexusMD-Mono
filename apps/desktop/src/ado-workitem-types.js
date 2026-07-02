// ado-workitem-types.js — caches ADO work item type definitions.
import { getProfileKey } from './profile-keys.js'
import { createAdoHttpAdapter } from './ado-client.js'

const rawStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

function cacheKey(project, type) {
  return getProfileKey(`ado.wiTypeDefs.${project}.${type}`)
}

export function getCachedDefs(project, type) {
  try {
    const raw = rawStorage.get(cacheKey(project, type))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setCachedDefs(project, type, defs) {
  rawStorage.set(cacheKey(project, type), JSON.stringify(defs))
}

async function adoFetchJson(path) {
  const adapter = createAdoHttpAdapter()
  const res = await adapter.fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

export async function fetchWorkItemTypes(project) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.0`)
  return (data.value || [])
    .filter((t) => !t.isDisabled)
    .map((t) => ({ name: t.name, referenceName: t.referenceName, icon: t.icon?.id || '', color: t.color || '' }))
}

export async function fetchProjectFieldTypes(project) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/fields?api-version=7.0`)
  const map = {}
  for (const f of data.value || []) map[f.referenceName] = f.type
  return map
}

export async function fetchTypeFields(project, type, fieldTypeMap) {
  const data = await adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?api-version=7.0`)
  return (data.value || []).map((f) => ({
    referenceName: f.referenceName,
    name: f.name,
    alwaysRequired: !!f.alwaysRequired,
    defaultValue: f.defaultValue ?? null,
    allowedValues: f.allowedValues || [],
    dataType: fieldTypeMap[f.referenceName] || 'string',
  }))
}

function flattenClassificationNode(node, prefix = '') {
  const path = prefix ? `${prefix}\\${node.name}` : node.name
  const children = (node.children || []).flatMap((c) => flattenClassificationNode(c, path))
  return [path, ...children]
}

export async function fetchClassificationPaths(project) {
  const [areas, iterations] = await Promise.all([
    adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.0`),
    adoFetchJson(`${encodeURIComponent(project)}/_apis/wit/classificationnodes/iterations?$depth=10&api-version=7.0`),
  ])
  return {
    areas: flattenClassificationNode(areas),
    iterations: flattenClassificationNode(iterations),
  }
}

export async function loadWorkItemTypeDefs(project, type, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = getCachedDefs(project, type)
    if (cached) return cached
  }
  const fieldTypeMap = await fetchProjectFieldTypes(project)
  const [fields, paths, types] = await Promise.all([
    fetchTypeFields(project, type, fieldTypeMap),
    fetchClassificationPaths(project),
    fetchWorkItemTypes(project),
  ])
  const defs = { fields, paths, types, fetchedAt: Date.now() }
  setCachedDefs(project, type, defs)
  return defs
}

const HTML_FIELDS = new Set([
  'System.Description',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.SystemInfo',
])

const KNOWN_FIELD_GROUPS = {
  'System.AssignedTo': 'status',
  'System.State': 'status',
  'System.Reason': 'status',
  'System.AreaPath': 'classification',
  'System.IterationPath': 'classification',
  'Microsoft.VSTS.Common.Priority': 'classification',
  'Microsoft.VSTS.Common.Severity': 'classification',
  'System.Tags': 'tags',
}

export function fieldBucket(field) {
  if (HTML_FIELDS.has(field.referenceName) || field.dataType === 'html') return 'html'
  if (field.referenceName === 'System.AreaPath' || field.referenceName === 'System.IterationPath' || field.dataType === 'treePath') return 'treePath'
  if (field.referenceName === 'System.AssignedTo' || field.dataType === 'identity') return 'identity'
  if (field.allowedValues && field.allowedValues.length > 0) return 'picklist'
  if (field.dataType === 'dateTime') return 'dateTime'
  if (field.dataType === 'boolean') return 'boolean'
  if (field.dataType === 'integer' || field.dataType === 'double') return 'number'
  return 'text'
}

export function fieldGroup(field) {
  if (KNOWN_FIELD_GROUPS[field.referenceName]) return KNOWN_FIELD_GROUPS[field.referenceName]
  if (field.referenceName.startsWith('Microsoft.VSTS.Scheduling.')) return 'planning'
  if (fieldBucket(field) === 'html') return 'main'
  return 'additional'
}

export const TYPE_LAYOUTS = {
  Bug: {
    left: ['Description', 'Repro Steps', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Resolved Reason', 'Story Points', 'Priority'],
  },
  Epic: {
    left: ['Description', 'Stages'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk', 'Effort'],
  },
  Feature: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk'],
  },
  Issue: {
    left: ['Description'],
    middleTop: null,
    planning: ['Area', 'Stack Rank', 'Priority', 'Due Date'],
  },
  Task: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Activity'],
  },
}

export function resolveTypeLayout(typeName, fields) {
  const layout = TYPE_LAYOUTS[typeName]
  if (!layout) return null

  const byName = (name) => fields.find((f) => f.name === name)
  const left = layout.left.map(byName).filter(Boolean)
  const middleTop = layout.middleTop ? (byName(layout.middleTop) || null) : null
  const planning = layout.planning.map(byName).filter(Boolean)

  const selectedRefNames = new Set([...left, ...(middleTop ? [middleTop] : []), ...planning].map((f) => f.referenceName))
  const additional = fields.filter((f) => !selectedRefNames.has(f.referenceName) && f.referenceName !== 'System.State')

  return { left, middleTop, planning, additional }
}

export const LINK_TYPES = [
  { label: 'Parent', rel: 'System.LinkTypes.Hierarchy-Reverse' },
  { label: 'Child', rel: 'System.LinkTypes.Hierarchy-Forward' },
  { label: 'Related', rel: 'System.LinkTypes.Related' },
  { label: 'Predecessor', rel: 'System.LinkTypes.Dependency-Reverse' },
  { label: 'Successor', rel: 'System.LinkTypes.Dependency-Forward' },
  { label: 'Duplicate', rel: 'System.LinkTypes.Duplicate-Forward' },
  { label: 'Duplicate Of', rel: 'System.LinkTypes.Duplicate-Reverse' },
]

export function buildFieldPatchOps(fields) {
  return Object.entries(fields).map(([referenceName, value]) => ({
    op: 'add',
    path: `/fields/${referenceName}`,
    value,
  }))
}

export function buildAttachmentRelationOps(attachmentUrls) {
  return attachmentUrls.map((url) => ({
    op: 'add',
    path: '/relations/-',
    value: { rel: 'AttachedFile', url },
  }))
}

export function buildLinkRelationOps(links) {
  return links.map(({ rel, id }) => ({
    op: 'add',
    path: '/relations/-',
    value: { rel, url: `vstfs:///WorkItemTracking/WorkItem/${id}` },
  }))
}

export async function submitNewWorkItem({ project, type, fields, attachmentFiles = [], links = [] }) {
  const adapter = createAdoHttpAdapter()
  const proj = encodeURIComponent(project)
  const ops = buildFieldPatchOps(fields)
  const createRes = await adapter.fetch(
    `${proj}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.0`,
    { method: 'POST', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(ops) },
  )
  if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`)
  const created = await createRes.json()
  const warnings = []

  const attachmentUrls = []
  for (const file of attachmentFiles) {
    try {
      const uploadRes = await adapter.fetch(
        `${proj}/_apis/wit/attachments?fileName=${encodeURIComponent(file.name)}&api-version=7.0`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
      )
      if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`)
      const uploaded = await uploadRes.json()
      attachmentUrls.push(uploaded.url)
    } catch (e) {
      warnings.push(`attachment "${file.name}" failed: ${e.message}`)
    }
  }

  const attachmentOps = buildAttachmentRelationOps(attachmentUrls)
  const linkOps = buildLinkRelationOps(links)
  const relationOps = [...attachmentOps, ...linkOps]
  if (relationOps.length > 0) {
    try {
      const patchRes = await adapter.fetch(
        `_apis/wit/workitems/${created.id}?api-version=7.0`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(relationOps) },
      )
      if (!patchRes.ok) throw new Error(`HTTP ${patchRes.status}`)
    } catch (e) {
      if (attachmentOps.length > 0 && linkOps.length > 0) {
        warnings.push(`${attachmentOps.length} attachment(s) and ${linkOps.length} link(s) relation update failed: ${e.message}`)
      } else if (attachmentOps.length > 0) {
        warnings.push(`${attachmentOps.length} attachment relation(s) failed: ${e.message}`)
      } else {
        warnings.push(`${linkOps.length} link relation(s) failed: ${e.message}`)
      }
    }
  }

  return { id: created.id, warnings }
}
