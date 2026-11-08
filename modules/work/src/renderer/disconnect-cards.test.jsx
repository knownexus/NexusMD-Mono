import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'

vi.mock('@nexusmd/shell-sdk', async (orig) => ({ ...(await orig()), getProfileKey: k => `nexusmd.p.P1.${k}` }))

import { profileSecrets } from '@nexusmd/shell-sdk'
import { saveAdoConfig, getAdoConfig, isAdoConfigured } from './ado-client.js'
import { saveJiraConfig, getJiraConfig, isJiraConfigured } from './jira-client.js'
import { saveGithubConfig, getGithubConfig, isGithubConfigured } from './github-client.js'
import { AdoConnectionCard } from './ado-settings.jsx'
import { JiraConnectionCard } from './jira-settings.jsx'
import { GithubConnectionCard } from './github-settings.jsx'

const P = 'nexusmd.p.P1.'

beforeEach(() => {
  localStorage.clear()
  saveAdoConfig({ org: 'acme', pat: 'ado-pat', projects: ['P'] })
  saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 'jira-tok', projectKeys: ['AB'] })
  saveGithubConfig({ pat: 'ghp', repos: ['a/b'], login: 'me' })
})
afterEach(async () => {
  cleanup()
  localStorage.clear()
  for (const n of ['ado.pat', 'jira.apiToken', 'github.pat']) await profileSecrets.remove(P + n)
})

const disconnect = (name) => {
  fireEvent.click(screen.getByRole('button', { name: `Disconnect ${name}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
}

describe('the Disconnect button on each connection card', () => {
  it('Azure DevOps: removes the connection, including its token, and empties the form', () => {
    render(<AdoConnectionCard />)
    expect(screen.getByPlaceholderText('your-org-name').value).toBe('acme')
    disconnect('Azure DevOps')
    expect(isAdoConfigured()).toBe(false)
    expect(getAdoConfig()).toMatchObject({ org: '', pat: '', projects: [] })
    expect(screen.getByPlaceholderText('your-org-name').value).toBe('')
  })

  it('Jira: removes the connection, including its token, and empties the form', () => {
    render(<JiraConnectionCard />)
    expect(screen.getByLabelText('Site').value).toBe('https://acme.atlassian.net')
    disconnect('Jira')
    expect(isJiraConfigured()).toBe(false)
    expect(getJiraConfig()).toMatchObject({ site: '', apiToken: '', projectKeys: [] })
    expect(screen.getByLabelText('Site').value).toBe('')
  })

  it('GitHub: removes the connection, including its token, and clears the selected repositories', () => {
    render(<GithubConnectionCard />)
    expect(screen.getByLabelText('a/b').checked).toBe(true)
    disconnect('GitHub')
    expect(isGithubConfigured()).toBe(false)
    expect(getGithubConfig()).toMatchObject({ pat: '', repos: [] })
    expect(screen.queryByLabelText('a/b')).toBeNull()
  })
})
