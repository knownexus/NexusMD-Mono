// team module — roster merge + per-member work aggregation.
//
// Pure, platform-agnostic logic extracted from the app layer (Phase 5).
// Storage and React stay in the apps; these functions take plain data and
// return plain data so every app (web, desktop, mobile) shares one implementation.

import {
  isActiveState, isReviewState, isBlockedState, isTerminalState,
} from '../ado/helpers.js'

/**
 * Merge the locally-stored roster overrides over a service-sourced team list.
 *
 * The visible roster is: service members that haven't been hidden, followed by
 * locally-added custom members whose id doesn't already exist. Custom members in
 * the base list (`isCustom`) are dropped first so the stored `customMembers`
 * array is the single source of truth for them.
 *
 * @param {Array<object>} baseTeam       Service-sourced members (e.g. from ADO).
 * @param {object}        [overrides]
 * @param {string[]}      [overrides.removedIds]     Service member ids to hide.
 * @param {Array<object>} [overrides.customMembers]  Locally-added members.
 * @returns {Array<object>} The merged, visible roster.
 */
export function mergeTeamRoster(baseTeam, { removedIds = [], customMembers = [] } = {}) {
  const serviceTeam = (baseTeam || []).filter(t => !t.isCustom)
  const visible = serviceTeam.filter(t => !removedIds.includes(t.id))
  const existingIds = new Set(visible.map(t => t.id))
  const newCustom = (customMembers || []).filter(m => m && m.id && !existingIds.has(m.id))
  return [...visible, ...newCustom]
}

/**
 * Aggregate a single member's work items and pull requests into summary buckets.
 *
 * @param {object} member                Roster member (must have `id`).
 * @param {object} data
 * @param {Array<object>} [data.workItems]  Work items (each `{ assignee, state, priority, sprint, points }`).
 * @param {Array<object>} [data.prs]        Pull requests (each `{ author, status }`).
 * @returns {object} The member with `myWIs, active, blocked, done, myPRs, current, points` added.
 */
export function enrichTeamMember(member, { workItems = [], prs = [] } = {}) {
  const myWIs = workItems.filter(w => w.assignee === member.id)
  const active = myWIs.filter(w => isActiveState(w.state) || isReviewState(w.state))
  const blocked = myWIs.filter(w => isBlockedState(w.state))
  const done = myWIs.filter(w => isTerminalState(w.state, w.stateCategory))
  const myPRs = prs.filter(p => p.author === member.id && p.status === 'active')
  const current = [...active].sort((a, b) => a.priority - b.priority)[0]
  const points = myWIs.reduce((s, w) => s + (w.sprint ? w.points : 0), 0)
  return { ...member, myWIs, active, blocked, done, myPRs, current, points }
}

/**
 * Enrich every member of a roster. Convenience wrapper over {@link enrichTeamMember}.
 *
 * @param {Array<object>} team  Roster members.
 * @param {object} data         `{ workItems, prs }`, forwarded to enrichTeamMember.
 * @returns {Array<object>} Enriched roster.
 */
export function enrichTeam(team, data) {
  return (team || []).map(m => enrichTeamMember(m, data))
}
