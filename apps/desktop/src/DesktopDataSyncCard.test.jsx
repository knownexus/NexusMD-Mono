import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./jira-settings.jsx', () => ({ JiraConnectionCard: () => null, WorkItemsDisplayCard: () => null }))
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
vi.mock('@nexusmd/core', async importOriginal => {
  // Settings modules read constants from core when they load (e.g. git-config's tab name).
  // makeProfileKeys: @nexusmd/shell-sdk builds getProfileKey from it when the Git app's settings card loads.
  const { ALL_PROJECTS, LEGACY_ALL_PROJECTS, SQL_AUTH, AZURE_AD_INTERACTIVE, makeProfileKeys } = await importOriginal()
  return { ALL_PROJECTS, LEGACY_ALL_PROJECTS, SQL_AUTH, AZURE_AD_INTERACTIVE, makeProfileKeys, ADO_CACHE_KEY: 'nexusmd.ado.cache.v1', JIRA_CACHE_KEY: 'nexusmd.jira.cache.v1' }
})
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

  it('does not render Clear cache when onRefreshData is absent', () => {
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear cache' })).toBeNull()
  })

  it('clears only the cache keys (ADO, Jira, type states) and re-fetches when Clear cache is clicked', async () => {
    const onRefreshData = vi.fn().mockResolvedValue()
    localStorage.setItem('nexusmd.ado.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.wi.wiTypeStates.cache', '{}')
    localStorage.setItem('nexusmd.jira.cache.v1', '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.ado.org', 'acme')
    localStorage.setItem('nexusmd.planner.week.2026-W27', 'notes')

    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} onRefreshData={onRefreshData} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))

    expect(localStorage.getItem('nexusmd.ado.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.wi.wiTypeStates.cache')).toBeNull()
    expect(localStorage.getItem('nexusmd.jira.cache.v1')).toBeNull()
    expect(localStorage.getItem('nexusmd.ado.org')).toBe('acme')
    expect(localStorage.getItem('nexusmd.planner.week.2026-W27')).toBe('notes')
    expect(onRefreshData).toHaveBeenCalledTimes(1)
  })

  it('does not call window.confirm or reload for Clear cache', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onRefreshData = vi.fn().mockResolvedValue()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} onRefreshData={onRefreshData} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onRefreshData).toHaveBeenCalledTimes(1)
  })
})
