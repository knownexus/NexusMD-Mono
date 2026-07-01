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

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

import { DesktopDataSyncCard } from './desktop-settings.jsx'

describe('DesktopDataSyncCard', () => {
  it('renders refresh interval input with current value', () => {
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    expect(screen.getByRole('spinbutton').value).toBe('300')
  })

  it('calls onRefreshIntervalChange and saves to localStorage when interval changes', () => {
    const onChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '120' } })
    expect(onChange).toHaveBeenCalledWith(120)
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBe('120')
  })

  it('clamps refresh interval to minimum 10', () => {
    const onChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('clamps refresh interval to maximum 3600', () => {
    const onChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9999' } })
    expect(onChange).toHaveBeenCalledWith(3600)
  })

  it('clears nexusmd.* localStorage keys and reloads when confirmed', () => {
    const reloadFn = vi.fn()
    vi.stubGlobal('location', { reload: reloadFn })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    localStorage.setItem('nexusmd.refreshInterval', '300')
    localStorage.setItem('unrelated', 'keep')

    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))

    expect(localStorage.getItem('nexusmd.profile.displayName')).toBeNull()
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(reloadFn).toHaveBeenCalled()
  })

  it('does not clear data when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))
    expect(localStorage.getItem('nexusmd.profile.displayName')).toBe('Alice')
  })
})
