import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RebaseRail, rebaseLabel } from './rebase-rail.jsx'

afterEach(cleanup)

const conflict = path => ({ id: `c\0${path}`, path, area: 'conflict' })
const rebase = (over = {}) => ({
  path: '/r/feat', branch: 'feat', operation: 'Rebase in progress',
  operationInfo: { kind: 'rebase', onto: { name: 'refs/remotes/origin/master', oid: 'a'.repeat(40) }, step: 3, total: 7, replaying: { oid: 'abcdef0123', subject: 'Fix the thing' } },
  changes: [conflict('a.txt'), conflict('b.txt')], ...over,
})
const names = () => ['Continue', 'Skip', 'Abort'].map(n => screen.queryByRole('button', { name: n }))

describe('RebaseRail', () => {
  it('says what is being rebased onto, which commit of how many, and how many conflicts are resolved', () => {
    render(<RebaseRail tree={rebase()} onAction={() => {}} />)
    expect(screen.getByText('Rebase in progress')).toBeTruthy()
    expect(screen.getByText('Rebasing onto origin/master')).toBeTruthy()
    expect(screen.getByText('Commit 3 of 7')).toBeTruthy()
    expect(screen.getByText('abcdef0')).toBeTruthy()
    expect(screen.getByText('0 of 2 conflicts resolved')).toBeTruthy()
  })

  it('draws one step segment per commit: done, the one now, then the rest', () => {
    render(<RebaseRail tree={rebase()} onAction={() => {}} />)
    const steps = [...screen.getByLabelText('Step 3 of 7').children].map(s => s.getAttribute('data-s'))
    expect(steps).toEqual(['done', 'done', 'now', 'todo', 'todo', 'todo', 'todo'])
  })

  it('disables Continue with the number left as its title, and enables it at zero', () => {
    const { rerender } = render(<RebaseRail tree={rebase()} onAction={() => {}} />)
    const cont = screen.getByRole('button', { name: 'Continue' })
    expect(cont.disabled).toBe(true)
    expect(cont.title).toBe('Resolve 2 remaining conflicts first')
    expect(cont.textContent).toBe('Continue rebase')
    rerender(<RebaseRail tree={rebase({ changes: [] })} onAction={() => {}} />)
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(false)
    expect(screen.getByText('All conflicts resolved')).toBeTruthy()
  })

  it('hands Continue, Skip and Abort to the page, Abort with what its confirmation needs', () => {
    const onAction = vi.fn()
    render(<RebaseRail tree={rebase({ changes: [] })} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    expect(onAction.mock.calls).toEqual([['continue', {}], ['skip', {}], ['abort', { branchLabel: 'feat', operationName: 'rebase' }]])
  })

  it('has no Skip for a merge', () => {
    render(<RebaseRail tree={rebase({ operation: 'Merge in progress', operationInfo: { kind: 'merge', merging: { name: 'refs/heads/topic' } } })} onAction={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByText('Merging topic')).toBeTruthy()
  })

  it('still offers Continue, Skip and Abort when the operation has no info at all', () => {
    render(<RebaseRail tree={rebase({ operationInfo: null, changes: [] })} onAction={() => {}} />)
    expect(names().every(Boolean)).toBe(true)
    expect(screen.queryByText(/Commit \d+ of/)).toBeNull()
    expect(screen.queryByLabelText(/^Step /)).toBeNull()
  })

  it('shows no commit position when a rebase has no step or total', () => {
    render(<RebaseRail tree={rebase({ operationInfo: { kind: 'rebase' }, changes: [] })} onAction={() => {}} />)
    expect(names().every(Boolean)).toBe(true)
    expect(screen.queryByText(/Commit \d+ of/)).toBeNull()
  })
})

describe('rebaseLabel', () => {
  it('is "Rebase i of n" for the collapsed strip, "Rebase" without a position, and names other operations', () => {
    expect(rebaseLabel(rebase())).toBe('Rebase 3 of 7')
    expect(rebaseLabel(rebase({ operationInfo: { kind: 'rebase' } }))).toBe('Rebase')
    expect(rebaseLabel(rebase({ operationInfo: null }))).toBe('Rebase in progress')
    expect(rebaseLabel(rebase({ operationInfo: { kind: 'merge' } }))).toBe('Merge')
  })
})
