import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RefPickerDialog } from './ref-picker-dialog.jsx'

afterEach(cleanup)

const prompt = {
  type: 'prompt', id: 'p2', kind: 'ref', title: 'Branch for orders',
  ref: {
    name: 'orders', current: 'main',
    worktrees: [{ path: 'C:\\w\\main', ref: 'main', display: 'main', folder: 'main', current: true }, { path: 'C:\\w\\fx', ref: 'feature/x', display: 'feature/x', folder: 'fx', current: false }],
    remotes: ['origin/feature-y', 'origin/release-1'],
  },
}

describe('RefPickerDialog', () => {
  it('answers a worktree by index', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: /feature\/x/ }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'worktree', index: 1 })
  })
  it('filters and answers a remote branch', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.change(screen.getByLabelText('Filter remote branches'), { target: { value: 'release' } })
    expect(screen.queryByRole('button', { name: /origin\/feature-y/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /origin\/release-1/ }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'remote', name: 'origin/release-1' })
  })
  it('answers a typed ref, disabled while empty', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: 'Use' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Branch, tag or SHA'), { target: { value: ' v1.2.0 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'ref', value: 'v1.2.0' })
  })
  it('Cancel keeps the current branch', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'cancel' })
  })
})
