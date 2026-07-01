import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadConfidentialConfig } from '@nexusmd/ui'

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
  VsPasswordModal: ({ open }) => open ? <div data-testid="pw-modal">VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.mocked(loadConfidentialConfig).mockReturnValue({ sections: [], hash: null })
})

import { DesktopConfidentialCard } from './desktop-settings.jsx'

describe('DesktopConfidentialCard', () => {
  it('shows "Set password" button when no hash is set', () => {
    render(<DesktopConfidentialCard />)
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy()
  })

  it('shows "Change password" button when hash is set', () => {
    vi.mocked(loadConfidentialConfig).mockReturnValue({ sections: [], hash: 'abc123' })
    render(<DesktopConfidentialCard />)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
  })

  it('opens password modal when password button is clicked', () => {
    render(<DesktopConfidentialCard />)
    expect(screen.queryByTestId('pw-modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(screen.getByTestId('pw-modal')).toBeTruthy()
  })

  it('toggles auto-relock on', () => {
    render(<DesktopConfidentialCard />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(localStorage.getItem('nexusmd.confidential.autoRelock')).toBe('1')
  })

  it('reads auto-relock state from localStorage', () => {
    localStorage.setItem('nexusmd.confidential.autoRelock', '1')
    render(<DesktopConfidentialCard />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})
