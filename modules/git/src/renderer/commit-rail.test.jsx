import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { CommitRail } from './commit-rail.jsx'

afterEach(cleanup)

const tree = (over = {}) => ({ path: '/r/feat', branch: 'feat', upstream: 'origin/feat', operation: '', operationInfo: null, changes: [{ area: 'staged' }, { area: 'staged' }, { area: 'unstaged' }], ...over })
const summary = () => screen.getByLabelText('Commit summary')

describe('CommitRail', () => {
  it('starts with the branch it commits to, the summary, a description that is always there and the amend option', () => {
    render(<CommitRail tree={tree()} onCommit={() => {}} />)
    expect(screen.getByText('Commit to feat')).toBeTruthy()
    expect(screen.getByLabelText('Commit description')).toBeTruthy()
    expect(screen.getByLabelText('Amend last commit')).toBeTruthy()
    expect(screen.getByText('0/72')).toBeTruthy()
  })

  it('says why Commit is disabled: no summary, or nothing staged', () => {
    render(<CommitRail tree={tree()} onCommit={() => {}} />)
    expect(screen.getByText('Write a summary to commit')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit 2 files' }).disabled).toBe(true)
    cleanup()
    render(<CommitRail tree={tree({ changes: [{ area: 'unstaged' }] })} onCommit={() => {}} />)
    expect(screen.getByText('Stage files first')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit' }).disabled).toBe(true)
    cleanup()
    render(<CommitRail tree={tree({ changes: [] })} onCommit={() => {}} />)
    expect(screen.getByText('Nothing to commit')).toBeTruthy()
  })

  it('summarises the staged files and where Commit & push goes', () => {
    const { rerender } = render(<CommitRail tree={tree()} onCommit={() => {}} />)
    expect(screen.getByText('2 files')).toBeTruthy()
    expect(screen.getByText('Pushes to origin/feat')).toBeTruthy()
    rerender(<CommitRail tree={tree({ upstream: null })} onCommit={() => {}} />)
    expect(screen.getByText('Not published yet')).toBeTruthy()
  })

  it('commits with the summary and description as one message, and clears', async () => {
    const onCommit = vi.fn(() => Promise.resolve(true))
    render(<CommitRail tree={tree()} onCommit={onCommit} />)
    fireEvent.change(summary(), { target: { value: 'Fix QR' } })
    fireEvent.change(screen.getByLabelText('Commit description'), { target: { value: 'Because it broke.' } })
    expect(screen.queryByText('Write a summary to commit')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit 2 files' }))
    expect(onCommit).toHaveBeenCalledWith({ message: 'Fix QR\n\nBecause it broke.', amend: false, push: false })
    await waitFor(() => expect(summary().value).toBe(''))
  })

  it('Commit & push pushes, Commit & publish when there is no upstream, Amend & push when amending', () => {
    const onCommit = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(<CommitRail tree={tree()} onCommit={onCommit} />)
    fireEvent.change(summary(), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }))
    expect(onCommit).toHaveBeenLastCalledWith({ message: 'x', amend: false, push: true })
    rerender(<CommitRail tree={tree({ upstream: null })} onCommit={onCommit} />)
    expect(screen.getByRole('button', { name: 'Commit & publish' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Amend last commit'))
    expect(screen.getByRole('button', { name: 'Amend & push' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Amend commit' })).toBeTruthy()
  })

  it('allows an amend with nothing staged', () => {
    render(<CommitRail tree={tree({ changes: [] })} onCommit={() => {}} />)
    fireEvent.click(screen.getByLabelText('Amend last commit'))
    fireEvent.change(summary(), { target: { value: 'Reword' } })
    expect(screen.getByRole('button', { name: 'Amend commit' }).disabled).toBe(false)
  })

  it('Ctrl+Enter commits from anywhere in the Changes tab while the summary is valid', () => {
    const onCommit = vi.fn(() => Promise.resolve(true))
    render(
      <div className="nx-gw-changes">
        <input aria-label="elsewhere" />
        <CommitRail tree={tree()} onCommit={onCommit} />
      </div>,
    )
    fireEvent.keyDown(screen.getByLabelText('elsewhere'), { key: 'Enter', ctrlKey: true })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(summary(), { target: { value: 'Two' } })
    fireEvent.keyDown(screen.getByLabelText('elsewhere'), { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledWith({ message: 'Two', amend: false, push: false })
  })

  it('does not commit twice for one Ctrl+Enter pressed in the summary', () => {
    const onCommit = vi.fn(() => Promise.resolve(true))
    render(<div className="nx-gw-changes"><CommitRail tree={tree()} onCommit={onCommit} /></div>)
    fireEvent.change(summary(), { target: { value: 'Once' } })
    fireEvent.keyDown(summary(), { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('starts empty for another worktree', () => {
    const { rerender } = render(<CommitRail tree={tree()} onCommit={() => {}} />)
    fireEvent.change(summary(), { target: { value: 'draft' } })
    rerender(<CommitRail tree={tree({ path: '/r/other' })} onCommit={() => {}} />)
    expect(summary().value).toBe('')
  })

  it('shows the character count in the warning tones', () => {
    render(<CommitRail tree={tree()} onCommit={() => {}} />)
    fireEvent.change(summary(), { target: { value: 'x'.repeat(60) } })
    expect(screen.getByText('60/72').getAttribute('data-tone')).toBe('warn')
    fireEvent.change(summary(), { target: { value: 'x'.repeat(80) } })
    expect(screen.getByText('80/72').getAttribute('data-tone')).toBe('bad')
  })

  it('locks the buttons while a write runs', () => {
    render(<CommitRail tree={tree()} busy onCommit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Commit 2 files' }).disabled).toBe(true)
    expect(screen.getByText('Working…')).toBeTruthy()
  })
})
