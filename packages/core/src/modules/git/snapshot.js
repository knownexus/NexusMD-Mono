import { parseStatus, parseWorktrees, parseBranches, worktreeId } from './parse.js'

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

const message = e => e?.message || String(e)

/** Merges one `adapter.status` result into a parsed worktree. */
export function applyStatus(tree, s) {
  if (s?.error) { tree.error = s.error; return tree }
  if (s?.missing) { tree.error = `Missing worktree${tree.prunable ? ' · stale registration' : ''}`; return tree }
  const p = parseStatus(s?.porcelain || '')
  Object.assign(tree, {
    branch: p.branch, head: p.head || tree.head, upstream: p.upstream, ahead: p.ahead, behind: p.behind, changes: p.changes,
    // Porcelain v2 omits branch.ab when the configured upstream ref no longer exists.
    upstreamGone: !!p.upstream && !p.hasAb,
    operation: s.operation || '', rebasingBranch: s.rebasingBranch || null, operationInfo: s.operationInfo || null, fetchedAt: s.fetchedAt || null,
  })
  return tree
}

export function worktreeSummary(tree) {
  return {
    changed: new Set(tree.changes.map(c => c.path)).size,
    staged: tree.changes.filter(c => c.area === 'staged').length,
  }
}

// One repo's worktrees (with status) and branches; a failure is the repo's error, not a throw.
// Untracked files are read collapsed (a new folder is one entry) unless the worktree is in `full`:
// listing every untracked file of a repository with tens of thousands of them takes seconds.
async function loadRepo(adapter, repo, registered, concurrency, full = new Set()) {
  try {
    const { commonDir } = await adapter.resolve(repo.path)
    const trees = parseWorktrees(await adapter.worktrees(repo, registered), repo, commonDir)
    await mapLimit(trees, concurrency, async tree => {
      let s
      const all = full.has(worktreeId(tree))
      try { s = await adapter.status(repo, tree.path, registered, { untracked: all ? 'all' : 'normal' }) } catch (e) { s = { error: message(e) } }
      applyStatus(tree, s)
      tree.untrackedFull = all
    })
    const branches = parseBranches(await adapter.branches(repo, registered), repo, commonDir)
    return { trees, branches, error: null }
  } catch (e) {
    return { trees: [], branches: [], error: { repo: repo.name, message: message(e) } }
  }
}

// The snapshot of `repos`, in their order, from each repo's part.
function assemble(repos, partOf, takenAt) {
  const parts = repos.map(partOf)
  return {
    worktrees: parts.flatMap(r => r.trees),
    branches: parts.flatMap(r => r.branches),
    errors: parts.filter(r => r.error).map(r => r.error),
    takenAt,
  }
}

/**
 * Reads every registered repo through the git adapter. A repo that fails is reported in
 * `errors`; a worktree whose status fails carries `error` — neither stops the others.
 * `fullFor`: worktree ids (their paths, slashes forward) whose untracked files are listed one by one.
 * @param {{ concurrency?: number, now?: () => Date, fullFor?: string[] }} [options]
 */
export async function loadSnapshot(adapter, repos, { concurrency = 4, now = () => new Date(), fullFor = [] } = {}) {
  const registered = repos.map(r => r.path)
  const full = new Set(fullFor)
  const parts = await mapLimit(repos, concurrency, repo => loadRepo(adapter, repo, registered, concurrency, full))
  return assemble(repos, (_r, i) => parts[i], now().toISOString())
}

/**
 * Reads only the named repos again and puts them into `snapshot`, keeping the others as they were:
 * after a write, only the repo written to has changed, and reading every repo takes seconds.
 * @param {{ concurrency?: number, now?: () => Date }} [options]
 */
export async function refreshRepos(adapter, repos, snapshot, names, { concurrency = 4, now = () => new Date(), fullFor = [] } = {}) {
  const registered = repos.map(r => r.path)
  const full = new Set(fullFor)
  const wanted = repos.filter(r => names.includes(r.name))
  const fresh = new Map(wanted.map((r, i) => [r.name, i]))
  const parts = await mapLimit(wanted, concurrency, repo => loadRepo(adapter, repo, registered, concurrency, full))
  const kept = name => ({
    trees: snapshot.worktrees.filter(t => t.repo === name),
    branches: snapshot.branches.filter(b => b.repo === name),
    error: snapshot.errors.find(e => e.repo === name) ?? null,
  })
  return assemble(repos, r => (fresh.has(r.name) ? parts[fresh.get(r.name)] : kept(r.name)), now().toISOString())
}
