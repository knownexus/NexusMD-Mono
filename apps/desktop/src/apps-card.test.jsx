import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, desc, children }) => <div><span>{title}</span><span>{desc}</span><div>{children}</div></div>,
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  toast: vi.fn(),
}))
vi.mock('./shell/registry.js', () => ({ registry: { apps: [], installedApps: [] } }))

import { AppsCard } from './apps-card.jsx'
import { getDisabledApps, resetDisabledApps } from './shell/apps-disabled.js'
import { toast } from '@nexusmd/ui'

const app = id => ({ id, label: id.toUpperCase() })
const reg = (installed, running = installed) => ({ installedApps: installed.map(app), apps: running.map(app) })

describe('AppsCard', () => {
  let setDisabled
  beforeEach(() => { resetDisabledApps(); setDisabled = vi.fn(() => Promise.resolve()); window.electronAPI = { registry: { setDisabled } } })
  afterEach(() => { cleanup(); delete window.electronAPI; resetDisabledApps(); vi.clearAllMocks() })

  it('is hidden with only one app installed', () => {
    const { container } = render(<AppsCard reg={reg(['git'])} />)
    expect(container.innerHTML).toBe('')
  })

  it('switches a running app off at once: saved, shown to the window, and no restart asked for', () => {
    render(<AppsCard reg={reg(['git', 'work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(setDisabled).toHaveBeenCalledWith(['git'])
    expect(getDisabledApps()).toEqual(['git'])
    expect(screen.queryByText('Restart now')).toBeNull()
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false')
  })

  it('switches it back on at once, too, with no restart', () => {
    render(<AppsCard reg={reg(['git', 'work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(setDisabled).toHaveBeenLastCalledWith([])
    expect(getDisabledApps()).toEqual([])
    expect(screen.queryByText('Restart now')).toBeNull()
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true')
  })

  it('shows an app that was off when NexusMD started as off', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Restart now')).toBeNull()
  })

  it('needs a restart only to turn on an app that was off at start, and says which', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(setDisabled).toHaveBeenCalledWith([])
    expect(screen.getByText('Restart to turn on')).toBeTruthy()
    expect(screen.getByText(/GIT was off when NexusMD started/)).toBeTruthy()
    expect(screen.getByText('On after a restart')).toBeTruthy()
    fireEvent.click(screen.getByText('Restart now'))
    expect(setDisabled).toHaveBeenLastCalledWith([], { restart: true })
  })

  it('takes the restart prompt away again if that app is switched back off', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(screen.getByText('Restart now')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(screen.queryByText('Restart now')).toBeNull()
  })

  it('starts from what the window already follows, so a reload does not forget a switched-off app', () => {
    const first = render(<AppsCard reg={reg(['git', 'work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    first.unmount()
    render(<AppsCard reg={reg(['git', 'work'])} />)
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false')
  })

  it('keeps at least one app on', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[1])
    expect(setDisabled).not.toHaveBeenCalled()
    expect(getDisabledApps()).toBeNull()
    expect(toast).toHaveBeenCalledWith('At least one app has to stay on.', 'error')
  })

  it('says so, and the window still follows the change, when it could not be saved', async () => {
    setDisabled.mockImplementation(() => Promise.reject(new Error('disk')))
    render(<AppsCard reg={reg(['git', 'work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[0])
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Could not save the change.', 'error'))
  })
})
