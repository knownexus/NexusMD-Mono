import { parseStatus, parseWorktrees, parseBranches } from './parse.js'

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
    upstreamGone: !!p.upstream && !s.upstreamResolves,
    operation: s.operation || '', rebasingBranch: s.rebasingBranch || null, fetchedAt: s.fetchedAt || null,
  })
  return tree
}

export function worktreeSummary(tree) {
  return {
    changed: new Set(tree.changes.map(c => c.path)).size,
    staged: tree.changes.filter(c => c.area === 'staged').length,
  }
}

/**
 * Reads every registered repo through the git adapter. A repo that fails is reported in
 * `errors`; a worktree whose status fails carries `error` — neither stops the others.
 * @param {{ concurrency?: number, now?: () => Date }} [options]
 */
export async function loadSnapshot(adapter, repos, { concurrency = 4, now = () => new Date() } = {}) {
  const registered = repos.map(r => r.path)
  const perRepo = await mapLimit(repos, concurrency, async repo => {
    try {
      const { commonDir } = await adapter.resolve(repo.path)
      const trees = parseWorktrees(await adapter.worktrees(repo, registered), repo, commonDir)
      await mapLimit(trees, concurrency, async tree => {
        let s
        try { s = await adapter.status(repo, tree.path, registered) } catch (e) { s = { error: message(e) } }
        applyStatus(tree, s)
      })
      const branches = parseBranches(await adapter.branches(repo, registered), repo, commonDir)
      return { trees, branches, error: null }
    } catch (e) {
      return { trees: [], branches: [], error: { repo: repo.name, message: message(e) } }
    }
  })
  return {
    worktrees: perRepo.flatMap(r => r.trees),
    branches: perRepo.flatMap(r => r.branches),
    errors: perRepo.filter(r => r.error).map(r => r.error),
    takenAt: now().toISOString(),
  }
}
