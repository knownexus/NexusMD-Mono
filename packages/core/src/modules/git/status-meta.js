// packages/core/src/modules/git/status-meta.js
//
// What a worktree needs from the user, as data the Git Workspace view renders: its tone, the
// non-default facts worth showing (never "↑0 ↓0"), the filter chips it falls under, a repo's
// summary pills, and the one action that moves it forward. Pure; works on snapshot worktrees
// ({ repo, branch, upstream, upstreamGone, ahead, behind, changes: [{ area }], operation, operationInfo, error }).

const DETACHED = '(detached)'
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/** The header filter chips, in order. Counts are branches (worktrees), never files. */
export const BRANCH_FILTERS = [
  { id: 'all', label: 'All', tone: 'muted', title: 'Every branch' },
  { id: 'busy', label: 'In progress', tone: 'bad', title: 'A rebase, merge, revert or cherry-pick stopped part-way' },
  { id: 'changes', label: 'Uncommitted', tone: 'warn', title: 'Branches with changed files not yet committed' },
  { id: 'push', label: 'To push', tone: 'info', title: 'Branches with local commits not on their upstream' },
  { id: 'pull', label: 'To pull', tone: 'info', title: 'Branches behind their upstream' },
  { id: 'local', label: 'Not published', tone: 'muted', title: 'Branches with no upstream, or whose upstream was deleted' },
]

/** Counts and flags for one worktree. tone: bad | warn | info | muted | ok. */
export function branchState(tree) {
  const changes = tree.changes ?? []
  const conflicts = changes.filter(c => c.area === 'conflict').length
  const staged = changes.filter(c => c.area === 'staged').length
  const changed = changes.length
  const ahead = tree.ahead || 0
  const behind = tree.behind || 0
  const detached = tree.branch === DETACHED
  const unpublished = !tree.error && !detached && (!tree.upstream || !!tree.upstreamGone)
  const busy = !!tree.operation
  const tone = tree.error || busy ? 'bad' : changed ? 'warn' : ahead || behind ? 'info' : unpublished ? 'muted' : 'ok'
  return { conflicts, staged, changed, ahead, behind, detached, unpublished, busy, tone }
}

/** Whether a worktree falls under a BRANCH_FILTERS id. */
export function matchesFilter(tree, id = 'all') {
  if (id === 'all') return true
  if (tree.error) return false
  const s = branchState(tree)
  if (id === 'busy') return s.busy
  if (id === 'changes') return s.changed > 0
  if (id === 'push') return s.ahead > 0
  if (id === 'pull') return s.behind > 0
  if (id === 'local') return s.unpublished
  return false
}

/** { [filterId]: number of worktrees } for the chips. */
export function filterCounts(trees) {
  return Object.fromEntries(BRANCH_FILTERS.map(f => [f.id, trees.filter(t => matchesFilter(t, f.id)).length]))
}

function operationLabel(tree) {
  const info = tree.operationInfo
  const kind = info?.kind
  const verb = { rebase: 'Rebasing', merge: 'Merging', revert: 'Reverting', 'cherry-pick': 'Cherry-picking' }[kind]
  if (verb && info?.step && info?.total) return `${verb} ${info.step}/${info.total}`
  return verb || tree.operation
}

/**
 * The facts a branch row shows, most urgent first: [{ text, tone, strong? }]. Only non-default facts;
 * a clean, synced, published branch is just "Up to date". `worktree` is shown when it differs from the branch.
 */
export function branchMeta(tree, { worktree = null } = {}) {
  if (tree.error) return [{ text: tree.error, tone: 'bad', strong: true }]
  const s = branchState(tree)
  const out = []
  if (s.busy) out.push({ text: `${operationLabel(tree)}${s.conflicts ? ` · ${plural(s.conflicts, 'conflict')}` : ''}`, tone: 'bad', strong: true })
  if (worktree) out.push({ text: worktree, tone: 'muted' })
  if (s.changed && !s.busy) out.push({ text: `${plural(s.changed, 'file')} changed${s.staged ? ` · ${s.staged} staged` : ''}`, tone: 'warn' })
  if (s.ahead) out.push({ text: `↑${s.ahead} to push`, tone: 'info' })
  if (s.behind) out.push({ text: `↓${s.behind} to pull`, tone: 'info' })
  if (tree.upstreamGone) out.push({ text: 'upstream deleted', tone: 'warn' })
  else if (s.unpublished) out.push({ text: 'not published', tone: 'muted' })
  if (!out.length || (out.length === 1 && worktree)) out.push({ text: 'Up to date', tone: 'ok' })
  return out
}

/** A repository header's pills across its worktrees: [{ text, tone }]. */
export function repoPills(trees) {
  const states = trees.filter(t => !t.error).map(branchState)
  const pills = []
  const busy = states.filter(s => s.busy).length
  const dirty = states.filter(s => s.changed).length
  const ahead = states.reduce((n, s) => n + s.ahead, 0)
  const behind = states.reduce((n, s) => n + s.behind, 0)
  if (trees.some(t => t.error)) pills.push({ text: 'error', tone: 'bad' })
  if (busy) pills.push({ text: busy === 1 ? 'in progress' : `${busy} in progress`, tone: 'bad' })
  if (dirty) pills.push({ text: `${dirty} uncommitted`, tone: 'warn' })
  if (ahead) pills.push({ text: `↑${ahead}`, tone: 'info' })
  if (behind) pills.push({ text: `↓${behind}`, tone: 'info' })
  if (!pills.length) pills.push({ text: 'all clean', tone: 'ok' })
  return pills
}

/** The one action that moves a worktree forward, or null: { kind: resolve | pull | push | review | publish, label }. */
export function primaryAction(tree) {
  if (tree.error) return null
  const s = branchState(tree)
  if (s.busy) return { kind: 'resolve', label: s.conflicts ? `Resolve ${plural(s.conflicts, 'conflict')}` : 'Continue' }
  if (s.behind) return { kind: 'pull', label: `Pull ↓${s.behind}` }
  if (s.ahead) return { kind: 'push', label: `Push ↑${s.ahead}` }
  if (s.changed) return { kind: 'review', label: 'Review & commit' }
  if (s.unpublished) return { kind: 'publish', label: 'Push' }
  return null
}
