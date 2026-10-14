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
