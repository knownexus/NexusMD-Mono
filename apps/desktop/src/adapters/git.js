// Renderer-side `git` adapter (contract: IGitAdapter in packages/core/src/adapters/index.js),
// calling through to window.electronAPI.git from electron/preload.cjs.

const api = () => window.electronAPI?.git

export const gitAdapter = {
  isAvailable() { return !!api() },
  version() { return api().version() },
  resolve(dir) { return api().resolve(dir) },
  worktrees(repo, registered) { return api().worktrees(repo, registered) },
  status(repo, worktreePath, registered) { return api().status(repo, worktreePath, registered) },
  branches(repo, registered) { return api().branches(repo, registered) },
  discover(roots, repos) { return api().discover(roots, repos) },
  checkFolders(paths) { return api().checkFolders(paths) },
  diff(repo, worktreePath, registered, change) { return api().diff(repo, worktreePath, registered, change) },
  stamp(repo, worktreePath, registered, request) { return api().stamp(repo, worktreePath, registered, request) },
  stage(repo, worktreePath, registered, paths, expected) { return api().stage(repo, worktreePath, registered, paths, expected) },
  unstage(repo, worktreePath, registered, paths, expected) { return api().unstage(repo, worktreePath, registered, paths, expected) },
  discard(repo, worktreePath, registered, paths, expected) { return api().discard(repo, worktreePath, registered, paths, expected) },
  deleteUntracked(repo, worktreePath, registered, paths, expected) { return api().deleteUntracked(repo, worktreePath, registered, paths, expected) },
  stageHunk(repo, worktreePath, registered, paths, index, expected) { return api().stageHunk(repo, worktreePath, registered, paths, index, expected) },
  unstageHunk(repo, worktreePath, registered, paths, index, expected) { return api().unstageHunk(repo, worktreePath, registered, paths, index, expected) },
  commit(repo, worktreePath, registered, message, expected) { return api().commit(repo, worktreePath, registered, message, expected) },
  refs(repo, worktreePath, registered) { return api().refs(repo, worktreePath, registered) },
  log(repo, worktreePath, registered, query) { return api().log(repo, worktreePath, registered, query) },
  commitDetails(repo, worktreePath, registered, oid) { return api().commitDetails(repo, worktreePath, registered, oid) },
  commitFiles(repo, worktreePath, registered, oid, parent) { return api().commitFiles(repo, worktreePath, registered, oid, parent) },
  commitDiff(repo, worktreePath, registered, oid, parent, paths) { return api().commitDiff(repo, worktreePath, registered, oid, parent, paths) },
  remotes(repo, worktreePath, registered) { return api().remotes(repo, worktreePath, registered) },
  stashes(repo, worktreePath, registered) { return api().stashes(repo, worktreePath, registered) },
  preview(repo, worktreePath, registered, kind, options) { return api().preview(repo, worktreePath, registered, kind, options) },
  run(repo, worktreePath, registered, kind, options, stamp) { return api().run(repo, worktreePath, registered, kind, options, stamp) },
}
