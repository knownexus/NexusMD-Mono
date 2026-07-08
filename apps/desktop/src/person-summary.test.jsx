import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NexusDataProvider } from '@nexusmd/ui'
import { PersonSummary } from './person-summary.jsx'

function renderPerson(dev, props = {}) {
  return render(
    <NexusDataProvider value={{}}>
      <PersonSummary dev={dev} onOpenItem={() => {}} onOpenPR={() => {}} {...props} />
    </NexusDataProvider>
  )
}

describe('PersonSummary', () => {
  afterEach(cleanup)

  const baseDev = {
    id: 'alice', name: 'Alice Ng', role: 'Dev', tz: 'UTC', focus: 'Onboarding',
    active: [{ id: 1, type: 'bug', title: 'Fix login redirect' }],
    blocked: [],
    myPRs: [{ id: 10, title: 'Add retry logic' }],
    points: 8,
  }

  it('renders identity info and the stats strip from the enriched dev object', () => {
    renderPerson(baseDev)
    expect(screen.getByText('Alice Ng')).toBeTruthy()
    expect(screen.getByText('Active work (1)')).toBeTruthy()
    expect(screen.getByText('Open PRs (1)')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('lists active work items and calls onOpenItem when a row is clicked', () => {
    const onOpenItem = vi.fn()
    renderPerson(baseDev, { onOpenItem })
    fireEvent.click(screen.getByText('Fix login redirect'))
    expect(onOpenItem).toHaveBeenCalledWith(baseDev.active[0])
  })

  it('lists open PRs and calls onOpenPR when a row is clicked', () => {
    const onOpenPR = vi.fn()
    renderPerson(baseDev, { onOpenPR })
    fireEvent.click(screen.getByText('Add retry logic'))
    expect(onOpenPR).toHaveBeenCalledWith(baseDev.myPRs[0])
  })

  it('shows a blocked-items callout when the person has blockers', () => {
    const dev = { ...baseDev, blocked: [{ id: 2, title: 'Waiting on infra' }] }
    renderPerson(dev)
    expect(screen.getByText('1 blocker')).toBeTruthy()
    expect(screen.getByText('· Waiting on infra')).toBeTruthy()
  })

  it('shows no blocked callout when there are no blockers', () => {
    renderPerson(baseDev)
    expect(screen.queryByText(/blocker/)).toBeNull()
  })

  it('shows empty states when there is no active work or open PRs', () => {
    renderPerson({ ...baseDev, active: [], myPRs: [] })
    expect(screen.getByText('No active work items.')).toBeTruthy()
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })
})
