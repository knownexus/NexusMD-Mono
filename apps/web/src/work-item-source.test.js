import { describe, it, expect, vi, afterEach } from 'vitest'
import { webWorkItemSource } from './work-item-source.js'
import { NexusMDData } from './data.js'

const ok = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

afterEach(() => { NexusMDData._adoMeta = null })

describe('webWorkItemSource', () => {
  it('moveToCategory resolves the real completed state and saves it through the proxy', async () => {
    NexusMDData._adoMeta = { typeStates: { Bug: ['New', 'Closed'] }, stateCategoryByName: { New: 'Proposed', Closed: 'Completed' } }
    global.fetch = vi.fn(async () => ok())
    const r = await webWorkItemSource.moveToCategory(12, 'Completed', { type: 'bug' })
    expect(r).toEqual({ state: 'Closed', stateCategory: 'Completed' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/workitems/12')
    expect(JSON.parse(opts.body)).toEqual([{ op: 'add', path: '/fields/System.State', value: 'Closed' }])
  })

  it('moveToCategory falls back to Done for Completed when there is no metadata', async () => {
    global.fetch = vi.fn(async () => ok())
    expect((await webWorkItemSource.moveToCategory(1, 'Completed', { type: 'bug' })).state).toBe('Done')
  })

  it('keeps the shared /api operations alongside the move', () => {
    for (const op of ['loadDetail', 'loadComments', 'saveField', 'addComment', 'loadRawFields']) {
      expect(typeof webWorkItemSource[op]).toBe('function')
    }
  })
})
