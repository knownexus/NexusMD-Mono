import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', () => ({ getProfileKey: k => `nexusmd.p.p1.${k}` }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, desc, children }) => <div><span>{title}</span><span>{desc}</span>{children}</div>,
  PlToggle: ({ checked, onChange }) => <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} />,
  toast: vi.fn(),
}))

import { WORK_SCREENS, getOffScreens, setOffScreens, skippedFetches, resetOffScreensCache, useOffScreens } from './work-screens.js'
import { WorkScreensCard } from './work-screens-card.jsx'
import { toast } from '@nexusmd/ui'

const KEY = 'nexusmd.p.p1.work.screens.off'

describe('Work screens switched off', () => {
  beforeEach(() => { localStorage.clear(); resetOffScreensCache() })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('lists Work\'s seven screens from its manifest', () => {
    expect(WORK_SCREENS.map(s => s.id)).toEqual(['dashboard', 'work', 'prs', 'builds', 'tests', 'team', 'triage'])
  })

  it('saves under the profile, ignores unknown ids, and keeps one screen on', () => {
    expect(setOffScreens(['triage', 'team', 'nope'])).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual(['triage', 'team'])
    expect(setOffScreens(WORK_SCREENS.map(s => s.id))).toBe(false)
    expect(getOffScreens()).toEqual(['triage', 'team'])
  })

  it('skips fetching only for screens with data of their own', () => {
    expect(skippedFetches(['prs', 'team', 'triage'])).toEqual({ prs: true, builds: false, tests: false })
  })

  it('tells subscribers when it changes', () => {
    function Probe() { return <div data-testid="off">{useOffScreens().join(',')}</div> }
    render(<Probe />)
    expect(screen.getByTestId('off').textContent).toBe('')
    act(() => { setOffScreens(['team']) })
    expect(screen.getByTestId('off').textContent).toBe('team')
  })

  it('the Settings card switches a screen off and says what that means', () => {
    render(<WorkScreensCard />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[2])   // Pull Requests
    fireEvent.click(switches[6])   // Triage
    expect(getOffScreens()).toEqual(['prs', 'triage'])
    expect(screen.getByText('Off — not shown or fetched')).toBeTruthy()
    expect(screen.getByText('Off — hidden')).toBeTruthy()
  })

  it('the Settings card won\'t switch off the last screen', () => {
    setOffScreens(['dashboard', 'work', 'prs', 'builds', 'tests', 'team'])
    render(<WorkScreensCard />)
    fireEvent.click(screen.getAllByRole('switch')[6])
    expect(getOffScreens()).not.toContain('triage')
    expect(toast).toHaveBeenCalledWith('At least one Work screen has to stay on.', 'error')
  })
})
