import { describe, it, expect } from 'vitest'
import { connectionsSummary, privacySummary, dataSummary } from './settings-summary.js'

describe('settings summaries', () => {
  it('lists the connected providers', () => {
    expect(connectionsSummary({ ado: { org: 'acme' }, jira: { site: 'https://acme.atlassian.net/' }, github: { pat: 't', repos: ['a/b', 'c/d'] } }))
      .toBe('Azure DevOps (acme) · Jira (acme) · GitHub (2 repos)')
    expect(connectionsSummary({ github: { pat: 't', repos: ['a/b'] } })).toBe('GitHub (1 repo)')
  })
  it('says so when nothing is connected, and ignores GitHub with no token or repos', () => {
    expect(connectionsSummary({})).toBe('Nothing connected yet')
    expect(connectionsSummary({ github: { pat: '', repos: ['a/b'] } })).toBe('Nothing connected yet')
    expect(connectionsSummary({ github: { pat: 't', repos: [] } })).toBe('Nothing connected yet')
  })
  it('describes confidential settings', () => {
    expect(privacySummary({ hasPassword: true, autoRelock: '1' })).toBe('Password set · auto re-lock on')
    expect(privacySummary({ hasPassword: false, autoRelock: '0' })).toBe('No password yet · auto re-lock off')
  })
  it('describes data and sync', () => {
    expect(dataSummary({ pending: 2, loadedLabel: 'Updated 5m ago' })).toBe('Updated 5m ago · 2 changes waiting to sync')
    expect(dataSummary({ pending: 1 })).toBe('1 change waiting to sync')
    expect(dataSummary({})).toBe('Storage, sync and versions')
  })
})
