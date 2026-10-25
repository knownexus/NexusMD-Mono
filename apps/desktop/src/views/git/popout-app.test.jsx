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
const snapshot = { current: null }
const reload = vi.fn()
vi.mock('./use-git-snapshot.js', () => ({ useGitSnapshot: vi.fn(() => ({ snapshot: snapshot.current, error: null, reload })) }))

import { PopoutApp } from './popout-app.jsx'
import { useGitSnapshot } from './use-git-snapshot.js'
import { useDiff } from './use-diff.js'

afterEach(cleanup)
beforeEach(() => {
  snapshot.current = null
  reload.mockClear()
  useGitSnapshot.mockClear()
  useDiff.mockClear()
})

const repo = { name: 'A', path: 'C:/repos/A' }
const spec = (kind, extra = {}) => ({ kind, repo, worktree: 'C:/repos/A', registered: ['C:/repos/A'], path: 'src/app.jsx', ...extra })
const tree = changes => ({ path: 'C:/repos/A', repo: 'A', changes })
const adapter = () => {
  const a = { notifyChanged: vi.fn(), onChanged: vi.fn(() => vi.fn()) }
  return a
}

describe('PopoutApp', () => {
  it('shows the editor for the file, tells the other windows after a save, and reads no snapshot', () => {
    const a = adapter()
    render(<PopoutApp spec={spec('editor')} adapter={a} />)
    expect(screen.getByText('editor src/app.jsx in C:/repos/A')).toBeTruthy()
    expect(screen.getByText('A · C:/repos/A')).toBeTruthy()
    expect(useGitSnapshot.mock.calls[0][0]).toMatchObject({ enabled: false, persist: false })
    act(() => screen.getByRole('button').click())
    expect(a.notifyChanged).toHaveBeenCalledWith('C:/repos/A')
    expect(a.onChanged).not.toHaveBeenCalled()
  })

  it('names the window for what it shows', () => {
    render(<PopoutApp spec={spec('editor')} adapter={adapter()} />)
    expect(document.title).toBe('Edit app.jsx · A')
  })

  it('waits for the worktree before showing the conflict', () => {
    render(<PopoutApp spec={spec('conflict')} adapter={adapter()} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('resolves the conflicted file from the worktree’s own entry and reports the resolve', () => {
    snapshot.current = { takenAt: 't', worktrees: [tree([{ id: 'c1', area: 'conflict', path: 'src/app.jsx' }])] }
    const a = adapter()
    render(<PopoutApp spec={spec('conflict')} adapter={a} />)
    act(() => screen.getByText('resolve src/app.jsx conflict').click())
    expect(a.notifyChanged).toHaveBeenCalledWith('C:/repos/A')
    expect(reload).toHaveBeenCalledWith(['A'])
  })

  it('keeps the resolve screen once the file is no longer conflicted', () => {
    snapshot.current = { takenAt: 't', worktrees: [tree([])] }
    render(<PopoutApp spec={spec('conflict')} adapter={adapter()} />)
    expect(screen.getByText('resolve src/app.jsx gone')).toBeTruthy()
  })

  it('reads again when another window writes to the repository', () => {
    snapshot.current = { takenAt: 't', worktrees: [tree([])] }
    const a = adapter()
    render(<PopoutApp spec={spec('conflict')} adapter={a} />)
    a.onChanged.mock.calls[0][0]('C:/repos/A')
    expect(reload).toHaveBeenCalledWith(['A'])
  })

  it('shows the change as a read-only diff', () => {
    snapshot.current = { takenAt: 't', worktrees: [tree([{ id: 'u1', area: 'unstaged', path: 'src/app.jsx' }])] }
    render(<PopoutApp spec={spec('diff', { changeId: 'u1' })} adapter={adapter()} />)
    expect(screen.getByText('diff u1 readOnly=true')).toBeTruthy()
    expect(useDiff.mock.calls[0][0]).toMatchObject({ worktreePath: 'C:/repos/A', version: 't', change: { id: 'u1' } })
  })

  it('says so when the change has gone', () => {
    snapshot.current = { takenAt: 't', worktrees: [tree([])] }
    render(<PopoutApp spec={spec('diff', { changeId: 'u1' })} adapter={adapter()} />)
    expect(screen.getByRole('note').textContent).toBe('src/app.jsx has no changes any more.')
  })

  it('shows a worktree that could not be read', () => {
    snapshot.current = { takenAt: 't', worktrees: [{ ...tree([]), error: 'Not a git repository' }] }
    render(<PopoutApp spec={spec('diff', { changeId: 'u1' })} adapter={adapter()} />)
    expect(screen.getByRole('alert').textContent).toBe('Not a git repository')
  })
})
