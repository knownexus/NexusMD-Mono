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
