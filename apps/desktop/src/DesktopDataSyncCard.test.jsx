import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/core', async importOriginal => ({ ...(await importOriginal()) }))
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
  toast: vi.fn(),
  WI_TYPE_STATES_CACHE_KEY: 'nexusmd.wi.wiTypeStates.cache',
}))

vi.mock('./shell/modules.js', async importOriginal => ({
  ...(await importOriginal()),
  modulePanels: tab => (tab === 'data-sync' ? [{ id: 'fake', Panel: () => <div>a row from an installed app</div> }] : []),
}))

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

import { DesktopDataSyncCard } from './desktop-settings.jsx'

describe('DesktopDataSyncCard', () => {
  it('shows the rows that installed apps add (Work adds its refresh interval and cache)', () => {
    render(<DesktopDataSyncCard />)
    expect(screen.getByText('a row from an installed app')).toBeTruthy()
  })

  it('no longer carries Work\'s own rows', () => {
    render(<DesktopDataSyncCard />)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear cache' })).toBeNull()
  })

  it('clears nexusmd.* localStorage keys and reloads when confirmed', () => {
    const reloadFn = vi.fn()
    vi.stubGlobal('location', { reload: reloadFn })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    localStorage.setItem('nexusmd.refreshInterval', '300')
    localStorage.setItem('unrelated', 'keep')

    render(<DesktopDataSyncCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))

    expect(localStorage.getItem('nexusmd.profile.displayName')).toBeNull()
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(reloadFn).toHaveBeenCalled()
  })

  it('does not clear data when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    render(<DesktopDataSyncCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))
    expect(localStorage.getItem('nexusmd.profile.displayName')).toBe('Alice')
  })
})
