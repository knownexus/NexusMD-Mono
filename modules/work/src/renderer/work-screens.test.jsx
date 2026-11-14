import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', async (orig) => ({ ...(await orig()), getProfileKey: k => `nexusmd.p.p1.${k}` }))
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

describe('Work screens when a change arrives from another computer', () => {
  beforeEach(() => { localStorage.clear(); resetOffScreensCache() })
  afterEach(() => { cleanup(); vi.clearAllMocks() })
  function Probe() { return <div data-testid="off">{useOffScreens().join(',')}</div> }
  const announce = (collId) => document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId } }))

  it('reads the saved screens again when sync says they changed, with no reload', () => {
    render(<Probe />)
    expect(screen.getByTestId('off').textContent).toBe('')
    // The sync has just written the other computer's choice under the profile.
    localStorage.setItem(KEY, JSON.stringify(['triage', 'team']))
    act(() => { announce('work-screens') })
    expect(screen.getByTestId('off').textContent).toBe('triage,team')
  })

  it('ignores a sync announcement about something else', () => {
    render(<Probe />)
    localStorage.setItem(KEY, JSON.stringify(['team']))
    act(() => { announce('tweaks') })
    expect(screen.getByTestId('off').textContent).toBe('')
  })

  it('stops listening when the screen goes away', () => {
    const { unmount } = render(<Probe />)
    unmount()
    localStorage.setItem(KEY, JSON.stringify(['team']))
    expect(() => announce('work-screens')).not.toThrow()
  })
})
