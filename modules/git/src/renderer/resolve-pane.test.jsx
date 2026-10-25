import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { ResolvePane } from './resolve-pane.jsx'
import { clearWorktreeDrafts, putWorktreeDraft, conflictDraftKey } from './use-worktree-file.js'

afterEach(() => { cleanup(); clearWorktreeDrafts() })
// jsdom has no layout; CodeMirror measures text ranges after scrolling a jumped-to line into view.
beforeEach(() => {
  Range.prototype.getClientRects ??= () => []
  Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
})

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const B = 'b'.repeat(40)
const tree = {
  path: 'C:/repos/A', branch: 'feat/x', operation: 'Rebase in progress',
  operationInfo: { kind: 'rebase', onto: { oid: 'a'.repeat(40), name: 'main' }, replaying: { oid: B, subject: 'Fix login' }, step: 1, total: 2 },
  changes: [],
}
const change = { id: 'conflict\0f.txt', path: 'f.txt', area: 'conflict', xy: 'UU' }
const THEIRS = 'main (already applied)'
const MINE = 'Your commit bbbbbbb "Fix login"'
const TWO = 'a\n<<<<<<< HEAD\nL1\n=======\nR1\n>>>>>>> fix\nb\n<<<<<<< HEAD\nL2\n=======\nR2\n>>>>>>> fix\nc\n'
const LEFT2 = '2 conflict blocks left in this file'
const DONE = 'Conflict resolved — review, then mark resolved'
const data = (over = {}) => ({
  kind: 'both-modified', binary: false,
  stages: { base: { text: 'base text\n', bom: false }, left: { text: 'l\n', bom: false }, right: { text: 'r\n', bom: false } },
  working: { text: TWO, bom: false, stamp: 'w1' }, stamp: 'c1', ...over,
})
const mk = (over = {}) => ({
  conflict: vi.fn(async () => data()),
  resolveConflict: vi.fn(async () => ({ ok: true })),
  unresolve: vi.fn(async () => ({ ok: true })),
  stamp: vi.fn(async () => 'f1'),
  ...over,
})

async function setup(adapter = mk(), props = {}) {
  const onResolved = vi.fn()
  const onDirtyChange = vi.fn()
  render(<ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={onResolved} onDirtyChange={onDirtyChange} {...props} />)
  await screen.findByRole('heading', { name: 'Conflict f.txt' })
  await screen.findByText(LEFT2)
  return { adapter, onResolved, onDirtyChange }
}
const result = () => EditorView.findFromDOM(document.querySelector('.cm-content[aria-label="Result for f.txt"]').closest('.cm-editor'))
const side = title => screen.getByRole('region', { name: title })
const markButton = () => screen.getByRole('button', { name: /^Mark resolved( & next)?$/ })
// Uses theirs for both blocks: the result is then 'a\nL1\nb\nL2\nc\n'.
const resolveAll = () => {
  fireEvent.click(within(side(THEIRS)).getByRole('button', { name: 'Use theirs' }))
  fireEvent.click(within(side(THEIRS)).getByRole('button', { name: 'Use theirs' }))
}

