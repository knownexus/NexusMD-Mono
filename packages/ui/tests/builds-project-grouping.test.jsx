import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView } from '../src/index.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const BUILDS = [
  { id: 1, pipeline: 'API', status: 'success', branch: 'main', project: 'proj-a', definitionId: 5, commit: 'abc1234', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' },
  { id: 2, pipeline: 'Web', status: 'success', branch: 'main', project: 'proj-b', definitionId: 6, commit: 'def5678', reason: 'manual', duration: '2m', when: 'now', finishTime: '2026-01-02T11:00:00' },
]

const PROJECTS = [
  { id: 'proj-a', name: 'Project A', color: '#111111' },
  { id: 'proj-b', name: 'Project B', color: '#222222' },
]

function renderBuilds(props = {}) {
  return render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS } }}>
      <BuildsView builds={BUILDS} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} {...props} />
    </NexusDataProvider>,
  )
}

it('groups builds by project, then by pipeline within each project', () => {
  const { getAllByText, getByText } = renderBuilds()
  expect(getAllByText('Project A').length).toBe(2)
  expect(getAllByText('Project B').length).toBe(2)
  expect(getByText('API')).toBeTruthy()
  expect(getByText('Web')).toBeTruthy()
})

it('toggles pipeline visibility independently for two projects sharing a pipeline name', () => {
  const sharedNameBuilds = [
    { id: 1, pipeline: 'API', status: 'success', branch: 'main', project: 'proj-a', definitionId: 5, commit: 'aaa1111', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' },
    { id: 2, pipeline: 'API', status: 'success', branch: 'main', project: 'proj-b', definitionId: 6, commit: 'bbb2222', reason: 'manual', duration: '2m', when: 'now', finishTime: '2026-01-02T11:00:00' },
  ]
  const { getByText, queryByText, container } = render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', PROJECTS } }}>
      <BuildsView builds={sharedNameBuilds} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>,
  )
  fireEvent.click(getByText('Pipelines'))
  const checkboxes = container.querySelectorAll('input[type="checkbox"]')
  expect(checkboxes.length).toBe(2)
  fireEvent.click(checkboxes[0])
  expect(queryByText('aaa1111')).toBeNull()
  expect(getByText('bbb2222')).toBeTruthy()
})

it('calls onOpenBuild with the clicked build', () => {
  const onOpenBuild = vi.fn()
  const { getByText } = renderBuilds({ onOpenBuild })
  const row = getByText('abc1234').closest('.build-row')
  fireEvent.click(row)
  expect(onOpenBuild).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

it('collapsing a project group hides its pipeline groups and build rows', () => {
  const { getAllByText, getByText, queryByText } = renderBuilds()
  fireEvent.click(getAllByText('Project A')[0])
  expect(queryByText('API')).toBeNull()
  expect(queryByText('abc1234')).toBeNull()
  expect(getByText('Web')).toBeTruthy()
})

it('does not throw when onOpenBuild is not provided', () => {
  const { getByText } = renderBuilds()
  const row = getByText('abc1234').closest('.build-row')
  expect(() => fireEvent.click(row)).not.toThrow()
})
