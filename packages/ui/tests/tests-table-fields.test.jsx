import { it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, TestsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const RUN = { id: 't1', pipeline: 'CI', project: 'Proj', result: 'succeeded', totalTests: 3, passedTests: 3, failedTests: 0, startTime: '2026-01-01T09:00:00', branch: 'main', duration: '30s', when: 'now' }

afterEach(cleanup)

it('hides the duration cell when config hides it', () => {
  const storage = memStorage({ 'nexusmd.fields.testsTable': JSON.stringify([{ key: 'duration', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <TestsView tests={[RUN]} acknowledgedTests={[]} setAcknowledgedTests={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).not.toContain('30s')
})

it('shows the duration cell when config is empty (positive control)', () => {
  const storage = memStorage({})
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <TestsView tests={[RUN]} acknowledgedTests={[]} setAcknowledgedTests={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).toContain('30s')
})
