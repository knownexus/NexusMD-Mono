import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BranchList } from './branch-list.jsx'

afterEach(cleanup)

const tree = patch => ({
  repo: 'A', repoRoot: 'C:/repos/A', commonDir: 'C:/repos/A/.git', path: 'C:/repos/A', head: 'a', branch: 'main',
  upstream: null, upstreamGone: false, ahead: 1, behind: 0, changes: [], operation: '', rebasingBranch: null,
  fetchedAt: null, error: '', locked: false, prunable: false, ...patch,
})
const change = (id, area = 'unstaged') => ({ id, path: id, area, originalPath: null })
const REPOS = [{ name: 'A', path: 'C:/repos/A' }]

function show(trees, { branches = [], errors = [], collapsed = [], repos = REPOS, ...props } = {}) {
  return render(<BranchList repos={repos} scoped={{ worktrees: trees, inactiveBranches: branches }}
    errors={errors} collapsed={collapsed} onToggleRepo={() => {}} selected={null} onSelect={() => {}} {...props} />)
}
const head = name => within(screen.getByRole('region', { name })).getAllByRole('button').find(b => b.hasAttribute('aria-expanded'))

describe('BranchList', () => {
  it('shows an operation in progress with what to push and the upstream note, never ↑0 ↓0', () => {
    show([tree({ operation: 'Rebase in progress' })])
    const row = screen.getByRole('button', { name: /^checkout → main,/ })
    for (const text of ['Rebase in progress', '↑1 to push', 'not published']) expect(within(row).getByText(text)).toBeTruthy()
    expect(row.textContent).not.toMatch(/↑0|↓0/)
  })

  it('says the upstream was deleted instead of "not published"', () => {
    show([tree({ upstream: 'origin/main', upstreamGone: true, ahead: 0 })])
    const row = screen.getByRole('button', { name: /checkout → main/ })
    expect(within(row).getByText('upstream deleted')).toBeTruthy()
    expect(within(row).queryByText('not published')).toBeNull()
  })

  it('shows a clean, synced, published branch as up to date and its repo as all clean', () => {
    show([tree({ upstream: 'origin/main', ahead: 0 })])
    expect(screen.getByRole('button', { name: 'checkout → main, Up to date' })).toBeTruthy()
    expect(within(head('A')).getByText('all clean')).toBeTruthy()
  })

  it('counts changed and staged files on the row, and branches with pills on the repository header', () => {
    show([tree({ changes: [change('x', 'staged'), change('y')] }), tree({ path: 'C:/repos/A/wt/b', branch: 'b', ahead: 0, behind: 2, upstream: 'origin/b' })])
    expect(screen.getByRole('button', { name: /checkout → main, 2 files changed · 1 staged/ })).toBeTruthy()
    const h = head('A')
    expect(within(h).getByText('2 branches')).toBeTruthy()
    for (const pill of ['1 uncommitted', '↑1', '↓2']) expect(within(h).getByText(pill)).toBeTruthy()
    expect(h.textContent).not.toMatch(/changed/)
  })

  it('names the worktree when it differs from the branch, and shows a broken worktree as an error', () => {
    show([tree({ path: 'C:/repos/A/wt/feature', branch: 'feature' }), tree({ path: 'C:/repos/A/wt/gone', branch: 'gone', error: 'Missing worktree' })])
    expect(screen.getByText('wt/feature')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'wt/gone → gone, Missing worktree' })).toBeTruthy()
  })

  it('selects worktrees and inactive branches, and folds a repository', () => {
    const onSelect = vi.fn(), onToggleRepo = vi.fn()
    show([tree()], { branches: [{ id: 'A:refs/heads/old', repo: 'A', name: 'old' }], onSelect, onToggleRepo })
    fireEvent.click(screen.getByRole('button', { name: /checkout → main/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'worktree', id: expect.any(String) })
    fireEvent.click(screen.getByRole('button', { name: /◇ old/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'branch', id: 'A:refs/heads/old' })
    fireEvent.click(head('A'))
    expect(onToggleRepo).toHaveBeenCalledWith('A')
  })

  it('folds a repository from anywhere on its header, pills included', () => {
    const onToggleRepo = vi.fn()
    show([tree({ changes: [change('x')] })], { onToggleRepo })
    const h = head('A')
    expect(h.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(h).getByText('1 uncommitted'))
    expect(onToggleRepo).toHaveBeenCalledWith('A')
  })

  it('folds every repository shown with one button, which then unfolds them all', () => {
    const repos = [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }]
    const trees = [tree(), tree({ repo: 'B', repoRoot: 'C:/repos/B', path: 'C:/repos/B' })]
    const onSetCollapsed = vi.fn()
    const view = show(trees, { repos, collapsed: ['Hidden', 'A'], onSetCollapsed })
    // Anything still open: the button folds.
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    // Repositories outside this view keep their own state.
    expect(onSetCollapsed).toHaveBeenLastCalledWith(['Hidden', 'A', 'B'])
    view.rerender(<BranchList repos={repos} scoped={{ worktrees: trees, inactiveBranches: [] }} errors={[]} collapsed={['Hidden', 'A', 'B']}
      onToggleRepo={() => {}} onSetCollapsed={onSetCollapsed} selected={null} onSelect={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(onSetCollapsed).toHaveBeenLastCalledWith(['Hidden'])
  })

  it("hides a folded repository's rows but keeps its error", () => {
    show([tree()], { collapsed: ['A'], errors: [{ repo: 'A', message: 'git said no' }] })
    expect(screen.queryByRole('button', { name: /checkout → main/ })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('git said no')
  })
})

describe('BranchList filtering', () => {
  const trees = [
    tree({ path: 'C:/repos/A/wt/qrcode-response', branch: 'fix/qrcode-response', ahead: 0, changes: [change('x')], upstream: 'origin/x' }),
    tree({ path: 'C:/repos/A/wt/feature', branch: 'feature/login', ahead: 3, upstream: 'origin/feature/login' }),
  ]

  it('shows only the branches under the chosen filter, without inactive branches', () => {
    show(trees, { filter: 'push', branches: [{ id: 'A:refs/heads/old', repo: 'A', name: 'old' }] })
    expect(screen.getByRole('button', { name: /feature\/login/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /qrcode/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /◇ old/ })).toBeNull()
  })

  it('matches every term at the start of a word only, and unfolds what it finds', () => {
    const view = show(trees, { query: 'qr', collapsed: ['A'] })
    expect(screen.getByRole('button', { name: /fix\/qrcode-response/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /feature\/login/ })).toBeNull()
    view.rerender(<BranchList repos={REPOS} scoped={{ worktrees: trees, inactiveBranches: [] }} errors={[]} collapsed={[]}
      onToggleRepo={() => {}} selected={null} onSelect={() => {}} query="code" />)
    expect(screen.queryByRole('button', { name: /qrcode/ })).toBeNull()
  })

  it('offers to clear the filters when nothing matches', () => {
    const onClearFilters = vi.fn()
    show(trees, { query: 'zzz', onClearFilters })
    expect(screen.getByText(/No branches match/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalled()
  })
})
