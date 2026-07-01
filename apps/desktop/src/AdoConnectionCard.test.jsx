import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saveAdoConfig, getAdoConfig } from './ado-client.js'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: vi.fn(() => ({ org: '', pat: '', projects: [] })),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: vi.fn(() => ({
    fetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ value: [{ name: 'ProjectA' }, { name: 'ProjectB' }] }) })),
  })),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ children }) => <div>{children}</div>,
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
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAdoConfig).mockReturnValue({ org: '', pat: '', projects: [] })
})

afterEach(() => { cleanup() })

import { AdoConnectionCard } from './desktop-settings.jsx'

describe('AdoConnectionCard', () => {
  it('renders org and PAT inputs', () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    expect(screen.getByPlaceholderText('your-org-name')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave blank to keep existing PAT')).toBeTruthy()
  })

  it('loads initial org from getAdoConfig on mount', async () => {
    vi.mocked(getAdoConfig).mockReturnValue({ org: 'myorg', pat: '', projects: ['ProjectA'] })
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText('your-org-name').value).toBe('myorg'))
  })

  it('calls saveAdoConfig with org and PAT when Save is clicked', async () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing PAT'), { target: { value: 'mytoken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveAdoConfig).toHaveBeenCalledWith({
      org: 'myorg',
      pat: 'mytoken',
      projects: [],
    }))
  })

  it('calls onRefreshData after successful save', async () => {
    const onRefreshData = vi.fn(() => Promise.resolve())
    render(<AdoConnectionCard onRefreshData={onRefreshData} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(onRefreshData).toHaveBeenCalled())
  })

  it('discovers projects and populates the projects textarea', async () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing PAT'), { target: { value: 'mytoken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discover projects' }))
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Project1, Project2')
      expect(textarea.value).toBe('ProjectA, ProjectB')
    })
  })
})
