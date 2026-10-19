import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ChangesPane } from './changes-pane.jsx'

afterEach(cleanup)

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: area === 'staged' ? 'M.' : '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const A = c('staged', 'a.txt')
const B = c('unstaged', 'b.txt')
const LIB = c('unstaged', 'lib', { sub: 'SC..' })
const NEW = c('untracked', 'new.txt')
const tree = { path: 'C:/repos/A', changes: [A, B, NEW, LIB] }

function renderPane(props = {}) {
  const handlers = { onSelectionChange: vi.fn(), onFocus: vi.fn(), onAction: vi.fn(), onCommit: vi.fn() }
  render(<ChangesPane tree={tree} selected={[]} focusId={null} {...handlers} {...props} />)
  return handlers
}
const button = name => screen.getByRole('button', { name })

describe('ChangesPane', () => {
  it('groups files as Staged, Changes and Untracked with coloured status codes', () => {
    renderPane()
    expect(screen.getByRole('group', { name: 'Staged (1)' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Changes (2)' })).getByText('b.txt')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Untracked (1)' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Conflicts/ })).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Changes (2)' })).getByText('submodule')).toBeTruthy()
  })

  it('counts what each action would touch and runs it', () => {
    const h = renderPane({ selected: [A.id, B.id, NEW.id, LIB.id] })
    expect(button('Stage 2').disabled).toBe(false)
    expect(button('Unstage 1').disabled).toBe(false)
    expect(button('Discard 1…').disabled).toBe(false)
    expect(button('Delete 1…').disabled).toBe(false)
    fireEvent.click(button('Stage 2'))
    expect(h.onAction).toHaveBeenCalledWith('stage')
    fireEvent.click(button('Commit…'))
    expect(h.onCommit).toHaveBeenCalled()
  })

  it('disables actions that do not apply, with a reason', () => {
    renderPane()
    expect(button('Stage').disabled).toBe(true)
    expect(button('Stage').title).toBe('Select changes that can be staged')
    expect(button('Discard…').title).toBe('Select unstaged changes to tracked files')
    expect(button('Commit…').disabled).toBe(false)
  })

  it('selects with checkboxes, shift-click ranges and group checkboxes, skipping submodules', () => {
    const h = renderPane({ focusId: A.id })
    fireEvent.click(screen.getByLabelText('Select b.txt'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
    fireEvent.click(screen.getByLabelText('Select new.txt'), { shiftKey: true })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([A.id, B.id, LIB.id, NEW.id])
    fireEvent.click(screen.getByLabelText('Select all Changes'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
    expect(screen.getByLabelText('Select lib').disabled).toBe(true)
  })

  it('focuses a file when its row is clicked', () => {
    const h = renderPane()
    fireEvent.click(screen.getByText('b.txt'))
    expect(h.onFocus).toHaveBeenCalledWith(B.id)
  })

  it('moves focus with the arrows, selects with Space and runs s, u and c', () => {
    const h = renderPane({ selected: [B.id, A.id], focusId: B.id })
    const list = screen.getByLabelText('Changed files')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(h.onFocus).toHaveBeenLastCalledWith(LIB.id)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(h.onFocus).toHaveBeenLastCalledWith(A.id)
    fireEvent.keyDown(list, { key: ' ' })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([A.id])
    fireEvent.keyDown(list, { key: 's' })
    expect(h.onAction).toHaveBeenLastCalledWith('stage')
    fireEvent.keyDown(list, { key: 'u' })
    expect(h.onAction).toHaveBeenLastCalledWith('unstage')
    fireEvent.keyDown(list, { key: 'c' })
    expect(h.onCommit).toHaveBeenCalled()
  })

  it('ignores keys held with Ctrl, Meta or Alt', () => {
    const h = renderPane({ selected: [B.id, A.id], focusId: B.id })
    const list = screen.getByLabelText('Changed files')
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      for (const key of ['s', 'u', 'c', ' ', 'ArrowDown']) fireEvent.keyDown(list, { key, [mod]: true })
    }
    expect(h.onAction).not.toHaveBeenCalled()
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(h.onSelectionChange).not.toHaveBeenCalled()
    expect(h.onFocus).not.toHaveBeenCalled()
  })

  it('leaves Space on a tabbed-to checkbox to that checkbox', () => {
    const h = renderPane({ focusId: B.id })
    fireEvent.keyDown(screen.getByLabelText('Select a.txt'), { key: ' ' })
    expect(h.onSelectionChange).not.toHaveBeenCalled()
  })

  it('locks the toolbar while a write runs and shows the last result', () => {
    renderPane({ selected: [B.id], busy: true, status: { ok: false, text: 'fatal: nope' } })
    expect(button('Stage 1').disabled).toBe(true)
    expect(button('Commit…').disabled).toBe(true)
    expect(screen.getByText('Working…')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('fatal: nope')
  })

  it('says when there are no changes', () => {
    renderPane({ tree: { path: 'C:/repos/A', changes: [] } })
    expect(screen.getByText('No changes.')).toBeTruthy()
    expect(button('Commit…').disabled).toBe(true)
  })
})

describe('ChangesPane conflicts', () => {
  const U = c('conflict', 'u.txt', { xy: 'UU' })
  const D = c('conflict', 'd.txt', { xy: 'DU' })
  const op = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 1, total: 2, replaying: null }
  const ctree = { path: 'C:/repos/A', branch: 'feat', operationInfo: op, changes: [A, B, U, D] }

  afterEach(() => vi.restoreAllMocks())

  it('lists conflicts first with whole-file choices', () => {
    renderPane({ tree: ctree, onResolve: vi.fn() })
    const groups = screen.getAllByRole('group').filter(g => /\(\d+\)$/.test(g.getAttribute('aria-label')))
    expect(groups[0].getAttribute('aria-label')).toBe('Conflicts (2)')
    const row = within(groups[0])
    expect(row.getAllByRole('button', { name: /^Take main's for / })).toHaveLength(2)
    expect(row.getAllByRole('button', { name: /^Take mine for / })).toHaveLength(2)
    expect(within(screen.getByRole('group', { name: 'Staged (1)' })).queryByRole('button', { name: /^Take/ })).toBeNull()
  })

  it('whole-file choice asks first and resolves', () => {
    const onResolve = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    renderPane({ tree: ctree, onResolve })
    const take = screen.getByRole('button', { name: "Take main's for u.txt" })
    fireEvent.click(take)
    expect(confirm).toHaveBeenLastCalledWith("Use main's version for the whole of u.txt?")
    expect(onResolve).not.toHaveBeenCalled()
    fireEvent.click(take)
    expect(onResolve).toHaveBeenCalledWith(U, 'left')
  })

  it('keys on a take button activate it and do not stage, select or commit', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const h = renderPane({ tree: ctree, onResolve: vi.fn(), selected: [A.id] })
    const take = screen.getByRole('button', { name: "Take main's for u.txt" })
    for (const key of ['s', 'u', 'c', ' ']) fireEvent.keyDown(take, { key })
    expect(h.onAction).not.toHaveBeenCalled()
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(h.onSelectionChange).not.toHaveBeenCalled()
    // Space's default action is the click, so the notification is not cancelled.
    expect(fireEvent.keyDown(take, { key: ' ' })).toBe(true)
  })
})
