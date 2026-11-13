// shortcut-open.js — what the Git Workspace does for a Home shortcut to a file or folder (core shortcuts):
// the repositories it can offer to match one against, a request to open a place, and the plan for showing it.
// The Dashboard asks through the git.listRepos / git.openPath capabilities (index.js); view-git.jsx carries the plan out.
import { remoteFromRemotes, cloneRepoIdentity, parseWorktrees, worktreeId, ignore, rendererLog } from '@nexusmd/core'

const log = rendererLog('git', 'shortcuts')

export const OPEN_EVENT = 'nexusmd:git-open'

// ── Repositories, with the remote each one was cloned from ────────────────────────────────────────────────
// Asking git costs a process per repository, so a remote is remembered for a minute.
const TTL = 60_000
const POOL = 4
const remotes = new Map()
export const forgetRepoRemotes = () => remotes.clear()

// A worktree of a registered repository that git can be asked in: the one at the repository's own path, else the first one
// there is. A repository kept as a folder of worktrees (a bare repository with its working copies inside it) has none at its
// own path, and git refuses to be asked about a folder that is not a worktree. null when there is none.
async function usableWorktree(adapter, repo, registered) {
  const listed = parseWorktrees(await adapter.worktrees({ name: repo.name, path: repo.path }, registered), repo, '')
  const usable = listed.filter(t => !t.prunable)
  return (usable.find(t => samePath(t.path, repo.path)) ?? usable[0])?.path ?? null
}

// The normalized origin of a repository; '' when it has none or git cannot be asked.
async function readRemote(adapter, repo, worktreePath, registered) {
  try { return remoteFromRemotes(await adapter.remotes(repo, worktreePath, registered)) } catch (e) {
    ignore(log, 'a repository whose remotes cannot be read has none to match a shortcut against', e)
    return ''
  }
}

// The same, finding the worktree to ask in first.
async function readRepoRemote(adapter, repo, registered) {
  try {
    const worktree = await usableWorktree(adapter, repo, registered)
    return worktree ? await readRemote(adapter, { name: repo.name, path: repo.path }, worktree, registered) : ''
  } catch (e) {
    ignore(log, 'a repository whose worktrees cannot be listed has no remote to match a shortcut against', e)
    return ''
  }
}

/** The registered repositories as { name, path, provider: 'local', remote }, remote being the normalized `origin` ('' without one). */
export async function listLocalRepos(adapter, repos, now = Date.now()) {
  const registered = repos.map(r => r.path)
  const out = new Array(repos.length)
  let next = 0
  const worker = async () => {
    while (next < repos.length) {
      const i = next++
      const r = repos[i]
      const hit = remotes.get(r.path)
      let remote
      if (hit && now - hit.at < TTL) remote = hit.remote
      else {
        remote = await readRepoRemote(adapter, r, registered)
        remotes.set(r.path, { at: now, remote })
      }
      out[i] = { name: r.name, path: r.path, provider: 'local', remote }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, repos.length) }, worker))
  return out
}

// ── Pinning: a shortcut to a row of the Files tab ─────────────────────────────────────────────────────────────
/**
 * The shortcut target for a file or folder of a registered repository (`path` is repo-relative). A clone of a GitHub
 * repository is named by its owner/name, so any device can find it; any other clone by its remote and folder name, which
 * the devices that have the repository can match, and the rest show greyed out.
 */
export async function localPinTarget({ adapter, repo, worktreePath, registered, kind, path }) {
  const remote = await readRemote(adapter, repo, worktreePath, registered)
  return {
    target: 'git', kind, path: '/' + String(path || '').replace(/^\/+/, ''),
    repo: cloneRepoIdentity({ name: repo.name, remote }),
  }
}

/** Every file of a registered repository (repo-relative paths), for choosing one: { files, truncated }. */
export async function listRepoFiles(adapter, repos, repoPath) {
  const repo = repos.find(r => samePath(r.path, repoPath))
  if (!repo) throw new Error('That repository is not registered.')
  const registered = repos.map(x => x.path)
  const worktree = await usableWorktree(adapter, repo, registered)
  if (!worktree) throw new Error('That repository has no worktree to list the files of.')
  const r = await adapter.files({ name: repo.name, path: repo.path }, worktree, registered)
  return { files: Array.isArray(r?.files) ? r.files : [], truncated: !!r?.truncated }
}

// ── The request: a place to show, waiting for the screen to take it ───────────────────────────────────────
// spec: { repoPath?, githubRepo?, branch?, path (repo-relative, leading slash), kind: 'file' | 'folder' }
let pending = null
export function requestOpen(spec) {
  pending = spec
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}
/** The waiting request, once: null when there is none. */
export function takeOpenRequest() {
  const p = pending
  pending = null
  return p
}

// ── The plan ───────────────────────────────────────────────────────────────────────────────────────────────
const samePath = (a, b) => String(a || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// The folders to open, and the file to pick, in an explorer (its paths are repo-relative, with no leading slash).
export function explorerState(kind, path) {
  const rel = String(path || '').replace(/^\/+|\/+$/g, '')
  if (!rel) return { open: [], selected: null }
  const parts = rel.split('/')
  const upTo = n => parts.slice(0, n).map((_, i) => parts.slice(0, i + 1).join('/'))
  return kind === 'file' ? { open: upTo(parts.length - 1), selected: rel } : { open: upTo(parts.length), selected: null }
}

/**
 * What to show for a request, given the registered `repos` and the snapshot's worktrees:
 *   { kind: 'local', repo, tree, viewKey, open, selected }   a registered repository's worktree: the one on the
 *                                                            request's branch, else the main one
 *   { kind: 'github', githubRepo, viewKey, open, selected }  no local copy: the GitHub tab (viewKey only when the
 *                                                            branch is known, since the explorer is kept per branch)
 *   { kind: 'missing' }                                      nothing to show it in
 */
export function planOpen(req, { repos = [], trees = [] } = {}) {
  if (!req) return { kind: 'missing' }
  const repo = req.repoPath ? repos.find(r => samePath(r.path, req.repoPath)) : null
  const state = explorerState(req.kind, req.path)
  if (repo) {
    const usable = trees.filter(t => t.repo === repo.name && !t.prunable && !t.error)
    const main = usable.find(t => worktreeId(t) === worktreeId({ path: repo.path }))
    const onBranch = req.branch ? usable.find(t => t.branch === req.branch) : null
    const tree = onBranch ?? main ?? usable[0]
    if (tree) return { kind: 'local', repo, tree, viewKey: `local:${tree.path}`, ...state }
  }
  if (req.githubRepo) {
    return { kind: 'github', githubRepo: req.githubRepo, viewKey: req.branch ? `github:${req.githubRepo}@${req.branch}` : null, ...state }
  }
  return { kind: 'missing' }
}
