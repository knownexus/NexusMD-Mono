import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OperationBar } from './operation-bar.jsx'

afterEach(cleanup)

const oid = '1234567890abcdef1234567890abcdef12345678'
const rebase = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 2, total: 5, replaying: { oid, subject: 'add thing' } }
const tree = (over = {}) => ({ branch: 'feat', operation: 'Rebase in progress', operationInfo: rebase, changes: [], ...over })

describe('OperationBar', () => {
  it('shows rebase progress and the replayed commit', () => {
    render(<OperationBar tree={tree()} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain(`Rebasing feat onto main · commit 2 of 5 · ${oid.slice(0, 7)} "add thing"`)
  })

  it('falls back to the plain operation text without details', () => {
    render(<OperationBar tree={tree({ operationInfo: null })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('Rebase in progress')
  })

  it('renders nothing when no operation is in progress', () => {
    render(<OperationBar tree={tree({ operation: '', operationInfo: null })} onAction={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Continue waits for the last conflict', () => {
    const onAction = vi.fn()
    const { rerender } = render(<OperationBar tree={tree({ changes: [{ area: 'conflict' }] })} onAction={onAction} />)
    const cont = screen.getByRole('button', { name: 'Continue' })
    expect(cont.disabled).toBe(true)
    expect(cont.title).toBe('Resolve every conflicted file first')
    rerender(<OperationBar tree={tree()} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    expect(onAction.mock.calls).toEqual([['continue', {}], ['skip', {}], ['abort', {}]])
  })

  it('Skip is offered for a rebase, not a merge', () => {
    const merge = { kind: 'merge', merging: { name: 'refs/heads/topic', oid } }
    const { rerender } = render(<OperationBar tree={tree()} onAction={() => {}} />)
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    rerender(<OperationBar tree={tree({ operation: 'Merge in progress', operationInfo: merge })} onAction={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByText(/Merging topic into feat/)).toBeTruthy()
  })
})
