import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('./profile-keys.js', async (importOriginal) => ({ ...(await importOriginal()), getProfileKey: k => k }))
const jira = vi.hoisted(() => ({
  config: { site: '', email: '', apiToken: '', projectKeys: [], jql: '', enabled: true, boardId: '' },
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

import { JIRA_CACHE_KEY } from '@nexusmd/core'
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
      site: 'acme', email: 'me@acme.io', projectKeys: ['abc', 'def'], jql: '', enabled: true, boardId: '',
    })
    expect(onRefreshData).toHaveBeenCalled()
  })

  it('offers the boards for the entered projects after Test connection and saves the choice', async () => {
    jira.routes = {
      'rest/api/3/myself': { displayName: 'Me Person' },
      'rest/api/3/project/search': { values: [{ key: 'ABC', name: 'Alpha' }] },
      'rest/agile/1.0/board?projectKeyOrId=ABC': { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] },
    }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Team board (ABC, scrum)' })).toBeTruthy())
    expect(screen.getByRole('option', { name: 'Status columns (default)' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: '7' } })
    fireEvent.click(screen.getByText('Save & connect'))
    expect(jira.save).toHaveBeenLastCalledWith(expect.objectContaining({ boardId: '7' }))
  })

  it('explains when boards could not be loaded', async () => {
    jira.routes = { 'rest/api/3/myself': { displayName: 'Me Person' }, 'rest/api/3/project/search': { values: [] } }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText("Couldn't load boards")).toBeTruthy())
  })

  it('clears the listed boards and the board hint when the project keys change', async () => {
    jira.routes = {
      'rest/api/3/myself': { displayName: 'Me Person' },
      'rest/api/3/project/search': { values: [] },
      'rest/agile/1.0/board?projectKeyOrId=ABC': { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] },
    }
    render(<JiraConnectionCard />)
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Team board (ABC, scrum)' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'XYZ' } })
    expect(screen.queryByRole('option', { name: 'Team board (ABC, scrum)' })).toBeNull()

    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText("Couldn't load boards")).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
    expect(screen.queryByText("Couldn't load boards")).toBeNull()
  })

  it('saves no board when the saved board is not among the listed boards', async () => {
    const prev = jira.config
    jira.config = { ...prev, boardId: '99' }
    try {
      jira.routes = {
        'rest/api/3/myself': { displayName: 'Me Person' },
        'rest/api/3/project/search': { values: [] },
        'rest/agile/1.0/board?projectKeyOrId=ABC': { values: [{ id: 7, name: 'Team board', type: 'scrum', location: { projectKey: 'ABC' } }] },
      }
      render(<JiraConnectionCard />)
      fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'acme' } })
      fireEvent.change(screen.getByLabelText('Project keys'), { target: { value: 'ABC' } })
      fireEvent.click(screen.getByText('Test connection'))
      await waitFor(() => expect(screen.getByRole('option', { name: 'Team board (ABC, scrum)' })).toBeTruthy())
      fireEvent.click(screen.getByText('Save & connect'))
      expect(jira.save).toHaveBeenLastCalledWith(expect.objectContaining({ boardId: '' }))
    } finally { jira.config = prev }
  })

  it('drops the Jira cache before refreshing so metadata is refetched', () => {
    localStorage.setItem(JIRA_CACHE_KEY, '{"WORK_ITEMS":[]}')
    localStorage.setItem('nexusmd.ado.cache.v1', '{"WORK_ITEMS":[]}')
    let cacheAtRefresh = 'not called'
    const onRefreshData = vi.fn(() => { cacheAtRefresh = localStorage.getItem(JIRA_CACHE_KEY); return Promise.resolve() })
    render(<JiraConnectionCard onRefreshData={onRefreshData} />)
    fireEvent.click(screen.getByText('Save & connect'))
    expect(cacheAtRefresh).toBeNull()
    expect(localStorage.getItem('nexusmd.ado.cache.v1')).toBe('{"WORK_ITEMS":[]}')
  })
})

describe('WorkItemsDisplayCard', () => {
  it('stores the display mode under the Work Items view key', () => {
    render(<WorkItemsDisplayCard />)
    fireEvent.click(screen.getByText('Separate'))
    expect(localStorage.getItem('nexusmd.wi.displayMode')).toBe('"separate"')
  })
})

// These two cards are the real collapsible card (VsCard), not a stub, so collapsing is what a person sees.
describe('the Jira cards collapse and stay collapsed', () => {
  const collapsedIds = () => {
    const key = Object.keys(localStorage).find(k => k.endsWith('nexusmd.settings.collapsed'))
    return key ? JSON.parse(localStorage.getItem(key)) : []
  }
  const toggle = (title) => screen.getByRole('button', { name: new RegExp(title) })

  it('Jira Cloud Connection folds away, is remembered under its own id, and is still folded when shown again', () => {
    const first = render(<JiraConnectionCard />)
    expect(toggle('Jira Cloud Connection').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle('Jira Cloud Connection'))
    expect(toggle('Jira Cloud Connection').getAttribute('aria-expanded')).toBe('false')
    expect(collapsedIds()).toEqual(['integrations-jira'])
    first.unmount()
    render(<JiraConnectionCard />)
    expect(toggle('Jira Cloud Connection').getAttribute('aria-expanded')).toBe('false')
  })

  it('Work Items Display folds away on its own, leaving the Jira connection as it was', () => {
    render(<><JiraConnectionCard /><WorkItemsDisplayCard /></>)
    fireEvent.click(toggle('Work Items Display'))
    expect(toggle('Work Items Display').getAttribute('aria-expanded')).toBe('false')
    expect(toggle('Jira Cloud Connection').getAttribute('aria-expanded')).toBe('true')
    expect(collapsedIds()).toEqual(['integrations-work-display'])
  })

  it('keeps a half-typed field while folded, and opens again with it', () => {
    render(<JiraConnectionCard />)
    const site = screen.getAllByRole('textbox')[0]
    fireEvent.change(site, { target: { value: 'acme.atlassian.net' } })
    fireEvent.click(toggle('Jira Cloud Connection'))
    fireEvent.click(toggle('Jira Cloud Connection'))
    expect(screen.getAllByRole('textbox')[0].value).toBe('acme.atlassian.net')
  })
})
