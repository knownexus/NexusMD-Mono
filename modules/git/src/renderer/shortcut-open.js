// shortcut-open.js — what the Git Workspace does for a Home shortcut to a file or folder (core shortcuts):
// the repositories it can offer to match one against, a request to open a place, and the plan for showing it.
// The Dashboard asks through the git.listRepos / git.openPath capabilities (index.js); view-git.jsx carries the plan out.
import { remoteFromRemotes, worktreeId, ignore, rendererLog } from '@nexusmd/core'

const log = rendererLog('git', 'shortcuts')

export const OPEN_EVENT = 'nexusmd:git-open'

// ── Repositories, with the remote each one was cloned from ────────────────────────────────────────────────
// Asking git costs a process per repository, so a remote is remembered for a minute.
const TTL = 60_000
const POOL = 4
const remotes = new Map()
export const forgetRepoRemotes = () => remotes.clear()

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
        try { remote = remoteFromRemotes(await adapter.remotes({ name: r.name, path: r.path }, r.path, registered)) } catch (e) {
          ignore(log, 'a repository whose remotes cannot be read has none to match a shortcut against', e)
          remote = ''
        }
        remotes.set(r.path, { at: now, remote })
      }
      out[i] = { name: r.name, path: r.path, provider: 'local', remote }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, repos.length) }, worker))
  return out
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
