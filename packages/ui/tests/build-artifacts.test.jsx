import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildDetail } from '../src/index.js'

afterEach(cleanup)

const build = {
  id: 5, project: 'proj-a', pipeline: 'API', status: 'success', duration: '1m', actor: 'alice',
  commit: 'abc1234', finishTime: '2026-01-02T10:00:00Z', branch: 'main', reason: 'manual',
}
const ITEMS = [
  { provider: 'ado', name: 'drop', size: 2048, url: 'https://dev.azure.com/a/1', filename: 'drop.zip', expired: false },
  { provider: 'ado', name: 'old', size: 1, url: 'https://dev.azure.com/a/2', filename: 'old.zip', expired: true },
]
const loadTimeline = vi.fn(async () => ({ failedRecords: [] }))

describe('BuildDetail artifacts', () => {
  it('shows no artifacts section when the platform can\'t save them (web)', () => {
    render(<NexusDataProvider value={{ data: {}, buildSource: { loadTimeline } }}><BuildDetail build={build} /></NexusDataProvider>)
    expect(screen.queryByText('Artifacts')).toBeNull()
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
  })

  it('lists the build\'s artifacts and saves one through the injected capability', async () => {
    const buildArtifacts = { list: vi.fn(async () => ITEMS), save: vi.fn(async () => ({ saved: true, path: 'C:\\d\\drop.zip' })) }
    render(<NexusDataProvider value={{ data: {}, buildSource: { loadTimeline }, buildArtifacts }}><BuildDetail build={build} /></NexusDataProvider>)
    expect(await screen.findByText('drop')).toBeTruthy()
    expect(buildArtifacts.list).toHaveBeenCalledWith(build)
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
    const [dl, expired] = screen.getAllByRole('button', { name: /download/i })
    expect(expired.disabled).toBe(true)
    fireEvent.click(dl)
    await waitFor(() => expect(buildArtifacts.save).toHaveBeenCalledWith(ITEMS[0]))
  })

  it('says so when the build published none, or the listing failed', async () => {
    const empty = { list: vi.fn(async () => []), save: vi.fn() }
    render(<NexusDataProvider value={{ data: {}, buildSource: { loadTimeline }, buildArtifacts: empty }}><BuildDetail build={build} /></NexusDataProvider>)
    expect(await screen.findByText('This build published no artifacts.')).toBeTruthy()
    cleanup()
    const failing = { list: vi.fn(async () => { throw new Error('Azure DevOps answered 403') }), save: vi.fn() }
    render(<NexusDataProvider value={{ data: {}, buildSource: { loadTimeline }, buildArtifacts: failing }}><BuildDetail build={build} /></NexusDataProvider>)
    expect(await screen.findByText('Azure DevOps answered 403')).toBeTruthy()
  })
})
