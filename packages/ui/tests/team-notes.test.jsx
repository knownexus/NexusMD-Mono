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
