import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NexusDataProvider } from '@nexusmd/ui'
import { PersonSummary, PersonActions } from './person-summary.jsx'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderPerson(dev, { storage = memStorage(), ...props } = {}) {
  return render(
    <NexusDataProvider value={{ storage }}>
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

  it('renders existing notes for this person from storage', () => {
    const storage = memStorage({
      'nexusmd.team.notes': JSON.stringify([
        { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
        { id: 'tn2', devId: 'bob', person: 'Bob', note: 'Not for Alice', date: '2026-07-01T00:00:00Z' },
      ]),
    })
    renderPerson(baseDev, { storage })
    expect(screen.getByText('Notes (1)')).toBeTruthy()
    expect(screen.getByText('Great work on the API')).toBeTruthy()
    expect(screen.queryByText('Not for Alice')).toBeNull()
  })

  it('shows an empty state when there are no notes', () => {
    renderPerson(baseDev)
    expect(screen.getByText('No notes yet.')).toBeTruthy()
  })

  it('refreshes its notes list when nexusmd:team-notes-changed fires', () => {
    const storage = memStorage()
    renderPerson(baseDev, { storage })
    expect(screen.getByText('No notes yet.')).toBeTruthy()

    storage.setItem('nexusmd.team.notes', JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Added later', date: '2026-07-02T00:00:00Z' },
    ]))
    fireEvent(window, new CustomEvent('nexusmd:team-notes-changed'))

    expect(screen.getByText('Added later')).toBeTruthy()
  })

  it('dispatches nexusmd:team-delete-note with the note id when delete is clicked', () => {
    const storage = memStorage({
      'nexusmd.team.notes': JSON.stringify([
        { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
      ]),
    })
    renderPerson(baseDev, { storage })
    const onDelete = vi.fn()
    window.addEventListener('nexusmd:team-delete-note', onDelete)

    fireEvent.click(screen.getByTitle('Delete note'))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0][0].detail).toEqual({ noteId: 'tn1' })
    window.removeEventListener('nexusmd:team-delete-note', onDelete)
  })

  it('shows ADO ids as #123 and Jira items by their key', () => {
    renderPerson({
      ...baseDev,
      active: [
        { id: 123, type: 'bug', title: 'ADO bug' },
        { id: 'jira:ABC-12', type: 'story', title: 'Jira story' },
        { id: 'jira:ABC-13', displayId: 'ABC-13', type: 'story', title: 'Merged Jira story' },
      ],
    })
    expect(screen.getByText('#123')).toBeTruthy()
    expect(screen.getByText('ABC-12')).toBeTruthy()
    expect(screen.getByText('ABC-13')).toBeTruthy()
    expect(screen.queryByText(/#jira:/)).toBeNull()
  })
})

describe('PersonActions', () => {
  afterEach(cleanup)
  const dev = { id: 'alice', name: 'Alice Ng' }

  it('dispatches nexusmd:team-schedule-1on1 with the person id/name when Schedule 1:1 is clicked', () => {
    render(<PersonActions dev={dev} />)
    const onSchedule = vi.fn()
    window.addEventListener('nexusmd:team-schedule-1on1', onSchedule)

    fireEvent.click(screen.getByText('Schedule 1:1'))

    expect(onSchedule.mock.calls[0][0].detail).toEqual({ id: 'alice', name: 'Alice Ng' })
    window.removeEventListener('nexusmd:team-schedule-1on1', onSchedule)
  })

  it('dispatches nexusmd:team-add-note with the person id/name when Add note is clicked', () => {
    render(<PersonActions dev={dev} />)
    const onAdd = vi.fn()
    window.addEventListener('nexusmd:team-add-note', onAdd)

    fireEvent.click(screen.getByText('Add note'))

    expect(onAdd.mock.calls[0][0].detail).toEqual({ id: 'alice', name: 'Alice Ng' })
    window.removeEventListener('nexusmd:team-add-note', onAdd)
  })
})
