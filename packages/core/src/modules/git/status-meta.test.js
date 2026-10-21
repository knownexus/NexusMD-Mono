import { describe, it, expect } from 'vitest'
import { BRANCH_FILTERS, branchState, matchesFilter, filterCounts, branchMeta, repoPills, primaryAction } from './status-meta.js'

const tree = (over = {}) => ({ repo: 'Joiners', branch: 'feat', upstream: 'origin/feat', upstreamGone: false, ahead: 0, behind: 0, changes: [], operation: '', operationInfo: null, ...over })
const files = (...areas) => areas.map(area => ({ area }))

describe('branchState', () => {
  it('picks the most urgent tone', () => {
    expect(branchState(tree()).tone).toBe('ok')
    expect(branchState(tree({ upstream: null })).tone).toBe('muted')
    expect(branchState(tree({ behind: 2 })).tone).toBe('info')
    expect(branchState(tree({ behind: 2, changes: files('unstaged') })).tone).toBe('warn')
    expect(branchState(tree({ operation: 'Rebase in progress', changes: files('conflict') })).tone).toBe('bad')
  })

  it('does not call a detached worktree unpublished', () => {
    expect(branchState(tree({ branch: '(detached)', upstream: null })).unpublished).toBe(false)
  })
})

describe('filters', () => {
  const trees = [
    tree({ id: 'a', ahead: 3 }),
    tree({ id: 'b', behind: 12, changes: files('unstaged', 'unstaged') }),
    tree({ id: 'c', upstream: null }),
    tree({ id: 'd', upstreamGone: true }),
    tree({ id: 'e', operation: 'Rebase in progress', changes: files('conflict', 'staged') }),
    tree({ id: 'f' }),
  ]
  it('counts branches per chip', () => {
    expect(filterCounts(trees)).toEqual({ all: 6, busy: 1, changes: 2, push: 1, pull: 1, local: 2 })
    expect(BRANCH_FILTERS.map(f => f.id)).toEqual(['all', 'busy', 'changes', 'push', 'pull', 'local'])
  })
  it('matches one filter', () => {
    expect(trees.filter(t => matchesFilter(t, 'pull')).map(t => t.id)).toEqual(['b'])
    expect(trees.filter(t => matchesFilter(t, 'all'))).toHaveLength(6)
  })
})

describe('branchMeta', () => {
  it('never shows zero counts', () => {
    expect(branchMeta(tree())).toEqual([{ text: 'Up to date', tone: 'ok' }])
    expect(branchMeta(tree()).map(m => m.text).join(' ')).not.toMatch(/↑0|↓0/)
  })
  it('lists what matters, most urgent first', () => {
    const t = tree({ ahead: 3, behind: 1, changes: files('staged', 'unstaged') })
    expect(branchMeta(t).map(m => m.text)).toEqual(['2 files changed · 1 staged', '↑3 to push', '↓1 to pull'])
  })
  it('describes an operation with its step and conflicts', () => {
    const t = tree({ operation: 'Rebase in progress', operationInfo: { kind: 'rebase', step: 1, total: 7 }, changes: files('conflict', 'conflict', 'staged') })
    expect(branchMeta(t)[0]).toEqual({ text: 'Rebasing 1/7 · 2 conflicts', tone: 'bad', strong: true })
  })
  it('shows the worktree folder and still says up to date', () => {
    expect(branchMeta(tree({ branch: '(detached)', upstream: null }), { worktree: 'agent-a37' }).map(m => m.text)).toEqual(['agent-a37', 'Up to date'])
  })
  it('flags a deleted upstream', () => {
    expect(branchMeta(tree({ upstreamGone: true })).map(m => m.text)).toEqual(['upstream deleted'])
  })
})

describe('repoPills', () => {
  it('summarises a repository', () => {
    expect(repoPills([tree(), tree()])).toEqual([{ text: 'all clean', tone: 'ok' }])
    expect(repoPills([tree({ ahead: 2 }), tree({ behind: 5, changes: files('unstaged') }), tree({ operation: 'Rebase in progress' })]).map(p => p.text))
      .toEqual(['in progress', '1 uncommitted', '↑2', '↓5'])
  })
})

describe('primaryAction', () => {
  it('chooses resolve › pull › push › review › publish', () => {
    expect(primaryAction(tree({ operation: 'x', changes: files('conflict') })).kind).toBe('resolve')
    expect(primaryAction(tree({ behind: 1, ahead: 1 }))).toEqual({ kind: 'pull', label: 'Pull ↓1' })
    expect(primaryAction(tree({ ahead: 4 }))).toEqual({ kind: 'push', label: 'Push ↑4' })
    expect(primaryAction(tree({ changes: files('unstaged') })).kind).toBe('review')
    expect(primaryAction(tree({ upstreamGone: true }))).toEqual({ kind: 'publish', label: 'Re-publish' })
    expect(primaryAction(tree())).toBeNull()
  })
})
