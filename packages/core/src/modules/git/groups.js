import { worktreeId, activeBranchRef } from './parse.js'

export const ALL_PROJECTS = 'All projects'

const lower = s => String(s ?? '').toLowerCase()
const samePath = (a, b) => lower(a).replace(/\\/g, '/').replace(/\/+$/, '') === lower(b).replace(/\\/g, '/').replace(/\/+$/, '')

export function findGroup(config, name) {
  if (name === ALL_PROJECTS) return null
  return (config?.groups || []).find(g => g.name === name) || null
}

export function groupIncludesWorktree(group, tree) {
  if (!group) return true
  const ref = activeBranchRef(tree)
  return group.repos.includes(tree.repo) || group.worktrees.includes(worktreeId(tree)) ||
    group.branches.some(b => b.repo === tree.repo && b.ref === ref)
}

export function groupIncludesBranch(group, branch) {
  return !!group && (group.repos.includes(branch.repo) || group.branches.some(b => b.repo === branch.repo && b.ref === branch.ref))
}

/** Worktrees in the group, plus branch members that are not checked out in any worktree. */
export function scopeSnapshot(snapshot, group) {
  const all = snapshot?.worktrees || []
  const worktrees = all.filter(t => groupIncludesWorktree(group, t))
  const checkedOut = new Set(all.map(t => `${t.repo}\0${activeBranchRef(t)}`))
  const inactiveBranches = group
    ? (snapshot?.branches || []).filter(b => group.branches.some(s => s.repo === b.repo && s.ref === b.ref) && !checkedOut.has(`${b.repo}\0${b.ref}`))
    : []
  return { worktrees, inactiveBranches }
}

export function changeCount(snapshot, group, { showUntracked = true } = {}) {
  return scopeSnapshot(snapshot, group).worktrees.reduce((n, t) =>
    n + new Set(t.changes.filter(c => showUntracked || c.area !== 'untracked').map(c => c.path)).size, 0)
}

export function uniqueName(name, taken) {
  const used = new Set(taken.map(lower))
  if (!used.has(lower(name))) return name
  for (let n = 2; ; n++) if (!used.has(lower(`${name} ${n}`))) return `${name} ${n}`
}

/** Returns why `name` can't be used for a group (ignoring the group being renamed), or null. */
export function groupNameError(config, name, existingName = null) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Choose a group name.'
  if (lower(trimmed) === lower(ALL_PROJECTS)) return 'All projects is reserved — choose another name.'
  if ((config.groups || []).some(g => g.name !== existingName && lower(g.name) === lower(trimmed))) return 'A group with that name already exists.'
  return null
}

function checkName(config, name, existingName) {
  const error = groupNameError(config, name, existingName)
  if (error) throw new Error(error)
  return String(name).trim()
}

const copyGroup = g => ({ ...g, repos: [...g.repos], worktrees: [...g.worktrees], branches: g.branches.map(b => ({ ...b })) })

export function renameGroup(config, oldName, newName) {
  const name = checkName(config, newName, oldName)
  return { ...config, groups: config.groups.map(g => g.name === oldName ? { ...copyGroup(g), name } : g) }
}

export function duplicateGroup(config, sourceName, newName) {
  const name = checkName(config, newName)
  const source = config.groups.find(g => g.name === sourceName)
  if (!source) throw new Error(`No group named ${sourceName}`)
  return { ...config, groups: [...config.groups, { ...copyGroup(source), name }] }
}

export function deleteGroup(config, name) {
  return { ...config, groups: config.groups.filter(g => g.name !== name) }
}

/**
 * Registers the repository at `path` under its folder name (suffixed if taken).
 * Refuses a second registration of the same repository, compared by git common dir.
 */
export async function registerRepo(config, path, adapter) {
  const { commonDir } = await adapter.resolve(path)
  for (const repo of config.repos) {
    let other = null
    try { other = (await adapter.resolve(repo.path)).commonDir } catch { /* an unavailable registration can't clash */ }
    if (other && samePath(other, commonDir)) throw new Error(`That repository is already registered as ${repo.name}`)
  }
  const folder = String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return { ...config, repos: [...config.repos, { name: uniqueName(folder, config.repos.map(r => r.name)), path }] }
}

/** Removes a registration only; repository files and saved group entries are untouched. */
export function unregisterRepo(config, name) {
  return { ...config, repos: config.repos.filter(r => r.name !== name) }
}
