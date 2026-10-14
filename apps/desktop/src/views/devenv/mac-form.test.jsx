import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MacForm } from './mac-form.jsx'

afterEach(cleanup)

describe('MacForm', () => {
  it('edits host, user and the key path, removing a cleared key path', () => {
    const onChange = vi.fn()
    render(<MacForm value={{ host: 'mac.local', user: 'me', sshKey: 'C:\\k', other: 1 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Mac host'), { target: { value: '10.0.0.5' } })
    expect(onChange).toHaveBeenLastCalledWith({ host: '10.0.0.5', user: 'me', sshKey: 'C:\\k', other: 1 })
    fireEvent.change(screen.getByLabelText('SSH key file'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ host: 'mac.local', user: 'me', other: 1 })
  })
  it('starts from nothing', () => {
    const onChange = vi.fn()
    render(<MacForm value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Mac user'), { target: { value: 'me' } })
    expect(onChange).toHaveBeenLastCalledWith({ user: 'me' })
  })
})
