import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GithubError } from '@nexusmd/core'
import { saveGithubConfig, getGithubConfig } from './github-client.js'

vi.mock('./github-client.js', () => ({
  getGithubConfig: vi.fn(() => ({ pat: '', repos: [], issues: true, login: '' })),
  saveGithubConfig: vi.fn(),
  createGithubHttpAdapter: vi.fn(() => ({ fetch: vi.fn() })),
}))
vi.mock('./icons.jsx', () => ({ Icon: () => null }))
vi.mock('./components.jsx', () => ({
  Sheet: ({ open, children, footer }) => (open ? <div>{children}{footer}</div> : null),
}))

import { GithubSettingsModal } from './github-settings.jsx'

const REPOS = [
  { fullName: 'acme/api', owner: 'acme', name: 'api', private: true, archived: false, hasIssues: true, org: 'acme' },
  { fullName: 'acme/old', owner: 'acme', name: 'old', private: false, archived: true, hasIssues: true, org: 'acme' },
  { fullName: 'me/dots', owner: 'me', name: 'dots', private: false, archived: false, hasIssues: false, org: null },
]

function fakeClient({ repos = REPOS, ssoOrgs = [], login = 'octo', discoverError = null } = {}) {
  return {
    get: vi.fn(async (path) => {
      if (path === 'user') return { login }
      throw new Error('unexpected ' + path)
    }),
    discover: vi.fn(async () => { if (discoverError) throw discoverError; return { repos, ssoOrgs } }),
  }
}

const mount = (client, onSaved = vi.fn()) => {
  render(<GithubSettingsModal open onClose={() => {}} onSaved={onSaved} makeClient={() => client} discover={c => c.discover()} />)
  return onSaved
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getGithubConfig).mockReturnValue({ pat: '', repos: [], issues: true, login: '' })
})
afterEach(cleanup)

describe('GithubSettingsModal', () => {
  it('saves the token, ticked repos, issues switch and login, then reloads data', async () => {
    const onSaved = mount(fakeClient())
    expect(screen.getByPlaceholderText('Leave blank to keep existing token').value).toBe('')
    expect(screen.getByText('0 of 50 selected')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing token'), { target: { value: 'ghp_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /acme\/api/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /me\/dots/ }))
    expect(screen.getByText('2 of 50 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledWith({ pat: 'ghp_new', repos: ['acme/api', 'me/dots'], issues: true, login: 'octo' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('saves issues: false when "Load GitHub issues" is switched off', async () => {
    vi.mocked(getGithubConfig).mockReturnValue({ pat: 'ghp_old', repos: ['acme/api'], issues: true, login: 'octo' })
    mount(fakeClient())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Load GitHub issues' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledWith(expect.objectContaining({ issues: false, repos: ['acme/api'] })))
  })

  it('keeps the stored token when the token field is left blank', async () => {
    vi.mocked(getGithubConfig).mockReturnValue({ pat: 'ghp_old', repos: ['acme/api'], issues: true, login: 'octo' })
    mount(fakeClient())
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalled())
    expect(saveGithubConfig.mock.calls[0][0]).not.toHaveProperty('pat')
  })

  it('groups discovered repos by owner, labels archived and issues-off repos, and filters by search', async () => {
    vi.mocked(getGithubConfig).mockReturnValue({ pat: 'ghp_old', repos: [], issues: true, login: '' })
    mount(fakeClient({ ssoOrgs: [{ login: 'bigco', url: 'https://github.com/orgs/bigco/sso' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    const acme = await screen.findByRole('group', { name: 'acme' })
    expect(within(acme).getByText('archived')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'me' })).getByText('issues off')).toBeTruthy()
    expect(screen.getByRole('link', { name: /bigco/ }).getAttribute('href')).toBe('https://github.com/orgs/bigco/sso')
    fireEvent.change(screen.getByPlaceholderText('Search repositories'), { target: { value: 'dot' } })
    expect(screen.queryByRole('checkbox', { name: /acme\/api/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /me\/dots/ })).toBeTruthy()
  })

  it('refuses a 51st repository and disables Save', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ fullName: `acme/r${i}`, owner: 'acme', name: `r${i}`, private: false, archived: false, hasIssues: true, org: 'acme' }))
    vi.mocked(getGithubConfig).mockReturnValue({ pat: 'ghp_old', repos: many.slice(0, 50).map(r => r.fullName), issues: true, login: '' })
    mount(fakeClient({ repos: many }))
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /acme\/r50/ }))
    expect(screen.getByText('Select at most 50 repositories')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save & connect' }).disabled).toBe(true)
  })

  it('shows the scope message from GitHub, not a generic failure', async () => {
    vi.mocked(getGithubConfig).mockReturnValue({ pat: 'ghp_old', repos: [], issues: true, login: '' })
    const err = new GithubError('The token lacks permission for this action — grant it the required repository access or scopes', { status: 403, kind: 'scope' })
    mount(fakeClient({ discoverError: err }))
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    expect(await screen.findByText(/The token lacks permission for this action/)).toBeTruthy()
  })

  it('asks for a token before discovering', () => {
    const client = fakeClient()
    mount(client)
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    expect(screen.getByText(/Enter a token first/)).toBeTruthy()
    expect(client.discover).not.toHaveBeenCalled()
  })
})
