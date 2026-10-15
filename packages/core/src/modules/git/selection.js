import { GIT_AREAS } from './parse.js'

/** Paths a change touches; a rename names both the new and the original path. */
export function changePaths(change) {
  return change.originalPath ? [change.path, change.originalPath] : [change.path]
}

/** Submodule changes are managed inside the submodule, never staged from here. */
export function isSubmodule(change) {
  return typeof change.sub === 'string' && change.sub.startsWith('S')
}

/** git reports an untracked repository as one `? nested/` folder; staging it would add an embedded gitlink. */
export function isNestedRepo(change) {
  return change.area === GIT_AREAS.UNTRACKED && typeof change.path === 'string' && change.path.endsWith('/')
}

const APPLIES = {
  // Staging a conflicted file marks it resolved.
  stage: c => c.area === GIT_AREAS.UNSTAGED || c.area === GIT_AREAS.UNTRACKED || c.area === GIT_AREAS.CONFLICT,
  unstage: c => c.area === GIT_AREAS.STAGED,
  discard: c => c.area === GIT_AREAS.UNSTAGED,
  delete: c => c.area === GIT_AREAS.UNTRACKED,
}

export const FILE_ACTIONS = Object.freeze(Object.keys(APPLIES))

/** The selected changes each file action applies to. */
export function actionsFor(changes, selectedIds) {
  const chosen = changes.filter(c => selectedIds.includes(c.id))
  return Object.fromEntries(FILE_ACTIONS.map(a => [a, chosen.filter(c => !isSubmodule(c) && !isNestedRepo(c) && APPLIES[a](c))]))
}

const GROUPS = [
  [GIT_AREAS.CONFLICT, 'Conflicts'], [GIT_AREAS.STAGED, 'Staged'], [GIT_AREAS.UNSTAGED, 'Changes'], [GIT_AREAS.UNTRACKED, 'Untracked'],
]

/** Changes in display order, one group per area; empty groups are left out. */
export function groupChanges(changes) {
  return GROUPS.map(([area, title]) => ({ area, title, changes: changes.filter(c => c.area === area) })).filter(g => g.changes.length)
}

export function toggleSelection(ids, id) {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
}

/** Shift-click: adds every change from the anchor to `id` in display order, keeping the rest. */
export function rangeSelection(ordered, ids, anchorId, id) {
  const a = ordered.findIndex(c => c.id === anchorId)
  const b = ordered.findIndex(c => c.id === id)
  if (a < 0 || b < 0) return toggleSelection(ids, id)
  const [from, to] = a < b ? [a, b] : [b, a]
  const add = ordered.slice(from, to + 1).map(c => c.id).filter(x => !ids.includes(x))
  return [...ids, ...add]
}

/** Drops ids whose change is no longer in the snapshot. */
export function pruneSelection(ids, changes) {
  const live = new Set(changes.map(c => c.id))
  return ids.filter(id => live.has(id))
}
