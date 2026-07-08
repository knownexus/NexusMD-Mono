import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, TeamView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }
}
const TEAM = [{ id: 'alice', name: 'Alice Ng', initials: 'AN', role: 'Dev', tz: 'UTC', status: 'online', focus: '' }]

function renderTeam(storage) {
  const value = { data: { ORG: 'o', TEAM, PROJECTS: [] }, storage, getProfileKey: k => k, pushPref: () => {} }
  return render(
    <NexusDataProvider value={value}>
      <TeamView team={TEAM} workItems={[]} prs={[]} onOpenItem={() => {}} onOpenPerson={() => {}} onTeamChange={() => {}} />
    </NexusDataProvider>
  )
}

afterEach(cleanup)

it('renders persisted team notes on the member card', () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  const { container } = renderTeam(storage)
  expect(container.textContent).toContain('Great work on the API')
})

it('adds a note that persists to storage and shows on the card', async () => {
  const storage = memStorage()
  const { getByText, getByPlaceholderText, container } = renderTeam(storage)

  fireEvent.click(getByText('Note'))                       // open the note modal from the card
  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'Pairing on the migration' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => expect(container.textContent).toContain('Pairing on the migration'))
  const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ devId: 'alice', person: 'Alice Ng', note: 'Pairing on the migration' })
})

it('opens the add-note modal when nexusmd:team-add-note fires', async () => {
  const storage = memStorage()
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-add-note', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Add note — Alice Ng')).toBeTruthy()

  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'From the drawer' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ devId: 'alice', note: 'From the drawer' })
  })
})

it('opens the schedule-1:1 modal when nexusmd:team-schedule-1on1 fires', () => {
  const storage = memStorage()
  const { getByText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-schedule-1on1', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Schedule 1:1 — Alice Ng')).toBeTruthy()
})

it('deletes a note when nexusmd:team-delete-note fires', async () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-delete-note', { detail: { noteId: 'tn1' } }))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(0)
  })
})

it('broadcasts nexusmd:team-notes-changed after adding a note', async () => {
  const storage = memStorage()
  const onChanged = vi.fn()
  window.addEventListener('nexusmd:team-notes-changed', onChanged)
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent.click(getByText('Note'))
  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'Pairing' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  window.removeEventListener('nexusmd:team-notes-changed', onChanged)
})
