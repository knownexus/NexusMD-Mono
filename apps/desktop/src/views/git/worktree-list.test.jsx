import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorktreeList } from './worktree-list.jsx'

afterEach(cleanup)

const tree = patch => ({
  repo: 'A', repoRoot: 'C:/repos/A', commonDir: 'C:/repos/A/.git', path: 'C:/repos/A', head: 'a', branch: 'main',
  upstream: null, upstreamGone: false, ahead: 1, behind: 0, changes: [], operation: '', rebasingBranch: null,
  fetchedAt: null, error: '', locked: false, prunable: false, ...patch,
})

function show(t) {
  render(<WorktreeList repos={[{ name: 'A', path: 'C:/repos/A' }]} scoped={{ worktrees: [t], inactiveBranches: [] }}
    errors={[]} collapsed={[]} onToggleRepo={() => {}} selected={null} onSelect={() => {}} />)
}

describe('WorktreeList', () => {
  it('shows an operation in progress together with ahead/behind and the upstream note', () => {
    show(tree({ operation: 'Rebase in progress' }))
    expect(screen.getByText('Rebase in progress · ↑1 ↓0 · no upstream · clean')).toBeTruthy()
  })

  it('shows ahead/behind and a missing upstream without an operation', () => {
    show(tree({ upstream: 'origin/main', upstreamGone: true }))
    expect(screen.getByText('↑1 ↓0 · upstream missing · clean')).toBeTruthy()
  })
})
