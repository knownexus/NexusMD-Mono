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
  const handlers = { onSelectionChange: vi.fn(), onFocus: vi.fn(), onAction: vi.fn(), onWrite: vi.fn(), onCommit: vi.fn() }
  render(<ChangesPane tree={tree} selected={[]} focusId={null} {...handlers} {...props} />)
  return handlers
}
const button = name => screen.getByRole('button', { name })

describe('ChangesPane', () => {
  it('groups files as Staged and Not staged with coloured status letters, basename then folder', () => {
    renderPane({ tree: { ...tree, changes: [A, B, NEW, LIB, c('unstaged', 'src/deep/file.cs', { xy: '.D' })] } })
    expect(screen.getByRole('group', { name: 'Staged (1)' })).toBeTruthy()
    const notStaged = within(screen.getByRole('group', { name: 'Not staged (4)' }))
    expect(notStaged.getByText('b.txt')).toBeTruthy()
    expect(notStaged.getByText('new.txt')).toBeTruthy()
    expect(notStaged.getByText('submodule')).toBeTruthy()
    expect(notStaged.getByText('file.cs').className).toBe('base')
    expect(notStaged.getByText('src/deep').className).toBe('dir')
    expect(notStaged.getByText('D').dataset.tone).toBe('bad')
    expect(screen.queryByRole('group', { name: /Conflicts/ })).toBeNull()
  })

  it('stages, unstages and resolves from a row or a section, without the review', () => {
    const h = renderPane()
    fireEvent.click(button('Stage b.txt'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id])
    fireEvent.click(button('Unstage a.txt'))
    expect(h.onWrite).toHaveBeenLastCalledWith('unstage', [A.id])
    // A submodule has no row action, and Stage all leaves it out.
    expect(screen.queryByRole('button', { name: 'Stage lib' })).toBeNull()
    fireEvent.click(button('Stage all'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id, NEW.id])
    fireEvent.click(button('Unstage all'))
    expect(h.onWrite).toHaveBeenLastCalledWith('unstage', [A.id])
    expect(h.onFocus).not.toHaveBeenCalled()
    expect(h.onAction).not.toHaveBeenCalled()
  })

  it('counts what each action would touch and runs it', () => {
    const h = renderPane({ selected: [A.id, B.id, NEW.id, LIB.id] })
    expect(button('Stage 2').disabled).toBe(false)
    expect(button('Unstage 1').disabled).toBe(false)
    expect(button('Discard 1…').disabled).toBe(false)
    expect(button('Delete 1…').disabled).toBe(false)
    fireEvent.click(button('Stage 2'))
    expect(h.onAction).toHaveBeenCalledWith('stage')
  })

  it('disables actions that do not apply, with a reason', () => {
    renderPane()
    expect(button('Stage').disabled).toBe(true)
    expect(button('Stage').title).toBe('Select changes that can be staged')
    expect(button('Discard…').title).toBe('Select unstaged changes to tracked files')
  })

  it('commits from the composer at the bottom of the column', async () => {
    const h = renderPane()
    h.onCommit.mockResolvedValue(true)
    fireEvent.change(screen.getByLabelText('Commit summary'), { target: { value: 'Ship it' } })
    fireEvent.click(button('Commit 1 file'))
    expect(h.onCommit).toHaveBeenCalledWith({ message: 'Ship it', amend: false, push: false })
  })

  it('selects with checkboxes, shift-click ranges and group checkboxes, skipping submodules', () => {
    const h = renderPane({ focusId: A.id })
    fireEvent.click(screen.getByLabelText('Select b.txt'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
    fireEvent.click(screen.getByLabelText('Select new.txt'), { shiftKey: true })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([A.id, B.id, LIB.id, NEW.id])
    fireEvent.click(screen.getByLabelText('Select all Not staged'))
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id, NEW.id])
    expect(screen.getByLabelText('Select lib').disabled).toBe(true)
  })

  it('focuses a file when its row is clicked', () => {
    const h = renderPane()
    fireEvent.click(screen.getByText('b.txt'))
    expect(h.onFocus).toHaveBeenCalledWith(B.id)
  })

  it('moves focus with the arrows, selects with Space, runs s and u, and c goes to the commit summary', () => {
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
    expect(document.activeElement).toBe(screen.getByLabelText('Commit summary'))
    expect(h.onCommit).not.toHaveBeenCalled()
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
    expect(button('Commit 1 file').disabled).toBe(true)
    expect(within(screen.getByRole('toolbar')).getByText('Working…')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('fatal: nope')
  })

  it('says when there are no changes', () => {
    renderPane({ tree: { path: 'C:/repos/A', changes: [] } })
    expect(screen.getByText('Working tree clean')).toBeTruthy()
    expect(button('Commit').disabled).toBe(true)
    expect(screen.getByText('Nothing to commit')).toBeTruthy()
  })
})

describe('ChangesPane conflicts', () => {
  const U = c('conflict', 'u.txt', { xy: 'UU' })
  const D = c('conflict', 'd.txt', { xy: 'DU' })
  const op = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 1, total: 2, replaying: null }
  const ctree = { path: 'C:/repos/A', branch: 'feat', operationInfo: op, changes: [A, B, U, D] }

  afterEach(() => vi.restoreAllMocks())

  it('notes how to finish, opens a conflict from its Resolve button, and pauses the composer', () => {
    const h = renderPane({ tree: { ...ctree, operation: 'Rebase in progress' }, onResolve: vi.fn() })
    const conflicts = within(screen.getByRole('group', { name: 'Conflicts (2)' }))
    expect(conflicts.getByText('Resolve each file, then continue the rebase.')).toBeTruthy()
    fireEvent.click(conflicts.getByRole('button', { name: 'Resolve d.txt' }))
    expect(h.onFocus).toHaveBeenCalledWith(D.id)
    expect(screen.queryByLabelText('Commit summary')).toBeNull()
    expect(screen.getByRole('note').textContent).toBe('Committing is paused during the rebase — resolved files go into the replayed commit.')
  })

  it('lists conflicts first with whole-file choices', () => {
    renderPane({ tree: ctree, onResolve: vi.fn() })
    const groups = screen.getAllByRole('group').filter(g => /\(\d+\)$/.test(g.getAttribute('aria-label')))
    expect(groups[0].getAttribute('aria-label')).toBe('Conflicts (2)')
    const row = within(groups[0])
    expect(row.getAllByRole('button', { name: /^Take main's for / })).toHaveLength(1)
    expect(row.getAllByRole('button', { name: /^Take mine for / })).toHaveLength(1)
    expect(within(screen.getByRole('group', { name: 'Staged (1)' })).queryByRole('button', { name: /^Take/ })).toBeNull()
  })

  it('only text conflicts get row takes; a deletion conflict is resolved from its own screen', () => {
    const AA = c('conflict', 'aa.txt', { xy: 'AA' })
    const others = ['DU', 'UD', 'AU', 'UA', 'DD'].map(xy => c('conflict', `${xy}.txt`, { xy }))
    renderPane({ tree: { ...ctree, changes: [U, AA, ...others] }, onResolve: vi.fn() })
    expect(screen.getByRole('button', { name: "Take main's for u.txt" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take mine for aa.txt' })).toBeTruthy()
    for (const o of others) expect(screen.queryByRole('button', { name: new RegExp(`for ${o.path}$`) })).toBeNull()
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

describe('ChangesPane with very many changes', () => {
  const many = Array.from({ length: 1000 }, (_, i) => c('untracked', `out/f${i}.js`))

  it('draws only the first rows and says how many are not shown', () => {
    renderPane({ tree: { ...tree, changes: many } })
    const group = within(screen.getByRole('group', { name: 'Not staged (1000)' }))
    expect(group.getAllByRole('checkbox', { name: /^Select out\// })).toHaveLength(300)
    expect(group.getByRole('button', { name: 'Show 700 more (700 not shown)' })).toBeTruthy()
  })

  it('shows more on request', () => {
    renderPane({ tree: { ...tree, changes: many } })
    fireEvent.click(screen.getByRole('button', { name: /Show 700 more/ }))
    expect(document.querySelectorAll(".nx-gw-file")).toHaveLength(1000)
  })

  it('always draws the focused file, even past the cap', () => {
    renderPane({ tree: { ...tree, changes: many }, focusId: many[900].id })
    expect(screen.getByRole('checkbox', { name: 'Select out/f900.js' })).toBeTruthy()
  })

  it('Select all still covers the rows that are not drawn', () => {
    const { onSelectionChange } = renderPane({ tree: { ...tree, changes: many } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all Not staged' }))
    expect(onSelectionChange.mock.calls[0][0]).toHaveLength(1000)
  })
})

describe('ChangesPane pop-out menu', () => {
  const DEL = c('unstaged', 'gone.txt', { xy: '.D' })
  const CON = c('conflict', 'clash.txt', { xy: 'UU' })
  const open = async (path, onPopout = vi.fn()) => {
    renderPane({ tree: { ...tree, changes: [A, B, DEL, CON, LIB] }, onPopout })
    fireEvent.contextMenu(screen.getByTitle(path))
    return onPopout
  }

  it('offers an editor and a diff for a changed file, each in a window of its own', async () => {
    const onPopout = await open('b.txt')
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Edit in new window', 'Diff in new window'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diff in new window' }))
    expect(onPopout).toHaveBeenLastCalledWith('diff', B)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(screen.getByTitle('b.txt'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit in new window' }))
    expect(onPopout).toHaveBeenLastCalledWith('editor', B)
  })

  it('offers only the diff for a deleted file, and only Resolve for a conflict', async () => {
    await open('gone.txt')
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Diff in new window'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTitle('clash.txt'))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Resolve in new window'])
  })

  it('has no menu for a submodule, or when pop-outs are not available', async () => {
    await open('lib')
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    renderPane()
    const row = screen.getByTitle('b.txt')
    expect(fireEvent.contextMenu(row)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows why a window could not be opened', async () => {
    const onPopout = vi.fn(async () => { throw new Error("Error invoking remote method 'popout:open': Error: Can't open that window: no file.") })
    await open('b.txt', onPopout)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diff in new window' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Can't open that window: no file.")
  })
})
