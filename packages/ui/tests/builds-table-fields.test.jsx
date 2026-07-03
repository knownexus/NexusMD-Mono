import { describe, it, expect, afterEach } from 'vitest'
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
