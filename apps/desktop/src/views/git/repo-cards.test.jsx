import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { RepoCards, GitSummary } from './repo-cards.jsx'

afterEach(cleanup)

const tree = patch => ({
  repo: 'A', repoRoot: 'C:/repos/A', commonDir: 'C:/repos/A/.git', path: 'C:/repos/A', head: 'a', branch: 'main',
  upstream: null, upstreamGone: false, ahead: 1, behind: 0, changes: [], operation: '', rebasingBranch: null,
  fetchedAt: null, error: '', locked: false, prunable: false, ...patch,
})
const change = (id, area = 'unstaged') => ({ id, path: id, area, originalPath: null })

function show(trees, { branches = [], errors = [], collapsed = [], ...props } = {}) {
  render(<RepoCards repos={[{ name: 'A', path: 'C:/repos/A' }]} scoped={{ worktrees: trees, inactiveBranches: branches }}
    errors={errors} collapsed={collapsed} onToggleRepo={() => {}} selected={null} onSelect={() => {}} {...props} />)
}

describe('RepoCards', () => {
  it('shows an operation in progress together with ahead/behind and the upstream note', () => {
    show([tree({ operation: 'Rebase in progress' })])
    const row = screen.getByRole('button', { name: 'checkout → main, clean' })
    for (const text of ['Rebase in progress', '↑1', '↓0', 'no upstream']) expect(within(row).getByText(text)).toBeTruthy()
  })

  it('shows ahead/behind and a missing upstream without an operation', () => {
    show([tree({ upstream: 'origin/main', upstreamGone: true })])
    const row = screen.getByRole('button', { name: /checkout → main/ })
    expect(within(row).getByText('upstream missing')).toBeTruthy()
    expect(within(row).queryByText('no upstream')).toBeNull()
  })

  it('counts changed and staged files on the row and the repository card', () => {
    show([tree({ changes: [change('x', 'staged'), change('y')] })])
    expect(screen.getByRole('button', { name: 'checkout → main, 2 changed' })).toBeTruthy()
    expect(screen.getByText('1 staged')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'A' })).getAllByText('2 changed')).toHaveLength(2)
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
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(onToggleRepo).toHaveBeenCalledWith('A')
  })

  it('folds a repository from anywhere on its title bar, not only the arrow', () => {
    const onToggleRepo = vi.fn()
    show([tree({ changes: [change('x')] })], { onToggleRepo })
    const head = screen.getByRole('button', { name: 'A' })
    expect(head.getAttribute('aria-expanded')).toBe('true')
    // The change count on the right of the bar is part of the same button.
    fireEvent.click(within(head).getByText('1 changed'))
    expect(onToggleRepo).toHaveBeenCalledWith('A')
  })

  it('expands or collapses every repository shown, and disables whichever is already done', () => {
    const repos = [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }]
    const trees = [tree(), tree({ repo: 'B', repoRoot: 'C:/repos/B', path: 'C:/repos/B' })]
    const onSetCollapsed = vi.fn()
    const view = render(<RepoCards repos={repos} scoped={{ worktrees: trees, inactiveBranches: [] }} errors={[]} collapsed={['Hidden']}
      onToggleRepo={() => {}} onSetCollapsed={onSetCollapsed} selected={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Expand all' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    // Repositories outside this view keep their own state.
    expect(onSetCollapsed).toHaveBeenLastCalledWith(['Hidden', 'A', 'B'])
    view.rerender(<RepoCards repos={repos} scoped={{ worktrees: trees, inactiveBranches: [] }} errors={[]} collapsed={['Hidden', 'A', 'B']}
      onToggleRepo={() => {}} onSetCollapsed={onSetCollapsed} selected={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Collapse all' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(onSetCollapsed).toHaveBeenLastCalledWith(['Hidden'])
  })

  it('hides a folded repository\'s rows but keeps its error', () => {
    show([tree()], { collapsed: ['A'], errors: [{ repo: 'A', message: 'git said no' }] })
    expect(screen.queryByRole('button', { name: /checkout → main/ })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('git said no')
  })
})

describe('GitSummary', () => {
  it('adds up the usable worktrees only', () => {
    render(<GitSummary worktrees={[
      tree({ changes: [change('x'), change('y')], ahead: 2, behind: 1, upstream: 'origin/main' }),
      tree({ path: 'C:/repos/A-b', branch: 'b', ahead: 1 }),
      tree({ path: 'C:/repos/A-d', branch: '(detached)', ahead: 0 }),
      tree({ path: 'C:/repos/A-x', error: 'Missing worktree', changes: [change('z')], ahead: 9 }),
    ]} />)
    const value = label => screen.getByText(label).nextSibling.textContent
    expect(value('Uncommitted files')).toBe('2')
    expect(value('Commits to push')).toBe('3')
    expect(value('Commits to pull')).toBe('1')
    expect(value('Without upstream')).toBe('1')
  })
})
