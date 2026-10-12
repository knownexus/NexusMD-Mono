import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { PromptDialog } from './prompt-dialog.jsx'

const base = { type: 'prompt', id: 'p1', title: 'Database', prompt: 'Choice [1]' }

afterEach(cleanup)

describe('PromptDialog', () => {
  it('choice: preselects the default and answers the picked value', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'choice', default: '1', options: [{ value: '1', label: 'Leave it' }, { value: '4', label: 'Remote DEV', hint: 'shared' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/Leave it/).checked).toBe(true)
    fireEvent.click(screen.getByLabelText(/Remote DEV/))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('4')
  })

  it('choice with allowText answers the typed text when filled', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'choice', allowText: true, default: '', options: [{ value: '', label: 'Keep main' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Or type a value'), { target: { value: 'feature/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('feature/x')
  })

  it('multi answers the ticked values', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'multi', options: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }, { value: '3', label: 'c' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('a'))
    fireEvent.click(screen.getByLabelText('c'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith(['1', '3'])
  })

  it('confirm with a word only enables OK once the word is typed', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'confirm', confirmWord: 'YES', detail: 'Deletes everything.' }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    const ok = screen.getByRole('button', { name: 'OK' })
    expect(ok.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type YES to confirm'), { target: { value: 'YES' } })
    fireEvent.click(ok)
    expect(onAnswer).toHaveBeenCalledWith('YES')
  })

  it('confirm with options shows them as buttons', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'confirm', options: [{ value: 'y', label: 'Yes, proceed' }, { value: 'n', label: 'No' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, proceed' }))
    expect(onAnswer).toHaveBeenCalledWith('y')
  })

  it('secret uses a password field and does not render the value anywhere else', () => {
    const onAnswer = vi.fn()
    const { container } = render(<PromptDialog prompt={{ ...base, kind: 'secret', title: 'Mac password' }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('Mac password')
    expect(input.getAttribute('type')).toBe('password')
    fireEvent.change(input, { target: { value: 'hunter22' } })
    expect(container.textContent).not.toContain('hunter22')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('hunter22')
  })

  it('text answers the default when untouched; Cancel cancels', () => {
    const onAnswer = vi.fn(); const onCancel = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'text', default: 'main' }} onAnswer={onAnswer} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('main')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
