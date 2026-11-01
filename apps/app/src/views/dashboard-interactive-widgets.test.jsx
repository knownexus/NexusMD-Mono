import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined, registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } }))

import { TimeWidget, PrWidget } from './dashboard-interactive-widgets.jsx'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('TimeWidget', () => {
  it('starts, pauses, resumes and stops a timer in the shared log', () => {
    render(<TimeWidget storageKey="tl" navTo={() => {}}/>)
    fireEvent.change(screen.getByPlaceholderText('What are you working on?'), { target: { value: 'Review' } })
    fireEvent.click(screen.getByRole('button', { name: /Start/ }))
    expect(JSON.parse(localStorage.getItem('tl')).entries[0]).toMatchObject({ label: 'Review', end: null })
    fireEvent.click(screen.getByRole('button', { name: /Mark/ }))
    expect(JSON.parse(localStorage.getItem('tl')).entries[0].marks?.length ?? 1).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }))
    expect(JSON.parse(localStorage.getItem('tl')).entries[0].end).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }))
    expect(JSON.parse(localStorage.getItem('tl')).entries.filter(e => e.end == null)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(JSON.parse(localStorage.getItem('tl')).entries.filter(e => e.end == null)).toHaveLength(0)
  })
})

describe('PrWidget', () => {
  const prs = [{ id: 1, title: 'Mine to review' }, { id: 2, title: 'A draft', draft: true }]
  it('shows the list the user picks', () => {
    render(<PrWidget prs={prs} needsMe={p => p.id === 1} onOpenPR={() => {}} navTo={() => {}}/>)
    expect(screen.getByText('Mine to review')).toBeTruthy()
    expect(screen.queryByText('A draft')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    expect(screen.getByText('A draft')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Mine to review')).toBeTruthy()
  })
})
