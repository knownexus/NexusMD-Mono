import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined, registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } }))

import { NavOrderCard } from './view-settings.jsx'

afterEach(cleanup)

const groups = [
  { id: 'main', title: 'Sidebar', tabs: [{ id: 'dashboard', label: 'Home', icon: 'dashboard' }, { id: 'planner', label: 'Planner', icon: 'planner' }] },
  { id: 'more', title: 'More', tabs: [{ id: 'builds', label: 'Builds', icon: 'build' }, { id: 'team', label: 'Team', icon: 'team' }] },
]

describe('NavOrderCard', () => {
  it('lists each group and moves a screen within its own group', () => {
    const onMove = vi.fn()
    render(<NavOrderCard groups={groups} onMove={onMove} onReset={() => {}}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Move Planner up' }))
    expect(onMove).toHaveBeenCalledWith('main', 'planner', -1)
    fireEvent.click(screen.getByRole('button', { name: 'Move Builds down' }))
    expect(onMove).toHaveBeenCalledWith('more', 'builds', 1)
  })

  it('cannot move the first screen up or the last one down', () => {
    render(<NavOrderCard groups={groups} onMove={() => {}} onReset={() => {}}/>)
    expect(screen.getByRole('button', { name: 'Move Home up' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Planner down' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Team down' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Team up' }).disabled).toBe(false)
  })

  it('puts the order back to the default', () => {
    const onReset = vi.fn()
    render(<NavOrderCard groups={groups} onMove={() => {}} onReset={onReset}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalled()
  })
})
