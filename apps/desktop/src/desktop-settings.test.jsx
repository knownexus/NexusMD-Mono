import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeGoogleBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeMicrosoftBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div data-testid="logs-card">LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ title, children }) => <div data-testid={`vs-card-${(title || '').toLowerCase().replace(/[\s&]+/g, '-')}`}>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div data-testid="vs-profiles">VsProfiles</div>,
  BackupRestoreCard: () => <div data-testid="backup-restore">BackupRestoreCard</div>,
  CloudSyncCard: () => <div data-testid="cloud-sync">CloudSyncCard</div>,
  BoardColumnsCard: () => <div data-testid="board-columns">BoardColumnsCard</div>,
  IntegrationsView: () => <div data-testid="integrations-view">IntegrationsView</div>,
  ThemeChipPicker: () => <div data-testid="theme-chip-picker">ThemeChipPicker</div>,
  VsPasswordModal: ({ open }) => open ? <div>VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))

vi.stubGlobal('electronAPI', {
  getCloseToTray: vi.fn(() => Promise.resolve(true)),
  setCloseToTray: vi.fn(),
})

afterEach(() => { cleanup(); localStorage.clear() })

const defaultProps = {
  tweaks: { theme: 'dark', lightTheme: 'parchment', darkTheme: 'cobalt', quickLinks: [] },
  setTweak: vi.fn(),
  refreshInterval: 300,
  onRefreshIntervalChange: vi.fn(),
  onRefreshData: vi.fn(),
}

import { DesktopSettings } from './desktop-settings.jsx'

describe('DesktopSettings tab navigation', () => {
  it('shows Profile tab content by default', () => {
    render(<DesktopSettings {...defaultProps} />)
    expect(screen.getByTestId('vs-card-profile')).toBeTruthy()
    expect(screen.queryByTestId('theme-chip-picker')).toBeNull()
  })

  it('shows Appearance tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getAllByTestId('theme-chip-picker').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('vs-card-profile')).toBeNull()
  })

  it('shows Planner tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }))
    expect(screen.getByTestId('vs-card-planner')).toBeTruthy()
    expect(screen.getByTestId('board-columns')).toBeTruthy()
  })

  it('shows Profiles tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }))
    expect(screen.getByTestId('vs-profiles')).toBeTruthy()
    expect(screen.getByTestId('backup-restore')).toBeTruthy()
    expect(screen.getByTestId('cloud-sync')).toBeTruthy()
  })

  it('shows Confidential tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confidential' }))
    expect(screen.getByTestId('vs-card-confidential')).toBeTruthy()
  })

  it('shows Data & sync tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }))
    expect(screen.getByTestId('vs-card-data-sync')).toBeTruthy()
    expect(screen.getByTestId('logs-card')).toBeTruthy()
  })

  it('shows Integrations tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    expect(screen.getByTestId('integrations-view')).toBeTruthy()
  })

  it('shows Desktop tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))
    expect(screen.getByTestId('vs-card-desktop-app')).toBeTruthy()
  })
})
