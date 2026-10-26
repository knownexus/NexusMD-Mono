// packages/core/src/modules/git/commit-edit.js
//
// Rewording and squashing commits from a branch's history, as pure checks and plans. `commits` is
// newest first ([{ oid, subject, parents }], starting at HEAD, contiguous); `unpushed` is a Set of
// oids not on any remote; `own` is the Set of oids in source..HEAD, or null when there's no source.
// The plans feed the existing rebaseInteractive action through rebase-plan.js's row model.

import { rebasePlan, setRowAction, setRowMessage } from './rebase-plan.js'
import { sourceName } from './snapshot.js'

const isMerge = c => (c.parents?.length ?? 0) > 1

export function rewordProblem(commit, unpushed) {
  if (!unpushed.has(commit.oid)) return 'Already pushed'
  if (isMerge(commit)) return "Merge commits can't be reworded here"
  return null
}

/** Whether commits[index] can be folded into the commit before it (commits[index + 1]). */
export function squashPreviousProblem(commits, index, unpushed, own, source) {
  const commit = commits[index]
  const previous = commits[index + 1]
  if (!unpushed.has(commit.oid)) return 'Already pushed'
  if (isMerge(commit)) return "Merge commits can't be squashed here"
  if (!previous) return own ? `The previous commit is on ${source ? sourceName(source) : 'the source branch'}` : 'There is no previous commit'
  if (own && !own.has(previous.oid)) return `The previous commit is on ${source ? sourceName(source) : 'the source branch'}`
  if (!unpushed.has(previous.oid)) return 'The previous commit is already pushed'
  if (isMerge(previous)) return "Merge commits can't be squashed here"
  return null
}

/** Whether the selected oids (any order) can be squashed into one commit. */
export function squashSelectedProblem(commits, oids, unpushed) {
  if (oids.length < 2) return 'Pick at least two commits'
  const chosen = new Set(oids)
  const picked = commits.filter(c => chosen.has(c.oid))
  if (picked.length !== chosen.size) return 'Those commits changed. Try again'
  for (const c of picked) {
    if (!unpushed.has(c.oid)) return 'Already pushed'
    if (isMerge(c)) return "Merge commits can't be squashed here"
  }
  for (let i = 0; i < picked.length - 1; i++) {
    if (picked[i].parents?.[0] !== picked[i + 1].oid) return 'Pick commits that are next to each other'
  }
  return null
}

/** Messages oldest first, trimmed and joined with a blank line. */
export function squashMessage(messages) {
  return messages.map(m => m.trim()).join('\n\n')
}

/**
 * The rebaseInteractive plan for one edit: { base, rows } with rows oldest first covering every commit
 * from the oldest touched one to HEAD. edit is { kind: 'reword', oid, message } or { kind: 'squash', oids, message }.
 * A squash group's message sits on its last (newest) row, where rebaseMessages looks for it.
 */
export function editPlan(commits, edit) {
  const oids = edit.kind === 'squash' ? edit.oids : [edit.oid]
  const indexes = oids.map(oid => commits.findIndex(c => c.oid === oid))
  if (!oids.length || indexes.some(i => i < 0)) throw new Error('That commit is no longer in the list')
  if (edit.kind === 'squash') {
    // The rows only squash the right commits when the chosen ones are a run with nothing between them.
    if (oids.length < 2 || new Set(oids).size !== oids.length) throw new Error('Pick at least two different commits')
    const sorted = [...indexes].sort((a, b) => a - b)
    if (sorted.some((at, k) => k > 0 && (at !== sorted[k - 1] + 1 || commits[sorted[k - 1]].parents?.[0] !== commits[at].oid))) {
      throw new Error('Pick commits that are next to each other')
    }
  }
  const oldest = Math.max(...indexes)
  const base = commits[oldest].parents?.[0]
  if (!base) throw new Error("The first commit on a branch can't be edited here")
  let rows = rebasePlan(commits.slice(0, oldest + 1).reverse())
  if (edit.kind === 'reword') {
    rows = setRowMessage(setRowAction(rows, edit.oid, 'reword'), edit.oid, edit.message)
  } else {
    const chosen = commits.filter(c => oids.includes(c.oid)).reverse() // oldest first
    for (const c of chosen.slice(1)) rows = setRowAction(rows, c.oid, 'squash')
    rows = setRowMessage(rows, chosen[chosen.length - 1].oid, edit.message)
  }
  return { base, rows }
}
