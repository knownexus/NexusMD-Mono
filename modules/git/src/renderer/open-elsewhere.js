// Where "open this file in another app" goes from the Files tab.
//
// With the Editor app installed, the file opens there (it offers the editor.openPath capability).
// Without it, the file opens with the system's default app, which the main process allows only for
// plain text files that could not run anything (see git:openExternal).

// The file's full path: the worktree's path plus the repo-relative one, in the worktree's own style.
export function absolutePath(worktreePath, rel) {
  const win = worktreePath.includes('\\') && !worktreePath.includes('/')
  const sep = win ? '\\' : '/'
  return worktreePath.replace(/[\\/]+$/, '') + sep + (win ? rel.replace(/\//g, '\\') : rel)
}

export function openElsewhere({ host, adapter, repo, worktreePath, registered }) {
  if (host?.capabilities?.has('editor.openPath')) {
    return { label: 'Open in Editor', run: rel => host.capabilities.call('editor.openPath', absolutePath(worktreePath, rel)) }
  }
  return { label: 'Open with default app', run: rel => adapter.openExternal(repo, worktreePath, registered, rel) }
}
