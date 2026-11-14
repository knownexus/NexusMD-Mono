import { describe, it, expect } from 'vitest'
import { connectionsSummary, connectedProviders, privacySummary, dataSummary } from './settings-summary.js'

const ADO = { org: 'acme', pat: 'p', projects: ['P'] }
const JIRA = { site: 'https://acme.atlassian.net/', email: 'a@b.c', apiToken: 't', projectKeys: ['AB'] }

describe('settings summaries', () => {
  it('lists the connected providers', () => {
    expect(connectionsSummary({ ado: ADO, jira: JIRA, github: { pat: 't', repos: ['a/b', 'c/d'] } }))
      .toBe('Azure DevOps (acme) · Jira (acme) · GitHub (2 repos)')
    expect(connectionsSummary({ github: { pat: 't', repos: ['a/b'] } })).toBe('GitHub (1 repo)')
  })
  it('says so when nothing is connected, and ignores a provider with no token or nothing selected', () => {
    expect(connectionsSummary({})).toBe('Nothing connected yet')
    expect(connectionsSummary({ github: { pat: '', repos: ['a/b'] } })).toBe('Nothing connected yet')
    expect(connectionsSummary({ github: { pat: 't', repos: [] } })).toBe('Nothing connected yet')
  })
  it('does not list a provider whose token was removed, though its organisation or site is still saved', () => {
    expect(connectionsSummary({ ado: { ...ADO, pat: '' }, jira: { ...JIRA, apiToken: '' } })).toBe('Nothing connected yet')
    expect(connectionsSummary({ ado: { org: 'acme', pat: '', projects: [] } })).toBe('Nothing connected yet')
  })
  it('tells which providers are connected', () => {
    expect(connectedProviders({ ado: ADO, jira: JIRA, github: { pat: 't', repos: ['a/b'] } })).toEqual({ ado: true, jira: true, github: true })
    expect(connectedProviders({ ado: { ...ADO, projects: [] }, jira: { ...JIRA, email: '' }, github: { pat: 't', repos: [] } }))
      .toEqual({ ado: false, jira: false, github: false })
    expect(connectedProviders()).toEqual({ ado: false, jira: false, github: false })
  })
  it('describes confidential settings', () => {
    expect(privacySummary({ hasPassword: true, autoRelock: '1' })).toBe('Password set · auto re-lock on')
    expect(privacySummary({ hasPassword: false, autoRelock: '0' })).toBe('No password yet · auto re-lock off')
  })
  it('describes data and sync', () => {
    expect(dataSummary({ pending: 2, loadedLabel: 'Work data updated 5m ago' })).toBe('Work data updated 5m ago · 2 changes waiting to be sent')
    expect(dataSummary({ pending: 1 })).toBe('1 change waiting to be sent')
    expect(dataSummary({})).toBe('Storage, sync and versions')
  })
  it('adds the account sync: conflicts first, then what is not saved', () => {
    expect(dataSummary({ conflicts: 1 })).toBe('1 sync conflict')
    expect(dataSummary({ unsaved: 3 })).toBe('3 not saved to your account')
    expect(dataSummary({ loadedLabel: 'Work data updated 1m ago', pending: 1, conflicts: 2, unsaved: 4 }))
      .toBe('Work data updated 1m ago · 1 change waiting to be sent · 2 sync conflicts · 4 not saved to your account')
    expect(dataSummary({ conflicts: 0, unsaved: 0 })).toBe('Storage, sync and versions')
  })
})
