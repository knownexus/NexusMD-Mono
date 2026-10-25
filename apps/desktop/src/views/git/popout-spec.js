// What a Git Workspace pop-out window is asked to show, and how its page reads that back from the URL
// hash. The main process (electron/popout.cjs) checks the same shape again before opening a window.

export const POPOUT_KINDS = ['editor', 'conflict', 'diff']

/** The request for a window: `kind` of screen, for the file `path` (and `change` for a diff) in a worktree. */
export function popoutSpec(kind, { repo, worktree, registered, path, change = null }) {
  return {
    kind,
    repo: { name: repo.name, path: repo.path },
    worktree,
    path,
    registered: [...registered],
    ...(kind === 'diff' ? { changeId: change.id } : null),
  }
}

/** The request in a page's URL hash ("#popout=<json>"), or null when this isn't a pop-out page or it is malformed. */
export function parsePopoutHash(hash) {
  const m = /^#?popout=(.+)$/.exec(hash || '')
  if (!m) return null
  try {
    const spec = JSON.parse(decodeURIComponent(m[1]))
    const ok = spec && POPOUT_KINDS.includes(spec.kind) && spec.repo?.path && spec.worktree && spec.path && Array.isArray(spec.registered)
    return ok ? spec : null
  } catch {
    return null
  }
}
