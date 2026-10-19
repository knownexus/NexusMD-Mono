// Parsers for git's machine-readable output. Ported from gws (Git.ParseStatus,
// Git.ParseWorktrees, History.Branches) so both tools read git the same way.

export const GIT_AREAS = Object.freeze({ STAGED: 'staged', UNSTAGED: 'unstaged', CONFLICT: 'conflict', UNTRACKED: 'untracked' })

const change = (path, originalPath, xy, area, sub) => ({ path, originalPath, xy, area, sub, id: `${area}\0${path}` })

function splitN(s, sep, n) {
  const out = []
  let start = 0
  while (out.length < n - 1) {
    const i = s.indexOf(sep, start)
    if (i < 0) break
    out.push(s.slice(start, i))
    start = i + 1
  }
  out.push(s.slice(start))
  return out
}

/**
 * Parses `git status --porcelain=v2 --branch -z --untracked-files=all`.
 * A file changed on both the staged and unstaged side yields two changes.
 */
export function parseStatus(output) {
  const result = { branch: '(detached)', head: '', upstream: null, ahead: 0, behind: 0, hasAb: false, changes: [] }
  const records = (output || '').split('\0')
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.startsWith('# branch.head ')) result.branch = r.slice(14)
    else if (r.startsWith('# branch.oid ')) result.head = r.slice(13)
    else if (r.startsWith('# branch.upstream ')) result.upstream = r.slice(18)
    else if (r.startsWith('# branch.ab ')) {
      const [ahead, behind] = r.slice(12).split(' ')
      result.ahead = Number(ahead.slice(1))
      result.behind = Number(behind.slice(1))
      result.hasAb = true
    }
    else if (r.startsWith('? ')) result.changes.push(change(r.slice(2), null, '??', GIT_AREAS.UNTRACKED, 'N...'))
    else if (/^[12u] /.test(r)) {
      const kind = r[0]
      const parts = splitN(r, ' ', kind === '1' ? 9 : kind === '2' ? 10 : 11)
      const path = parts[parts.length - 1]
      const xy = parts[1]
      const sub = parts[2]
      // Renames carry the original path as the next NUL-separated record.
      const original = kind === '2' ? records[++i] : null
      if (kind === 'u') result.changes.push(change(path, original, xy, GIT_AREAS.CONFLICT, sub))
      else {
        if (xy[0] !== '.') result.changes.push(change(path, original, xy, GIT_AREAS.STAGED, sub))
        if (xy[1] !== '.' || (sub.startsWith('S') && sub !== 'S...')) result.changes.push(change(path, original, xy, GIT_AREAS.UNSTAGED, sub))
      }
    }
  }
  return result
}

/** Two-letter status: staged side on the left, unstaged side on the right. */
export function statusCode(c) {
  if (c.area === GIT_AREAS.UNTRACKED) return '??'
  if (c.area === GIT_AREAS.CONFLICT) return c.xy.replace(/\./g, ' ').padEnd(2).slice(0, 2)
  if (c.area === GIT_AREAS.STAGED) return `${c.xy[0] === '.' ? 'M' : c.xy[0]} `
  return ` ${c.xy.length > 1 && c.xy[1] !== '.' ? c.xy[1] : 'M'}`
}

function newWorktree(repo, commonDir, path) {
  return {
    repo: repo.name, repoRoot: repo.path, path, commonDir,
    branch: '(detached)', head: '', rebasingBranch: null, upstream: null, upstreamGone: false,
    ahead: 0, behind: 0, operation: '', error: '', locked: null, prunable: null, fetchedAt: null, changes: [],
  }
}

/** Parses `git worktree list --porcelain -z`; the bare entry of a bare repository is skipped. */
export function parseWorktrees(output, repo, commonDir) {
  const trees = []
  let current = null
  let bare = false
  const flush = () => { if (current && !bare) trees.push(current); current = null }
  for (const field of (output || '').split('\0')) {
    if (field.startsWith('worktree ')) { flush(); current = newWorktree(repo, commonDir, field.slice(9)); bare = false }
    else if (current) {
      if (field === 'bare') bare = true
      else if (field.startsWith('branch ')) current.branch = field.slice(7).replace(/^refs\/heads\//, '')
      else if (field.startsWith('HEAD ')) current.head = field.slice(5)
      else if (field.startsWith('locked')) current.locked = field.length > 7 ? field.slice(7) : 'Locked'
      else if (field.startsWith('prunable')) current.prunable = field.length > 9 ? field.slice(9) : 'Stale registration'
      else if (field === '') flush()
    }
  }
  flush()
  return trees
}

/** Parses `git for-each-ref --format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short) refs/heads/`. */
export function parseBranches(output, repo, commonDir) {
  return (output || '').split('\n')
    .map(line => line.replace(/\r$/, '').split('\0'))
    .filter(p => p.length === 4 && !p[0].endsWith('/HEAD'))
    .map(([ref, head, subject, upstream]) => ({
      repo: repo.name, commonDir, ref, head, subject, upstream: upstream || null,
      name: ref.replace(/^refs\/heads\//, ''), id: `b:${repo.name}:${ref}`,
    }))
}

const slashes = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')

export function worktreeId(tree) {
  return slashes(tree.path)
}

export function worktreeName(tree) {
  const path = slashes(tree.path)
  const root = slashes(tree.repoRoot)
  if (path.toLowerCase() === root.toLowerCase()) return 'checkout'
  if (path.toLowerCase().startsWith(root.toLowerCase() + '/')) return path.slice(root.length + 1)
  return path
}

export function activeBranchRef(tree) {
  return tree.rebasingBranch ?? (tree.branch === '(detached)' ? null : `refs/heads/${tree.branch}`)
}

export function branchLabel(tree) {
  return tree.rebasingBranch ? `${tree.rebasingBranch.replace(/^refs\/heads\//, '')} (rebasing)` : tree.branch
}

/** The short name of the branch this worktree is working on (the one being rebased, during a rebase), or null when detached. */
export function checkoutName(tree) {
  if (tree.rebasingBranch) return tree.rebasingBranch.replace(/^refs\/heads\//, '')
  return tree.branch && tree.branch !== '(detached)' ? tree.branch : null
}
