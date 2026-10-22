import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiWorkItemSource } from '../src/index.js'

afterEach(() => { vi.unstubAllGlobals() })

const failing = (status, body = {}) => vi.fn(async () => ({
  ok: false, status, statusText: 'Bad', json: async () => body, text: async () => 'server said no',
}))

// The failure contract documented in work-item-source.js, checked against the /api source.
describe('apiWorkItemSource failure contract', () => {
  it('loadDetail throws so the view can show the error', async () => {
    vi.stubGlobal('fetch', failing(502))
    await expect(apiWorkItemSource.loadDetail(1)).rejects.toThrow('HTTP 502')
  })

  it('loadComments resolves to [] instead of failing the item', async () => {
    vi.stubGlobal('fetch', failing(500))
    expect(await apiWorkItemSource.loadComments(1, 'P')).toEqual([])
  })

  it('saveField, addComment and loadRawFields throw', async () => {
    vi.stubGlobal('fetch', failing(400, { error: 'denied' }))
    await expect(apiWorkItemSource.saveField(1, 'System.Title', 'x')).rejects.toThrow('server said no')
    await expect(apiWorkItemSource.addComment(1, 'P', 'x')).rejects.toThrow('denied')
    await expect(apiWorkItemSource.loadRawFields(1)).rejects.toThrow('HTTP 400')
  })
})
