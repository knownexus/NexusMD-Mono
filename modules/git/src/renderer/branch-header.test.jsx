import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { BranchHeader } from './branch-header.jsx'

afterEach(cleanup)

const tree = over => ({
  repo: 'Joiners', repoRoot: 'C:/repos/Joiners', path: 'C:/repos/Joiners/feature-x', branch: 'feature/x', rebasingBranch: null,
  upstream: 'origin/feature/x', upstreamGone: false, ahead: 0, behind: 0, operation: '', error: '', locked: null, prunable: null,
  fetchedAt: null, changes: [], ...over,
})

function setup(t, props = {}) {
  const handlers = { onSync: vi.fn(), onStashes: vi.fn(), onOverview: vi.fn(), onSwitch: vi.fn(), onEditor: vi.fn(), onTerminal: null, ...props }
  render(<BranchHeader tree={t} stashCount={2} {...handlers} />)
  return { ...handlers, bar: within(screen.getByRole('group', { name: 'Branch actions' })) }
}

describe('BranchHeader', () => {
  it('shows the breadcrumb, branch, Switch chip, path and tracking line', () => {
    const { onOverview, onSwitch } = setup(tree({ ahead: 2, behind: 1 }))
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumb.textContent).toBe('Overview›Joiners›feature-x')
    fireEvent.click(within(crumb).getByRole('button', { name: 'Overview' }))
    expect(onOverview).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'feature/x' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Switch/ }))
    expect(onSwitch).toHaveBeenCalled()
    expect(screen.getByTitle('C:/repos/Joiners/feature-x').textContent).toBe('C:/repos/Joiners/feature-x')
    expect(screen.getByText('Tracks origin/feature/x')).toBeTruthy()
    expect(screen.getByText('↑2 to push · ↓1 to pull')).toBeTruthy()
    expect(screen.getByText('Never fetched')).toBeTruthy()
  })

  it('shows from <source> only with a source, and opens the picker', () => {
    const { onSource } = setup(tree({ source: { ref: 'refs/heads/master', count: 2 } }), { onSource: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'from master ▾' }))
    expect(onSource).toHaveBeenCalled()
    cleanup()
    setup(tree({ source: null }), { onSource: vi.fn() })
    expect(screen.queryByText(/^from /)).toBeNull()
    cleanup()
    setup(tree({ branch: '(detached)', source: { ref: 'refs/heads/master', count: 2 } }), { onSource: vi.fn() })
    expect(screen.queryByText(/^from /)).toBeNull()
  })

  it('omits the worktree from the breadcrumb for the main checkout or a folder named like the branch', () => {
    setup(tree({ path: 'C:/repos/Joiners' }))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Overview›Joiners')
  })

  it('says In sync, Not published yet, or that the upstream was deleted', () => {
    setup(tree())
    expect(screen.getByText('In sync')).toBeTruthy()
    cleanup()
    setup(tree({ upstream: null }))
    expect(screen.getByText('Not published yet')).toBeTruthy()
    cleanup()
    setup(tree({ upstreamGone: true }))
    expect(screen.getByText('Upstream was deleted on origin')).toBeTruthy()
  })

  it('copies the path', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    setup(tree())
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    expect(writeText).toHaveBeenCalledWith('C:/repos/Joiners/feature-x')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('offers the contextual primary: Pull before Push before Publish', () => {
    let h = setup(tree({ ahead: 1, behind: 3 }))
    fireEvent.click(h.bar.getByRole('button', { name: 'Pull ↓3' }))
    expect(h.onSync).toHaveBeenLastCalledWith('pull', { mode: 'ff' })
    cleanup()
    h = setup(tree({ ahead: 1 }))
    fireEvent.click(h.bar.getByRole('button', { name: 'Push ↑1' }))
    expect(h.onSync).toHaveBeenLastCalledWith('push', {})
    cleanup()
    h = setup(tree({ upstream: null }))
    fireEvent.click(h.bar.getByRole('button', { name: 'Push' }))
    expect(h.onSync).toHaveBeenLastCalledWith('push', { setUpstream: true })
    cleanup()
    h = setup(tree())
    expect(h.bar.queryByRole('button', { name: /↑|↓|^Push$/ })).toBeNull()
  })

  it('hides the primary and disables Pull… and Rebase… during an operation', () => {
    const { bar } = setup(tree({ behind: 2, operation: 'rebase', changes: [{ id: 'c', area: 'conflict', path: 'a' }] }))
    expect(bar.queryByRole('button', { name: 'Pull ↓2' })).toBeNull()
    expect(bar.getByRole('button', { name: 'Pull…' }).disabled).toBe(true)
    expect(bar.getByRole('button', { name: 'Rebase…' }).disabled).toBe(true)
    expect(bar.getByRole('button', { name: 'Fetch' }).disabled).toBe(false)
  })

  it('Fetch, Pull… and Rebase… open their dialogs', () => {
    const { bar, onSync } = setup(tree())
    fireEvent.click(bar.getByRole('button', { name: 'Fetch' }))
    expect(onSync).toHaveBeenLastCalledWith('fetch', {})
    fireEvent.click(bar.getByRole('button', { name: 'Pull…' }))
    expect(onSync).toHaveBeenLastCalledWith('pull', { mode: 'ff' })
    fireEvent.click(bar.getByRole('button', { name: 'Rebase…' }))
    expect(onSync).toHaveBeenLastCalledWith('rebase', {})
  })

  it('More ▾ groups branch, remote, stash and worktree actions', () => {
    const { bar, onSync, onStashes } = setup(tree())
    fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(menu.textContent).toBe('BranchNew branch…bCheck out another branch…RemotePush…StashStash changes…Stashes…2WorktreeAdd worktree…Remove this worktree…')
    const pick = (name, kind, options) => {
      fireEvent.click(within(screen.getByRole('menu', { name: 'More' })).getByRole('menuitem', { name: new RegExp(`^${name}`) }))
      expect(onSync).toHaveBeenLastCalledWith(kind, options)
      fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    }
    pick('New branch…', 'branch', { start: 'HEAD', checkout: true })
    pick('Check out another branch…', 'checkout', {})
    pick('Push…', 'push', {})
    pick('Stash changes…', 'stashPush', {})
    pick('Add worktree…', 'worktreeAdd', {})
    pick('Remove this worktree…', 'worktreeRemove', { path: 'C:/repos/Joiners/feature-x' })
    fireEvent.click(within(screen.getByRole('menu', { name: 'More' })).getByRole('menuitem', { name: /^Stashes…/ }))
    expect(onStashes).toHaveBeenCalled()
  })

  const removeItem = bar => {
    fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    return screen.getByRole('menuitem', { name: 'Remove this worktree…' })
  }

  it('lets a linked worktree whose folder is named main, master or develop be removed', () => {
    for (const folder of ['main', 'master', 'develop']) {
      const { bar, onSync } = setup(tree({ path: `C:/repos/Joiners/${folder}`, commonDir: 'C:/repos/Joiners/.git' }))
      const remove = removeItem(bar)
      expect(remove.disabled).toBe(false)
      fireEvent.click(remove)
      expect(onSync).toHaveBeenLastCalledWith('worktreeRemove', { path: `C:/repos/Joiners/${folder}` })
      cleanup()
    }
  })

  it('disables removing the main checkout whatever its folder is called', () => {
    const { bar } = setup(tree({ repoRoot: 'C:/repos/Joiners', path: 'C:\\work\\feature-x', commonDir: 'C:/work/feature-x/.git' }))
    const remove = removeItem(bar)
    expect(remove.disabled).toBe(true)
    expect(remove.title).toBe("The main worktree can't be removed")
  })

  it("won't remove the main worktree, and says why", () => {
    const { bar } = setup(tree({ path: 'C:/repos/Joiners', upstream: null }))
    fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    const remove = screen.getByRole('menuitem', { name: 'Remove this worktree…' })
    expect(remove.disabled).toBe(true)
    expect(remove.title).toBe("The main worktree can't be removed")
    expect(screen.getByRole('menuitem', { name: 'Push…' })).toBeTruthy()
  })

  it('Terminal reports a failure; Editor calls its handler', async () => {
    const onTerminal = vi.fn().mockRejectedValueOnce(new Error('none found'))
    const { bar, onEditor } = setup(tree(), { onTerminal })
    fireEvent.click(bar.getByRole('button', { name: 'Terminal' }))
    expect((await screen.findByRole('alert')).textContent).toBe('none found')
    fireEvent.click(bar.getByRole('button', { name: 'Editor' }))
    expect(onEditor).toHaveBeenCalled()
    await waitFor(() => expect(onTerminal).toHaveBeenCalledTimes(1))
  })
})
