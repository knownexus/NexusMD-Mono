import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined, registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } }))

import { WorkItemsView } from './view-workitems.jsx'
import { PRView } from './view-prs.jsx'
import { BuildsView } from './view-builds.jsx'

afterEach(cleanup)

const ghIssue = (over = {}) => ({
  id: 'gh:acme/web#7', displayId: 'acme/web#7', title: 'Fix the login redirect', state: 'Open', type: 'bug',
  source: 'github', project: 'acme-web', projectName: 'acme/web', assignee: 'unassigned', ...over,
})
const adoItem = { id: 42, title: 'ADO thing', state: 'Active', type: 'task', project: 'P', assignee: 'unassigned' }

describe('GitHub work items', () => {
  it('shows the owner/repo#n key', () => {
    render(<WorkItemsView items={[ghIssue()]} onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    expect(screen.getByText('#acme/web#7')).toBeTruthy()
  })

  it('uses Open and Closed lanes when GitHub is the only provider', () => {
    localStorage.setItem('helm.workitems.viewState', JSON.stringify({ groupBy: 'status' }))
    render(<WorkItemsView items={[ghIssue(), ghIssue({ id: 'gh:acme/web#8', displayId: 'acme/web#8', state: 'Closed' })]}
      onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    const groups = [...document.querySelectorAll('.wi-group-label')].map(e => e.textContent)
    expect(groups).toEqual(['Open', 'Closed'])
  })

  it('leaves an ADO-only list as it was', () => {
    render(<WorkItemsView items={[adoItem]} onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    expect(screen.getByText('#42')).toBeTruthy()
  })
})

describe('GitHub pull requests', () => {
  it('lists a PR under its repo key', () => {
    const pr = { id: 'gh:acme/web#9', displayId: 'acme/web#9', title: 'Add retries', repo: 'web', status: 'active', source: 'github', author: 'octo' }
    render(<PRView prs={[pr]} onOpen={() => {}} device="phone"/>)
    expect(screen.getByText('acme/web#9')).toBeTruthy()
  })
})

describe('GitHub runs', () => {
  const run = { id: 991, source: 'github', url: 'https://github.com/acme/web/actions/runs/991', pipeline: 'CI', status: 'failed', branch: 'main', definitionId: 5, project: 'acme-web', actor: 'octo', when: '1h' }

  it('opens in GitHub and has no re-run or cancel', () => {
    render(<BuildsView builds={[run, { ...run, id: 992, status: 'running' }]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}}/>)
    const links = screen.getAllByText(/Open in GitHub/)
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].closest('a').getAttribute('href')).toBe('https://github.com/acme/web/actions/runs/991')
    expect(screen.queryByText('Rerun')).toBeNull()
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})

describe('source switch', () => {
  it('shows one provider at a time on Work, and remembers the choice', () => {
    localStorage.clear()
    render(<WorkItemsView items={[adoItem, ghIssue()]} onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    expect(screen.getByRole('tab', { name: /Azure DevOps/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('ADO thing')).toBeTruthy()
    expect(screen.queryByText('Fix the login redirect')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /GitHub/ }))
    expect(screen.getByText('Fix the login redirect')).toBeTruthy()
    expect(screen.queryByText('ADO thing')).toBeNull()
    cleanup()
    render(<WorkItemsView items={[adoItem, ghIssue()]} onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    expect(screen.getByRole('tab', { name: /GitHub/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows no switch when there is only one provider', () => {
    localStorage.clear()
    render(<WorkItemsView items={[adoItem]} onOpen={() => {}} onCreate={() => {}} team={[]} device="phone"/>)
    expect(screen.queryByRole('tablist', { name: 'Source' })).toBeNull()
  })
})

import { stateChoices } from './view-workitems.jsx'

describe('changing an item\'s state', () => {
  const wi = { id: 5, type: 'bug', state: 'Active' }
  it('prefers the provider\'s own workflow for the item', () => {
    expect(stateChoices(wi, ['Active', 'Resolved'], { Bug: ['New'] }, ['x'])).toEqual(['Resolved'])
  })
  it('uses the type\'s workflow when the provider cannot say, matching the type case-insensitively', () => {
    expect(stateChoices(wi, null, { Bug: ['New', 'Active', 'Closed'], Task: ['To Do'] }, ['x'])).toEqual(['New', 'Closed'])
  })
  it('falls back to every state in use, never offering the current one', () => {
    expect(stateChoices(wi, null, {}, ['Active', 'Done', 'New', 'Done'])).toEqual(['Done', 'New'])
    expect(stateChoices(wi, [], undefined, [])).toEqual([])
  })
})
