import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', async (orig) => ({ ...(await orig()), getProfileKey: k => `nexusmd.p.P1.${k}` }))

import { profileSecrets } from '@nexusmd/shell-sdk'
import { core, ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY, WORK_ITEM_STATUS_KEY } from '@nexusmd/core'
import { saveAdoConfig, isAdoConfigured } from './ado-client.js'
import { saveJiraConfig, isJiraConfigured } from './jira-client.js'
import { saveGithubConfig, isGithubConfigured } from './github-client.js'
import { disconnectProvider } from './disconnect.js'
import { DisconnectButton } from './disconnect-button.jsx'

const P = 'nexusmd.p.P1.'
const cache = (key) => P + key

beforeEach(async () => {
  localStorage.clear()
  saveAdoConfig({ org: 'acme', pat: 'ado-pat', projects: ['P'] })
  saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 'jira-tok', projectKeys: ['AB'] })
  saveGithubConfig({ pat: 'ghp', repos: ['a/b'], login: 'me' })
  await profileSecrets.set(P + 'ado.auth', '{"t":1}')
  await profileSecrets.set(P + 'github.auth', '{"t":1}')
  for (const k of [ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY]) localStorage.setItem(cache(k), '{"PRS":[{"id":1}]}')
  localStorage.setItem(cache(WORK_ITEM_STATUS_KEY), JSON.stringify({ ado: { status: 'ok' }, jira: { status: 'ok' }, github: { status: 'ok' } }))
})
afterEach(async () => {
  cleanup()
  localStorage.clear()
  for (const n of ['ado.pat', 'jira.apiToken', 'github.pat', 'ado.auth', 'github.auth']) await profileSecrets.remove(P + n)
})

describe('disconnectProvider', () => {
  it('disconnects Azure DevOps: config, PAT, sign-in and cache go; the others stay connected', () => {
    expect(isAdoConfigured()).toBe(true)
    disconnectProvider('ado')
    expect(isAdoConfigured()).toBe(false)
    expect(profileSecrets.peek(P + 'ado.pat')).toBeNull()
    expect(profileSecrets.peek(P + 'ado.auth')).toBeNull()
    expect(localStorage.getItem(P + 'ado.org')).toBeNull()
    expect(localStorage.getItem(cache(ADO_CACHE_KEY))).toBeNull()
    expect(JSON.parse(localStorage.getItem(cache(WORK_ITEM_STATUS_KEY)))).not.toHaveProperty('ado')
    expect(isJiraConfigured()).toBe(true)
    expect(isGithubConfigured()).toBe(true)
    expect(localStorage.getItem(cache(JIRA_CACHE_KEY))).not.toBeNull()
  })

  it('disconnects Jira, token included', () => {
    disconnectProvider('jira')
    expect(isJiraConfigured()).toBe(false)
    expect(profileSecrets.peek(P + 'jira.apiToken')).toBeNull()
    expect(localStorage.getItem(cache(JIRA_CACHE_KEY))).toBeNull()
    expect(isAdoConfigured()).toBe(true)
  })

  it('disconnects GitHub, and the older plain token and repository keys that would bring it back', () => {
    localStorage.setItem(P + 'nexusmd.github.pat', 'old')
    localStorage.setItem(P + 'nexusmd.github.repos', 'a/b')
    disconnectProvider('github')
    expect(isGithubConfigured()).toBe(false)
    expect(profileSecrets.peek(P + 'github.pat')).toBeNull()
    expect(profileSecrets.peek(P + 'github.auth')).toBeNull()
    expect(localStorage.getItem(P + 'nexusmd.github.pat')).toBeNull()
    expect(localStorage.getItem(P + 'nexusmd.github.repos')).toBeNull()
    expect(localStorage.getItem(cache(GITHUB_CACHE_KEY))).toBeNull()
  })

  it('also drops a token left in a plain key (what the start-up move could not finish)', () => {
    localStorage.setItem(P + 'ado.pat', 'plain-left-over')
    disconnectProvider('ado')
    expect(localStorage.getItem(P + 'ado.pat')).toBeNull()
  })

  it('tells the screens to re-read the data', () => {
    const emit = vi.spyOn(core, '_emit')
    disconnectProvider('ado')
    expect(emit).toHaveBeenCalledWith('data:updated')
    emit.mockRestore()
  })

  it('throws for an unknown provider', () => {
    expect(() => disconnectProvider('nope')).toThrow()
  })
})

describe('DisconnectButton', () => {
  it('asks first, and only then disconnects', () => {
    const onDone = vi.fn()
    render(<DisconnectButton provider="ado" name="Azure DevOps" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Azure DevOps' }))
    expect(isAdoConfigured()).toBe(true)
    expect(screen.getByText(/Remove the Azure DevOps connection/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(isAdoConfigured()).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('keeps the connection when cancelled', () => {
    render(<DisconnectButton provider="github" name="GitHub" />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(isGithubConfigured()).toBe(true)
    expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toBeTruthy()
  })
})
