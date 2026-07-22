import { it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const BUILD = { id: 'b1', pipeline: 'API', status: 'success', branch: 'main', project: 'Proj', definitionId: 5, commit: 'abc1234', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' }

afterEach(cleanup)

it('omits the Commit column when hidden by config', () => {
  const storage = memStorage({ 'nexusmd.fields.buildsTable': JSON.stringify([{ key: 'commit', visible: false }]) })
  const { queryAllByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>
  )
  expect(queryAllByText('Commit').length).toBe(0)
})

it('shows the Commit column by default', () => {
  const storage = memStorage({})
  const { queryAllByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>
  )
  expect(queryAllByText('Commit').length).toBeGreaterThanOrEqual(1)
})

it('shows the build\'s project as a ProjectChip by default', () => {
  const storage = memStorage({})
  const projects = [{ id: 'Proj', name: 'Cirrus', color: '#123456' }]
  const { getAllByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS: projects } }}>
      <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>
  )
  expect(getAllByText('Cirrus').length).toBeGreaterThanOrEqual(1)
})

it('omits the Project column when hidden by config', () => {
  const storage = memStorage({ 'nexusmd.fields.buildsTable': JSON.stringify([{ key: 'project', visible: false }]) })
  const projects = [{ id: 'Proj', name: 'Cirrus', color: '#123456' }]
  const { queryByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS: projects } }}>
      <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>
  )
  expect(queryByText('Cirrus')).toBeNull()
})
