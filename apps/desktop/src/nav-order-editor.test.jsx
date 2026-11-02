import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NavOrderEditor } from './nav-order-editor.jsx'

afterEach(cleanup)

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Calendar', icon: 'clock' },
  { id: 'work', label: 'Work Items', icon: 'work' },
]

function makeDataTransfer() {
  return { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
}

describe('NavOrderEditor', () => {
  it('renders items in resolved order', () => {
    render(<NavOrderEditor nav={NAV} order={['work', 'dashboard', 'calendar']} onChange={vi.fn()} />)
    const items = screen.getAllByTestId('nav-order-item').map(el => el.textContent)
    expect(items).toEqual(['Work Items', 'Dashboard', 'Calendar'])
  })

  it('reorders on drop and calls onChange with new id order', () => {
    const onChange = vi.fn()
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={onChange} />)
    const rows = screen.getAllByTestId('nav-order-row')
    const dt = makeDataTransfer()
    // drag 'work' (index 2) onto 'dashboard' (index 0)
    fireEvent.dragStart(rows[2], { dataTransfer: dt })
    fireEvent.dragOver(rows[0], { dataTransfer: dt })
    fireEvent.drop(rows[0], { dataTransfer: dt })
    expect(onChange).toHaveBeenCalledWith(['work', 'dashboard', 'calendar'])
  })

  it('has no checkboxes unless it can report hiding', () => {
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={vi.fn()} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('shows a checkbox per entry, ticked unless hidden, and dims the hidden ones', () => {
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} hidden={['calendar']} onChange={vi.fn()} onHiddenChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Show Dashboard in the sidebar' }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Show Calendar in the sidebar' }).checked).toBe(false)
    expect(screen.getAllByText('Hidden')).toHaveLength(1)
  })

  it('reports an entry hidden or shown again, keeping the others', () => {
    const onHiddenChange = vi.fn()
    const { rerender } = render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} hidden={['calendar']} onChange={vi.fn()} onHiddenChange={onHiddenChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Work Items in the sidebar' }))
    expect(onHiddenChange).toHaveBeenLastCalledWith(['calendar', 'work'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Calendar in the sidebar' }))
    expect(onHiddenChange).toHaveBeenLastCalledWith([])
    rerender(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} hidden={[]} onChange={vi.fn()} onHiddenChange={onHiddenChange} />)
    expect(screen.queryAllByText('Hidden')).toHaveLength(0)
  })

  it('still reorders with a hidden entry in the list', () => {
    const onChange = vi.fn()
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} hidden={['calendar']} onChange={onChange} onHiddenChange={vi.fn()} />)
    const rows = screen.getAllByTestId('nav-order-row')
    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[0], { dataTransfer: dt })
    fireEvent.drop(rows[2], { dataTransfer: dt })
    expect(onChange).toHaveBeenCalledWith(['calendar', 'work', 'dashboard'])
  })

  it('moving a screen to More removes it from the main sidebar and lists it under More', () => {
    const onPlacementChange = vi.fn()
    const order = ['dashboard', 'calendar', 'work']
    const { rerender } = render(<NavOrderEditor nav={NAV} order={order} onChange={vi.fn()} placement={{}} onPlacementChange={onPlacementChange} />)
    const group = name => screen.getByRole('group', { name })
    const labels = name => within(group(name)).queryAllByTestId('nav-order-item').map(el => el.textContent)
    expect(labels('Sidebar')).toEqual(['Dashboard', 'Calendar', 'Work Items'])
    expect(labels('More')).toEqual([])
    fireEvent.change(screen.getByRole('combobox', { name: 'Move Calendar to' }), { target: { value: 'more' } })
    expect(onPlacementChange).toHaveBeenCalledWith({ calendar: 'more' })
    rerender(<NavOrderEditor nav={NAV} order={order} onChange={vi.fn()} placement={{ calendar: 'more' }} onPlacementChange={onPlacementChange} />)
    expect(labels('Sidebar')).toEqual(['Dashboard', 'Work Items'])
    expect(labels('More')).toEqual(['Calendar'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Move Work Items to' }), { target: { value: 'footer' } })
    expect(onPlacementChange).toHaveBeenLastCalledWith({ calendar: 'more', work: 'footer' })
  })

  it('placement naming a missing id is ignored', () => {
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={vi.fn()} placement={{ ghost: 'more' }} onPlacementChange={vi.fn()} />)
    expect(within(screen.getByRole('group', { name: 'Sidebar' })).getAllByTestId('nav-order-item')).toHaveLength(3)
    expect(within(screen.getByRole('group', { name: 'More' })).queryAllByTestId('nav-order-item')).toHaveLength(0)
  })

  it('reorders within a group, keeping the other groups in place', () => {
    const onChange = vi.fn()
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={onChange} placement={{ calendar: 'more' }} onPlacementChange={vi.fn()} />)
    const rows = within(screen.getByRole('group', { name: 'Sidebar' })).getAllByTestId('nav-order-row')
    const dt = makeDataTransfer()
    fireEvent.dragStart(rows[1], { dataTransfer: dt })
    fireEvent.drop(rows[0], { dataTransfer: dt })
    expect(onChange).toHaveBeenCalledWith(['work', 'calendar', 'dashboard'])
  })

  it('dropping a row on another group moves it there', () => {
    const onChange = vi.fn()
    const onPlacementChange = vi.fn()
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={onChange} placement={{ calendar: 'more' }} onPlacementChange={onPlacementChange} />)
    const dt = makeDataTransfer()
    fireEvent.dragStart(within(screen.getByRole('group', { name: 'Sidebar' })).getAllByTestId('nav-order-row')[0], { dataTransfer: dt })
    fireEvent.drop(within(screen.getByRole('group', { name: 'More' })).getAllByTestId('nav-order-row')[0], { dataTransfer: dt })
    expect(onPlacementChange).toHaveBeenCalledWith({ calendar: 'more', dashboard: 'more' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
