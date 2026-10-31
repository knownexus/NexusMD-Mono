import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NavSettings } from './nav-settings.jsx'

afterEach(cleanup)

const T = (...ids) => ids.map(id => ({ id, label: id.toUpperCase(), icon: 'work' }))
const mount = (bar, more, max = 3) => {
  const onChange = vi.fn(), onReset = vi.fn()
  render(<NavSettings nav={{ bar: T(...bar), more: T(...more) }} max={max} onChange={onChange} onReset={onReset}/>)
  return { onChange, onReset }
}

describe('navigation settings', () => {
  it('shows the bar and More with counts', () => {
    mount(['a', 'b'], ['c'])
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('reorders within the bar', () => {
    const { onChange } = mount(['a', 'b'], ['c'])
    fireEvent.click(screen.getByRole('button', { name: 'Move B up' }))
    expect(onChange).toHaveBeenCalledWith({ bar: ['b', 'a'], more: ['c'] })
  })

  it('cannot move the first up or the last down', () => {
    mount(['a', 'b'], [])
    expect(screen.getByRole('button', { name: 'Move A up' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move B down' }).disabled).toBe(true)
  })

  it('moves a screen between the bar and More', () => {
    const { onChange } = mount(['a', 'b'], ['c'])
    fireEvent.click(screen.getByRole('button', { name: 'Show C in the bar' }))
    expect(onChange).toHaveBeenLastCalledWith({ bar: ['a', 'b', 'c'], more: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Move A to More' }))
    expect(onChange).toHaveBeenLastCalledWith({ bar: ['b'], more: ['a', 'c'] })
  })

  it('refuses to overfill the bar and says why', () => {
    const { onChange } = mount(['a', 'b', 'c'], ['d'])
    fireEvent.click(screen.getByRole('button', { name: 'Show D in the bar' }))
    expect(screen.getByRole('alert').textContent).toMatch(/holds 3/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('refuses to empty the bar', () => {
    const { onChange } = mount(['a'], ['b'])
    fireEvent.click(screen.getByRole('button', { name: 'Move A to More' }))
    expect(screen.getByRole('alert').textContent).toMatch(/at least one/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets to the default', () => {
    const { onReset } = mount(['a'], ['b'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to the default' }))
    expect(onReset).toHaveBeenCalled()
  })
})
