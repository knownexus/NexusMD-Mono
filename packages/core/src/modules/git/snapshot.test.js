import { describe, it, expect, vi } from 'vitest'
import { loadSnapshot, applyStatus, worktreeSummary } from './snapshot.js'
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
