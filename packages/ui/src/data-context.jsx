// data-context.jsx — the seam that lets shared views run on any platform.
//
// Shared views never import a platform's data module directly. Instead they read
// `useNexusData()`, and each app provides the data + platform helpers once at its
// root via <NexusDataProvider>. Web backs it with its `NexusMDData`/`NexusMDApi`
// singleton; desktop backs it with a core-derived cached snapshot. This is what
// keeps the views in @nexusmd/ui free of electron/capacitor/ASP.NET coupling.

import React from 'react'
import { effectiveNeedsMe as coreEffectiveNeedsMe } from '@nexusmd/core'
import { setPlannerRuntime } from './planner/runtime.js'
import { apiWorkItemSource, setWorkItemSource } from './views/work-item-source.js'

// Shape every consumer can rely on even before data has loaded.
export const EMPTY_NEXUS_DATA = {
  TEAM: [],
  ME: { id: 'me', name: '', initials: 'ME' },
  PROJECTS: [],
  CONFIG_PROJECTS: [],
  ORG: '',
  WORK_ITEMS: [],
  PRS: [],
  BUILDS: [],
  TESTS: [],
  ACTIVITY: [],
  RESOLVED_WI: [],
  AVG_RESOLUTION_DAYS: null,
  PR_SPARKLINE: [],
  STATES: [],
  // DashboardView dereferences SPRINT.* unguarded, so always provide a shape.
  SPRINT: { name: 'Current Sprint', start: '—', end: '—', daysLeft: 0, totalPoints: 1, donePoints: 0, inProgPoints: 0, reviewPoints: 0, burndown: [] },
}

// localStorage in a browser/Electron renderer; an in-memory shim under SSR/tests.
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage
  } catch { /* access can throw in sandboxed contexts */ }
  const mem = new Map()
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
  }
}

const DEFAULTS = {
  data: EMPTY_NEXUS_DATA,
  api: { load: () => Promise.resolve() },
  storage: defaultStorage(),
  getProfileKey: (k) => k,   // identity = the web contract (keys are already namespaced)
  pushPref: () => {},        // no-op unless the host wires a server/sync push
  namespace: 'nexusmd',      // storage-key prefix for shared UI state (web 'nexusmd', app 'helm')
  googleAuth: null,          // optional Google OAuth client (web only); null → widgets show "connect"
  workItemSource: apiWorkItemSource, // data ops for WorkItemDetail (web/desktop: /api; app: ado-client)
  prSource: null,            // optional: platform's PR http adapter passthrough (desktop only for now)
  plannerOnWeekSaved: null,  // web only: fired after a planner week is saved (Google-Drive sync); null → no-op
}

const NexusDataContext = React.createContext(DEFAULTS)

/**
 * Wrap an app's tree once. `value` supplies { data, api, storage, getProfileKey, pushPref };
 * any field omitted falls back to a safe default, so partial providers are fine.
 */
export function NexusDataProvider({ value, children }) {
  const merged = React.useMemo(
    () => ({ ...DEFAULTS, ...value, data: (value && value.data) || EMPTY_NEXUS_DATA }),
    [value],
  )
  // Mirror the storage/namespace fields to the planner runtime so the non-component
  // planner helpers (loadGlobalNotes/saveGlobalNotes) persist under the right keys.
  // Set synchronously during render so it's ready before any child reads it.
  setPlannerRuntime({
    namespace: merged.namespace,
    getProfileKey: merged.getProfileKey,
    pushPref: merged.pushPref,
    storage: merged.storage,
    onWeekSaved: merged.plannerOnWeekSaved || (() => {}),
  })
  // Mirror the work-item source so the non-component prefetch helper can reach it.
  setWorkItemSource(merged.workItemSource)
  return <NexusDataContext.Provider value={merged}>{children}</NexusDataContext.Provider>
}

export function useNexusData() {
  return React.useContext(NexusDataContext)
}

/**
 * PR review-filter bound to the current user. Mirrors web's old (pr, criteria)
 * call shape by injecting `data.ME` from context.
 */
export function useEffectiveNeedsMe() {
  const { data } = useNexusData()
  const me = data.ME
  return React.useCallback((pr, criteria) => coreEffectiveNeedsMe(pr, criteria, me), [me])
}
