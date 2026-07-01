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

afterEach(() => { cleanup(); localStorage.clear() })

import { DesktopQuickLinksCard } from './desktop-settings.jsx'

describe('DesktopQuickLinksCard', () => {
  it('renders existing links', () => {
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={vi.fn()} />)
    expect(screen.getByText('Google')).toBeTruthy()
  })

  it('adds a new link via form', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Google' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'https://google.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Google', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('rejects a link without https:// URL', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('edits an existing link in place', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('Google'), { target: { value: 'Bing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Bing', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('removes a link', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('cancels the add form without calling onChange', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Label')).toBeNull()
  })
})
