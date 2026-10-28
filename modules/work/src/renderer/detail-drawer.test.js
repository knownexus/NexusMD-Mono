import { describe, it, expect, vi } from 'vitest'

vi.mock('./ado-client.js', () => ({ createAdoHttpAdapter: vi.fn(), getAdoConfig: () => ({ org: 'myorg' }) }))

import { drawerLink } from './detail-drawer.jsx'

const workItemSource = { webUrl: (w) => `wi:${w.id}` }

describe('drawerLink', () => {
  it('opens GitHub Actions runs on GitHub', () => {
    expect(drawerLink('build', { id: 9, source: 'github', url: 'https://github.com/a/b/actions/runs/9' }, { org: 'myorg', workItemSource }))
      .toEqual({ url: 'https://github.com/a/b/actions/runs/9', label: 'GitHub' })
  })
  it('opens ADO builds on ADO', () => {
    expect(drawerLink('build', { id: 9, projectName: 'P 1' }, { org: 'myorg', workItemSource }))
      .toEqual({ url: 'https://dev.azure.com/myorg/P%201/_build/results?buildId=9', label: 'ADO' })
  })
  it('names the work item provider', () => {
    expect(drawerLink('wi', { id: 'gh:a/b#1', source: 'github' }, { org: 'myorg', workItemSource })).toEqual({ url: 'wi:gh:a/b#1', label: 'GitHub' })
    expect(drawerLink('wi', { id: 'jira:A-1', source: 'jira' }, { org: 'myorg', workItemSource }).label).toBe('Jira')
    expect(drawerLink('wi', { id: 3 }, { org: 'myorg', workItemSource }).label).toBe('ADO')
  })
  it('opens pull requests in the browser', () => {
    expect(drawerLink('pr', { id: 1, url: 'u' }, { org: 'myorg', workItemSource })).toEqual({ url: 'u', label: 'browser' })
  })
})
