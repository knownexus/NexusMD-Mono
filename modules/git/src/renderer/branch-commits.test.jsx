import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { BranchCommits, useBranchCommits } from './branch-commits.jsx'
import { relativeTime } from './history-pane.jsx'
import { editPlan, parseLog } from '@nexusmd/core'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => localStorage.clear())

const oid = n => String(n).padStart(40, '0')
const rec = n => `* \x1e${oid(n)}\x1f${oid(n + 100)}\x1fAna\x1fa@b\x1f1\x1f\x1fSubject ${n}`
const tree = (count = 3) => ({ path: 'C:/r', branch: 'feat/x', source: { ref: 'refs/heads/master', count } })

function adapterFor(n, extra = {}) {
  return {
    log: vi.fn(async (_r, _c, _g, q) => ({
      text: Array.from({ length: n }, (_, i) => rec(i + 1)).join('\n') + '\n', tip: oid(1), unpushed: Array.from({ length: n }, (_, i) => oid(i + 1)), truncated: false, limit: q.limit,
    })),
    commitDetails: vi.fn(async () => ({ details: ['x', '', 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', 'Subject 1'].join('\0') })),
    ...extra,
  }
}

function Harness({ adapter, t = tree(), handlers = {}, head = 'H1' }) {
  const data = useBranchCommits({ adapter, repo: { name: 'r', path: 'C:/r' }, cwd: t.path, registered: ['C:/r'], sourceRef: t.source?.count ? t.source.ref : null, head })
  return <BranchCommits tree={t} adapter={adapter} repo={{ name: 'r', path: 'C:/r' }} registered={['C:/r']} data={data}
    onOpenCommit={vi.fn()} onShowAll={vi.fn()} onAction={vi.fn()} {...handlers} />
}

describe('BranchCommits', () => {
  it('shows the title and a row per commit', async () => {
    const adapter = adapterFor(3)
    render(<Harness adapter={adapter} />)
    expect(await screen.findByText('3 commits off master')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(adapter.log.mock.calls[0][3]).toMatchObject({ ref: 'HEAD', filter: 'sinceBase', base: 'refs/heads/master' })
  })

  it('says "1 commit" for one', async () => {
    render(<Harness adapter={adapterFor(1)} t={tree(1)} />)
    expect(await screen.findByText('1 commit off master')).toBeTruthy()
  })

  it('renders nothing with no commits off the source', () => {
    const adapter = adapterFor(0)
    const { container } = render(<Harness adapter={adapter} t={tree(0)} />)
    expect(container.textContent).toBe('')
    expect(adapter.log).not.toHaveBeenCalled()
  })

  it('renders nothing for a branch without a source', () => {
    const { container } = render(<Harness adapter={adapterFor(0)} t={{ path: 'C:/r', branch: 'master', source: null }} />)
    expect(container.textContent).toBe('')
  })

  it('caps the rows at 10 and offers Show all in History', async () => {
    const onShowAll = vi.fn()
    render(<Harness adapter={adapterFor(12)} t={tree(12)} handlers={{ onShowAll }} />)
    await screen.findByText('12 commits off master')
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Show all in History' }))
    expect(onShowAll).toHaveBeenCalled()
  })

  it('opens a commit when its row is clicked', async () => {
    const onOpenCommit = vi.fn()
    render(<Harness adapter={adapterFor(3)} handlers={{ onOpenCommit }} />)
    fireEvent.click(await screen.findByText('Subject 2'))
    expect(onOpenCommit).toHaveBeenCalledWith(oid(2))
  })

  it('right-click offers Reword and runs the reword flow', async () => {
    const onAction = vi.fn()
    render(<Harness adapter={adapterFor(3)} handlers={{ onAction }} />)
    fireEvent.contextMenu(await screen.findByText('Subject 1'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Reword…' }))
    const box = await screen.findByRole('textbox', { name: 'Commit message' })
    fireEvent.change(box, { target: { value: 'Better subject' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onAction).toHaveBeenCalledWith('rebaseInteractive', expect.anything())
  })

  it('opens a commit from the keyboard-focusable row button', async () => {
    const onOpenCommit = vi.fn()
    render(<Harness adapter={adapterFor(3)} handlers={{ onOpenCommit }} />)
    const open = (await screen.findByText('Subject 3')).closest('button')
    expect(open.tagName).toBe('BUTTON')
    fireEvent.click(open)
    expect(onOpenCommit).toHaveBeenCalledWith(oid(3))
  })

  it('the actions button opens the same items, focuses the first and Escape returns focus', async () => {
    render(<Harness adapter={adapterFor(3)} />)
    await screen.findByText('Subject 2')
    const more = screen.getAllByRole('button', { name: /^Actions for/ })[1]
    fireEvent.click(more)
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Reword…', 'Squash into previous…', 'Squash selected…'])
    await waitFor(() => expect(document.activeElement.textContent).toBe('Reword…'))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement.textContent).toBe('Squash into previous…') // Squash selected is disabled for one commit
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('an outside click closes the menu', async () => {
    render(<Harness adapter={adapterFor(3)} />)
    fireEvent.contextMenu(await screen.findByText('Subject 1'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('remembers collapsing across a remount', async () => {
    const adapter = adapterFor(3)
    const { unmount } = render(<Harness adapter={adapter} />)
    await screen.findByText('3 commits off master')
    fireEvent.click(screen.getByRole('button', { name: /3 commits off master/ }))
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    unmount()
    render(<Harness adapter={adapter} />)
    await screen.findByText('3 commits off master')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('still renders, open, when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    render(<Harness adapter={adapterFor(3)} />)
    await screen.findByText('3 commits off master')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /3 commits off master/ }))
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('reads again when the head moves', async () => {
    const adapter = adapterFor(3)
    const { rerender } = render(<Harness adapter={adapter} />)
    await screen.findByText('3 commits off master')
    expect(adapter.log).toHaveBeenCalledTimes(1)
    rerender(<Harness adapter={adapter} head="H2" />)
    await waitFor(() => expect(adapter.log).toHaveBeenCalledTimes(2))
  })

  it('starts empty in another worktree instead of showing the last one\'s commits', async () => {
    const loaded = adapterFor(3)
    const adapter = { ...loaded, log: vi.fn((r, c, g, q) => (c === 'C:/r' ? loaded.log(r, c, g, q) : new Promise(() => {}))) }
    const { rerender } = render(<Harness adapter={adapter} />)
    await screen.findByText('Subject 1')
    rerender(<Harness adapter={adapter} t={{ ...tree(), path: 'C:/s' }} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  describe('selecting several', () => {
    // A chain: each commit's parent is the next one down, so neighbours can be squashed.
    const chain = n => Array.from({ length: n }, (_, i) => `* \x1e${oid(i + 1)}\x1f${oid(i + 2)}\x1fAna\x1fa@b\x1f1\x1f\x1fSubject ${i + 1}`).join('\n') + '\n'
    const chained = n => adapterFor(n, {
      log: vi.fn(async (_r, _c, _g, q) => ({ text: chain(n), tip: oid(1), unpushed: Array.from({ length: n }, (_, i) => oid(i + 1)), truncated: false, limit: q.limit })),
      commitDetails: vi.fn(async (_r, _c, _g, o) => ({ details: [o, '', 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', `message of ${o[0]}`].join('\0') })),
    })
    const row = name => screen.getByText(name).closest('li')
    const picked = () => ['Subject 1', 'Subject 2', 'Subject 3'].map(name => row(name).getAttribute('data-selected') === 'true')

    it('Ctrl-click adds rows without opening them, and Squash selected… squashes them', async () => {
      const onOpenCommit = vi.fn()
      const onAction = vi.fn()
      render(<Harness adapter={chained(3)} handlers={{ onOpenCommit, onAction }} />)
      fireEvent.click(await screen.findByText('Subject 1'))
      expect(onOpenCommit).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByText('Subject 2'), { ctrlKey: true })
      expect(onOpenCommit).toHaveBeenCalledTimes(1)
      expect(picked()).toEqual([true, true, false])
      fireEvent.contextMenu(screen.getByText('Subject 2'))
      expect(picked()).toEqual([true, true, false]) // right-click inside keeps the selection
      const squash = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Squash selected…' })
      expect(squash.disabled).toBe(false)
      fireEvent.click(squash)
      const box = await screen.findByRole('textbox', { name: 'Commit message' })
      fireEvent.change(box, { target: { value: 'one and two' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      const commits = parseLog(chain(3)).filter(r => r.commit).map(r => r.commit)
      await waitFor(() => expect(onAction).toHaveBeenCalledWith('rebaseInteractive', editPlan(commits, { kind: 'squash', oids: [oid(1), oid(2)], message: 'one and two' })))
    })

    it('Ctrl-click again removes a row; Shift-click selects a range; a plain click or a right-click outside resets', async () => {
      render(<Harness adapter={chained(3)} />)
      fireEvent.click(await screen.findByText('Subject 1'))
      fireEvent.click(screen.getByText('Subject 2'), { ctrlKey: true })
      fireEvent.click(screen.getByText('Subject 2'), { ctrlKey: true })
      expect(picked()).toEqual([true, false, false])
      fireEvent.click(screen.getByText('Subject 3'), { shiftKey: true })
      expect(picked()).toEqual([false, true, true]) // from the last row Ctrl-clicked, as in History
      fireEvent.click(screen.getByText('Subject 2'))
      expect(picked()).toEqual([false, true, false])
      fireEvent.click(screen.getByText('Subject 3'), { ctrlKey: true })
      fireEvent.contextMenu(screen.getByText('Subject 1'))
      expect(picked()).toEqual([true, false, false])
    })
  })

  it('shows each commit\'s age', async () => {
    render(<Harness adapter={adapterFor(1)} t={tree(1)} />)
    await screen.findByText('Subject 1')
    const time = parseLog(rec(1) + '\n').find(r => r.commit).commit.time
    expect(within(screen.getByRole('listitem')).getByText(relativeTime(time))).toBeTruthy()
  })

  it('shows a read error', async () => {
    const adapter = adapterFor(3, { log: vi.fn(async () => { throw new Error('boom') }) })
    render(<Harness adapter={adapter} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })
})
