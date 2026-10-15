import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiBuildSource } from '../src/views/build-source.js'

describe('apiBuildSource.loadTimeline', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches the ADO timeline through the proxy and maps its failed records', async () => {
    const raw = { records: [
      { name: 'Build', type: 'Stage', result: 'failed', issues: [{ message: 'boom' }] },
      { name: 'Test', type: 'Stage', result: 'succeeded' },
    ] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => raw })))
    const result = await apiBuildSource.loadTimeline('my proj', 42)
    expect(result).toEqual({ failedRecords: [{ name: 'Build', type: 'Stage', messages: ['boom'] }] })
    expect(fetch).toHaveBeenCalledWith('/api/ado/my%20proj/_apis/build/builds/42/timeline?api-version=7.0')
  })

  it('returns an empty failedRecords array on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [] })
  })

  it('returns an empty failedRecords array if fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [] })
  })
})
