import { describe, it, expect, vi } from 'vitest'
import {
  ALL_PROJECTS, findGroup, groupIncludesWorktree, groupIncludesBranch, scopeSnapshot, changeCount,
  uniqueName, groupNameError, renameGroup, duplicateGroup, deleteGroup, registerRepo, unregisterRepo,
} from './groups.js'

const tree = (repo, path, branch, changes = []) => ({ repo, repoRoot: `C:/repos/${repo}`, path, branch, rebasingBranch: null, changes })
const snapshot = {
  worktrees: [
    tree('A', 'C:/repos/A', 'main', [{ path: 'x', area: 'unstaged' }, { path: 'x', area: 'staged' }, { path: 'u', area: 'untracked' }]),
    tree('A', 'C:/repos/A/feature', 'feature/qr', [{ path: 'y', area: 'unstaged' }]),
    tree('B', 'C:/repos/B', 'main', [{ path: 'z', area: 'unstaged' }]),
  ],
  branches: [
    { repo: 'A', ref: 'refs/heads/main', id: 'b:A:refs/heads/main' },
    { repo: 'A', ref: 'refs/heads/feature/qr', id: 'b:A:refs/heads/feature/qr' },
    { repo: 'B', ref: 'refs/heads/parked', id: 'b:B:refs/heads/parked' },
  ],
}
const group = { name: 'QR', repos: [], worktrees: ['C:/repos/B'], branches: [{ repo: 'A', ref: 'refs/heads/feature/qr' }, { repo: 'B', ref: 'refs/heads/parked' }] }
const config = { version: 1, repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }], groups: [group], roots: null, view: {} }

describe('group membership', () => {
  it('matches whole repos, fixed worktree paths and branches that follow their checkout', () => {
    expect(groupIncludesWorktree(null, snapshot.worktrees[0])).toBe(true)
    expect(snapshot.worktrees.map(t => groupIncludesWorktree(group, t))).toEqual([false, true, true])
    expect(groupIncludesWorktree({ ...group, repos: ['A'] }, snapshot.worktrees[0])).toBe(true)
    expect(groupIncludesBranch(group, snapshot.branches[2])).toBe(true)
    expect(groupIncludesBranch(null, snapshot.branches[2])).toBe(false)
  })

  it('scopes a snapshot and lists only branch members that are not checked out', () => {
    const s = scopeSnapshot(snapshot, group)
    expect(s.worktrees.map(t => t.path)).toEqual(['C:/repos/A/feature', 'C:/repos/B'])
    expect(s.inactiveBranches.map(b => b.id)).toEqual(['b:B:refs/heads/parked'])
    expect(scopeSnapshot(snapshot, null).inactiveBranches).toEqual([])
    expect(scopeSnapshot(null, group)).toEqual({ worktrees: [], inactiveBranches: [] })
  })

  it('counts distinct changed paths, optionally without untracked files', () => {
    expect(changeCount(snapshot, null)).toBe(4)
    expect(changeCount(snapshot, null, { showUntracked: false })).toBe(3)
    expect(changeCount(snapshot, group)).toBe(2)
  })

  it('finds groups by name and treats Registered repos (and the old All projects) as no group', () => {
    expect(ALL_PROJECTS).toBe('Registered repos')
    expect(findGroup(config, 'QR')).toBe(group)
    expect(findGroup(config, ALL_PROJECTS)).toBeNull()
    expect(findGroup(config, 'All projects')).toBeNull()
    expect(findGroup(config, 'missing')).toBeNull()
  })
})

describe('group names', () => {
  it('rejects blank, reserved and duplicate names case-insensitively', () => {
    expect(groupNameError(config, ' ')).toMatch(/name/)
    expect(groupNameError(config, 'registered REPOS')).toMatch(/Registered repos is reserved/)
    expect(groupNameError(config, 'all PROJECTS')).toMatch(/All projects is reserved/)
    expect(groupNameError(config, 'qr')).toMatch(/already exists/)
    expect(groupNameError(config, 'qr', 'QR')).toBeNull()
    expect(uniqueName('joiners', ['Joiners', 'joiners 2'])).toBe('joiners 3')
    expect(uniqueName('New', [])).toBe('New')
  })

  it('renames, duplicates and deletes without mutating the input', () => {
    const renamed = renameGroup(config, 'QR', 'Secure QR')
    expect(renamed.groups.map(g => g.name)).toEqual(['Secure QR'])
    expect(config.groups[0].name).toBe('QR')
    const copy = duplicateGroup(config, 'QR', 'QR copy')
    expect(copy.groups.map(g => g.name)).toEqual(['QR', 'QR copy'])
    copy.groups[1].branches.push({ repo: 'X', ref: 'y' })
    expect(group.branches).toHaveLength(2)
    expect(deleteGroup(config, 'QR').groups).toEqual([])
    expect(() => renameGroup(config, 'QR', 'All projects')).toThrow(/reserved/)
  })
})

describe('repo registration', () => {
  it('registers a repository under its folder name, refusing the same repository twice', async () => {
    const adapter = { resolve: vi.fn(async dir => ({ commonDir: dir.toLowerCase().includes('a-clone') ? 'C:/repos/A/.git' : `${dir}/.git` })) }
    const next = await registerRepo(config, 'D:\\src\\a\\', adapter)
    expect(next.repos.at(-1)).toEqual({ name: 'a 2', path: 'D:\\src\\a\\' })
    await expect(registerRepo(config, 'D:/src/a-clone', { resolve: async dir => ({ commonDir: dir.includes('clone') ? 'c:/repos/a/.git/' : 'C:/repos/A/.git' }) }))
      .rejects.toThrow('That repository is already registered as A')
  })

  it('unregisters by name and leaves groups untouched', () => {
    const next = unregisterRepo(config, 'B')
    expect(next.repos.map(r => r.name)).toEqual(['A'])
    expect(next.groups).toBe(config.groups)
  })
})
