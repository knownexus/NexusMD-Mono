import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildDetail } from '../src/index.js'

afterEach(cleanup)

const successBuild = {
  id: 1, project: 'proj-a', pipeline: 'API', status: 'success',
  duration: '1m 30s', actor: 'alice', commit: 'abc1234',
  finishTime: '2026-01-02T10:00:00Z', branch: 'main', reason: 'manual', failureReason: null,
}

const failedBuild = { ...successBuild, id: 2, status: 'failed', failureReason: 'Step "test" failed' }

describe('BuildDetail', () => {
  it('renders static metadata for a successful build without fetching a timeline', () => {
    const loadTimeline = vi.fn()
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={successBuild} />
      </NexusDataProvider>,
    )
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('abc1234')).toBeTruthy()
    expect(screen.getByText('1m 30s')).toBeTruthy()
    expect(loadTimeline).not.toHaveBeenCalled()
    expect(screen.queryByText('Errors')).toBeNull()
  })

  it('fetches and renders failed timeline records for a failed build', async () => {
    const loadTimeline = vi.fn(async () => ({
      failedRecords: [{ name: 'Run tests', type: 'Task', messages: ['Test suite exited with code 1'] }],
    }))
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={failedBuild} />
      </NexusDataProvider>,
    )
    expect(loadTimeline).toHaveBeenCalledWith('proj-a', 2, failedBuild)
    await waitFor(() => expect(screen.getByText('Run tests')).toBeTruthy())
    expect(screen.getByText('Test suite exited with code 1')).toBeTruthy()
  })

  it('shows an error line if the timeline fetch rejects', async () => {
    const loadTimeline = vi.fn(async () => { throw new Error('ADO unreachable') })
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={failedBuild} />
      </NexusDataProvider>,
    )
    await waitFor(() => expect(screen.getByText('ADO unreachable')).toBeTruthy())
  })

  it('shows an empty state when a cancelled build has no failed records', async () => {
    const loadTimeline = vi.fn(async () => ({ failedRecords: [] }))
    render(
      <NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}>
        <BuildDetail build={{ ...successBuild, id: 3, status: 'cancelled' }} />
      </NexusDataProvider>,
    )
    await waitFor(() => expect(screen.getByText('No failure details available.')).toBeTruthy())
  })
})
