import { registerModule } from '../../features/module-registry.js'
import { isTerminalState, isBlockedState } from '../ado/helpers.js'
import { ADO_CACHE_KEY } from '../ado/loader.js'

/**
 * Build a digest summary from ADO and team data.
 * All inputs are optional — missing data produces zeroed-out counts.
 *
 * @param {object}   [data]
 * @param {object[]} [data.workItems]  Mapped work items from loadAdoData / cache.
 * @param {object[]} [data.prs]        Mapped pull requests.
 * @param {object[]} [data.builds]     Mapped builds.
 * @param {object[]} [data.team]       Team roster.
 * @param {object}   [data.sprint]     Sprint summary from deriveSprint.
 * @returns {{
 *   openCount: number,
 *   blockedCount: number,
 *   criticalCount: number,
 *   activePrCount: number,
 *   failedBuildCount: number,
 *   runningBuildCount: number,
 *   sprintName: string|null,
 *   sprintVelocity: number|null,
 *   teamMetrics: { id: string, name: string, openCount: number, blockedCount: number, prCount: number }[],
 * }}
 */
export function buildDigest({ workItems = [], prs = [], builds = [], team = [], sprint = null } = {}) {
  const openItems     = workItems.filter(wi => !isTerminalState(wi.state))
  const blockedItems  = openItems.filter(wi => isBlockedState(wi.state))
  const criticalItems = openItems.filter(wi => wi.priority <= 1)
  const activePrs     = prs.filter(p => p.status === 'active' || p.status === 'draft')
  const failedBuilds  = builds.filter(b => b.status === 'failed' || b.status === 'partial')
  const runningBuilds = builds.filter(b => b.status === 'running')

  const teamMetrics = (team || []).map(member => ({
    id:           member.id,
    name:         member.name,
    openCount:    openItems.filter(wi => wi.assignee === member.id).length,
    blockedCount: openItems.filter(wi => wi.assignee === member.id && isBlockedState(wi.state)).length,
    prCount:      activePrs.filter(p => p.author === member.id).length,
  }))

  return {
    openCount:         openItems.length,
    blockedCount:      blockedItems.length,
    criticalCount:     criticalItems.length,
    activePrCount:     activePrs.length,
    failedBuildCount:  failedBuilds.length,
    runningBuildCount: runningBuilds.length,
    sprintName:        sprint?.name     ?? null,
    sprintVelocity:    sprint?.velocity ?? null,
    teamMetrics,
  }
}

registerModule({
  id:               'digest',
  name:             'Digest',
  requiredAdapters: [],
  defaultEnabled:   false,

  init(_adapters, _config) {},

  async load(adapters) {
    const storage = adapters?.storage
    if (!storage) return buildDigest()

    let cached = {}
    try {
      const raw = storage.get(ADO_CACHE_KEY)
      cached    = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {}
    } catch { cached = {} }

    return buildDigest({
      workItems: cached.WORK_ITEMS || [],
      prs:       cached.PRS       || [],
      builds:    cached.BUILDS    || [],
      team:      cached.TEAM      || [],
      sprint:    cached.SPRINT    || null,
    })
  },

  dispose() {},
})
