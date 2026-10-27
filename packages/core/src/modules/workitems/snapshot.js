// snapshot.js — combine the per-provider (ADO, Jira) caches into the snapshot the shared
// views read, refresh providers independently (one failing never blocks the other; its
// last cache stays visible, marked stale), and keep the hidden-people list in step.
import { loadCachedAdoData } from '../ado/loader.js'
import { loadCachedJiraData } from '../jira/loader.js'
import { mergeWorkItemData } from './merge.js'
import { readProviderStatus, recordProviderStatus } from './status.js'
import { applyHiddenPeople } from './people.js'

// `adoWorkItems: false` keeps ADO's PRs, builds and tests but leaves its work items out (also
// any still in the cache from before they were switched off) and ADO out of the providers.
export function buildSnapshot({ adoConfig, adoConfigured, adoWorkItems = true, jiraConfig, jiraActive, storage, empty, hiddenIds = [] }) {
  const ado = loadCachedAdoData(adoConfig, { storage })
  const jira = jiraActive ? loadCachedJiraData(jiraConfig, { storage }) : null
  const noAdoItems = { WORK_ITEMS: [], RESOLVED_WI: [], STATES: [], TYPES: [], PRIORITIES: [], WI_TYPE_STATES: {} }
  const adoForItems = ado && !adoWorkItems ? { ...ado, ...noAdoItems } : ado
  const merged = mergeWorkItemData({
    ado: adoForItems, jira, status: readProviderStatus(storage),
    configured: { ado: !!adoConfigured && adoWorkItems, jira: !!jiraActive },
  })
  // Derived from ADO's work items alone, so meaningless without them.
  const adoItemStats = ado && !adoWorkItems ? { SPRINT: empty?.SPRINT ?? null, AVG_RESOLUTION_DAYS: null } : {}
  return applyHiddenPeople({ ...empty, ...(ado || {}), ...adoItemStats, ...merged }, hiddenIds)
}

// The hidden-people list after the Team view reports `newTeam`. Updated
// incrementally: roster members absent from newTeam are hidden, present ones
// restored, and ids not in the current roster (snapshot not loaded yet, a person
// not in TEAM yet) are kept untouched.
export function nextHiddenIds(currentIds, fullRoster, newTeam) {
  const inTeam = new Set(newTeam.map(m => m.id))
  const rosterIds = new Set(fullRoster.map(m => m.id))
  const kept = currentIds.filter(id => !rosterIds.has(id) || !inTeam.has(id))
  const added = fullRoster.map(m => m.id).filter(id => !inTeam.has(id) && !kept.includes(id))
  return [...kept, ...added]
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

export function defaultCreateProvider({ readJson, adoAvailable, jiraAvailable }) {
  const preferred = readJson('nexusmd.wi.displayMode', 'merged') === 'separate'
    ? readJson('nexusmd.wi.sourceTab', 'ado')
    : readJson('nexusmd.wi.createProvider', 'ado')
  if (preferred === 'jira' && jiraAvailable) return 'jira'
  if (adoAvailable) return 'ado'
  return jiraAvailable ? 'jira' : 'ado'
}
