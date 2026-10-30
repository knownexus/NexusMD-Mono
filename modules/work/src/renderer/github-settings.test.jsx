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
vi.mock('@nexusmd/ui', () => ({
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
  SettField: ({ label, hint, children }) => <div><label>{label}</label>{children}{hint && <span>{hint}</span>}</div>,
}))

import { GithubConnectionCard } from './github-settings.jsx'

const REPOS = [
  { fullName: 'acme/api', owner: 'acme', name: 'api', private: true, archived: false, hasIssues: true, org: 'acme' },
  { fullName: 'acme/old', owner: 'acme', name: 'old', private: false, archived: true, hasIssues: true, org: 'acme' },
  { fullName: 'me/dots', owner: 'me', name: 'dots', private: false, archived: false, hasIssues: false, org: null },
]

function fakeClient({ repos = REPOS, ssoOrgs = [], login = 'octo', userError = null, discoverError = null } = {}) {
  return {
    get: vi.fn(async (path) => {
      if (path === 'user') { if (userError) throw userError; return { login } }
      throw new Error('unexpected ' + path)
    }),
    discover: vi.fn(async () => { if (discoverError) throw discoverError; return { repos, ssoOrgs } }),
  }
}

const mount = (client, onRefreshData = vi.fn(async () => {}), legacy) => {
  render(<GithubConnectionCard onRefreshData={onRefreshData} makeClient={() => client} discover={c => c.discover()} legacy={legacy} />)
  return onRefreshData
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getGithubConfig).mockReturnValue({ pat: '', repos: [], issues: true, login: '' })
})
afterEach(cleanup)

describe('GithubConnectionCard', () => {
  it('renders blank with no config, and saves the token, ticked repos, issues switch and login', async () => {
    const client = fakeClient()
    const onRefreshData = mount(client)
    expect(screen.getByPlaceholderText('Leave blank to keep existing token').value).toBe('')
    expect(screen.getByText('0 of 50 selected')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing token'), { target: { value: 'ghp_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /acme\/api/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /me\/dots/ }))
    expect(screen.getByText('2 of 50 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledWith({ pat: 'ghp_new', repos: ['acme/api', 'me/dots'], issues: true, login: 'octo' }))
    expect(onRefreshData).toHaveBeenCalled()
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

  it('asks for a token before discovering', async () => {
    const client = fakeClient()
    mount(client)
    fireEvent.click(screen.getByRole('button', { name: 'Discover repositories' }))
    expect(screen.getByText(/Enter a token first/)).toBeTruthy()
    expect(client.discover).not.toHaveBeenCalled()
  })

  it('pre-ticks the repositories from the older GitHub settings when none are saved', async () => {
    mount(fakeClient(), undefined, { pat: 'ghp_legacy', repos: 'acme/api, me/dots, bare' })
    expect(screen.getByText('2 of 50 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledWith(expect.objectContaining({ pat: 'ghp_legacy', repos: ['acme/api', 'me/dots'] })))
  })

  it('saves again after a first save without retyping the token', async () => {
    let stored = { pat: '', repos: ['acme/api'], issues: true, login: '' }
    vi.mocked(getGithubConfig).mockImplementation(() => stored)
    vi.mocked(saveGithubConfig).mockImplementation(v => { stored = { ...stored, ...v } })
    mount(fakeClient())
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing token'), { target: { value: 'ghp_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledTimes(1))
    await screen.findByText(/Saved!/)
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveGithubConfig).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Enter a token first/)).toBeNull()
  })
})

describe('GithubConnectionCard where issues and builds show', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('defaults to Work and Git, and saves Git only at once without reconnecting', async () => {
    const { core } = await import('@nexusmd/core')
    const emit = vi.spyOn(core, '_emit').mockImplementation(() => {})
    const onRefreshData = mount(fakeClient())
    const group = within(screen.getByRole('radiogroup', { name: 'Show GitHub issues and builds in' }))
    expect(group.getByLabelText('Work and Git').checked).toBe(true)
    fireEvent.click(group.getByLabelText('Git only'))
    expect(saveGithubConfig).toHaveBeenCalledWith({ inWork: false })
    expect(emit).toHaveBeenCalledWith('data:updated')
    expect(onRefreshData).not.toHaveBeenCalled()
    expect(group.getByLabelText('Git only').checked).toBe(true)
    emit.mockRestore()
  })

  it('shows the saved choice', () => {
    getGithubConfig.mockReturnValueOnce({ pat: '', repos: [], issues: true, inWork: false, login: '' })
    mount(fakeClient())
    expect(screen.getByLabelText('Git only').checked).toBe(true)
  })
})
