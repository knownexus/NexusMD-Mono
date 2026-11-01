import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined, registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } }))

import { WidgetHost, WidgetSheet } from './home-widgets.jsx'
import { HelmData } from '../data.jsx'

afterEach(cleanup)

describe('Home widgets', () => {
  it('shows nothing until a widget is added', () => {
    const { container } = render(<WidgetHost widgets={[]} ctx={{}} onEdit={() => {}}/>)
    expect(container.innerHTML).toBe('')
  })

  it('adds a widget set up as chosen', () => {
    const onSave = vi.fn()
    render(<WidgetSheet open widget={null} onClose={() => {}} onSave={onSave} onRemove={() => {}}/>)
    fireEvent.click(screen.getByText('Builds'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'builds', config: expect.objectContaining({ count: 7 }) }))
  })

  it('shows only as many builds as configured, and shares a row when half width', () => {
    HelmData.BUILDS = [1, 2, 3, 4].map(n => ({ id: n, pipeline: `P${n}`, status: 'success', branch: 'main' }))
    render(<WidgetHost widgets={[{ id: 'a', type: 'builds', config: { count: 2 } }, { id: 'b', type: 'shortcut', config: { to: 'time' } }]} ctx={{ navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.queryByText('P3')).toBeNull()
    expect(screen.getByText('P2')).toBeTruthy()
    expect(screen.getByText('Time').closest('[style*="span 1"]')).toBeTruthy()
  })
})
