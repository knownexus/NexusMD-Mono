import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OperationBanner } from './operation-banner.jsx'

afterEach(cleanup)

const oid = '1234567890abcdef1234567890abcdef12345678'
const rebase = { kind: 'rebase', onto: { name: 'refs/heads/main', oid: 'a'.repeat(40) }, step: 2, total: 5, replaying: { oid, subject: 'add thing' } }
const tree = (over = {}) => ({ path: 'C:/r/feat', branch: 'feat', operation: 'Rebase in progress', operationInfo: rebase, changes: [], ...over })
const conflict = path => ({ id: `c:${path}`, path, area: 'conflict' })

describe('OperationBanner', () => {
  it('names what is paused, the commit being replayed and the step', () => {
    render(<OperationBanner tree={tree()} onAction={() => {}} />)
    const status = screen.getByRole('status').textContent
    expect(status).toContain('Rebasing onto main — ready to continue')
    expect(status).toContain(`Commit 2 of 5 · ${oid.slice(0, 7)} add thing`)
    expect(screen.getByText(oid.slice(0, 7)).className).toContain('nx-hash')
    expect(screen.getByLabelText('Step 2 of 5').children).toHaveLength(5)
    expect(status).toContain('All conflicts resolved')
  })

  it('falls back to the plain operation text without details', () => {
    render(<OperationBanner tree={tree({ operationInfo: null })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('Rebase in progress')
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('counts conflicts resolved during the step and explains a disabled Continue', () => {
    const { rerender } = render(<OperationBanner tree={tree({ changes: [conflict('a'), conflict('b'), conflict('c')] })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('Rebasing onto main — paused on conflicts')
    expect(screen.getByRole('status').textContent).toContain('0 of 3 conflicts resolved')
    const cont = screen.getByRole('button', { name: 'Continue' })
    expect(cont.disabled).toBe(true)
    expect(cont.title).toBe('Resolve 3 remaining conflicts first')
    rerender(<OperationBanner tree={tree({ changes: [conflict('c')] })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('2 of 3 conflicts resolved')
    expect(screen.getByRole('button', { name: 'Continue' }).title).toBe('Resolve 1 remaining conflict first')
    // The next step starts counting again.
    rerender(<OperationBanner tree={tree({ operationInfo: { ...rebase, step: 3 }, changes: [conflict('d')] })} onAction={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('0 of 1 conflict resolved')
  })

  it('Continue waits for the last conflict, then sends continue, skip and abort', () => {
    const onAction = vi.fn()
    const { rerender } = render(<OperationBanner tree={tree({ changes: [conflict('a')] })} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onAction).not.toHaveBeenCalled()
    rerender(<OperationBanner tree={tree()} onAction={onAction} />)
    expect(screen.getByRole('button', { name: 'Continue' }).textContent).toBe('Continue rebase')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    expect(onAction.mock.calls).toEqual([['continue', {}], ['skip', {}], ['abort', { branchLabel: 'feat', operationName: 'rebase' }]])
  })

  it('has no Skip for a merge and nothing without an operation', () => {
    const merge = { kind: 'merge', merging: { name: 'refs/heads/topic', oid } }
    const { rerender } = render(<OperationBanner tree={tree()} onAction={() => {}} />)
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    rerender(<OperationBanner tree={tree({ operation: 'Merge in progress', operationInfo: merge })} onAction={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByText('Merging topic — ready to continue')).toBeTruthy()
    expect(screen.getByText(/Merging topic into feat/)).toBeTruthy()
    rerender(<OperationBanner tree={tree({ operation: '', operationInfo: null })} onAction={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
