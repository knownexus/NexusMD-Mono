import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ChangesPane } from './changes-pane.jsx'
import { getGitConfig, setGitConfig } from './git-config.js'

afterEach(() => { cleanup(); localStorage.clear() })

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
const lane = name => within(screen.getByRole('group', { name }))

describe('ChangesPane', () => {
  it('groups files into the Not staged and Staged lanes with coloured status letters, basename then folder', () => {
    renderPane({ tree: { ...tree, changes: [A, B, NEW, LIB, c('unstaged', 'src/deep/file.cs', { xy: '.D' })] } })
    expect(screen.getByRole('group', { name: 'Staged (1)' })).toBeTruthy()
    const notStaged = lane('Not staged (4)')
    expect(notStaged.getByText('b.txt')).toBeTruthy()
    expect(notStaged.getByText('new.txt')).toBeTruthy()
    expect(notStaged.getByText('submodule')).toBeTruthy()
    expect(notStaged.getByText('file.cs').className).toBe('base')
    expect(notStaged.getByText('src/deep').className).toBe('dir')
    expect(notStaged.getByText('D').dataset.tone).toBe('bad')
    expect(screen.queryByRole('group', { name: /Conflicts/ })).toBeNull()
  })

  it('puts the Not staged lane above the Staged lane', () => {
    renderPane()
    const top = screen.getByRole('group', { name: 'Not staged (3)' })
    const bottom = screen.getByRole('group', { name: 'Staged (1)' })
    expect(top.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stages, unstages and resolves from a row or a lane header, without the review', () => {
    const h = renderPane()
    fireEvent.click(button('Stage b.txt'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id])
    fireEvent.click(button('Unstage a.txt'))
    expect(h.onWrite).toHaveBeenLastCalledWith('unstage', [A.id])
    // A submodule has no row action, and Stage all leaves it out.
    expect(screen.queryByRole('button', { name: 'Stage lib' })).toBeNull()
    fireEvent.click(button('Stage all ↓'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id, NEW.id])
    fireEvent.click(button('Unstage all ↑'))
    expect(h.onWrite).toHaveBeenLastCalledWith('unstage', [A.id])
    expect(h.onFocus).not.toHaveBeenCalled()
    expect(h.onAction).not.toHaveBeenCalled()
  })

  it('a lane header counts the selected files that belong to it and stages just those', () => {
    const h = renderPane({ selected: [A.id, B.id, NEW.id, LIB.id] })
    expect(button('Stage 2 ↓').disabled).toBe(false)
    expect(button('Unstage 1 ↑').disabled).toBe(false)
    fireEvent.click(button('Stage 2 ↓'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id, NEW.id])
  })

  it('counts a file changed in both areas once in each lane, not twice in either', () => {
    const staged = c('staged', 'm.txt')
    const unstaged = c('unstaged', 'm.txt')
    const h = renderPane({ tree: { path: 'C:/repos/A', changes: [staged, unstaged] }, selected: [unstaged.id] })
    expect(button('Stage 1 ↓')).toBeTruthy()
    expect(button('Unstage all ↑')).toBeTruthy()
    fireEvent.click(button('Stage 1 ↓'))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [unstaged.id])
  })

  it('has no toolbar and no checkboxes', () => {
    renderPane({ selected: [B.id] })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(within(screen.getByLabelText('Changed files')).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('has no commit form of its own: that lives in the panel beside the diff', () => {
    renderPane()
    expect(screen.queryByLabelText('Commit summary')).toBeNull()
  })

  it('a plain click focuses a file and selects only it', () => {
    const h = renderPane({ selected: [A.id] })
    fireEvent.click(screen.getByText('b.txt'))
    expect(h.onFocus).toHaveBeenCalledWith(B.id)
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id])
  })

  it('Ctrl-click toggles a file into the selection and Shift-click selects the range from the focused one', () => {
    const h = renderPane({ selected: [B.id], focusId: B.id })
    fireEvent.click(screen.getByText('new.txt'), { ctrlKey: true })
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id, NEW.id])
    fireEvent.click(screen.getByText('a.txt'), { shiftKey: true })
    // Display order is Not staged (b, lib, new) then Staged (a).
    expect(h.onSelectionChange).toHaveBeenLastCalledWith([B.id, LIB.id, NEW.id, A.id])
  })

  it('moves focus with the arrows through both lanes, selects with Space, runs s and u, and c goes to the commit summary', () => {
    const onCompose = vi.fn()
    const h = renderPane({ selected: [B.id, A.id], focusId: NEW.id, onCompose })
    const list = screen.getByLabelText('Changed files')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(h.onFocus).toHaveBeenLastCalledWith(A.id)
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(h.onFocus).toHaveBeenLastCalledWith(LIB.id)
    cleanup()
    const h2 = renderPane({ selected: [B.id, A.id], focusId: B.id, onCompose })
    const list2 = screen.getByLabelText('Changed files')
    fireEvent.keyDown(list2, { key: ' ' })
    expect(h2.onSelectionChange).toHaveBeenLastCalledWith([A.id])
    fireEvent.keyDown(list2, { key: 's' })
    expect(h2.onAction).toHaveBeenLastCalledWith('stage')
    fireEvent.keyDown(list2, { key: 'u' })
    expect(h2.onAction).toHaveBeenLastCalledWith('unstage')
    fireEvent.keyDown(list2, { key: 'c' })
    expect(onCompose).toHaveBeenCalledTimes(1)
    expect(h2.onCommit).not.toHaveBeenCalled()
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

  it('leaves a key pressed on a row button to that button', () => {
    const h = renderPane({ focusId: B.id })
    fireEvent.keyDown(button('Stage b.txt'), { key: ' ' })
    expect(h.onSelectionChange).not.toHaveBeenCalled()
  })

  it('locks the lane actions while a write runs and shows the last result', () => {
    renderPane({ selected: [B.id], busy: true, status: { ok: false, text: 'fatal: nope' } })
    expect(button('Stage 1 ↓').disabled).toBe(true)
    expect(screen.getAllByText('Working…').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert').textContent).toBe('fatal: nope')
  })

  it('says when there are no changes', () => {
    renderPane({ tree: { path: 'C:/repos/A', changes: [] } })
    expect(screen.getByText('Working tree clean')).toBeTruthy()
    expect(screen.getByText('Edits to files on this branch appear here.')).toBeTruthy()
    expect(screen.getByText('Nothing staged.')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Not staged (0)' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Staged (0)' })).toBeTruthy()
  })
})

