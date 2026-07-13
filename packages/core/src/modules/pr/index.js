// pr module — pure pull-request filtering logic shared across platforms.
//
// Extracted from the duplicated components.jsx copies. The original read a module
// global (NexusMDData.ME); the headless version takes the current user `me` as an
// explicit argument so it has no ambient dependencies.

import { slugify } from '../ado/helpers.js'

// Criteria shared by both effectiveNeedsMe and effectiveTeamActivity: draft/status/
// conflict/age gates that don't depend on reviewer state.
function passesCommonPrFilters(pr, criteria) {
  if (!criteria.includeDrafts && pr.draft) return false
  if (criteria.onlyActive && pr.status !== 'active') return false
  if (criteria.excludeConflicts && pr.hasConflicts) return false

  if (criteria.minAgeDays) {
    const a = String(pr.age || '')
    const ageDays = a.endsWith('d') ? (parseInt(a, 10) || 0) : 0
    if (ageDays < criteria.minAgeDays) return false
  }

  return true
}

function isAuthoredByMe(pr, me) {
  const myId = slugify((me && me.name) || '')
  return !!myId && pr.author === myId
}

/**
 * Does this PR need review from the current user, under the given criteria?
 *
 * @param {object} pr        Normalized PR (status, draft, hasConflicts, author, age,
 *                           needsMe, reviewerDetails: [{ name, vote }]).
 * @param {object} [criteria]
 * @param {number[]} [criteria.votes=[0]]   Reviewer vote values that count as "needs me".
 * @param {boolean}  [criteria.includeDrafts]
 * @param {boolean}  [criteria.onlyActive]
 * @param {boolean}  [criteria.excludeConflicts]
 * @param {boolean}  [criteria.excludeMine]
 * @param {number}   [criteria.minAgeDays]
 * @param {object} [me]      Current user, e.g. { name }. Replaces the old global.
 * @returns {boolean}
 */
export function effectiveNeedsMe(pr, criteria, me) {
  criteria = criteria || {}
  const votes = criteria.votes && criteria.votes.length ? criteria.votes : [0]

  if (!passesCommonPrFilters(pr, criteria)) return false
  if (criteria.excludeMine && isAuthoredByMe(pr, me)) return false

  const meName = (me && me.name) || ''
  if (!meName) return !!pr.needsMe
  return (pr.reviewerDetails || []).some((r) => r.name === meName && votes.indexOf(r.vote) !== -1)
}

/**
 * Does this PR represent team activity worth browsing — i.e. it's not one of mine,
 * regardless of whether I'm a listed reviewer? Used by the "Team activity" filter,
 * which is for keeping an eye on others' PRs rather than tracking review requests.
 *
 * @param {object} pr        Normalized PR (status, draft, hasConflicts, author, age).
 * @param {object} [criteria]
 * @param {boolean} [criteria.includeDrafts]
 * @param {boolean} [criteria.onlyActive]
 * @param {boolean} [criteria.excludeConflicts]
 * @param {number}  [criteria.minAgeDays]
 * @param {object} [me]      Current user, e.g. { name }.
 * @returns {boolean}
 */
export function effectiveTeamActivity(pr, criteria, me) {
  criteria = criteria || {}
  if (!passesCommonPrFilters(pr, criteria)) return false
  return !isAuthoredByMe(pr, me)
}
