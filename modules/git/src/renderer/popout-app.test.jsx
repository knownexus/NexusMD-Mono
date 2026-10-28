import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

// The screens have their own tests; here only what the pop-out hands them, and what it tells the other windows.
vi.mock('./file-editor.jsx', () => ({
  FileEditor: p => <button onClick={p.onSaved}>{`editor ${p.path} in ${p.worktreePath}`}</button>,
}))
vi.mock('./resolve-pane.jsx', () => ({
  ResolvePane: p => <button onClick={p.onResolved}>{`resolve ${p.change.path} ${p.change.area ?? 'gone'}`}</button>,
}))
vi.mock('./diff-pane.jsx', () => ({
  DiffPane: p => <div>{`diff ${p.change.id} readOnly=${p.readOnly}`}</div>,
}))
vi.mock('./use-diff.js', () => ({ useDiff: vi.fn(() => ({ loading: false })) }))
// What the worktree's status read has given so far.
const status = { current: { tree: null, takenAt: null, reads: 0 } }
const reload = vi.fn()
vi.mock('./use-worktree-status.js', () => ({ useWorktreeStatus: vi.fn(() => ({ error: null, ...status.current, reload })) }))

import { PopoutApp } from './popout-app.jsx'
import { useWorktreeStatus } from './use-worktree-status.js'
import { useDiff } from './use-diff.js'

afterEach(cleanup)
beforeEach(() => {
  status.current = { tree: null, takenAt: null, reads: 0 }
  reload.mockClear()
  useWorktreeStatus.mockClear()
  useDiff.mockClear()
})

const repo = { name: 'A', path: 'C:/repos/A' }
const spec = (kind, extra = {}) => ({ kind, repo, worktree: 'C:/repos/A', registered: ['C:/repos/A'], path: 'src/app.jsx', ...extra })
const tree = changes => ({ path: 'C:/repos/A', repo: 'A', changes })
const read = (t, reads = 1, takenAt = 't') => { status.current = { tree: t, takenAt, reads } }
const adapter = () => {
  const a = { notifyChanged: vi.fn(), onChanged: vi.fn(() => vi.fn()) }
  return a
}
const unstaged = { id: 'u1', area: 'unstaged', path: 'src/app.jsx' }

describe('PopoutApp', () => {
  it('shows the editor for the file, tells the other windows after a save, and reads no status', () => {
    const a = adapter()
    render(<PopoutApp spec={spec('editor')} adapter={a} />)
    expect(screen.getByText('editor src/app.jsx in C:/repos/A')).toBeTruthy()
    expect(screen.getByText('A · C:/repos/A')).toBeTruthy()
    expect(useWorktreeStatus.mock.calls[0][0]).toMatchObject({ enabled: false })
    act(() => screen.getByRole('button').click())
    expect(a.notifyChanged).toHaveBeenCalledWith('C:/repos/A')
    expect(a.onChanged).not.toHaveBeenCalled()
  })

  it('names the window for what it shows', () => {
    render(<PopoutApp spec={spec('editor')} adapter={adapter()} />)
    expect(document.title).toBe('Edit app.jsx · A')
  })

  it('reads the status of its own worktree only', () => {
    render(<PopoutApp spec={spec('conflict', { worktree: 'C:/repos/A-wt' })} adapter={adapter()} />)
    expect(useWorktreeStatus.mock.calls[0][0]).toMatchObject({ enabled: true, repo, worktree: 'C:/repos/A-wt', registered: ['C:/repos/A'] })
  })

  it('waits for the worktree before showing the conflict', () => {
    render(<PopoutApp spec={spec('conflict')} adapter={adapter()} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('resolves the conflicted file from the worktree’s own entry and reports the resolve', () => {
    read(tree([{ id: 'c1', area: 'conflict', path: 'src/app.jsx' }]))
    const a = adapter()
    render(<PopoutApp spec={spec('conflict')} adapter={a} />)
    act(() => screen.getByText('resolve src/app.jsx conflict').click())
    expect(a.notifyChanged).toHaveBeenCalledWith('C:/repos/A')
    expect(reload).toHaveBeenCalled()
  })

  it('keeps the resolve screen once the file is no longer conflicted', () => {
    read(tree([]))
    render(<PopoutApp spec={spec('conflict')} adapter={adapter()} />)
    expect(screen.getByText('resolve src/app.jsx gone')).toBeTruthy()
  })

  it('reads again when another window writes to the repository', () => {
    read(tree([]))
    const a = adapter()
    render(<PopoutApp spec={spec('conflict')} adapter={a} />)
    a.onChanged.mock.calls[0][0]('C:/repos/A')
    expect(reload).toHaveBeenCalled()
  })

  it('shows the change as a read-only diff', () => {
    read(tree([unstaged]))
    render(<PopoutApp spec={spec('diff', { changeId: 'u1' })} adapter={adapter()} />)
    expect(screen.getByText('diff u1 readOnly=true')).toBeTruthy()
    expect(useDiff.mock.calls[0][0]).toMatchObject({ worktreePath: 'C:/repos/A', version: 't', change: { id: 'u1' } })
  })

  it('shows the diff of the change it came with before the status is read', () => {
    render(<PopoutApp spec={spec('diff', { changeId: 'u1', change: unstaged })} adapter={adapter()} />)
    expect(screen.getByText('diff u1 readOnly=true')).toBeTruthy()
    expect(useDiff.mock.calls[0][0]).toMatchObject({ worktreePath: 'C:/repos/A', version: null, change: unstaged })
  })

  it('asks for that diff again only from the second status read on', () => {
    const s = spec('diff', { changeId: 'u1', change: unstaged })
    const { rerender } = render(<PopoutApp spec={s} adapter={adapter()} />)
    read(tree([unstaged]), 1, 't1')
    rerender(<PopoutApp spec={s} adapter={adapter()} />)
    expect(useDiff.mock.lastCall[0].version).toBeNull()
    read(tree([unstaged]), 2, 't2')
    rerender(<PopoutApp spec={s} adapter={adapter()} />)
    expect(useDiff.mock.lastCall[0].version).toBe('t2')
  })

  it('says so when the change has gone', () => {
    read(tree([]))
    render(<PopoutApp spec={spec('diff', { changeId: 'u1' })} adapter={adapter()} />)
    expect(screen.getByRole('note').textContent).toBe('src/app.jsx has no changes any more.')
  })

  it('says so when the change it came with has gone by the time the status is read', () => {
    read(tree([]))
    render(<PopoutApp spec={spec('diff', { changeId: 'u1', change: unstaged })} adapter={adapter()} />)
    expect(screen.getByRole('note').textContent).toBe('src/app.jsx has no changes any more.')
  })

  it('shows a worktree that could not be read', () => {
    read({ ...tree([]), error: 'Not a git repository' })
    render(<PopoutApp spec={spec('diff', { changeId: 'u1', change: unstaged })} adapter={adapter()} />)
    expect(screen.getByRole('alert').textContent).toBe('Not a git repository')
  })
})
