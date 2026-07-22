import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ado-client.js', () => ({
  createAdoHttpAdapter: vi.fn(),
  getAdoConfig: vi.fn(() => ({ org: 'myorg', pat: 'x', projects: [] })),
  isAdoConfigured: vi.fn(() => true),
}))

import { createAdoHttpAdapter } from './ado-client.js'
import { desktopBuildSource } from './desktop-build-source.js'

describe('desktopBuildSource.loadTimeline', () => {
  beforeEach(() => { createAdoHttpAdapter.mockReset() })

  it('fetches the ADO timeline endpoint and maps the response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ records: [{ name: 'Run tests', type: 'Task', result: 'failed', issues: [{ message: 'boom' }] }] }),
    }))
    createAdoHttpAdapter.mockReturnValue({ fetch: fetchMock })

    const result = await desktopBuildSource.loadTimeline('MyProject', 500)

    expect(fetchMock).toHaveBeenCalledWith('MyProject/_apis/build/builds/500/timeline?api-version=7.0')
    expect(result).toEqual({ failedRecords: [{ name: 'Run tests', type: 'Task', messages: ['boom'] }] })
  })

  it('url-encodes the project name', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ records: [] }) }))
    createAdoHttpAdapter.mockReturnValue({ fetch: fetchMock })

    await desktopBuildSource.loadTimeline('My Project', 500)

    expect(fetchMock).toHaveBeenCalledWith('My%20Project/_apis/build/builds/500/timeline?api-version=7.0')
  })

  it('throws with the HTTP status on a non-ok response', async () => {
    createAdoHttpAdapter.mockReturnValue({ fetch: vi.fn(async () => ({ ok: false, status: 404 })) })

    await expect(desktopBuildSource.loadTimeline('MyProject', 999)).rejects.toThrow('HTTP 404')
  })
})
