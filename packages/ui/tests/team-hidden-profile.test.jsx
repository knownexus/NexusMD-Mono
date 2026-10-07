import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, TeamView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }
}
const TEAM = [
  { id: 'alice', name: 'Alice Ng', initials: 'AN', role: 'Dev', tz: 'UTC', status: 'online', focus: '' },
  { id: 'bob', name: 'Bob Ray', initials: 'BR', role: 'Dev', tz: 'UTC', status: 'online', focus: '' },
]

function renderTeam(storage, { onTeamChange = () => {}, pushPref = () => {} } = {}) {
  const value = { data: { ORG: 'o', TEAM, PROJECTS: [] }, storage, getProfileKey: k => 'p1.' + k, pushPref }
  return render(
    <NexusDataProvider value={value}>
      <TeamView team={TEAM} workItems={[]} prs={[]} onOpenItem={() => {}} onOpenPerson={() => {}} onTeamChange={onTeamChange} />
    </NexusDataProvider>
  )
}

afterEach(cleanup)

it('reads the hidden list from the profile-scoped key and ignores the bare key', () => {
  const storage = memStorage({
    'nexusmd.team.removed': JSON.stringify(['bob']),
    'p1.nexusmd.team.removed': JSON.stringify(['alice']),
  })
  const onTeamChange = vi.fn()
  const { getByText } = renderTeam(storage, { onTeamChange })
  expect(getByText('1 hidden')).toBeTruthy()
  expect(onTeamChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'bob' })])
})

it('a bare hidden list does not leak into the profile', () => {
  const storage = memStorage({ 'nexusmd.team.removed': JSON.stringify(['alice', 'bob']) })
  const onTeamChange = vi.fn()
  const { queryByText } = renderTeam(storage, { onTeamChange })
  expect(queryByText(/hidden$/)).toBeNull()
  expect(onTeamChange.mock.lastCall[0].map(m => m.id)).toEqual(['alice', 'bob'])
})

it('writes restores to the profile-scoped key and pushes the unscoped pref name', () => {
  const storage = memStorage({ 'p1.nexusmd.team.removed': JSON.stringify(['alice']) })
  const pushPref = vi.fn()
  const { getByText } = renderTeam(storage, { pushPref })
  fireEvent.click(getByText('1 hidden'))
  fireEvent.click(getByText('Restore'))
  expect(JSON.parse(storage.getItem('p1.nexusmd.team.removed'))).toEqual([])
  expect(storage.getItem('nexusmd.team.removed')).toBeNull()
  expect(pushPref).toHaveBeenCalledWith('nexusmd.team.removed', '[]')
})
