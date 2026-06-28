import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView, TestsView, BuildsView, TeamView } from '../src/index.js'

afterEach(cleanup)

// In-memory storage so usePersisted has a deterministic backing store in jsdom.
function memStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

function renderWithData(ui, data = {}) {
  const value = {
    data: {
      TEAM: [{ id: 'alice', name: 'Alice Ng', initials: 'AN', role: 'Dev', tz: 'UTC', status: 'online', focus: '' }],
      ME: { id: 'me', name: 'Me', initials: 'ME' },
      ORG: 'contoso', CONFIG_PROJECTS: ['Proj'], PROJECTS: [],
      WORK_ITEMS: [], PRS: [], BUILDS: [], TESTS: [],
      ...data,
    },
    api: { load: () => Promise.resolve() },
    storage: memStorage(),
    getProfileKey: (k) => k,
    pushPref: () => {},
  }
  return render(<NexusDataProvider value={value}>{ui}</NexusDataProvider>)
}

describe('shared views render through the data-context seam', () => {
  it('PRView shows its header and an author-grouped PR', () => {
    const prs = [{
      id: 1, title: 'Fix login', author: 'alice', authorName: 'Alice', status: 'active',
      branch: 'fix/login', age: '2d', additions: 3, deletions: 1, reviewerDetails: [], linkedWorkItems: [],
    }]
    const { container } = renderWithData(
      <PRView prs={prs} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />,
      { PRS: prs },
    )
    expect(container.querySelector('.page-head h1')?.textContent).toBe('Pull requests')
    // Summary line is derived from the prop list regardless of the active filter.
    expect(container.querySelector('.page-head .sub')?.textContent).toContain('1 active')
  })

  it('TestsView renders totals and a run row with a deep link to the org', () => {
    const tests = [{
      id: 't1', pipeline: 'CI', project: 'Proj', result: 'succeeded',
      totalTests: 10, passedTests: 10, failedTests: 0, startTime: '2026-01-01', branch: 'main',
    }]
    const { container } = renderWithData(
      <TestsView tests={tests} acknowledgedTests={[]} setAcknowledgedTests={() => {}} />,
    )
    expect(container.querySelector('.page-head h1')?.textContent).toBe('Tests')
    const link = container.querySelector('a[href*="dev.azure.com/contoso"]')
    expect(link).toBeTruthy()
  })

  it('BuildsView groups builds by pipeline and counts passing', () => {
    const builds = [
      { id: 'b1', pipeline: 'API', status: 'success', branch: 'main', project: 'Proj', definitionId: 5, when: 'now', finishTime: '2026-01-02' },
      { id: 'b2', pipeline: 'API', status: 'failed',  branch: 'main', project: 'Proj', definitionId: 5, when: 'now', finishTime: '2026-01-01' },
    ]
    const { container } = renderWithData(
      <BuildsView builds={builds} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />,
    )
    expect(container.querySelector('.page-head h1')?.textContent).toBe('Builds')
    expect(container.textContent).toContain('1 passing')
  })

  it('TeamView lists members and opens the add-member modal', () => {
    const team = [{ id: 'alice', name: 'Alice Ng', initials: 'AN', role: 'Dev', tz: 'UTC', status: 'online', focus: '' }]
    const onTeamChange = vi.fn()
    const { container, getByText } = renderWithData(
      <TeamView team={team} workItems={[]} prs={[]} onOpenItem={() => {}} onOpenPerson={() => {}} onTeamChange={onTeamChange} />,
    )
    expect(container.querySelector('.page-head h1')?.textContent).toBe('Team')
    expect(container.textContent).toContain('Alice Ng')
    // membership effect syncs back to the host
    expect(onTeamChange).toHaveBeenCalled()
    fireEvent.click(getByText('Add member'))
    expect(container.querySelector('#modal-add-member')).toBeTruthy()
  })
})
