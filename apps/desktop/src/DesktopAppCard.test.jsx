import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

let mockElectronAPI

beforeEach(() => {
  mockElectronAPI = {
    getLoginItemEnabled: vi.fn(() => Promise.resolve(false)),
    getCloseToTray: vi.fn(() => Promise.resolve(true)),
    setLoginItemEnabled: vi.fn(() => Promise.resolve()),
    setCloseToTray: vi.fn(() => Promise.resolve()),
    pickOutputFolder: vi.fn(() => Promise.resolve(null)),
  }
  vi.stubGlobal('electronAPI', mockElectronAPI)
})

afterEach(() => { cleanup(); localStorage.clear() })

import { DesktopAppCard } from './desktop-settings.jsx'

describe('DesktopAppCard', () => {
  it('calls getLoginItemEnabled and getCloseToTray on mount', async () => {
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getLoginItemEnabled).toHaveBeenCalled())
    expect(mockElectronAPI.getCloseToTray).toHaveBeenCalled()
  })

  it('labels the start-on-login toggle for Windows sign-in', () => {
    render(<DesktopAppCard />)
    expect(screen.getByText('Start NexusMD when I sign in to Windows')).toBeTruthy()
  })

  it('calls setLoginItemEnabled(true) when start-on-login toggle is clicked', async () => {
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getLoginItemEnabled).toHaveBeenCalled())
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[0])
    expect(mockElectronAPI.setLoginItemEnabled).toHaveBeenCalledWith(true)
  })

  it('calls setCloseToTray(false) when close-to-tray toggle is clicked', async () => {
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getCloseToTray).toHaveBeenCalled())
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[1])
    expect(mockElectronAPI.setCloseToTray).toHaveBeenCalledWith(false)
  })

  it('calls pickOutputFolder and saves path to localStorage', async () => {
    mockElectronAPI.pickOutputFolder = vi.fn(() => Promise.resolve('/home/user/output'))
    render(<DesktopAppCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    await waitFor(() => expect(mockElectronAPI.pickOutputFolder).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem('nexusmd.outputPath')).toBe('/home/user/output'))
  })

  it('renders null when electronAPI is not present', () => {
    vi.stubGlobal('electronAPI', undefined)
    const { container } = render(<DesktopAppCard />)
    expect(container.firstChild).toBeNull()
  })
})
