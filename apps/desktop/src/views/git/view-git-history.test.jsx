import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'
import { historyCache } from './history-cache.js'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  clearGitSnapshotCache()
  for (const k of ['details', 'files', 'diffs', 'pages']) historyCache[k].clear()
})

const HEAD = 'a'.repeat(40)
const SIDE = 'b'.repeat(40)
const porcelain = `# branch.oid ${HEAD}\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\x001 .M N... 100644 100644 100644 a a f.txt\0`
const rec = (oid, subject) => `* \x1e${oid}\x1f\x1fAna\x1fa@b\x1f1\x1f\x1f${subject}`

function adapter(overrides = {}) {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD ${HEAD}\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => `refs/heads/main\0${HEAD}\0Main\0origin/main\nrefs/heads/side\0${SIDE}\0Side work\0\n`),
    discover: vi.fn(async () => []),
    diff: vi.fn(async () => ({ text: '', stamp: 's', truncated: false, binary: false, size: 0 })),
    refs: vi.fn(async () => ({ refs: `refs/heads/main\0${HEAD}\0\0*\nrefs/heads/side\0${SIDE}\0\0 \n`, originHead: null, shallow: false })),
    log: vi.fn(async (_r, _c, _g, q) => ({
      text: (q.ref === 'HEAD' ? rec(HEAD, 'On main') : rec(SIDE, 'Side work')) + '\n',
      tip: q.ref === 'HEAD' ? HEAD : SIDE, unpushed: [], truncated: false, limit: q.limit,
    })),
    commitDetails: vi.fn(async (_r, _c, _g, oid) => ({ details: [oid, '', 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', 'msg'].join('\0') })),
    commitFiles: vi.fn(async () => ({ files: 'A\0f.txt\0' })),
    commitDiff: vi.fn(async () => ({ text: '', truncated: false, binary: false, size: 0 })),
    ...overrides,
  }
}

describe('ViewGit history', () => {
  it('switches a worktree to History, remembers it, and reads HEAD\'s history there', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], groups: [] })
    const git = adapter()
    render(<ViewGit adapters={{ git }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /→ main/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    expect(getGitConfig().view.panel).toBe('history')
    expect(await screen.findByText('On main')).toBeTruthy()
    expect(git.log).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', ['C:/repos/A'], expect.objectContaining({ ref: 'HEAD' }))
    // The top commit is focused, so its files load.
    expect(await screen.findByRole('listbox', { name: 'Files in commit' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^Changes/ }))
    expect(getGitConfig().view.panel).toBe('changes')
    expect(screen.queryByRole('listbox', { name: 'Commits' })).toBeNull()
  })

  it('a branch that is not checked out opens its history', async () => {
    setGitConfig({
      repos: [{ name: 'A', path: 'C:/repos/A' }],
      groups: [{ name: 'G', repos: [], worktrees: [], branches: [{ repo: 'A', ref: 'refs/heads/side' }] }],
      view: { ...getGitConfig().view, group: 'G' },
    })
    const git = adapter()
    render(<ViewGit adapters={{ git }} />)
    fireEvent.click(await screen.findByRole('button', { name: /◇ side/ }))
    expect(await screen.findByText('Side work', { selector: '[role=option] span' })).toBeTruthy()
    expect(git.log).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', ['C:/repos/A'], expect.objectContaining({ ref: 'refs/heads/side' }))
    expect(screen.getByText('Not checked out in any worktree.')).toBeTruthy()
  })

  it('History doesn\'t load the changes pane\'s diff', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], groups: [], view: { ...getGitConfig().view, panel: 'history' } })
    const git = adapter()
    render(<ViewGit adapters={{ git }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /→ main/ }))
    await screen.findByText('On main')
    await waitFor(() => expect(git.commitFiles).toHaveBeenCalled())
    expect(git.diff).not.toHaveBeenCalled()
  })
})
