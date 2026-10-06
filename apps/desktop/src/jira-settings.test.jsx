import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('./profile-keys.js', async (importOriginal) => ({ ...(await importOriginal()), getProfileKey: k => k }))
const jira = vi.hoisted(() => ({
  config: { site: '', email: '', apiToken: '', projectKeys: [], jql: '', enabled: true },
  save: vi.fn(),
  routes: {},
}))
vi.mock('./jira-client.js', () => ({
  getJiraConfig: () => jira.config,
  saveJiraConfig: jira.save,
  createJiraHttpAdapter: () => ({
    fetch: async (path) => {
      const body = Object.entries(jira.routes).find(([p]) => path.includes(p))?.[1]
      const text = JSON.stringify(body ?? {})
      return { ok: !!body, status: body ? 200 : 401, headers: { get: () => null }, text: async () => text, json: async () => body ?? {} }
    },
  }),
}))

import { JiraConnectionCard, WorkItemsDisplayCard } from './jira-settings.jsx'

afterEach(() => { cleanup(); jira.save.mockReset(); jira.routes = {}; localStorage.clear() })

describe('JiraConnectionCard', () => {
  it('tests the connection, shows who is connected and offers projects', async () => {
    jira.routes = {
      'rest/api/3/myself': { displayName: 'Me Person' },
      'rest/api/3/project/search': { values: [{ key: 'ABC', name: 'Alpha' }, { key: 'DEF', name: 'Delta' }] },
    }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@acme.io' } })
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText('Connected as Me Person')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('ABC — Alpha'))
    expect(screen.getByLabelText('Project keys').value).toBe('ABC')
  })

  it('shows the Jira error when the test fails', async () => {
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText(/^Error: .*credentials/)).toBeTruthy())
  })

  it('saves, keeping the existing token when the field is blank, then refreshes', async () => {
    const onRefreshData = vi.fn(() => Promise.resolve())
    render(<JiraConnectionCard onRefreshData={onRefreshData} />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@acme.io' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'abc, def' } })
    fireEvent.click(screen.getByText('Save & connect'))
    expect(jira.save).toHaveBeenLastCalledWith({
      site: 'acme', email: 'me@acme.io', projectKeys: ['abc', 'def'], jql: '', enabled: true,
    })
    expect(onRefreshData).toHaveBeenCalled()
  })
})

describe('WorkItemsDisplayCard', () => {
  it('stores the display mode under the Work Items view key', () => {
    render(<WorkItemsDisplayCard />)
    fireEvent.click(screen.getByText('Separate'))
    expect(localStorage.getItem('nexusmd.wi.displayMode')).toBe('"separate"')
  })
})
