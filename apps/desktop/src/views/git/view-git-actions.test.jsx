import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'
import { clearWorktreeDrafts } from './use-worktree-file.js'

afterEach(() => { cleanup(); clearWorktreeDrafts() })
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

  it('reloads the snapshot after a write even when a load was already running', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const run = within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' })
    await waitFor(() => expect(run.disabled).toBe(false))
    const poll = deferred()
    const before = a.status.mock.calls.length
    a.status.mockImplementationOnce(() => poll.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(a.status.mock.calls.length).toBe(before + 1))
    fireEvent.click(run)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done'))
    expect(a.status.mock.calls.length).toBe(before + 1)
    await act(async () => { poll.resolve({ porcelain: DIRTY, operation: '', rebasingBranch: null, fetchedAt: null }) })
    await waitFor(() => expect(a.status.mock.calls.length).toBe(before + 2))
  })

  it('reloads the focused diff as soon as a hunk write finishes, with its buttons disabled meanwhile', async () => {
    const { a } = setupView()
    await openWorktree()
    fireEvent.click(screen.getByText('f.txt'))
    const buttons = await screen.findAllByRole('button', { name: 'Stage hunk' })
    await waitFor(() => expect(buttons[0].disabled).toBe(false))
    // No new snapshot arrives, so only the hunk write can trigger the reload.
    a.status.mockImplementation(() => new Promise(() => {}))
    const next = deferred()
    a.diff.mockImplementationOnce(() => next.promise)
    const diffs = a.diff.mock.calls.length
    fireEvent.click(buttons[0])
    await waitFor(() => expect(a.diff.mock.calls.length).toBe(diffs + 1))
    expect(screen.getAllByRole('button', { name: 'Stage hunk' }).every(b => b.disabled)).toBe(true)
    await act(async () => { next.resolve({ text: TWO.slice(0, TWO.indexOf('@@ -9')), stamp: 'd2', truncated: false, binary: false, size: 10 }) })
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Stage hunk' })).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Stage hunk' }).disabled).toBe(false)
  })

  it('shows a thrown write error without Electron\'s remote-method prefix', async () => {
    setupView({ stage: vi.fn(async () => { throw new Error("Error invoking remote method 'git:stage': Error: git add timed out after 30s") }) })
    await openWorktree()
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1' }))
    const run = within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('git add timed out after 30s'))
  })

  it('saves the divider position once, when the drag ends', async () => {
    setupView()
    await openWorktree()
    const divider = screen.getByRole('separator', { name: 'Resize changes and diff' })
    divider.parentElement.getBoundingClientRect = () => ({ top: 0, height: 100 })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.pointerDown(divider)
    // jsdom has no PointerEvent, so clientY is set on a plain event.
    for (const y of [30, 40, 60]) act(() => { window.dispatchEvent(Object.assign(new Event('pointermove'), { clientY: y })) })
    expect(setItem).not.toHaveBeenCalled()
    expect(divider.getAttribute('aria-valuenow')).toBe('60')
    fireEvent.pointerUp(window)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(setItem.mock.calls[0][1]).view.split).toBe(0.6)
    setItem.mockRestore()
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

describe('editing files', () => {
  const NINE_PLUS = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const files = () => ({
    readFile: vi.fn(async () => ({ text: NINE_PLUS, bom: false, stamp: 'f1' })),
    writeFile: vi.fn(async () => ({ ok: true, stamp: 'f2' })),
  })
  const changes = () => within(screen.getByRole('region', { name: 'Changes' }))
  const pills = () => within(screen.getByRole('group', { name: 'Diff or edit' }))
  const editorFor = async path => {
    const content = await screen.findByLabelText(`Edit ${path}`)
    return EditorView.findFromDOM(content.closest('.cm-editor'))
  }
  afterEach(() => { vi.restoreAllMocks() })
  // jsdom has no layout; CodeMirror measures text ranges after scrolling a jumped-to line into view.
  beforeEach(() => {
    Range.prototype.getClientRects ??= () => []
    Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  })

  it('Ctrl+P opens Go to file, prevents printing, and opens the picked file in Edit', async () => {
    const { a } = setupView({ ...files(), files: vi.fn(async () => ({ files: ['f.txt', 'docs/guide.md'], truncated: false })) })
    await openWorktree()
    const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    const box = await screen.findByRole('combobox', { name: 'File name' })
    await screen.findAllByRole('option')
    fireEvent.change(box, { target: { value: 'guide' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await editorFor('docs/guide.md')
    expect(a.readFile).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'docs/guide.md')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores Ctrl+P while another modal is open, but still prevents printing', async () => {
    setupView({ ...files(), files: vi.fn(async () => ({ files: ['f.txt'], truncated: false })) })
    await openWorktree()
    const other = document.createElement('div')
    other.setAttribute('aria-modal', 'true')
    document.body.appendChild(other)
    try {
      const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
      act(() => { window.dispatchEvent(ev) })
      expect(ev.defaultPrevented).toBe(true)
      expect(screen.queryByRole('combobox', { name: 'File name' })).toBeNull()
    } finally { other.remove() }
  })

  it('swallows a second Ctrl+P over the open Go to file dialog instead of stacking', async () => {
    setupView({ ...files(), files: vi.fn(async () => ({ files: ['f.txt'], truncated: false })) })
    await openWorktree()
    const press = () => { const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }); act(() => { window.dispatchEvent(ev) }); return ev }
    press()
    await screen.findByRole('combobox', { name: 'File name' })
    expect(press().defaultPrevented).toBe(true)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getAllByRole('combobox', { name: 'File name' })).toHaveLength(1)
  })

  it('Edit opens the focused file and Diff returns', async () => {
    const { a } = setupView(files())
    await openWorktree()
    fireEvent.click(changes().getByText('f.txt'))
    await screen.findAllByRole('button', { name: 'Stage hunk' })
    expect(pills().getByRole('button', { name: 'Diff' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    const view = await editorFor('f.txt')
    expect(view.state.doc.toString()).toBe(NINE_PLUS)
    expect(a.readFile).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'f.txt')
    expect(screen.queryAllByRole('button', { name: 'Stage hunk' })).toHaveLength(0)
    fireEvent.click(pills().getByRole('button', { name: 'Diff' }))
    expect(await screen.findAllByRole('button', { name: 'Stage hunk' })).toHaveLength(2)
    // Focusing another change keeps the mode: back in Edit, it opens that file.
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    await editorFor('f.txt')
    fireEvent.click(changes().getByText('new.txt'))
    await editorFor('new.txt')
    expect(a.readFile).toHaveBeenLastCalledWith(REPO, 'C:/repos/A', REG, 'new.txt')
    expect(pills().getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('asks before leaving unsaved edits', async () => {
    setupView(files())
    await openWorktree()
    fireEvent.click(changes().getByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    const view = await editorFor('f.txt')
    act(() => { view.dispatch({ changes: { from: 0, insert: 'mine ' } }) })
    await screen.findByText('● Unsaved')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(changes().getByText('new.txt'))
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to f.txt?')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /^Changes/ }).getAttribute('aria-pressed')).toBe('true')
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${NINE_PLUS}`)
    confirm.mockReturnValue(true)
    fireEvent.click(changes().getByText('new.txt'))
    expect((await editorFor('new.txt')).state.doc.toString()).toBe(NINE_PLUS)
    expect(screen.queryByText('● Unsaved')).toBeNull()
  })

  it('goes back to Diff whenever the editor closes', async () => {
    const CONFLICT = DIRTY + 'u UU N... 100644 100644 100644 100644 a b c c.txt\0'
    const { state } = setupView({
      ...files(),
      // History is only passed through; it never needs to finish loading.
      refs: vi.fn(() => new Promise(() => {})),
      log: vi.fn(() => new Promise(() => {})),
      worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0worktree C:/repos/A-feat\0HEAD b\0branch refs/heads/feat\0\0`),
    })
    state.porcelain = CONFLICT
    await openWorktree()
    const diffShown = async () => {
      expect(pills().getByRole('button', { name: 'Diff' }).getAttribute('aria-pressed')).toBe('true')
      expect(await screen.findAllByRole('button', { name: 'Stage hunk' })).toHaveLength(2)
      expect(screen.queryByLabelText(/^Edit /)).toBeNull()
    }
    const editF = async () => {
      fireEvent.click(changes().getByText('f.txt'))
      fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
      await editorFor('f.txt')
    }
    // Changes → History → Changes.
    await editF()
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    fireEvent.click(screen.getByRole('button', { name: /^Changes/ }))
    await diffShown()
    // A conflicted file has no Edit; the next file opens in Diff.
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    await editorFor('f.txt')
    fireEvent.click(changes().getByText('c.txt'))
    expect(screen.queryByRole('group', { name: 'Diff or edit' })).toBeNull()
    fireEvent.click(changes().getByText('f.txt'))
    await diffShown()
    // Another worktree and back.
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    await editorFor('f.txt')
    const region = screen.getByRole('region', { name: 'A' })
    fireEvent.click(within(region).getByRole('button', { name: /^C:\/repos\/A-feat →/ }))
    await screen.findByText(/^C:\/repos\/A-feat · /)
    fireEvent.click(within(region).getByRole('button', { name: /checkout → main/ }))
    fireEvent.click(await changes().findByText('f.txt'))
    await diffShown()
  })

  it('asks before a group save would close unsaved edits, and saves nothing when declined', async () => {
    setupView(files())
    act(() => { setGitConfig({ groups: [{ name: 'Mine', repos: ['A'], worktrees: [], branches: [] }] }) })
    const tabs = await screen.findByRole('tablist', { name: 'Project groups' })
    fireEvent.click(within(tabs).getByRole('tab', { name: /^Mine/ }))
    await openWorktree()
    fireEvent.click(changes().getByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    const view = await editorFor('f.txt')
    act(() => { view.dispatch({ changes: { from: 0, insert: 'mine ' } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Group options for Mine' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit members…' }))
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'Mine 2' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to f.txt?'))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' }).disabled).toBe(false))
    expect(getGitConfig().groups.map(g => g.name)).toEqual(['Mine'])
    expect(screen.getByLabelText('Group name')).toBeTruthy()
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${NINE_PLUS}`)
    confirm.mockReturnValue(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(getGitConfig().groups.map(g => g.name)).toEqual(['Mine 2']))
    expect(screen.queryByLabelText(/^Edit f.txt/)).toBeNull()
  })

  it('clicking a diff line opens Edit at that line', async () => {
    setupView(files())
    await openWorktree()
    fireEvent.click(changes().getByText('f.txt'))
    await screen.findAllByRole('button', { name: 'Stage hunk' })
    const added = screen.getAllByTestId('diff-line').filter(r => r.dataset.kind === 'add')
    fireEvent.click(added[1])
    const view = await editorFor('f.txt')
    expect(pills().getByRole('button', { name: 'Edit' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(view.state.selection.main.head).toBe(view.state.doc.line(9).from))
  })
})

describe('unsaved edits kept as drafts', () => {
  const TEXT = 'line 1\nline 2\n'
  const files = () => ({
    readFile: vi.fn(async () => ({ text: TEXT, bom: false, stamp: 'f1' })),
    writeFile: vi.fn(async () => ({ ok: true, stamp: 'f2' })),
  })
  const changes = () => within(screen.getByRole('region', { name: 'Changes' }))
  const pills = () => within(screen.getByRole('group', { name: 'Diff or edit' }))
  const editorFor = async path => {
    const content = await screen.findByLabelText(`Edit ${path}`)
    return EditorView.findFromDOM(content.closest('.cm-editor'))
  }
  const editF = async () => {
    fireEvent.click(changes().getByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    const view = await editorFor('f.txt')
    act(() => { view.dispatch({ changes: { from: 0, insert: 'mine ' } }) })
    await screen.findByText('● Unsaved')
  }
  // Waits for the panel, e.g. after the view mounts again.
  const changesShown = async () => within(await screen.findByRole('region', { name: 'Changes' }))
  afterEach(() => { vi.restoreAllMocks() })
  beforeEach(() => {
    Range.prototype.getClientRects ??= () => []
    Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  })

  it('restores edits after switching to another app view and back, until reverted', async () => {
    const { a } = setupView(files())
    await openWorktree()
    await editF()
    // Another app view unmounts the Git Workspace without asking.
    const confirm = vi.spyOn(window, 'confirm')
    cleanup()
    expect(confirm).not.toHaveBeenCalled()
    render(<ViewGit adapters={{ git: a }} />)
    // The worktree is still selected; its kept edits are pointed at.
    expect(await (await changesShown()).findByRole('img', { name: 'Unsaved edits' })).toBeTruthy()
    const note = screen.getByRole('note', { name: 'Unsaved edits' })
    fireEvent.click(within(note).getByRole('button', { name: 'f.txt' }))
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${TEXT}`)
    expect(screen.getByText('Unsaved changes from earlier were restored.')).toBeTruthy()
    expect(screen.getByText('● Unsaved')).toBeTruthy()
    // Revert drops the draft: the file's text comes back and nothing is pointed at any more.
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(async () => expect((await editorFor('f.txt')).state.doc.toString()).toBe(TEXT))
    expect(screen.queryByText('Unsaved changes from earlier were restored.')).toBeNull()
    expect(changes().queryByRole('img', { name: 'Unsaved edits' })).toBeNull()
    expect(screen.queryByRole('note', { name: 'Unsaved edits' })).toBeNull()
  })

  it('opening a restored draft over a file changed on disk shows the conflict, never overwriting', async () => {
    const { a } = setupView(files())
    await openWorktree()
    await editF()
    cleanup()
    a.readFile.mockImplementation(async () => ({ text: 'theirs\n', bom: false, stamp: 'f9' }))
    render(<ViewGit adapters={{ git: a }} />)
    fireEvent.click(await (await changesShown()).findByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${TEXT}`)
    expect(await screen.findByText('This file changed on disk since you opened it.')).toBeTruthy()
    expect(a.writeFile).not.toHaveBeenCalled()
  })

  it('keeps edits when a refresh briefly loses the worktree', async () => {
    let broken = false
    const { a } = setupView({
      ...files(),
      worktrees: vi.fn(async repo => { if (broken) throw new Error('busy'); return `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0` }),
    })
    await openWorktree()
    await editF()
    broken = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull())
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(await (await changesShown()).findByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${TEXT}`)
    expect(screen.getByText('Unsaved changes from earlier were restored.')).toBeTruthy()
    expect(a.writeFile).not.toHaveBeenCalled()
  })

  it('asks before another worktree card would close unsaved edits; declining keeps both, confirming drops the draft', async () => {
    setupView({
      ...files(),
      worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0worktree C:/repos/A-feat\0HEAD b\0branch refs/heads/feat\0\0`),
    })
    await openWorktree()
    await editF()
    const selected = getGitConfig().view.selected
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const region = screen.getByRole('region', { name: 'A' })
    fireEvent.click(within(region).getByRole('button', { name: /^C:\/repos\/A-feat →/ }))
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to f.txt?')
    expect(getGitConfig().view.selected).toBe(selected)
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(`mine ${TEXT}`)
    expect(screen.getByText('● Unsaved')).toBeTruthy()
    confirm.mockReturnValue(true)
    fireEvent.click(within(region).getByRole('button', { name: /^C:\/repos\/A-feat →/ }))
    await screen.findByText(/^C:\/repos\/A-feat · /)
    fireEvent.click(within(region).getByRole('button', { name: /checkout → main/ }))
    fireEvent.click(await (await changesShown()).findByText('f.txt'))
    fireEvent.click(pills().getByRole('button', { name: 'Edit' }))
    expect((await editorFor('f.txt')).state.doc.toString()).toBe(TEXT)
    expect(screen.queryByText('Unsaved changes from earlier were restored.')).toBeNull()
    expect(changes().queryByRole('img', { name: 'Unsaved edits' })).toBeNull()
  })
})
