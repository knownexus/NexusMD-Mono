// apps/desktop/src/work-item-data.js — combine provider caches into the snapshot the
// shared views read, and refresh providers independently (one failing never blocks
// the other; its last cache stays visible, marked stale).
import React from 'react'
import { createRoutedWorkItemSource } from '@nexusmd/ui'
import {
  loadCachedAdoData, loadCachedJiraData, mergeWorkItemData,
  readProviderStatus, recordProviderStatus, adoStateForCategory, CATEGORY_LABELS,
} from '@nexusmd/core'

// One routed source per (ado, jira) pair. Rebuilding it with every snapshot would
// give workItemSource a new identity on each data refresh, making WorkItemDetail
// reload and drop in-progress edits and comment drafts.
export function useRoutedWorkItemSource(ado, jira) {
  return React.useMemo(() => createRoutedWorkItemSource({ ado, jira }), [ado, jira])
}

export function buildSnapshot({ adoConfig, adoConfigured, jiraConfig, jiraActive, storage, empty }) {
  const ado = loadCachedAdoData(adoConfig, { storage })
  const jira = jiraActive ? loadCachedJiraData(jiraConfig, { storage }) : null
  const merged = mergeWorkItemData({
    ado, jira, status: readProviderStatus(storage), configured: { ado: !!adoConfigured, jira: !!jiraActive },
  })
  return { ...empty, ...(ado || {}), ...merged }
}

export async function refreshProviders({ storage, providers }) {
  await Promise.all(Object.entries(providers)
    .filter(([, p]) => p?.configured)
    .map(([id, p]) => Promise.resolve()
      .then(() => p.run())
      .then(
        () => recordProviderStatus(storage, id, { ok: true }),
        (error) => recordProviderStatus(storage, id, { ok: false, error }),
      )))
}

export async function adoMoveToCategory({ item, category, meta, saveState }) {
  const state = adoStateForCategory(item, category, meta || {}) || (category === 'Completed' ? 'Done' : null)
  if (!state) throw new Error(`No ${CATEGORY_LABELS[category] || category} state for ${item?.type || 'this type'} in ADO`)
  await saveState(state)
  return { state, stateCategory: category }
}

export function defaultCreateProvider({ readJson, adoAvailable, jiraAvailable }) {
  const preferred = readJson('nexusmd.wi.displayMode', 'merged') === 'separate'
    ? readJson('nexusmd.wi.sourceTab', 'ado')
    : readJson('nexusmd.wi.createProvider', 'ado')
  if (preferred === 'jira' && jiraAvailable) return 'jira'
  if (adoAvailable) return 'ado'
  return jiraAvailable ? 'jira' : 'ado'
}

export function adoWorkItemUrl(org, item) {
  if (!org || !item?.project) return null
  const proj = String(item.project).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/edit/${item.id}`
}
