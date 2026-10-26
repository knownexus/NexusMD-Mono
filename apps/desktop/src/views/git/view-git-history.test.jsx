import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { HistoryPanel } from './history-panel.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'
import { historyCache } from './history-cache.js'
import { editPlan, squashMessage, parseLog } from '@nexusmd/core'

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

  it('a request filters since a base and focuses the commit, once per nonce', async () => {
    const git = adapter({
      log: vi.fn(async (_r, _c, _g, q) => ({ text: [rec(HEAD, 'On main'), rec(SIDE, 'Side work')].join('\n') + '\n', tip: HEAD, unpushed: [], truncated: false, limit: q.limit })),
    })
    const props = { adapter: git, repo: { name: 'A', path: 'C:/repos/A' }, cwd: 'C:/repos/A', registered: ['C:/repos/A'], target: { ref: 'HEAD', head: HEAD }, split: 0.5, onSplit: () => {} }
    const { rerender } = render(<HistoryPanel {...props} />)
    await screen.findByText('On main')
    rerender(<HistoryPanel {...props} request={{ oid: SIDE, sinceBase: 'refs/heads/side', nonce: 1 }} />)
    await waitFor(() => expect(git.log).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), expect.objectContaining({ filter: 'sinceBase', base: 'refs/heads/side' })))
    expect(screen.getByRole('button', { name: 'Since' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(document.querySelector('[data-oid="' + SIDE + '"]').getAttribute('aria-selected')).toBe('true'))
    // The same nonce doesn't reapply: choosing All sticks.
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    rerender(<HistoryPanel {...props} request={{ oid: SIDE, sinceBase: 'refs/heads/side', nonce: 1 }} />)
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
  })

  describe('editing unpushed commits', () => {
    const oid = n => String(n).repeat(40)
    const rows = [[3, 'three', 2], [2, 'two', 1], [1, 'one', 0]]
    const LOG = rows.map(([o, subject, p]) => rec(oid(o), subject).replace('\x1f\x1fAna', `\x1f${oid(p)}\x1fAna`)).join('\n') + '\n'
    const commits = parseLog(LOG).filter(r => r.commit).map(r => r.commit)
    const open = async (over = {}) => {
      setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], groups: [], view: { ...getGitConfig().view, panel: 'history' } })
      const git = adapter({
        preview: vi.fn(async () => ({ eligible: true, reason: null, details: null, programs: [], stamp: 's' })),
        log: vi.fn(async (_r, _c, _g, q) => ({ text: LOG, tip: oid(3), unpushed: [oid(3), oid(2)], truncated: false, limit: q.limit })),
        commitDetails: vi.fn(async (_r, _c, _g, o) => ({ details: [o, '', 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', `message of ${o[0]}\n`].join('\0') })),
        ...over,
      })
      render(<ViewGit adapters={{ git }} />)
      const region = await screen.findByRole('region', { name: 'A' })
      fireEvent.click(await within(region).findByRole('button', { name: /→ main/ }))
      await screen.findByText('three')
      return git
    }
    const row = n => document.querySelector(`[data-oid="${oid(n)}"]`)
    const menuOf = n => { fireEvent.contextMenu(row(n)); return screen.getByRole('menu', { name: `Actions for ${oid(n).slice(0, 7)}` }) }
    const item = (menu, name) => within(menu).getByRole('menuitem', { name })

    it('rewords an unpushed commit: dialog prefilled from its message, Save previews the plan', async () => {
      const git = await open()
      const menu = menuOf(2)
      expect(item(menu, 'Reword…').disabled).toBe(false)
      fireEvent.click(item(menu, 'Reword…'))
      const box = await screen.findByRole('textbox', { name: 'Commit message' })
      expect(box.value).toBe('message of 2')
      fireEvent.change(box, { target: { value: 'better two' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'rebaseInteractive',
        editPlan(commits, { kind: 'reword', oid: oid(2), message: 'better two' })))
    })

    it('a pushed commit offers Reword… disabled with the reason', async () => {
      await open()
      const reword = item(menuOf(1), 'Reword…')
      expect(reword.disabled).toBe(true)
      expect(reword.title).toBe('Already pushed')
    })

    it('Squash selected… works on two adjacent commits and prefills both messages, oldest first', async () => {
      const git = await open()
      fireEvent.click(row(3))
      fireEvent.click(row(2), { ctrlKey: true })
      expect(row(3).getAttribute('aria-selected')).toBe('true')
      const menu = menuOf(3)
      expect(item(menu, 'Squash selected…').disabled).toBe(false)
      fireEvent.click(item(menu, 'Squash selected…'))
      const box = await screen.findByRole('textbox', { name: 'Commit message' })
      expect(box.value).toBe(squashMessage(['message of 2', 'message of 3']))
      fireEvent.change(box, { target: { value: 'combined' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'rebaseInteractive',
        editPlan(commits, { kind: 'squash', oids: [oid(3), oid(2)], message: 'combined' })))
    })

    it('Shift-click selects the range from the focused commit; right-click outside it resets', async () => {
      await open()
      fireEvent.click(row(3))
      fireEvent.click(row(1), { shiftKey: true })
      expect([3, 2, 1].map(n => row(n).getAttribute('aria-selected'))).toEqual(['true', 'true', 'true'])
      expect(item(menuOf(2), 'Squash selected…').disabled).toBe(true) // includes a pushed commit
      fireEvent.keyDown(document.body, { key: 'Escape' })
      fireEvent.contextMenu(row(3))
      fireEvent.click(row(3))
      expect([3, 2, 1].map(n => row(n).getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    })

    it('Squash into previous… is enabled on a commit whose previous one is unpushed', async () => {
      const menu = (await open(), menuOf(3))
      expect(item(menu, 'Squash into previous…').disabled).toBe(false)
      expect(item(menu, 'Squash selected…').title).toBe('Pick at least two commits')
    })

    it('shows an inline error when a message cannot be loaded', async () => {
      await open({ commitDetails: vi.fn(async () => { throw new Error('boom') }) })
      fireEvent.click(item(menuOf(3), 'Reword…'))
      expect(await screen.findByText("Couldn't load the message: boom")).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    })

    it('an active search disables all three edits; the Since filter does not', async () => {
      await open()
      const search = screen.getByRole('textbox', { name: 'Search history' })
      fireEvent.change(search, { target: { value: 'three' } })
      fireEvent.keyDown(search, { key: 'Enter' })
      await waitFor(() => expect(row(3)).toBeTruthy())
      const menu = menuOf(3)
      for (const name of ['Reword…', 'Squash into previous…', 'Squash selected…']) {
        expect(item(menu, name).disabled).toBe(true)
        expect(item(menu, name).title).toBe('Clear the search first')
      }
      fireEvent.keyDown(menu, { key: 'Escape' })
      fireEvent.keyDown(search, { key: 'Escape' })
      fireEvent.click(screen.getByRole('button', { name: 'Since' }))
      await waitFor(() => expect(item(menuOf(3), 'Reword…').disabled).toBe(false))
    })
  })
})
