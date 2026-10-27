import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { CommitComposer } from './commit-composer.jsx'

afterEach(cleanup)

const tree = (over = {}) => ({ path: '/r/feat', branch: 'feat', upstream: 'origin/feat', operation: '', operationInfo: null, changes: [{ area: 'staged' }, { area: 'staged' }, { area: 'unstaged' }], ...over })

describe('CommitComposer', () => {
  it('explains why it is disabled', () => {
    const { rerender } = render(<CommitComposer tree={tree({ changes: [{ area: 'unstaged' }] })} onCommit={() => {}} />)
    expect(screen.getByText('Stage files first — use Stage or Stage all above')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit' }).disabled).toBe(true)
    rerender(<CommitComposer tree={tree()} onCommit={() => {}} />)
    expect(screen.getByText('Write a summary to commit')).toBeTruthy()
  })

  it('shows the description only once the summary is focused', () => {
    render(<CommitComposer tree={tree()} onCommit={() => {}} />)
    expect(screen.queryByLabelText('Commit description')).toBeNull()
    fireEvent.focus(screen.getByLabelText('Commit summary'))
    expect(screen.getByLabelText('Commit description')).toBeTruthy()
  })

  it('commits, commits & pushes, and clears', async () => {
    const onCommit = vi.fn(() => Promise.resolve(true))
    render(<CommitComposer tree={tree()} onCommit={onCommit} />)
    fireEvent.change(screen.getByLabelText('Commit summary'), { target: { value: 'Fix QR' } })
    expect(screen.getByText('2 staged files → feat · Ctrl+Enter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }))
    expect(onCommit).toHaveBeenCalledWith({ message: 'Fix QR', amend: false, push: true })
    await waitFor(() => expect(screen.getByLabelText('Commit summary').value).toBe(''))
    fireEvent.change(screen.getByLabelText('Commit summary'), { target: { value: 'Two' } })
    fireEvent.keyDown(screen.getByLabelText('Commit summary'), { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenLastCalledWith({ message: 'Two', amend: false, push: false })
  })

  it('allows amend with nothing staged and says publish when unpublished', () => {
    render(<CommitComposer tree={tree({ upstream: null, changes: [] })} onCommit={() => {}} />)
    fireEvent.click(screen.getByLabelText('Amend last commit'))
    fireEvent.change(screen.getByLabelText('Commit summary'), { target: { value: 'Reword' } })
    expect(screen.getByRole('button', { name: 'Amend commit' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Amend & push' })).toBeTruthy()
  })

  it('is replaced by a note during an operation', () => {
    render(<CommitComposer tree={tree({ operation: 'Rebase in progress', operationInfo: { kind: 'rebase' } })} onCommit={() => {}} />)
    expect(screen.getByRole('note').textContent).toContain('Committing is paused during the rebase')
    expect(screen.queryByLabelText('Commit summary')).toBeNull()
  })
})
