import { describe, it, expect, vi, beforeEach } from 'vitest'

// No native plugin in jsdom: fall back to fetch, as the browser dev build does.
vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { saveAdoConfig } from './ado-client.js'
import { adoWorkItemSource } from './work-item-source.js'
import { HelmData } from './data.jsx'

const ok = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

beforeEach(() => {
  saveAdoConfig({ org: 'acme', pat: 'p', projects: ['P'] })
  HelmData._adoMeta = null
})

describe('adoWorkItemSource', () => {
  it('moveToCategory resolves the real completed state and PATCHes it to ADO', async () => {
    HelmData._adoMeta = { typeStates: { Bug: ['New', 'Closed'] }, stateCategoryByName: { New: 'Proposed', Closed: 'Completed' } }
    global.fetch = vi.fn(async () => ok())
    const r = await adoWorkItemSource.moveToCategory(12, 'Completed', { type: 'bug' })
    expect(r).toEqual({ state: 'Closed', stateCategory: 'Completed' })
    const [url, opts] = global.fetch.mock.calls.find(c => c[1]?.method === 'PATCH')
    expect(url).toContain('dev.azure.com/acme/_apis/wit/workitems/12')
    expect(JSON.parse(opts.body)).toEqual([{ op: 'add', path: '/fields/System.State', value: 'Closed' }])
  })

  it('follows the failure contract: comments resolve [], everything else throws', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect(await adoWorkItemSource.loadComments(1, 'P')).toEqual([])
    await expect(adoWorkItemSource.loadDetail(1)).rejects.toThrow('ADO 500')
    await expect(adoWorkItemSource.saveField(1, 'System.Title', 'x')).rejects.toThrow('ADO 500')
  })
})
