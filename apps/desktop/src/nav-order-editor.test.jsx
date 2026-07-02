import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
    const rows = screen.getAllByTestId('nav-order-item')
    const dt = makeDataTransfer()
    // drag 'work' (index 2) onto 'dashboard' (index 0)
    fireEvent.dragStart(rows[2], { dataTransfer: dt })
    fireEvent.dragOver(rows[0], { dataTransfer: dt })
    fireEvent.drop(rows[0], { dataTransfer: dt })
    expect(onChange).toHaveBeenCalledWith(['work', 'dashboard', 'calendar'])
  })
})
