import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => null, ProfileProvider: ({ children }) => children }))
vi.mock('./cloud-auth.js', () => ({ desktopCloudProviders: [], makeDesktopOAuthService: () => ({}) }))
vi.mock('./sync.js', () => ({ desktopSync: {}, startDesktopAutoSync: () => {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({ getAdoConfig: () => ({}), saveAdoConfig: () => {}, createAdoHttpAdapter: () => {}, isAdoConfigured: () => false }))
vi.mock('./logs-card.jsx', () => ({ default: () => null }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children, title }) => <div data-testid="vscard" data-title={title}>{children}</div>,
  VsRow: ({ children, title }) => <div data-testid="vsrow" data-title={title}>{children}</div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>toggle</button>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: () => ({ sections: [], hash: null }),
  ThemeChipPicker: () => null,
  BoardColumnsCard: () => null,
  VsProfiles: () => null,
  BackupRestoreCard: () => null,
  CloudSyncCard: () => null,
  IntegrationsView: () => null,
  Icon: () => null,
  CardFrame: ({ children }) => <div>{children}</div>,
}))

import { DesktopProfileCard } from './desktop-settings.jsx'

describe('DesktopProfileCard', () => {
  afterEach(() => { cleanup(); localStorage.clear() })

  it('renders 4 inputs', () => {
    render(<DesktopProfileCard />)
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
  })

  it('saves displayName to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'Alice' } })
    expect(localStorage.getItem('nexusmd.profile.displayName')).toBe('Alice')
  })

  it('saves role to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[1], { target: { value: 'Lead' } })
    expect(localStorage.getItem('nexusmd.profile.role')).toBe('Lead')
  })

  it('saves team to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[2], { target: { value: 'Platform' } })
    expect(localStorage.getItem('nexusmd.profile.team')).toBe('Platform')
  })

  it('reads initial displayName from localStorage', () => {
    localStorage.setItem('nexusmd.profile.displayName', 'Bob')
    render(<DesktopProfileCard />)
    expect(screen.getAllByRole('textbox')[0].value).toBe('Bob')
  })
})
