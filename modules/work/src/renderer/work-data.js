import React from 'react'
import {
  core, loadCachedAdoData, loadAdoData, makeAdoWorkItemSource, loadCachedJiraData, loadJiraData,
  buildSnapshot, refreshProviders,
} from '@nexusmd/core'
import { EMPTY_NEXUS_DATA } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, isAdoConfigured, usesAdoWorkItems } from './ado-client.js'
import { getJiraConfig, isJiraActive, createJiraHttpAdapter } from './jira-client.js'
import { submitNewWorkItem } from './ado-workitem-types.js'
import { skippedFetches } from './work-screens.js'

// Manual + timed refresh for every work-item provider. ADO also loads PRs/builds/tests. Each
// provider records its own outcome; a failure keeps its cached data. `cloud` is the shell's
// sign-in, used to check the GitHub token afterwards.
export function makeRefreshAllData(cloud) {
  return async function refreshAllData() {
    try {
      await refreshProviders({
        storage: localStorageAdapter,
        providers: {
          ado: {
            configured: isAdoConfigured(),
            run: () => {
              const priorData = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
              return loadAdoData(
                getAdoConfig(),
                { http: createAdoHttpAdapter(), storage: localStorageAdapter },
                // Switched-off screens (Settings > Desktop > Work screens) aren't fetched.
                { isRefresh: !!priorData && (priorData.TEAM?.length ?? 0) > 0, priorData, skip: { ...skippedFetches(), workItems: !usesAdoWorkItems() } },
              )
            },
          },
          jira: {
            configured: isJiraActive(),
            run: () => {
              const priorData = loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter })
              return loadJiraData(
                getJiraConfig(),
                { http: createJiraHttpAdapter(), storage: localStorageAdapter },
                { isRefresh: !!priorData?._jiraMeta, priorData },
              )
            },
          },
        },
      })
    } finally { core._emit?.('data:updated') }
    // Check GitHub token health — fires nexusmd:github-401 event if expired
    try {
      const ghService = cloud?.makeOAuthService('github')
      if (ghService?.getToken) {
        await ghService.getToken({ force: true }).catch(() => {})
      }
    } catch {}
  }
}

// Direct-to-ADO work item source for the desktop (no ASP.NET proxy available).
// The logic lives in core; this supplies the desktop's connection, process cache and create flow.
export const desktopWorkItemSource = makeAdoWorkItemSource({
  http: { fetch: (path, options) => createAdoHttpAdapter().fetch(path, options) },
  getDefaultProject: () => (getAdoConfig().projects || [])[0] || '',
  getOrg: () => getAdoConfig().org,
  loadProcessMeta: () => loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })?._adoMeta,
  createWorkItem: submitNewWorkItem,
})

// Per-profile ids of people hidden from NexusMD (the Team view's "Remove").
export function readHiddenPeople() {
  try {
    const ids = JSON.parse(localStorage.getItem(getProfileKey('nexusmd.team.removed')) || '[]')
    return Array.isArray(ids) ? ids : []
  } catch { return [] }
}

// Cached ADO snapshot, shaped for the shared views, re-read on every data:updated.
export function useNexusSnapshot() {
  const [snapshot, setSnapshot] = React.useState(EMPTY_NEXUS_DATA)
  const [loaded, setLoaded] = React.useState(false)
  const refresh = React.useCallback(() => {
    try {
      setSnapshot(buildSnapshot({
        adoConfig: getAdoConfig(), adoConfigured: isAdoConfigured(), adoWorkItems: usesAdoWorkItems(),
        jiraConfig: getJiraConfig(), jiraActive: isJiraActive(),
        storage: localStorageAdapter, empty: EMPTY_NEXUS_DATA,
        hiddenIds: readHiddenPeople(),
      }))
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return { snapshot, loaded }
}
