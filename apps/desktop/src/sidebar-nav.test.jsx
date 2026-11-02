import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { SidebarNav } from './sidebar-nav.jsx'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Calendar', icon: 'clock' },
  { id: 'work', label: 'Work Items', icon: 'work' },
  { id: 'builds', label: 'Builds', icon: 'build' },
]

const props = (over = {}) => ({
  nav: NAV, order: NAV.map(n => n.id), hidden: [], placement: {}, off: [],
  view: 'dashboard', onSelect: vi.fn(), iconsOnly: false, showNumbers: true, badges: {}, ...over,
})

const mainLabels = () => within(screen.getByRole('group', { name: 'Main screens' })).getAllByRole('button').map(b => b.textContent.replace(/\d+$/, ''))

describe('SidebarNav', () => {
  it('moving a screen to More removes it from the main sidebar and lists it under More', () => {
    const { rerender } = render(<SidebarNav {...props()} />)
    expect(mainLabels()).toEqual(['Dashboard', 'Calendar', 'Work Items', 'Builds'])
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull()

    rerender(<SidebarNav {...props({ placement: { calendar: 'more' } })} />)
    expect(mainLabels()).toEqual(['Dashboard', 'Work Items', 'Builds'])
    const toggle = screen.getByRole('button', { name: /More/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const more = screen.getByRole('group', { name: 'More' })
    expect(within(more).getAllByRole('button').map(b => b.textContent)).toEqual(['Calendar'])
  })

  it('placement naming a missing id is ignored', () => {
    render(<SidebarNav {...props({ placement: { ghost: 'more', nope: 'footer' } })} />)
    expect(mainLabels()).toEqual(['Dashboard', 'Calendar', 'Work Items', 'Builds'])
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Footer screens' })).toBeNull()
  })

  it('renders the footer group above the status, and Settings stays last', () => {
    render(<SidebarNav {...props({ placement: { builds: 'footer' } })} status={<div data-testid="status">Updated 5m ago</div>} />)
    const footer = screen.getByRole('group', { name: 'Footer screens' })
    expect(within(footer).getAllByRole('button').map(b => b.textContent)).toEqual(['Builds'])
    const buttons = within(screen.getByRole('navigation', { name: 'Sidebar' })).getAllByRole('button')
    expect(buttons[buttons.length - 1].textContent).toBe('Settings')
    // footer group, then the status, then Settings
    const status = screen.getByTestId('status')
    expect(footer.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status.compareDocumentPosition(buttons[buttons.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('marks the current screen and opens screens from any group', () => {
    const onSelect = vi.fn()
    render(<SidebarNav {...props({ onSelect, view: 'builds', placement: { builds: 'footer', work: 'more' } })} />)
    expect(screen.getByRole('button', { name: 'Builds' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Work Items' }))
    expect(onSelect).toHaveBeenCalledWith('work')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSelect).toHaveBeenLastCalledWith('settings')
  })

  it('keeps hidden and switched-off screens out of every group', () => {
    render(<SidebarNav {...props({ hidden: ['calendar'], off: ['builds'], placement: { calendar: 'more', builds: 'footer' } })} />)
    expect(mainLabels()).toEqual(['Dashboard', 'Work Items'])
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Footer screens' })).toBeNull()
  })
})
