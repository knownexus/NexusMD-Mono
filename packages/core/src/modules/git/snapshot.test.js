import { describe, it, expect, vi } from 'vitest'
import { loadSnapshot, refreshRepos, applyStatus, worktreeSummary } from './snapshot.js'
import { createNoOpAdapters } from '../../adapters/defaults.js'
import { getRegistry } from '../../features/module-registry.js'
import './index.js'

const repos = [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }, { name: 'C', path: 'C:/repos/C' }]

function fakeAdapter() {
  return {
    resolve: vi.fn(async dir => {
      if (dir.endsWith('C')) throw new Error('No repository at C:/repos/C')
      return { commonDir: `${dir}/.git` }
    }),
    worktrees: vi.fn(async repo => repo.name === 'A'
      ? `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0worktree ${repo.path}/locked\0HEAD b\0branch refs/heads/x\0\0worktree ${repo.path}/gone\0HEAD c\0branch refs/heads/y\0prunable gitdir missing\0\0`
      : `worktree ${repo.path}\0HEAD d\0branch refs/heads/main\0\0`),
    status: vi.fn(async (repo, path) => {
      if (path.endsWith('/locked')) return { error: 'fatal: Unable to create index.lock' }
      if (path.endsWith('/gone')) return { missing: true }
      return {
        porcelain: '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\x001 .M N... 100644 100644 100644 a a f.txt\0? n.txt\0',
        operation: '', rebasingBranch: null, fetchedAt: '2026-10-13T08:00:00.000Z',
      }
    }),
    branches: vi.fn(async () => 'refs/heads/main\0a\0Init\0origin/main\n'),
  }
}

describe('applyStatus', () => {
  const tree = () => ({ head: '', prunable: false, error: '' })
  const status = porcelain => ({ porcelain, operation: '', rebasingBranch: null, fetchedAt: null })

  it('marks the upstream gone when one is configured but git reports no ahead/behind', () => {
    expect(applyStatus(tree(), status('# branch.head main\0# branch.upstream origin/main\0')).upstreamGone).toBe(true)
  })

  it('keeps the upstream when git reports ahead/behind for it', () => {
    expect(applyStatus(tree(), status('# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0')).upstreamGone).toBe(false)
  })

  it('never marks a branch without an upstream as gone', () => {
    expect(applyStatus(tree(), status('# branch.head main\0')).upstreamGone).toBe(false)
  })

  it('applyStatus copies operationInfo', () => {
    const info = { kind: 'merge', step: null, total: null, onto: null, replaying: null, merging: { oid: 'a'.repeat(40), name: 'main' }, picked: null }
    expect(applyStatus(tree(), { ...status('# branch.head main\0'), operationInfo: info }).operationInfo).toEqual(info)
    expect(applyStatus(tree(), status('# branch.head main\0')).operationInfo).toBeNull()
  })
})

