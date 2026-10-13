import { describe, it, expect, vi } from 'vitest'
import { GroupDraft, GroupSaveError } from './group-draft.js'

const tree = (repo, path, branch) => ({ repo, repoRoot: `C:/repos/${repo}`, path, branch, rebasingBranch: null, error: '', changes: [] })
const snapshot = {
  worktrees: [tree('AccessControl', 'C:/repos/AccessControl', 'main'), tree('AccessControl', 'C:/repos/AccessControl/qr', 'feature/qr'), tree('Joiners', 'C:/repos/Joiners', 'main')],
  branches: [{ repo: 'Joiners', ref: 'refs/heads/main', name: 'main' }, { repo: 'Joiners', ref: 'refs/heads/topic', name: 'topic' }],
}
const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }, { name: 'Joiners', path: 'C:/repos/Joiners' }], groups: [], roots: null, view: {} }
const resolve = vi.fn(async () => ({ commonDir: 'x' }))
const find = (d, kind, repo) => d.members.find(m => m.kind === kind && m.repo === repo)

describe('GroupDraft', () => {
  it('registers ticked discovered repos with unique names and builds the group', async () => {
    const d = new GroupDraft(config, snapshot)
    d.addDiscovered([
      { name: 'joiners', path: 'D:/src/joiners', commonDir: 'd', registeredAs: null },
      { name: 'Payments', path: 'D:/src/Payments', commonDir: 'p', registeredAs: null },
      { name: 'AccessControl', path: 'C:/repos/AccessControl', commonDir: 'a', registeredAs: 'AccessControl' },
    ])
    expect(d.members.filter(m => m.kind === 'new-repo').map(m => m.label)).toEqual(['joiners', 'Payments'])
    d.members.filter(m => m.kind === 'new-repo').forEach(m => d.toggle(m))
    d.toggle(find(d, 'repo', 'AccessControl'))
    const { config: next, group } = await d.commit(config, '  Payments work ', null, resolve)
    expect(next.repos.map(r => r.name)).toEqual(['AccessControl', 'Joiners', 'joiners 2', 'Payments'])
    expect(group).toEqual({ name: 'Payments work', repos: ['AccessControl', 'joiners 2', 'Payments'], worktrees: [], branches: [] })
    expect(next.groups).toEqual([group])
    expect(config.repos).toHaveLength(2)
  })

  it('reports the failing discovered repo and changes nothing', async () => {
    const d = new GroupDraft(config, snapshot)
    d.addDiscovered([{ name: 'Vanished', path: 'D:/gone', commonDir: 'g', registeredAs: null }])
    const m = find(d, 'new-repo', 'D:/gone')
    d.toggle(m)
    const error = await d.commit(config, 'Broken', null, async () => { throw new Error('No repository at D:/gone') }).catch(e => e)
    expect(error).toBeInstanceOf(GroupSaveError)
    expect(error.memberId).toBe(m.id)
    expect(error.message).toBe('Vanished: No repository at D:/gone')
  })

  it('rejects reserved, duplicate and empty selections', async () => {
    const d = new GroupDraft({ ...config, groups: [{ name: 'QR', repos: ['Joiners'], worktrees: [], branches: [] }] }, snapshot)
    await expect(d.commit(config, 'All Projects', null, resolve)).rejects.toThrow(/reserved/)
    await expect(d.commit(config, 'anything', null, resolve)).rejects.toThrow(/Select at least one/)
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

  it('keeps unavailable members of an existing group and replaces that group in place', async () => {
    const existing = { name: 'Old', repos: ['Gone'], worktrees: ['C:/repos/Joiners', 'C:/elsewhere/missing'], branches: [{ repo: 'Joiners', ref: 'refs/heads/deleted' }] }
    const cfg = { ...config, groups: [{ name: 'First', repos: ['Joiners'], worktrees: [], branches: [] }, existing] }
    const d = new GroupDraft(cfg, snapshot, existing)
    expect(d.members.filter(m => m.label.endsWith('(unavailable)')).map(m => m.value)).toEqual(['Gone', 'C:/elsewhere/missing', 'refs/heads/deleted'])
    expect(d.rows().map(m => m.value)).toEqual(expect.arrayContaining(['C:/elsewhere/missing']))
    const { config: next } = await d.commit(cfg, 'Old', existing, resolve)
    expect(next.groups.map(g => g.name)).toEqual(['First', 'Old'])
    expect(next.groups[1].worktrees).toEqual(['C:/repos/Joiners', 'C:/elsewhere/missing'])
  })
})
