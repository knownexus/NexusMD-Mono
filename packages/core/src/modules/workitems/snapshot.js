// snapshot.js — combine the per-provider (ADO, Jira) caches into the snapshot the shared
// views read, refresh providers independently (one failing never blocks the other; its
// last cache stays visible, marked stale), and keep the hidden-people list in step.
import { loadCachedAdoData } from '../ado/loader.js'
import { loadCachedJiraData } from '../jira/loader.js'
import { mergeWorkItemData } from './merge.js'
import { readProviderStatus, recordProviderStatus } from './status.js'
import { applyHiddenPeople } from './people.js'

export function buildSnapshot({ adoConfig, adoConfigured, jiraConfig, jiraActive, storage, empty, hiddenIds = [] }) {
  const ado = loadCachedAdoData(adoConfig, { storage })
  const jira = jiraActive ? loadCachedJiraData(jiraConfig, { storage }) : null
  const merged = mergeWorkItemData({
    ado, jira, status: readProviderStatus(storage), configured: { ado: !!adoConfigured, jira: !!jiraActive },
  })
  return applyHiddenPeople({ ...empty, ...(ado || {}), ...merged }, hiddenIds)
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
