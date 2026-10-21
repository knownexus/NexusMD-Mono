import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OperationBanner } from './operation-banner.jsx'

afterEach(cleanup)

const oid = '1234567890abcdef1234567890abcdef12345678'
const rebase = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 2, total: 5, replaying: { oid, subject: 'add thing' } }
const tree = (over = {}) => ({ branch: 'feat', operation: 'Rebase in progress', operationInfo: rebase, changes: [], ...over })

describe('OperationBanner', () => {
  it('keeps the existing progress wording and adds a title', () => {
    render(<OperationBanner tree={tree()} onAction={() => {}} />)
    const status = screen.getByRole('status').textContent
    expect(status).toContain('Rebasing onto main — ready to continue')
    expect(status).toContain(`Rebasing feat onto main · commit 2 of 5 · ${oid.slice(0, 7)} "add thing"`)
    expect(screen.getByLabelText('Step 2 of 5')).toBeTruthy()
  })

  it('counts conflicts left and explains a disabled Continue', () => {
    render(<OperationBanner tree={tree({ changes: [{ area: 'conflict' }, { area: 'conflict' }] })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('2 conflicts left')
    const cont = screen.getByRole('button', { name: 'Continue' })
    expect(cont.disabled).toBe(true)
    expect(cont.title).toBe('Resolve every conflicted file first')
  })

  it('sends continue, skip and abort', () => {
    const onAction = vi.fn()
    render(<OperationBanner tree={tree()} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    expect(onAction.mock.calls).toEqual([['continue', {}], ['skip', {}], ['abort', {}]])
  })

  it('has no Skip for a merge and nothing without an operation', () => {
    const merge = { kind: 'merge', merging: { name: 'refs/heads/topic', oid } }
    const { rerender } = render(<OperationBanner tree={tree({ operation: 'Merge in progress', operationInfo: merge })} onAction={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    rerender(<OperationBanner tree={tree({ operation: '', operationInfo: null })} onAction={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
