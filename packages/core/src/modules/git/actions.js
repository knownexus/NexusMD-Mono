// packages/core/src/modules/git/actions.js
//
// Stage 4 (branch and sync actions): which worktrees an action applies to, what its preview dialog
// shows, and the two rules shared with devenv and git - where a new worktree goes, and which branch
// names git accepts. Main repeats the checks with git itself; these only catch mistakes early.

import { worktreeId, worktreeName, branchLabel } from './parse.js'

export const ACTION_KINDS = [
  'fetch', 'pull', 'push', 'branch', 'checkout', 'worktreeAdd', 'worktreeRemove',
  'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'revert', 'continue', 'skip', 'abort', 'rebaseInteractive',
]
export const BATCH_KINDS = ['fetch', 'pull']
export const BATCH_NOTE = 'Each repository runs separately; if one fails the others are not undone.'

const TITLES = {
  fetch: 'Fetch', pull: 'Pull', push: 'Push', branch: 'New branch', checkout: 'Check out', worktreeAdd: 'New worktree',
  worktreeRemove: 'Remove worktree', stashPush: 'Stash changes', stashApply: 'Apply stash', stashPop: 'Pop stash',
  stashDrop: 'Drop stash', revert: 'Revert', continue: 'Continue', skip: 'Skip', abort: 'Abort', rebaseInteractive: 'Interactive rebase',
}

function unavailableFor(kind, tree) {
  if (tree.error) return tree.error.startsWith('Missing') ? 'missing' : `error: ${tree.error}`
  if (kind !== 'pull') return null
  if (tree.operation) return `${tree.operation.replace(/ in progress$/, '').toLowerCase()} in progress`
  if (!tree.upstream) return 'no upstream'
  if (tree.upstreamGone) return 'upstream gone'
  return null
}

/**
 * The worktrees an action runs on. Fetch and fast-forward pull run across every worktree given (the
 * current group); everything else runs on the selected worktree only.
 */
export function actionTargets(kind, worktrees, selectedId) {
  if (!ACTION_KINDS.includes(kind)) throw new Error(`Unknown action: ${kind}`)
  const batch = BATCH_KINDS.includes(kind)
  const trees = batch ? worktrees : worktrees.filter(t => worktreeId(t) === selectedId)
  // One fetch per repository is enough: every worktree shares the object store.
  const seen = new Set()
  return trees.filter(t => kind !== 'fetch' || (!seen.has(t.repo) && seen.add(t.repo))).map(t => {
    const unavailable = unavailableFor(kind, t)
    return {
      id: worktreeId(t), repo: t.repo, repoRoot: t.repoRoot, worktreePath: t.path,
      title: `${t.repo} › ${worktreeName(t)} → ${branchLabel(t)}`, ticked: !unavailable, unavailable,
    }
  })
}

/** The preview dialog's model from per-target previews `{ target, preview | error }`. */
export function previewModel(kind, previews) {
  return {
    title: TITLES[kind] ?? kind,
    rows: previews.map(({ target, preview, error }) => ({
      id: target.id, label: target.title,
      eligible: !error && !target.unavailable && !!preview?.eligible,
      reason: error ?? target.unavailable ?? (preview?.eligible ? null : preview?.reason ?? null),
      details: preview?.details ?? null, programs: preview?.programs ?? [], stamp: preview?.stamp ?? null,
    })),
    note: BATCH_KINDS.includes(kind) ? BATCH_NOTE : null,
  }
}

const ILLEGAL = /[\\/:*?"<>|]/g

/**
 * devenv's rule (session.ps1 New-BranchWorktree): a sibling folder named after the branch's short
 * name, with characters Windows paths can't hold replaced by '-'. `remote` strips its prefix.
 */
export function worktreeDefaultPath(repoRoot, branch, { remote = false } = {}) {
  const short = remote ? branch.replace(/^[^/]+\//, '') : branch
  return `${String(repoRoot).replace(/[\\/]+$/, '')}/${short.replace(ILLEGAL, '-')}`
}

/** A first pass of `git check-ref-format --branch`; null when the name looks valid. */
export function checkBranchName(name) {
  const n = String(name ?? '')
  if (!n) return 'Give the branch a name.'
  if (n === '@') return "'@' isn't a branch name."
  if (n.startsWith('-') || n.startsWith('/')) return "A branch name can't start with - or /."
  if (n.endsWith('/') || n.endsWith('.') || n.endsWith('.lock')) return "A branch name can't end with /, . or .lock."
  if (n.includes('..') || n.includes('@{') || n.includes('//')) return "A branch name can't contain .., @{ or //."
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(n)) return "A branch name can't contain spaces or any of ~ ^ : ? * [ \\."
  if (n.split('/').some(p => p.startsWith('.'))) return "No part of a branch name can start with a dot."
  if (n.split('/').some(p => p.endsWith('.lock'))) return "No part of a branch name can end with .lock."
  if (n === 'HEAD') return "'HEAD' isn't a branch name."
  return null
}
