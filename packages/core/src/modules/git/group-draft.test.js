import { describe, it, expect } from 'vitest'
import { GroupDraft } from './group-draft.js'

const tree = (repo, path, branch) => ({ repo, repoRoot: `C:/repos/${repo}`, path, branch, rebasingBranch: null, error: '', changes: [] })
const snapshot = {
  worktrees: [tree('AccessControl', 'C:/repos/AccessControl', 'main'), tree('AccessControl', 'C:/repos/AccessControl/qr', 'feature/qr'), tree('Joiners', 'C:/repos/Joiners', 'main')],
  branches: [{ repo: 'Joiners', ref: 'refs/heads/main', name: 'main' }, { repo: 'Joiners', ref: 'refs/heads/topic', name: 'topic' }],
}
const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }, { name: 'Joiners', path: 'C:/repos/Joiners' }], groups: [], roots: null, view: {} }
const find = (d, kind, repo) => d.members.find(m => m.kind === kind && m.repo === repo)

describe('GroupDraft', () => {
  it('builds the group from registered repos only and never changes the registered list', () => {
    const d = new GroupDraft(config, snapshot)
    expect(d.addDiscovered).toBeUndefined()
    d.toggle(find(d, 'repo', 'AccessControl'))
    const { config: next, group } = d.commit(config, '  Access work ', null)
    expect(group).toEqual({ name: 'Access work', repos: ['AccessControl'], worktrees: [], branches: [] })
    expect(next.repos).toEqual(config.repos)
    expect(next.groups).toEqual([group])
  })

  it('rejects reserved, duplicate and empty selections', () => {
    const d = new GroupDraft({ ...config, groups: [{ name: 'QR', repos: ['Joiners'], worktrees: [], branches: [] }] }, snapshot)
    expect(() => d.commit(config, 'All Projects', null)).toThrow(/reserved/)
    expect(() => d.commit(config, 'anything', null)).toThrow(/Select at least one/)
  })

  it('switches a repo between whole repo and individual worktrees', () => {
    const d = new GroupDraft(config, snapshot)
    d.toggle(find(d, 'repo', 'AccessControl'))
    expect(d.state('AccessControl')).toBe('whole')
    expect(() => d.toggle(find(d, 'worktree', 'AccessControl'))).toThrow(/whole repo/)
    d.toggleWhole('AccessControl')
    expect(d.state('AccessControl')).toBe('some')
    expect(d.members.filter(m => m.kind === 'worktree' && m.repo === 'AccessControl').every(m => d.checked.has(m.id))).toBe(true)
    d.toggleWhole('AccessControl')
    expect(d.state('AccessControl')).toBe('whole')
    expect(d.members.filter(m => m.repo === 'AccessControl' && m.kind !== 'repo').some(m => d.checked.has(m.id))).toBe(false)
  })

  it('hides branches until shown, folds repos and filters rows', () => {
    const d = new GroupDraft(config, snapshot)
    expect(d.rows().some(m => m.kind === 'branch')).toBe(false)
    d.branchesShown.add('Joiners')
    expect(d.rows().filter(m => m.kind === 'branch').map(m => m.value)).toEqual(['refs/heads/main', 'refs/heads/topic'])
    expect(d.rows('', new Set(['Joiners'])).filter(m => m.repo === 'Joiners').map(m => m.kind)).toEqual(['repo'])
    expect(d.rows('qr').map(m => m.label)).toEqual(['AccessControl', 'qr → feature/qr'])
  })

  it('keeps unavailable members of an existing group and replaces that group in place', () => {
    const existing = { name: 'Old', repos: ['Gone'], worktrees: ['C:/repos/Joiners', 'C:/elsewhere/missing'], branches: [{ repo: 'Joiners', ref: 'refs/heads/deleted' }] }
    const cfg = { ...config, groups: [{ name: 'First', repos: ['Joiners'], worktrees: [], branches: [] }, existing] }
    const d = new GroupDraft(cfg, snapshot, existing)
    expect(d.members.filter(m => m.label.endsWith('(unavailable)')).map(m => m.value)).toEqual(['Gone', 'C:/elsewhere/missing', 'refs/heads/deleted'])
    expect(d.rows().map(m => m.value)).toEqual(expect.arrayContaining(['C:/elsewhere/missing']))
    const { config: next } = d.commit(cfg, 'Old', existing)
    expect(next.groups.map(g => g.name)).toEqual(['First', 'Old'])
    expect(next.groups[1].worktrees).toEqual(['C:/repos/Joiners', 'C:/elsewhere/missing'])
  })
})
