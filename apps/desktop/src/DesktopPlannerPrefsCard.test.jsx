import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

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
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} data-value={v} data-active={String(v === value)} onClick={() => onChange(v)}>{l}</button>)}</div>
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

afterEach(() => { cleanup(); localStorage.clear() })

import { DesktopPlannerPrefsCard } from './desktop-settings.jsx'

describe('DesktopPlannerPrefsCard', () => {
  it('saves landing preference to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(localStorage.getItem('nexusmd.planner.landing')).toBe('week')
  })

  it('saves nav style to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }))
    expect(localStorage.getItem('nexusmd.planner.nav')).toBe('tabs')
  })

  it('saves entry style to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Modal' }))
    expect(localStorage.getItem('nexusmd.planner.entry')).toBe('modal')
  })

  it('toggles carry-over prompt off', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('switch'))
    expect(localStorage.getItem('nexusmd.planner.carryPrompt')).toBe('0')
  })

  it('reads initial landing from localStorage', () => {
    localStorage.setItem('nexusmd.planner.landing', 'month')
    render(<DesktopPlannerPrefsCard />)
    const monthBtn = screen.getByRole('button', { name: 'Month' })
    expect(monthBtn.getAttribute('data-active')).toBe('true')
  })
})