describe('ChangesPane row context menu', () => {
  const rightClick = (title, props = {}) => {
    const h = renderPane(props)
    fireEvent.contextMenu(screen.getByTitle(title))
    return h
  }
  const items = () => screen.getAllByRole('menuitem').map(i => i.textContent)

  it('offers Stage and Discard for an unstaged tracked file, and runs them without the review for stage', () => {
    const h = rightClick('b.txt')
    expect(items()).toEqual(['Stage', 'Discard…'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stage' }))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id])
    fireEvent.contextMenu(screen.getByTitle('b.txt'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard…' }))
    expect(h.onAction).toHaveBeenLastCalledWith('discard', [B.id])
  })

  it('offers Unstage for a staged file and Delete for an untracked one', () => {
    rightClick('a.txt')
    expect(items()).toEqual(['Unstage'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTitle('new.txt'))
    expect(items()).toEqual(['Stage', 'Delete…'])
  })

  it('acts on the whole selection when the clicked file is part of it', () => {
    const h = rightClick('b.txt', { selected: [B.id, NEW.id] })
    expect(items()).toEqual(['Stage 2 files', 'Discard…', 'Delete…'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stage 2 files' }))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id, NEW.id])
  })

  it('acts on just the clicked file when it is outside the selection', () => {
    const h = rightClick('b.txt', { selected: [NEW.id] })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stage' }))
    expect(h.onWrite).toHaveBeenLastCalledWith('stage', [B.id])
  })

  it('has no menu at all for a submodule, and the browser menu is left alone', () => {
    renderPane()
    expect(fireEvent.contextMenu(screen.getByTitle('lib'))).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ChangesPane conflicts', () => {
  const U = c('conflict', 'u.txt', { xy: 'UU' })
  const D = c('conflict', 'd.txt', { xy: 'DU' })
  const op = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 1, total: 2, replaying: null }
  const ctree = { path: 'C:/repos/A', branch: 'feat', operationInfo: op, changes: [A, B, U, D] }

  afterEach(() => vi.restoreAllMocks())

  it('notes how to finish and opens a conflict from its Resolve button', () => {
    const h = renderPane({ tree: { ...ctree, operation: 'Rebase in progress' }, onResolve: vi.fn() })
    const conflicts = within(screen.getByRole('group', { name: 'Conflicts (2)' }))
    expect(conflicts.getByText('Resolve each file, then continue the rebase.')).toBeTruthy()
    fireEvent.click(conflicts.getByRole('button', { name: 'Resolve d.txt' }))
    expect(h.onFocus).toHaveBeenCalledWith(D.id)
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
  // The flat list's cap: a big lane starts in Folders, so these ask for Flat.
  beforeEach(() => setGitConfig({ view: { ...getGitConfig().view, laneMode: 'flat' } }))
  const many = Array.from({ length: 1000 }, (_, i) => c('untracked', `out/f${i}.js`))

  it('draws only the first rows and says how many are not shown', () => {
    renderPane({ tree: { ...tree, changes: many } })
    const group = within(screen.getByRole('group', { name: 'Not staged (1000)' }))
    expect(group.getAllByTitle(/^out\//)).toHaveLength(300)
    expect(group.getByRole('button', { name: 'Show 700 more (700 not shown)' })).toBeTruthy()
  })

  it('shows more on request', () => {
    renderPane({ tree: { ...tree, changes: many } })
    fireEvent.click(screen.getByRole('button', { name: /Show 700 more/ }))
    expect(document.querySelectorAll(".nx-gw-file")).toHaveLength(1000)
  })

  it('always draws the focused file, even past the cap', () => {
    renderPane({ tree: { ...tree, changes: many }, focusId: many[900].id })
    expect(screen.getByTitle('out/f900.js')).toBeTruthy()
  })

  it('Stage all still covers the rows that are not drawn', () => {
    const { onWrite } = renderPane({ tree: { ...tree, changes: many } })
    fireEvent.click(screen.getByRole('button', { name: 'Stage all ↓' }))
    expect(onWrite.mock.calls[0][1]).toHaveLength(1000)
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
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Stage', 'Discard…', 'Edit in new window', 'Diff in new window'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diff in new window' }))
    expect(onPopout).toHaveBeenLastCalledWith('diff', B)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(screen.getByTitle('b.txt'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit in new window' }))
    expect(onPopout).toHaveBeenLastCalledWith('editor', B)
  })

  it('offers only the diff for a deleted file, and only Resolve for a conflict', async () => {
    await open('gone.txt')
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Stage', 'Discard…', 'Diff in new window'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTitle('clash.txt'))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Resolve in new window'])
  })

  it('has no menu for a submodule, and without pop-outs the menu holds only the file actions', async () => {
    await open('lib')
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    renderPane()
    fireEvent.contextMenu(screen.getByTitle('b.txt'))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Stage', 'Discard…'])
  })

  it('shows why a window could not be opened', async () => {
    const onPopout = vi.fn(async () => { throw new Error("Error invoking remote method 'popout:open': Error: Can't open that window: no file.") })
    await open('b.txt', onPopout)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diff in new window' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Can't open that window: no file.")
  })
})

describe('ChangesPane large change sets', () => {
  const many = Array.from({ length: 120 }, (_, i) => c('untracked', `apps/web/dist/f${i}.js`))
  const withOthers = [...many, c('untracked', 'docs/readme.md'), c('untracked', 'top.txt')]
  const pane = (changes = withOthers, props = {}) => renderPane({ tree: { path: 'C:/repos/A', changes }, ...props })
  const notStaged = () => within(screen.getByRole('group', { name: /^Not staged/ }))

  it('a small lane has neither the filter nor the Folders | Flat switch', () => {
    renderPane()
    expect(screen.queryByPlaceholderText('Filter files')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Folders' })).toBeNull()
  })

  it('a lane over 50 changes starts in Folders, one row per folder with its file count', () => {
    pane()
    expect(screen.getByRole('tab', { name: 'Folders' }).getAttribute('aria-selected')).toBe('true')
    const lane = notStaged()
    expect(lane.getByText('apps/web/dist/')).toBeTruthy()
    expect(lane.getByText('120')).toBeTruthy()
    expect(lane.queryByText('f0.js')).toBeNull()
  })

  it('opening a folder lists its files, and the Flat view lists every file without folder rows', () => {
    pane()
    fireEvent.click(notStaged().getByText('apps/web/dist/'))
    expect(notStaged().getByText('f0.js')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Flat' }))
    expect(screen.queryByText('120')).toBeNull()
    expect(notStaged().getByText('readme.md')).toBeTruthy()
  })

  it('selecting a folder row tells the page which folder and its files', () => {
    const onFocusFolder = vi.fn()
    pane(withOthers, { onFocusFolder })
    fireEvent.click(notStaged().getByText('apps/web/dist/'))
    expect(onFocusFolder).toHaveBeenCalledWith(expect.objectContaining({ path: 'apps/web/dist/', area: 'unstaged', ids: expect.any(Array) }))
    expect(onFocusFolder.mock.calls[0][0].ids).toHaveLength(120)
  })

  it('filters by the start of words in the path, and Esc clears the filter', () => {
    pane()
    const box = screen.getByPlaceholderText('Filter files')
    fireEvent.change(box, { target: { value: 'doc read' } })
    expect(notStaged().getByText('docs/')).toBeTruthy()
    expect(notStaged().queryByText('apps/web/dist/')).toBeNull()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
    expect(notStaged().getByText('apps/web/dist/')).toBeTruthy()
  })

  it('a folder holding the focused file is open, and the file is drawn even past the per-folder cap', () => {
    const lots = Array.from({ length: 5000 }, (_, i) => c('untracked', `out/f${i}.js`))
    renderPane({ tree: { path: 'C:/repos/A', changes: lots }, focusId: lots[3000].id })
    expect(screen.getByTitle('out/f3000.js')).toBeTruthy()
    expect(document.querySelectorAll('.nx-gw-file').length).toBeLessThan(3200)
  })

  it('draws a bounded number of rows however many files there are, and offers more in the folder', () => {
    const lots = Array.from({ length: 50000 }, (_, i) => c('untracked', `dist/f${i}.js`))
    renderPane({ tree: { path: 'C:/repos/A', changes: lots } })
    fireEvent.click(screen.getByText('dist/'))
    expect(document.querySelectorAll('.nx-gw-file').length).toBe(300)
    expect(screen.getByText('Show 1200 more in this folder')).toBeTruthy()
  })
})
