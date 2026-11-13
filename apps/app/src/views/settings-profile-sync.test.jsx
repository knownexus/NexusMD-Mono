// The phone's Profiles page: it carries the Profile sync card (a Save to server and a Load from server for each
// profile, and which account and server they go to), since the Account card no longer has a Sync now of its own.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@capacitor/core', async orig => ({ ...(await orig()), CapacitorHttp: undefined }))
vi.mock('@capacitor/device', () => ({ Device: { getId: async () => ({ identifier: 'dev' }), getInfo: async () => ({ model: 'Test' }) } }))

import { AccountContext, ProfileProvider } from '@nexusmd/ui'
import '../planner/planner-ui.jsx' // sets up the PlFld and PlModal window globals the settings page uses, as the app does
import { SettingsView } from './view-settings.jsx'

beforeEach(() => {
  localStorage.clear()
  // A wide screen: the rail layout, so the Profiles page is a click away.
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})
afterEach(cleanup)

const PROFILES = [
  { id: 'W', name: 'Work', type: 'manual', initials: 'WK', color: '#357', updatedAt: 1 },
  { id: 'H', name: 'Home', type: 'manual', initials: 'HM', color: '#753', updatedAt: 1 },
]
const status = () => ({
  lastSyncAt: null,
  profiles: { W: { lastSyncAt: null, conflicts: 0, tooLarge: [], quota: [], error: null }, H: { lastSyncAt: null, conflicts: 0, tooLarge: [], quota: [], error: null } },
})
function open(sync) {
  const storage = {
    getItem: k => ({ 'helm.profiles': JSON.stringify(PROFILES), 'helm.activeProfileId': 'W' })[k] ?? localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v), removeItem: k => localStorage.removeItem(k), length: 0, key: () => null,
  }
  render(
    <ProfileProvider namespace="helm" lifecycle store={{}} storage={storage}>
      <AccountContext.Provider value={{ sync, session: { username: 'ann', role: 'user' }, signOut: async () => {}, serverName: 'api.example.com' }}>
        <SettingsView tweaks={{}} setTweak={() => {}} navGroups={[]} />
      </AccountContext.Provider>
    </ProfileProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Profiles/ }))
}

describe('the phone’s Profiles page', () => {
  const sync = () => ({
    status: vi.fn(status), onApplied: vi.fn(() => () => {}), lastSyncAt: vi.fn(() => null),
    push: vi.fn(async () => ({ pushed: 1, conflicts: 0 })), pull: vi.fn(async () => ({ applied: 0 })),
    conflicts: vi.fn(() => []), onConflict: vi.fn(() => () => {}),
  })

  it('shows the Profile sync card, naming the account and server, with Save and Load for each profile', async () => {
    open(sync())
    expect(await screen.findByText('Profile sync')).toBeTruthy()
    expect(screen.getByTestId('sync-target').textContent).toMatch(/Signed in as ann · api\.example\.com/)
    for (const name of ['Work', 'Home']) {
      expect(screen.getByRole('button', { name: `Save ${name} to the server` })).toBeTruthy()
      expect(screen.getByRole('button', { name: `Load ${name} from the server` })).toBeTruthy()
    }
  })

  it('Save on one profile sends that profile only', async () => {
    const s = sync()
    open(s)
    fireEvent.click(await screen.findByRole('button', { name: 'Save Home to the server' }))
    await within(screen.getByTestId('sync-row-H')).findByText('Saved Home to the server: 1 item sent.')
    expect(s.push).toHaveBeenCalledWith({ profileId: 'H' })
  })

  it('has no Sync now in the Account or Profile sync cards (the Google Drive / OneDrive card keeps its own)', async () => {
    open(sync())
    await screen.findByText('Profile sync')
    const card = (title) => screen.getByText(title, { selector: 'h3' }).closest('.set-card')
    expect(within(card('Profile sync')).queryByRole('button', { name: /sync now/i })).toBeNull()
    expect(within(card('Account')).queryByRole('button', { name: /sync now/i })).toBeNull()
  })
})
