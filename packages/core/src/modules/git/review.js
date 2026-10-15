import { GIT_AREAS, statusCode, worktreeId, worktreeName, branchLabel } from './parse.js'
import { actionsFor, changePaths, isSubmodule, isNestedRepo } from './selection.js'

export const COMMIT_NOTE = 'Each worktree commits separately; if one fails the others are not undone.'

const TEXT = {
  stage: { verb: 'Stage', warning: null, needsTyping: null },
  unstage: { verb: 'Unstage', warning: null, needsTyping: null },
  discard: { verb: 'Discard changes in', warning: "Unstaged edits in these files will be lost. This can't be undone.", needsTyping: 'DISCARD' },
  delete: { verb: 'Delete', warning: "These untracked files will be deleted from disk. This can't be undone.", needsTyping: 'DELETE' },
}

const files = n => `${n} file${n === 1 ? '' : 's'}`

/** What the review dialog shows for a file action on the selected changes. */
export function fileReview(action, changes, selectedIds) {
  const applicable = actionsFor(changes, selectedIds)[action]
  const t = TEXT[action]
  return {
    action,
    title: `${t.verb} ${files(applicable.length)}`,
    files: applicable.map(c => ({ id: c.id, code: statusCode(c), path: c.path, originalPath: c.originalPath })),
    paths: [...new Set(applicable.flatMap(changePaths))],
    skipped: changes.filter(c => selectedIds.includes(c.id) && !applicable.includes(c)).map(c => ({
      id: c.id, path: c.path,
      reason: isSubmodule(c) ? 'submodule — manage it inside the submodule'
        : isNestedRepo(c) ? 'nested repository — manage it on its own' : `not applicable to ${action}`,
    })),
    warning: t.warning,
    needsTyping: t.needsTyping,
  }
}

/** Worktrees that could commit: those with staged changes. Only the selected one starts ticked. */
export function commitTargets(worktrees, selectedTreeId) {
  return worktrees.filter(t => !t.error && t.changes.some(c => c.area === GIT_AREAS.STAGED)).map(t => {
    const unavailable = t.operation ? `${t.operation}: continue or abort it first`
      : t.changes.some(c => c.area === GIT_AREAS.CONFLICT) ? 'Resolve conflicts first' : null
    return {
      id: worktreeId(t), tree: t, title: `${t.repo} › ${worktreeName(t)} → ${branchLabel(t)}`,
      staged: t.changes.filter(c => c.area === GIT_AREAS.STAGED), unavailable, ticked: !unavailable && worktreeId(t) === selectedTreeId,
    }
  })
}

/** One block per ticked, available target, with its staged files and message. */
export function commitReview(targets, { message = '', perTarget = null } = {}) {
  const chosen = targets.filter(t => t.ticked && !t.unavailable)
  const blocks = chosen.map(t => ({
    id: t.id, title: t.title, files: t.staged.map(c => `${statusCode(c)} ${c.path}`),
    message: String((perTarget ? perTarget[t.id] : message) ?? '').trim(),
  }))
  const error = !blocks.length ? 'Choose at least one worktree.' : blocks.some(b => !b.message) ? 'Enter a commit message.' : null
  return { blocks, note: COMMIT_NOTE, error }
}
