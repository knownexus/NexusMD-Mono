import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY, WORK_ITEM_STATUS_KEY } from '@nexusmd/core'
import { saveAdoConfig, getAdoConfig, isAdoConfigured } from './ado-client.js'
import { saveJiraConfig, getJiraConfig, isJiraConfigured } from './jira-client.js'
import { saveGithubConfig, getGithubConfig, isGithubConfigured } from './github-client.js'
import { disconnectProvider } from './disconnect.js'
import { DisconnectButton } from './disconnect-button.jsx'

const load = vi.fn(() => Promise.resolve())

beforeEach(() => {
  localStorage.clear()
  window.HelmApi = { load }
  load.mockClear()
  saveAdoConfig({ org: 'acme', pat: 'ado-pat', projects: ['P'] })
  saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 'jira-tok', projectKeys: ['AB'] })
  saveGithubConfig({ pat: 'ghp', repos: ['a/b'], login: 'me' })
  for (const k of [ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY]) localStorage.setItem(k, '{"PRS":[{"id":1}]}')
  localStorage.setItem(WORK_ITEM_STATUS_KEY, JSON.stringify({ ado: { status: 'ok' }, jira: { status: 'ok' }, github: { status: 'ok' } }))
})
afterEach(() => { cleanup(); delete window.HelmApi })

describe('disconnectProvider', () => {
  it('disconnects Azure DevOps: settings, PAT and cached data go; the others stay connected', () => {
    disconnectProvider('ado')
    expect(isAdoConfigured()).toBe(false)
    expect(getAdoConfig()).toMatchObject({ org: '', pat: '', projects: [] })
    expect(localStorage.getItem(ADO_CACHE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(WORK_ITEM_STATUS_KEY))).not.toHaveProperty('ado')
    expect(isJiraConfigured()).toBe(true)
    expect(isGithubConfigured()).toBe(true)
    expect(localStorage.getItem(JIRA_CACHE_KEY)).not.toBeNull()
  })

  it('disconnects Jira, token included', () => {
    disconnectProvider('jira')
    expect(isJiraConfigured()).toBe(false)
    expect(getJiraConfig()).toMatchObject({ site: '', apiToken: '' })
    expect(localStorage.getItem(JIRA_CACHE_KEY)).toBeNull()
    expect(isAdoConfigured()).toBe(true)
  })

  it('disconnects GitHub, token included', () => {
    disconnectProvider('github')
    expect(isGithubConfigured()).toBe(false)
    expect(getGithubConfig()).toMatchObject({ pat: '', repos: [] })
    expect(localStorage.getItem(GITHUB_CACHE_KEY)).toBeNull()
  })

  it('reloads the data so what is on screen is dropped at once', () => {
    disconnectProvider('ado')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('throws for an unknown provider', () => {
    expect(() => disconnectProvider('nope')).toThrow()
  })
})

describe('DisconnectButton', () => {
  it('asks first, and only then disconnects and reports it', () => {
    const onDone = vi.fn()
    render(<DisconnectButton provider="ado" name="Azure DevOps" onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Azure DevOps' }))
    expect(isAdoConfigured()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(isAdoConfigured()).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('keeps the connection when cancelled', () => {
    render(<DisconnectButton provider="github" name="GitHub" />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(isGithubConfigured()).toBe(true)
  })
})
