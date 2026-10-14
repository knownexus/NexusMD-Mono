import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); clearGitSnapshotCache() })

const DIRTY = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\x001 .M N... 100644 100644 100644 a a f.txt\0? new.txt\0'
const TWO = 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-i\n+I\n'
const STALE = 'Changed since you reviewed it. Refresh and review again.'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function setupView(over = {}) {
  setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], groups: [] })
  const state = { porcelain: DIRTY }
  const a = {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain: state.porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    diff: vi.fn(async () => ({ text: TWO, stamp: 'd1', truncated: false, binary: false, size: TWO.length })),
    stamp: vi.fn(async () => 'stamp-1'),
    stage: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    unstage: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    discard: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    deleteUntracked: vi.fn(async () => ({ ok: true, detail: 'Deleted 1 untracked file.' })),
    stageHunk: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    unstageHunk: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    ...over,
  }
  render(<ViewGit adapters={{ git: a }} />)
  return { a, state }
}

async function openWorktree() {
  const region = await screen.findByRole('region', { name: 'A' })
  fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
  await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
}

const REPO = { name: 'A', path: 'C:/repos/A' }
const REG = ['C:/repos/A']

describe('file actions', () => {
  it('reviews, then stages the selected files and refreshes', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Stage 1 file')).toBeTruthy()
    expect(within(dialog).getByText('f.txt', { exact: false })).toBeTruthy()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Stage' }).disabled).toBe(false))
    expect(a.stamp).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, { kind: 'files', paths: ['f.txt'] })
    const statusCalls = a.status.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(a.stage).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 'stamp-1'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done'))
    await waitFor(() => expect(a.status.mock.calls.length).toBeGreaterThan(statusCalls))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('requires typing DISCARD before discarding', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard 1…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert').textContent).toBe("Unstaged edits in these files will be lost. This can't be undone.")
    const run = within(dialog).getByRole('button', { name: 'Discard' })
    await waitFor(() => expect(a.stamp).toHaveBeenCalled())
    expect(run.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type DISCARD to confirm'), { target: { value: 'discard' } })
    expect(run.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type DISCARD to confirm'), { target: { value: 'DISCARD' } })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    await waitFor(() => expect(a.discard).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 'stamp-1'))
  })

  it('requires typing DELETE before deleting untracked files', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select new.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1…' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(a.stamp).toHaveBeenCalled())
    fireEvent.change(within(dialog).getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(a.deleteUntracked).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['new.txt'], 'stamp-1'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Deleted 1 untracked file.'))
  })

  it('shows the stale message when the files changed after review', async () => {
    setupView({ stage: vi.fn(async () => ({ ok: false, stale: true, detail: STALE })) })
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Stage' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(STALE))
  })

  it('keeps the reviewed file list when a poll arrives while the dialog is open', async () => {
    const { state } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    state.porcelain = '# branch.oid a\0# branch.head main\0'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('No changes.')).toBeTruthy())
    expect(within(screen.getByRole('dialog')).getByText('f.txt', { exact: false })).toBeTruthy()
  })

  it('runs a confirmed write once even when Run is clicked twice', async () => {
    const pending = deferred()
    const { a } = setupView({ stage: vi.fn(() => pending.promise) })
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const run = within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    fireEvent.click(run)
    await act(async () => { pending.resolve({ ok: true, detail: 'Done' }) })
    expect(a.stage).toHaveBeenCalledTimes(1)
  })

  it('stages one hunk from the diff pane, once, with the diff stamp', async () => {
    const pending = deferred()
    const { a } = setupView({ stageHunk: vi.fn(() => pending.promise) })
    await openWorktree()
    fireEvent.click(screen.getByText('f.txt'))
    const buttons = await screen.findAllByRole('button', { name: 'Stage hunk' })
    fireEvent.click(buttons[1])
    fireEvent.click(buttons[1])
    await act(async () => { pending.resolve({ ok: true, detail: 'Done' }) })
    expect(a.stageHunk).toHaveBeenCalledTimes(1)
    expect(a.stageHunk).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['f.txt'], 1, 'd1')
  })

  it('opens the commit dialog from the toolbar with the selected worktree ticked', async () => {
    const STAGED = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\x001 M. N... 100644 100644 100644 a b f.txt\0'
    const { state, a } = setupView({ commit: vi.fn(async () => ({ ok: true, detail: 'ok' })) })
    state.porcelain = STAGED
    await openWorktree()
    fireEvent.click(screen.getByRole('button', { name: 'Commit…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('A › checkout → main').checked).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Commit' }).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(a.commit).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'Ship it', 'stamp-1'))
  })
})
