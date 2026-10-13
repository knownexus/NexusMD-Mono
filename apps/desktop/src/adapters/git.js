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
}
