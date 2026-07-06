import { registerModule } from '../../features/module-registry.js'
import { slugify } from '../ado/helpers.js'
import { ADO_CACHE_KEY } from '../ado/loader.js'

/**
 * Filter mapped ADO work items for a triage session.
 *
 * @param {object[]} workItems        Mapped work items from loadAdoData / cache.
 * @param {object}   filters
 * @param {string[]} [filters.projects]      Project slugs to include (empty = all).
 * @param {string[]} [filters.states]        States to include (empty = all).
 * @param {string}   [filters.assigneeId]    Assignee slug. '__unassigned__' = no assignee, null = all.
 * @param {string}   [filters.assigneeName]  Display name — slugified and matched against assignee id.
 * @param {number}   [filters.dateFrom]      Inclusive ms lower bound on changedMs.
 * @param {number}   [filters.dateTo]        Inclusive ms upper bound on changedMs.
 * @param {string[]} [filters.tags]          At least one of these tags must be present (empty = any).
 * @param {string[]} [filters.excludedTags]  None of these tags may be present.
 * @returns {object[]}
 */
export function filterTriageItems(workItems, {
  projects     = [],
  states       = [],
  assigneeId   = null,
  assigneeName = null,
  dateFrom     = null,
  dateTo       = null,
  tags         = [],
  excludedTags = [],
} = {}) {
  let items = workItems || []

  if (projects.length > 0) {
    items = items.filter(wi =>
      projects.some(p => wi.project === p || (wi.iterationPath || '').startsWith(p))
    )
  }

  if (states.length > 0) {
    items = items.filter(wi => states.includes(wi.state))
  }

  const resolvedId = assigneeId || (assigneeName ? slugify(assigneeName) : null)
  if (resolvedId === '__unassigned__') {
    items = items.filter(wi => !wi.assignee)
  } else if (resolvedId) {
    items = items.filter(wi => wi.assignee === resolvedId)
  }

  if (dateFrom !== null) {
    items = items.filter(wi => wi.changedMs == null || wi.changedMs >= dateFrom)
  }

  if (dateTo !== null) {
    items = items.filter(wi => wi.changedMs == null || wi.changedMs <= dateTo)
  }

  if (tags.length > 0) {
    const lc = tags.map(t => t.toLowerCase())
    items = items.filter(wi => (wi.tags || []).some(t => lc.includes(t.toLowerCase())))
  }

  if (excludedTags.length > 0) {
    const lc = excludedTags.map(t => t.toLowerCase())
    items = items.filter(wi => !(wi.tags || []).some(t => lc.includes(t.toLowerCase())))
  }

  return items
}

/**
 * Serialise triage items as a RFC 4180-compliant CSV string.
 * Columns: ID, Title, Type, State, Assignee, Priority, Project, Changed, Tags.
 */
export function buildTriageCsv(items) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = 'ID,Title,Type,State,Assignee,Priority,Project,Changed,Tags'
  const rows = (items || []).map(wi => [
    wi.id ?? '',
    esc(wi.title),
    wi.type ?? '',
    wi.state ?? '',
    wi.assignee ?? '',
    wi.priority ?? '',
    wi.project ?? '',
    wi.changedMs ? new Date(wi.changedMs).toISOString().slice(0, 10) : '',
    esc((wi.tags || []).join('; ')),
  ].join(','))
  return [header, ...rows].join('\n')
}

registerModule({
  id:               'triage',
  name:             'Triage',
  requiredAdapters: [],
  defaultEnabled:   true,

  init(_adapters, _config) {},

  async load(adapters) {
    const storage = adapters?.storage
    if (!storage) return { items: [], count: 0 }

    let workItems = []
    try {
      const raw    = storage.get(ADO_CACHE_KEY)
      const cached = typeof raw === 'string' ? JSON.parse(raw) : raw
      workItems    = cached?.WORK_ITEMS || []
    } catch { workItems = [] }

    return { items: workItems, count: workItems.length }
  },

  dispose() {},
})