describe('ResolvePane', () => {
  it('shows both sides of the current conflict in cards, by meaning', async () => {
    await setup()
    expect(within(side(THEIRS)).getByText('L1')).toBeTruthy()
    expect(within(side(MINE)).getByText('R1')).toBeTruthy()
    expect(within(side(THEIRS)).getByText('Incoming · already applied')).toBeTruthy()
    expect(within(side(MINE)).getByText('Yours · being replayed')).toBeTruthy()
    expect(side(THEIRS).dataset.role).toBe('theirs')
    expect(side(MINE).dataset.role).toBe('mine')
    expect(within(side(THEIRS)).getByRole('button', { name: 'Use theirs' })).toBeTruthy()
    expect(within(side(MINE)).getByRole('button', { name: 'Use mine' })).toBeTruthy()
    expect(result().state.doc.toString()).toBe(TWO)
    // The result is read-only here; Edit result… is where it's edited.
    expect(result().state.readOnly).toBe(true)
  })

  it('tints the result: markers, and each side by where it came from', async () => {
    await setup()
    await waitFor(() => expect(document.querySelectorAll('.nx-res-marker')).toHaveLength(6))
    expect([...document.querySelectorAll('.nx-res-theirs')].map(l => l.textContent)).toEqual(['L1', 'L2'])
    expect([...document.querySelectorAll('.nx-res-mine')].map(l => l.textContent)).toEqual(['R1', 'R2'])
    fireEvent.click(within(side(MINE)).getByRole('button', { name: 'Use mine' }))
    await waitFor(() => expect(document.querySelectorAll('.nx-res-marker')).toHaveLength(3))
    expect([...document.querySelectorAll('.nx-res-mine')].map(l => l.textContent)).toEqual(['R1', 'R2'])
  })

  it('Use mine after editing the result above the region', async () => {
    const { onDirtyChange } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Edit result…' }))
    const dialog = screen.getByRole('dialog')
    const editor = EditorView.findFromDOM(dialog.querySelector('.cm-content[aria-label="Edit result for f.txt"]').closest('.cm-editor'))
    expect(within(dialog).getByText(/Conflict markers remain/)).toBeTruthy()
    act(() => { editor.dispatch({ changes: { from: 0, insert: 'top\n' } }) })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save result' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use mine' }))
    expect(result().state.doc.toString()).toBe('top\na\nR1\nb\n<<<<<<< HEAD\nL2\n=======\nR2\n>>>>>>> fix\nc\n')
    expect(screen.getByText('1 conflict block left in this file')).toBeTruthy()
    expect(within(side(MINE)).getByText('R2')).toBeTruthy()
  })

  it('Edit result… says when no markers are left, and Cancel keeps the result', async () => {
    await setup()
    resolveAll()
    fireEvent.click(screen.getByRole('button', { name: 'Edit result…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('No conflict markers left.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(result().state.doc.toString()).toBe('a\nL1\nb\nL2\nc\n')
  })

  it('Both, theirs first / mine first order the sides; the choice shows once none are left', async () => {
    await setup()
    // Plain buttons, so they are reachable and usable from the keyboard like any other.
    const both = screen.getByRole('group', { name: 'Both' })
    const choices = within(both).getAllByRole('button')
    expect(choices.map(b => b.textContent)).toEqual(['Both, theirs first', 'Both, mine first'])
    expect(choices.every(b => b.tagName === 'BUTTON' && !b.disabled && b.tabIndex === 0)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(choices[0])
    expect(result().state.doc.toString().startsWith('a\nL1\nR1\nb\n')).toBe(true)
    fireEvent.click(within(screen.getByRole('group', { name: 'Both' })).getByRole('button', { name: 'Both, mine first' }))
    expect(result().state.doc.toString()).toBe('a\nL1\nR1\nb\nR2\nL2\nc\n')
    expect(screen.getByText(DONE)).toBeTruthy()
    // The last block stays on the cards, with its choice pressed; another choice swaps it in place.
    expect(screen.getByRole('button', { name: 'Both, mine first' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(side(THEIRS)).getByText('L2')).toBeTruthy()
    fireEvent.click(within(side(THEIRS)).getByRole('button', { name: 'Use theirs' }))
    expect(result().state.doc.toString()).toBe('a\nL1\nR1\nb\nL2\nc\n')
    const using = within(side(THEIRS)).getByRole('button', { name: '✓ Using this' })
    expect(using.getAttribute('aria-pressed')).toBe('true')
    expect(side(THEIRS).dataset.chosen).toBe('true')
    expect(within(side(MINE)).getByRole('button', { name: 'Use mine' })).toBeTruthy()
  })

  it('Show markers puts the last block back', async () => {
    await setup()
    expect(screen.getByRole('button', { name: 'Show markers' }).disabled).toBe(true)
    resolveAll()
    expect(screen.getByText(DONE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show markers' }))
    expect(result().state.doc.toString()).toBe('a\nL1\nb\n<<<<<<< HEAD\nL2\n=======\nR2\n>>>>>>> fix\nc\n')
    expect(screen.getByText('1 conflict block left in this file')).toBeTruthy()
    expect(within(side(THEIRS)).getByText('L2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show markers' }))
    expect(result().state.doc.toString()).toBe(TWO)
    expect(screen.getByRole('button', { name: 'Show markers' }).disabled).toBe(true)
  })

  it('counter and next/previous', async () => {
    await setup()
    const prev = screen.getByRole('button', { name: 'Previous conflict' })
    const next = screen.getByRole('button', { name: 'Next conflict' })
    expect(prev.disabled).toBe(true)
    fireEvent.click(next)
    expect(within(side(THEIRS)).getByText('L2')).toBeTruthy()
    expect(next.disabled).toBe(true)
    // The result jumps to the region's first line (line 8 of the file).
    await waitFor(() => expect(result().state.doc.lineAt(result().state.selection.main.head).number).toBe(8))
    fireEvent.click(prev)
    expect(within(side(THEIRS)).getByText('L1')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Resolve f.txt' }), { key: 'ArrowDown', altKey: true })
    expect(within(side(THEIRS)).getByText('L2')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Resolve f.txt' }), { key: 'ArrowUp', altKey: true })
    expect(within(side(THEIRS)).getByText('L1')).toBeTruthy()
  })

  it('Mark resolved waits, with a reason, until no conflict blocks are left', async () => {
    const { adapter, onResolved } = await setup()
    expect(markButton().disabled).toBe(true)
    expect(markButton().title).toBe('Resolve the 2 conflict blocks left first: use a side, combine them, or edit the result')
    fireEvent.click(screen.getByRole('button', { name: 'Use theirs' }))
    expect(markButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use mine' }))
    expect(markButton().disabled).toBe(false)
    fireEvent.click(markButton())
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(adapter.resolveConflict.mock.calls[0][4]).toEqual({ take: 'text', text: 'a\nL1\nb\nR2\nc\n', bom: false, force: false })
  })

  it('stray markers outside a block still ask first, then Undo resolution', async () => {
    const STRAY = 'a\n=======\nb\n'
    const adapter = mk({ conflict: vi.fn(async () => data({ working: { text: STRAY, bom: false, stamp: 'w1' } })) })
    const onResolved = vi.fn()
    render(<ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={onResolved} />)
    await screen.findByText(DONE)
    fireEvent.click(markButton())
    expect(await screen.findByText('This file still has conflict markers. Mark it resolved anyway?')).toBeTruthy()
    expect(adapter.resolveConflict).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved anyway' }))
    await waitFor(() => expect(adapter.resolveConflict).toHaveBeenCalledWith(repo, tree.path, registered, 'f.txt', { take: 'text', text: STRAY, bom: false, force: true }, 'c1'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    // Still in the rebase: the resolution can be undone from here.
    fireEvent.click(await screen.findByRole('button', { name: 'Undo resolution' }))
    await waitFor(() => expect(adapter.unresolve).toHaveBeenCalledWith(repo, tree.path, registered, 'f.txt', 'f1'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(2))
    await screen.findByText(DONE)
  })

  it('a refused undo shows its reason', async () => {
    await setup(mk({ unresolve: vi.fn(async () => ({ ok: false, detail: 'The rebase has moved on.' })) }))
    resolveAll()
    fireEvent.click(markButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo resolution' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The rebase has moved on.')
  })

  it('a stale resolve says so and offers Reload', async () => {
    const adapter = mk({ resolveConflict: vi.fn(async () => ({ ok: false, stale: true })) })
    const { onResolved } = await setup(adapter)
    resolveAll()
    fireEvent.click(markButton())
    const alert = await screen.findByText('This file changed since it was opened.')
    expect(onResolved).not.toHaveBeenCalled()
    expect(markButton().disabled).toBe(true)
    fireEvent.click(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(adapter.conflict).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('This file changed since it was opened.')).toBeNull())
  })

  it('a restored draft over a changed file asks before anything is written', async () => {
    putWorktreeDraft(conflictDraftKey(repo.path, tree.path, 'f.txt'), { text: 'draft\n', saved: TWO, eol: '\n', bom: false, stamp: 'old' })
    const adapter = mk()
    const onResolved = vi.fn()
    render(<ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={onResolved} />)
    expect(await screen.findByText('Unsaved changes from earlier were restored.')).toBeTruthy()
    expect(markButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(markButton().disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Reload (discard my changes)' })).toBeNull()
  })

  it('Reload (discard my changes) drops the restored draft', async () => {
    putWorktreeDraft(conflictDraftKey(repo.path, tree.path, 'f.txt'), { text: 'draft\n', saved: TWO, eol: '\n', bom: false, stamp: 'old' })
    render(<ResolvePane adapter={mk()} repo={repo} tree={tree} registered={registered} change={change} onResolved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reload (discard my changes)' }))
    await screen.findByText(LEFT2)
    expect(result().state.doc.toString()).toBe(TWO)
  })

  it('Show original shows the base', async () => {
    await setup()
    expect(document.querySelector('.cm-content[aria-label="Original f.txt"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }))
    expect(document.querySelector('.cm-content[aria-label="Original f.txt"]').textContent).toBe('base text')
    cleanup()
    await setup(mk({ conflict: vi.fn(async () => data({ stages: { base: null, left: { text: 'l\n' }, right: { text: 'r\n' } } })) }))
    expect(screen.getByRole('button', { name: 'Show original' }).disabled).toBe(true)
  })

  it('a deleted-or-binary conflict offers whole-file choices instead, under a pill', async () => {
    const adapter = mk({ conflict: vi.fn(async () => data({ kind: 'deleted-by-left', stages: { base: null, left: null, right: { text: 'r\n' } }, working: null })) })
    const onResolved = vi.fn()
    render(<ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={onResolved} />)
    // main (the incoming side, in a rebase) deleted it.
    expect(await screen.findByText('deleted upstream')).toBeTruthy()
    expect(markButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Accept the deletion' }))
    expect(adapter.resolveConflict).not.toHaveBeenCalled()
    fireEvent.click(markButton())
    await waitFor(() => expect(adapter.resolveConflict).toHaveBeenCalledWith(repo, tree.path, registered, 'f.txt', { take: 'delete' }, 'c1'))
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
  })

  it('a text conflict whose working file is missing never loads as an empty result', async () => {
    const adapter = mk({ conflict: vi.fn(async () => data({ working: null, missing: true })) })
    render(<ResolvePane adapter={adapter} repo={repo} tree={tree} registered={registered} change={change} onResolved={vi.fn()} />)
    expect(await screen.findByText(/f\.txt is missing from the folder/)).toBeTruthy()
    expect(screen.queryByText(/No conflicts left/)).toBeNull()
    expect(document.querySelector('.cm-content[aria-label="Result for f.txt"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: "Use main's version" }))
    fireEvent.click(markButton())
    await waitFor(() => expect(adapter.resolveConflict).toHaveBeenCalledWith(repo, tree.path, registered, 'f.txt', { take: 'left' }, 'c1'))
  })

  describe('jumping between conflicted files', () => {
    const files = { index: 0, total: 3, prev: 'z.txt', next: 'g.txt' }
    const content = () => document.querySelector('.cm-content[aria-label="Result for f.txt"]')

    it('goes on to the next file past the last conflict, and back past the first', async () => {
      const onOpenFile = vi.fn()
      await setup(mk(), { files, onOpenFile })
      const next = screen.getByRole('button', { name: 'Next conflict' })
      fireEvent.click(next)
      expect(onOpenFile).not.toHaveBeenCalled()
      expect(next.title).toBe('Alt+↓ · goes on to g.txt')
      fireEvent.click(next)
      expect(onOpenFile).toHaveBeenCalledWith('g.txt')
      fireEvent.keyDown(content(), { key: 'ArrowUp', altKey: true })
      fireEvent.keyDown(content(), { key: 'ArrowUp', altKey: true })
      expect(onOpenFile).toHaveBeenLastCalledWith('z.txt')
    })

    it('has file buttons and Alt+Shift+↑/↓, with where this file sits', async () => {
      const onOpenFile = vi.fn()
      await setup(mk(), { files, onOpenFile })
      const group = screen.getByRole('group', { name: 'Conflicted files' })
      expect(within(group).getByText('File 1 of 3')).toBeTruthy()
      fireEvent.click(within(group).getByRole('button', { name: 'Next conflicted file' }))
      expect(onOpenFile).toHaveBeenLastCalledWith('g.txt')
      fireEvent.click(within(group).getByRole('button', { name: 'Previous conflicted file' }))
      expect(onOpenFile).toHaveBeenLastCalledWith('z.txt')
      fireEvent.keyDown(content(), { key: 'ArrowDown', altKey: true, shiftKey: true })
      expect(onOpenFile).toHaveBeenLastCalledWith('g.txt')
    })

    it('Mark resolved & next opens the next conflicted file, or says none are left', async () => {
      const onOpenFile = vi.fn()
      const onDirtyChange = vi.fn()
      await setup(mk(), { files, onOpenFile, onDirtyChange })
      resolveAll()
      expect(screen.getByRole('button', { name: 'Mark resolved & next' }).title).toBe('Stage f.txt and open g.txt')
      fireEvent.click(screen.getByRole('button', { name: 'Mark resolved & next' }))
      await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('g.txt'))
      // Clean before moving on, so the panel doesn't ask about edits that were just staged.
      expect(onDirtyChange).toHaveBeenLastCalledWith(false)
      // Had the pane stayed, it offers the next file too.
      onOpenFile.mockClear()
      fireEvent.click(await screen.findByRole('button', { name: 'Next conflict: g.txt →' }))
      expect(onOpenFile).toHaveBeenCalledWith('g.txt')
      cleanup()
      await setup(mk(), { files: { index: 0, total: 1, prev: null, next: null }, onOpenFile })
      expect(screen.queryByRole('group', { name: 'Conflicted files' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Next conflict' }).disabled).toBe(false)
      resolveAll()
      fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
      expect(await screen.findByText('f.txt is marked resolved. No conflicted files left: continue when ready.')).toBeTruthy()
    })
  })
})
