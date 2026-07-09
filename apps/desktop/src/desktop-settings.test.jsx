import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeGoogleBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeMicrosoftBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn(), getToken }),
  decodeJwtClaims: vi.fn(),
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
  graphJSON: vi.fn(),
}))

vi.stubGlobal('electronAPI', {
  getCloseToTray: vi.fn(() => Promise.resolve(true)),
  setCloseToTray: vi.fn(),
  getZoomFactor: vi.fn(() => Promise.resolve(1.0)),
  setZoomFactor: vi.fn(),
  onZoomChanged: vi.fn(() => () => {}),
})

beforeEach(() => { getToken.mockReset(); getToken.mockResolvedValue('fake.token.value') })
afterEach(() => { cleanup(); localStorage.clear() })

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Calendar', icon: 'clock' },
  { id: 'work', label: 'Work Items', icon: 'work' },
]

const defaultProps = {
  tweaks: { theme: 'dark', lightTheme: 'parchment', darkTheme: 'cobalt', quickLinks: [], navOrder: ['dashboard', 'calendar', 'work'] },
  setTweak: vi.fn(),
  nav: NAV,
  defaultNavOrder: ['dashboard', 'calendar', 'work'],
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

  it('shows the zoom control and nav order editor in the Appearance tab', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByLabelText('Zoom')).toBeTruthy()
    expect(screen.getAllByTestId('nav-order-row').length).toBe(3)
    expect(screen.getByRole('button', { name: 'Reset order' })).toBeTruthy()
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

describe('GraphApiTestCard (Integrations tab)', () => {
  it('runs a preset and shows the JSON result', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    graphJSON.mockResolvedValueOnce({ displayName: 'Test User' })
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    const runButtons = screen.getAllByRole('button', { name: /Run/i })
    fireEvent.click(runButtons[0])
    expect(await screen.findByText(/Test User/)).toBeTruthy()
  })

  it('shows an error message when the preset call fails', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    graphJSON.mockRejectedValueOnce(new Error('Graph request failed (403): /me'))
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    const runButtons = screen.getAllByRole('button', { name: /Run/i })
    fireEvent.click(runButtons[0])
    expect(await screen.findByText(/Graph request failed \(403\)/)).toBeTruthy()
  })
})

describe('GraphPermissionsCard', () => {
  it('shows granted/not-granted per scope from the decoded token, and live check results', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    const { decodeJwtClaims } = await import('./cloud-auth.js')
    decodeJwtClaims.mockReturnValue({ scp: 'User.Read Calendars.ReadWrite' })
    graphJSON.mockImplementation((getToken, path) => {
      if (path.includes('/me/drive')) return Promise.reject(new Error('Graph request failed (403): /me/drive'))
      return Promise.resolve({ ok: true })
    })

    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))

    // User.Read and Calendars.ReadWrite are granted; Files.ReadWrite is not.
    expect(await screen.findAllByText('Yes')).toHaveLength(2)
    expect(screen.getAllByText('No')).toHaveLength(1)

    // Live check: me + calendar succeed, onedrive fails with the 403 message surfaced.
    expect(await screen.findAllByText('OK')).toHaveLength(2)
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText(/Graph request failed \(403\): \/me\/drive/)).toBeTruthy()
  })

  it('re-runs the diagnosis when Refresh is clicked', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    const { decodeJwtClaims } = await import('./cloud-auth.js')
    decodeJwtClaims.mockReturnValue({ scp: '' })
    graphJSON.mockResolvedValue({ ok: true })

    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    await screen.findAllByText('No') // initial auto-run completes

    const callsBefore = graphJSON.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findAllByText('OK')
    expect(graphJSON.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('treats a getToken rejection as no granted scopes, and unsticks the Refresh button', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    const { decodeJwtClaims } = await import('./cloud-auth.js')
    decodeJwtClaims.mockReturnValue({ scp: 'User.Read Calendars.ReadWrite' })
    graphJSON.mockResolvedValue({ ok: true })
    getToken.mockRejectedValue(new Error('no signed-in account'))

    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))

    // Scopes should settle to "No" (not stuck at "—") even though getToken rejected.
    expect(await screen.findAllByText('No')).toHaveLength(3)
    expect(screen.queryByText('—')).toBeNull()

    // Refresh button must not be stuck showing "Checking…".
    expect(await screen.findByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Checking…' })).toBeNull()
  })
})
