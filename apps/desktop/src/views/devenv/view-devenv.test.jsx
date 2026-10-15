import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { useProfileFile, clearProfileDrafts } from './use-profile-file.js'
import { createRunState } from '@nexusmd/core'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./status-view.jsx', () => ({ StatusView: ({ onStart }) => <button onClick={onStart}>status-stub</button> }))
vi.mock('./start-view.jsx', () => ({ StartView: () => <div>start-stub</div> }))
vi.mock('./commands-view.jsx', () => ({ CommandsView: () => <div>commands-stub</div> }))
vi.mock('./profile-view.jsx', () => ({ ProfileView: () => <div>profile-stub</div> }))

import { DevenvView } from './view-devenv.jsx'

afterEach(() => { cleanup(); clearProfileDrafts() })
beforeEach(() => {
  localStorage.clear()
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), leftover: { runs: [], error: null, cancelAll: vi.fn() } }
})

const adapters = { devenv: { isAvailable: () => true } }

describe('DevenvView', () => {
  it('opens on Status and switches tabs', () => {
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('status-stub')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
  it('Start… on Status opens the Start tab', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByText('status-stub'))
    expect(screen.getByText('start-stub')).toBeTruthy()
  })
  it('has a Profile tab between Mac and Commands', () => {
    render(<DevenvView adapters={adapters} />)
    const names = ['Status', 'Start', 'Builds', 'Logs', 'Tests', 'Database', 'Emulator', 'Mac', 'Profile', 'Commands']
    const order = names.map(n => screen.getByRole('button', { name: n }))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.getByText('profile-stub')).toBeTruthy()
  })
  it('marks the Profile tab while any profile draft is unsaved', async () => {
    // Real draft store: a tiny component creates a draft through useProfileFile.
    const adapter = { profileRead: async () => ({ text: '{}', bom: false, stamp: 's' }) }
    const cfg = { root: 'r', profile: '' }
    let api
    function Probe() { api = useProfileFile({ adapter, config: cfg, path: 'environment.json' }); return null }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile')
    render(<Probe />)
    await waitFor(() => expect(api.status).toBe('ready'))
    act(() => api.setText('{"x":1}'))
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile •')
    act(() => clearProfileDrafts())
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile')
  })
  it('remembers the tab', () => {
    const { unmount } = render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    unmount()
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
})
