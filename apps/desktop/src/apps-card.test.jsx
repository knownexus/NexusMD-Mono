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
import { toast } from '@nexusmd/ui'

const app = id => ({ id, label: id.toUpperCase() })
const reg = (installed, running = installed) => ({ installedApps: installed.map(app), apps: running.map(app) })

describe('AppsCard', () => {
  let setDisabled
  beforeEach(() => { setDisabled = vi.fn(() => Promise.resolve()); window.electronAPI = { registry: { setDisabled } } })
  afterEach(() => { cleanup(); delete window.electronAPI; vi.clearAllMocks() })

  it('is hidden with only one app installed', () => {
    const { container } = render(<AppsCard reg={reg(['git'])} />)
    expect(container.innerHTML).toBe('')
  })

  it('saves a switched-off app and offers a restart', async () => {
    render(<AppsCard reg={reg(['git', 'work'])} />)
    expect(screen.queryByText('Restart now')).toBeNull()
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(setDisabled).toHaveBeenCalledWith(['git'])
    fireEvent.click(screen.getByText('Restart now'))
    expect(setDisabled).toHaveBeenLastCalledWith(['git'], { restart: true })
  })

  it('shows a switched-off app as off, and switching it back on needs no restart', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    const [git] = screen.getAllByRole('switch')
    expect(git.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(git)
    expect(setDisabled).toHaveBeenCalledWith([])
    expect(screen.getByText('Restart now')).toBeTruthy()   // the app is still off until a restart
  })

  it('keeps at least one app on', () => {
    render(<AppsCard reg={reg(['git', 'work'], ['work'])} />)
    fireEvent.click(screen.getAllByRole('switch')[1])
    expect(setDisabled).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('At least one app has to stay on.', 'error')
  })
})
