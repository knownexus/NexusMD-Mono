import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PersonSummary } from './person-summary.jsx'

describe('PersonSummary', () => {
  afterEach(cleanup)

  const dev = { id: 'alice', name: 'Alice Ng', role: 'Dev', tz: 'UTC', focus: 'Onboarding' }

  it('renders identity info and active (non-terminal) work items assigned to this person', () => {
    const workItems = [
      { id: 1, assignee: 'alice', state: 'Active', title: 'Fix login redirect', type: 'bug' },
      { id: 2, assignee: 'alice', state: 'Done', title: 'Old finished task', type: 'task' },
      { id: 3, assignee: 'bob', state: 'Active', title: "Not Alice's", type: 'task' },
    ]
    render(<PersonSummary dev={dev} workItems={workItems} prs={[]} />)
    expect(screen.getByText('Alice Ng')).toBeTruthy()
    expect(screen.getByText('Active work (1)')).toBeTruthy()
    expect(screen.getByText('Fix login redirect')).toBeTruthy()
    expect(screen.queryByText('Old finished task')).toBeNull()
    expect(screen.queryByText("Not Alice's")).toBeNull()
  })

  it('renders open PRs authored by this person', () => {
    const prs = [
      { id: 10, author: 'alice', title: 'Add retry logic' },
      { id: 11, author: 'bob', title: "Not Alice's PR" },
    ]
    render(<PersonSummary dev={dev} workItems={[]} prs={prs} />)
    expect(screen.getByText('Open PRs (1)')).toBeTruthy()
    expect(screen.getByText('Add retry logic')).toBeTruthy()
    expect(screen.queryByText("Not Alice's PR")).toBeNull()
  })

  it('shows empty states when there is no active work or PRs', () => {
    render(<PersonSummary dev={dev} workItems={[]} prs={[]} />)
    expect(screen.getByText('No active work items.')).toBeTruthy()
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })
})
