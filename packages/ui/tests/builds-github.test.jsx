import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView, BuildDetail } from '../src/index.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const RUN = {
  id: 9001, pipeline: 'CI', status: 'failed', branch: 'feature/x', project: 'acme-web', projectName: 'acme/web', definitionId: 77,
  commit: 'abc1234', reason: 'push', duration: '2m 5s', when: 'now', finishTime: '2026-01-02T10:00:00', actor: 'octo',
  url: 'https://github.com/acme/web/actions/runs/9001', source: 'github',
}
const RUNNING = { ...RUN, id: 9002, status: 'running', url: 'https://github.com/acme/web/actions/runs/9002' }

const renderBuilds = (builds) => render(
  <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS: [{ id: 'acme-web', name: 'acme/web', color: '#111' }] } }}>
    <BuildsView builds={builds} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
  </NexusDataProvider>,
)

it('shows an Actions run with its workflow, branch and status, linking to GitHub rather than ADO', () => {
  const { container } = renderBuilds([RUN])
  expect(screen.getByText('CI')).toBeTruthy()
  expect(screen.getByText('feature/x')).toBeTruthy()
  expect(container.querySelector('.build-dot.failed')).toBeTruthy()
  const link = screen.getByRole('link', { name: '#9001' })
  expect(link.getAttribute('href')).toBe('https://github.com/acme/web/actions/runs/9001')
  expect(container.innerHTML).not.toContain('dev.azure.com')
})

it('offers no ADO rerun or cancel for Actions runs', () => {
  renderBuilds([RUN, RUNNING])
  expect(screen.queryByRole('button', { name: /Rerun/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull()
})

it('BuildDetail hands the build to the source when loading the timeline', async () => {
  const buildSource = { loadTimeline: vi.fn(async () => ({ failedRecords: [] })) }
  render(
    <NexusDataProvider value={{ data: {}, buildSource }}>
      <BuildDetail build={RUN} />
    </NexusDataProvider>,
  )
  await waitFor(() => expect(buildSource.loadTimeline).toHaveBeenCalledWith('acme/web', 9001, RUN))
})
