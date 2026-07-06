import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub the heavy shared view: assert DesktopNotesView passes a computed weekLabel
// and load/save-backed notes through to GlobalNotesView.
const gvProps = { current: null }
vi.mock('@nexusmd/ui', () => ({
  GlobalNotesView: (props) => { gvProps.current = props; return <div data-testid="gnv">notes:{props.notes.length}</div> },
  loadGlobalNotes: () => [{ id: 'gn1', title: 'A', body: '', status: 'open', completedWeek: null, createdAt: '', updatedAt: '' }],
  saveGlobalNotes: vi.fn(),
}))

import DesktopNotesView from './desktop-notes-view.jsx'

afterEach(() => { cleanup(); gvProps.current = null })

describe('DesktopNotesView', () => {
  it('renders GlobalNotesView with loaded notes and a week label', () => {
    render(<DesktopNotesView />)
    expect(screen.getByTestId('gnv').textContent).toBe('notes:1')
    expect(gvProps.current.weekLabel).toMatch(/^W\d{1,2}$/)
    expect(typeof gvProps.current.setNotes).toBe('function')
  })
})
