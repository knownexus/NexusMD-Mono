import React from 'react'
import { render, renderHook, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { SidebarNav, useNumberKeys } from './sidebar-nav.jsx'
import { sidebarGroups, shortcutNav } from './layout.js'

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
    expect(within(more).getAllByRole('button').map(b => b.textContent.replace(/\d+$/, ''))).toEqual(['Calendar'])
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
    expect(within(footer).getAllByRole('button').map(b => b.textContent.replace(/\d+$/, ''))).toEqual(['Builds'])
    const buttons = within(screen.getByRole('navigation', { name: 'Sidebar' })).getAllByRole('button')
    expect(buttons[buttons.length - 1].textContent).toBe('Settings')
    // footer group, then the status, then Settings
    const status = screen.getByTestId('status')
    expect(footer.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status.compareDocumentPosition(buttons[buttons.length - 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('scrolls the screens when they do not fit, with the footer, status and Settings pinned below', () => {
    render(<SidebarNav {...props({ placement: { work: 'footer', builds: 'more' }, status: <div>status line</div> })} />)
    const list = screen.getByRole('group', { name: 'Main screens' }).closest('.sidebar-scroll')
    expect(list).not.toBeNull()
    expect(list.style.overflowY).toBe('auto')
    // The More toggle scrolls with the screens; the footer group, status and Settings do not.
    expect(within(list).getByRole('button', { name: /More/ })).toBeTruthy()
    expect(within(list).queryByRole('group', { name: 'Footer screens' })).toBeNull()
    expect(within(list).queryByText('status line')).toBeNull()
    expect(within(list).queryByRole('button', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
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

  it('numbers the screens across main, More and footer, in the order shown', () => {
    render(<SidebarNav {...props({ placement: { calendar: 'more', dashboard: 'footer' } })} />)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    const hint = label => screen.getByRole('button', { name: new RegExp(`^${label}`) }).querySelector('span[aria-hidden="true"]')?.textContent
    expect(hint('Work Items')).toBe('1')
    expect(hint('Builds')).toBe('2')
    expect(hint('Calendar')).toBe('3')
    expect(hint('Dashboard')).toBe('4')
  })

  it('a screen moved to More or the footer still opens with its number key', () => {
    const setView = vi.fn()
    const groups = sidebarGroups(NAV, { order: NAV.map(n => n.id), placement: { calendar: 'more', dashboard: 'footer' } })
    renderHook(() => useNumberKeys(shortcutNav(groups), setView))
    const press = key => fireEvent.keyDown(window, { key })
    press('3'); expect(setView).toHaveBeenLastCalledWith('calendar')
    press('4'); expect(setView).toHaveBeenLastCalledWith('dashboard')
    press('1'); expect(setView).toHaveBeenLastCalledWith('work')
    setView.mockClear()
    press('5'); fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    expect(setView).not.toHaveBeenCalled()
  })

  it('keeps hidden and switched-off screens out of every group', () => {
    render(<SidebarNav {...props({ hidden: ['calendar'], off: ['builds'], placement: { calendar: 'more', builds: 'footer' } })} />)
    expect(mainLabels()).toEqual(['Dashboard', 'Work Items'])
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Footer screens' })).toBeNull()
  })
})
