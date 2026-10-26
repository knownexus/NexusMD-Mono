import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CommitMessageDialog } from './commit-message-dialog.jsx'

afterEach(cleanup)

const show = (props = {}) => {
  const handlers = { onSave: vi.fn(), onClose: vi.fn() }
  render(<CommitMessageDialog title="Reword commit" initial={'Old subject\n\nBody'} {...handlers} {...props} />)
  return handlers
}
const save = () => screen.getByRole('button', { name: 'Save' })
const box = () => screen.getByRole('textbox', { name: 'Commit message' })

describe('CommitMessageDialog', () => {
  it('is prefilled, with Save disabled until the text changes', () => {
    const { onSave } = show()
    expect(box().value).toBe('Old subject\n\nBody')
    expect(save().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: 'New subject\n\nBody' } })
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    expect(onSave).toHaveBeenCalledWith('New subject\n\nBody')
  })

  it('a prefilled message can be saved unchanged when a change is not required', () => {
    const { onSave } = show({ requireChange: false })
    expect(save().disabled).toBe(false)
    fireEvent.click(save())
    expect(onSave).toHaveBeenCalledWith('Old subject\n\nBody')
  })

  it('disables Save while the subject is blank', () => {
    show()
    fireEvent.change(box(), { target: { value: '  \n\nBody' } })
    expect(save().disabled).toBe(true)
  })

  it('Cancel closes, and an error disables Save', () => {
    const { onClose } = show({ initial: '', error: 'No message' })
    fireEvent.change(box(), { target: { value: 'x' } })
    expect(save().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('No message')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
