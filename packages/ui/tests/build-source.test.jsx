import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiBuildSource } from '../src/views/build-source.js'

describe('apiBuildSource.loadTimeline', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the parsed JSON body on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ failedRecords: [{ name: 'Build', type: 'Stage', messages: ['boom'] }] }) })))
    const result = await apiBuildSource.loadTimeline('proj', 42)
    expect(result).toEqual({ failedRecords: [{ name: 'Build', type: 'Stage', messages: ['boom'] }] })
    expect(fetch).toHaveBeenCalledWith('/api/builds/42/timeline?project=proj')
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
