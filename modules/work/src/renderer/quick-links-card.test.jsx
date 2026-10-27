import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
}))

afterEach(cleanup)

import { QuickLinksCard } from './quick-links-card.jsx'
describe('QuickLinksCard', () => {
  it('renders existing links', () => {
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<QuickLinksCard links={links} onChange={vi.fn()} />)
    expect(screen.getByText('Google')).toBeTruthy()
  })

  it('adds a new link via form', () => {
    const onChange = vi.fn()
    render(<QuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Google' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'https://google.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Google', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('rejects a link without https:// URL', () => {
    const onChange = vi.fn()
    render(<QuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('edits an existing link in place', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<QuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('Google'), { target: { value: 'Bing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Bing', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('removes a link', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<QuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('cancels the add form without calling onChange', () => {
    const onChange = vi.fn()
    render(<QuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Label')).toBeNull()
  })
})
