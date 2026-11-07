import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { GroupPicker } from './group-picker.jsx'

afterEach(cleanup)
const tabs = [{ name: 'Registered repos', repos: 3 }, { name: 'Only B', repos: 1 }]

describe('GroupPicker', () => {
  it('shows the active group and its repository count on one button', () => {
    render(<GroupPicker tabs={tabs} active="Only B" onSelect={() => {}} onNew={() => {}} />)
    const button = screen.getByRole('button', { name: /^Only B\s*1 repo/ })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('lists every group as a radio item, the active one checked, and selects on click', () => {
    const onSelect = vi.fn()
    render(<GroupPicker tabs={tabs} active="Registered repos" onSelect={onSelect} onNew={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^Registered repos/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Registered repos 3 repos' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Only B 1 repo' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Only B 1 repo' }))
    expect(onSelect).toHaveBeenCalledWith('Only B')
  })

  it('has a + New group button that calls onNew, disabled with the reason as its title while busy', () => {
    const onNew = vi.fn()
    const { rerender } = render(<GroupPicker tabs={tabs} active="Only B" onSelect={() => {}} onNew={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: 'New group' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    rerender(<GroupPicker tabs={tabs} active="Only B" onSelect={() => {}} onNew={onNew} busy="Loading repositories…" />)
    const plus = screen.getByRole('button', { name: 'New group' })
    expect(plus.disabled).toBe(true)
    expect(plus.title).toBe('Loading repositories…')
  })
})