describe('loadSnapshot', () => {
  it('loads every repo, keeps failures local and never reports a broken worktree as clean', async () => {
    const adapter = fakeAdapter()
    const s = await loadSnapshot(adapter, repos, { now: () => new Date('2026-10-13T09:00:00Z') })
    expect(s.takenAt).toBe('2026-10-13T09:00:00.000Z')
    expect(s.errors).toEqual([{ repo: 'C', message: 'No repository at C:/repos/C' }])
    expect(s.worktrees.map(t => t.path)).toEqual(['C:/repos/A', 'C:/repos/A/locked', 'C:/repos/A/gone', 'C:/repos/B'])
    const [main, locked, gone] = s.worktrees
    expect(main).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, upstreamGone: false, fetchedAt: '2026-10-13T08:00:00.000Z', error: '' })
    expect(worktreeSummary(main)).toEqual({ changed: 2, staged: 0 })
    expect(locked.error).toBe('fatal: Unable to create index.lock')
    expect(gone.error).toBe('Missing worktree · stale registration')
    expect(s.branches.map(b => b.id)).toEqual(['b:A:refs/heads/main', 'b:B:refs/heads/main'])
    expect(adapter.worktrees).toHaveBeenCalledWith(repos[0], repos.map(r => r.path))
  })

  it('turns a thrown status call into a worktree error', async () => {
    const adapter = { ...fakeAdapter(), status: vi.fn(async () => { throw new Error('git status timed out after 30s') }) }
    const s = await loadSnapshot(adapter, [repos[1]])
    expect(s.worktrees[0].error).toBe('git status timed out after 30s')
  })

  it('never runs more than the concurrency limit at once', async () => {
    let active = 0, peak = 0
    const adapter = { ...fakeAdapter(), resolve: vi.fn(async dir => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return { commonDir: dir } }) }
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}`, path: `C:/repos/R${i}` }))
    await loadSnapshot(adapter, many, { concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('git module registration', () => {
  it('registers a desktop-only module that the no-op adapters do not enable', () => {
    const mod = getRegistry().find(m => m.id === 'git')
    expect(mod).toMatchObject({ name: 'Git Workspace', requiredAdapters: ['git'], defaultEnabled: false })
    expect(createNoOpAdapters().git).toBeUndefined()
  })
})

describe('refreshRepos', () => {
  it('reads only the named repos and keeps the rest of the snapshot, in registered order', async () => {
    const adapter = fakeAdapter()
    const before = await loadSnapshot(adapter, repos, { now: () => new Date('2026-10-20T10:00:00Z') })
    adapter.resolve.mockClear(); adapter.worktrees.mockClear(); adapter.status.mockClear(); adapter.branches.mockClear()
    adapter.branches.mockImplementation(async () => 'refs/heads/main\0a\0Init\0origin/main\nrefs/heads/new\0b\0New\0\n')
    const after = await refreshRepos(adapter, repos, before, ['B'], { now: () => new Date('2026-10-20T10:01:00Z') })
    expect(adapter.resolve.mock.calls.map(c => c[0])).toEqual(['C:/repos/B'])
    expect(adapter.status).toHaveBeenCalledTimes(1)
    expect(after.worktrees.map(t => t.repo)).toEqual(before.worktrees.map(t => t.repo))
    expect(after.worktrees.filter(t => t.repo === 'A')).toEqual(before.worktrees.filter(t => t.repo === 'A'))
    expect(after.branches.filter(b => b.repo === 'B').map(b => b.name)).toEqual(['main', 'new'])
    expect(after.branches.filter(b => b.repo === 'A')).toEqual(before.branches.filter(b => b.repo === 'A'))
    expect(after.errors).toEqual(before.errors)
    expect(after.takenAt).toBe('2026-10-20T10:01:00.000Z')
  })
})

describe('untracked files in a snapshot', () => {
  const statusCalls = adapter => adapter.status.mock.calls.map(([, path, , options]) => [path, options?.untracked])

  it('reads untracked folders collapsed everywhere except the worktrees asked for in full', async () => {
    const adapter = fakeAdapter()
    await loadSnapshot(adapter, repos.filter(r => r.name !== 'C'), { fullFor: ['C:/repos/B'] })
    expect(Object.fromEntries(statusCalls(adapter))).toEqual({
      'C:/repos/A': 'normal', 'C:/repos/A/locked': 'normal', 'C:/repos/A/gone': 'normal', 'C:/repos/B': 'all',
    })
  })

  it('reads everything collapsed when no worktree is asked for in full', async () => {
    const adapter = fakeAdapter()
    await loadSnapshot(adapter, repos.filter(r => r.name === 'B'))
    expect(statusCalls(adapter)).toEqual([['C:/repos/B', 'normal']])
  })

  it('refreshRepos honours fullFor for the repos it reads again', async () => {
    const adapter = fakeAdapter()
    const first = await loadSnapshot(adapter, repos)
    adapter.status.mockClear()
    await refreshRepos(adapter, repos, first, ['B'], { fullFor: ['C:/repos/B'] })
    expect(statusCalls(adapter)).toEqual([['C:/repos/B', 'all']])
  })

  it('marks a worktree read in full so the UI can tell', async () => {
    const adapter = fakeAdapter()
    const s = await loadSnapshot(adapter, repos.filter(r => r.name === 'B'), { fullFor: ['C:/repos/B'] })
    expect(s.worktrees[0].untrackedFull).toBe(true)
    const t = await loadSnapshot(adapter, repos.filter(r => r.name === 'B'))
    expect(t.worktrees[0].untrackedFull).toBe(false)
  })
})
