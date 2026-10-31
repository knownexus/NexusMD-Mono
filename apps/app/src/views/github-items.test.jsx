import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

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
