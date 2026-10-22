import { describe, it, expect, vi } from 'vitest'
import { makeAdoWorkItemSource, adoMoveToCategory, adoWorkItemUrl } from '../src/index.js'

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

describe('makeAdoWorkItemSource', () => {
  it('loadDetail maps the rich-text fields and nulls the missing ones', async () => {
    const http = { fetch: vi.fn(async () => res({ fields: { 'System.Description': '<p>d</p>' } })) }
    const src = makeAdoWorkItemSource({ http })
    expect(await src.loadDetail(7)).toEqual({ description: '<p>d</p>', acceptanceCriteria: null, reproSteps: null })
    expect(http.fetch).toHaveBeenCalledWith('_apis/wit/workitems/7?$expand=all&api-version=7.0')
  })

  it('loadDetail and loadRawFields throw on HTTP errors', async () => {
    const src = makeAdoWorkItemSource({ http: { fetch: async () => res({}, 404) } })
    await expect(src.loadDetail(1)).rejects.toThrow('HTTP 404')
    await expect(src.loadRawFields(1)).rejects.toThrow('HTTP 404')
  })

  it('loadComments uses the default project, maps comments, and returns [] on failure or no project', async () => {
    const http = { fetch: vi.fn(async () => res({ comments: [{ id: 1, createdBy: { displayName: 'Ada' }, renderedText: 'hi', createdDate: 'd' }] })) }
    const src = makeAdoWorkItemSource({ http, getDefaultProject: () => 'My Proj' })
    expect(await src.loadComments(5)).toEqual([{ id: 1, author: 'Ada', text: 'hi', createdDate: 'd' }])
    expect(http.fetch).toHaveBeenCalledWith('My%20Proj/_apis/wit/workitems/5/comments?api-version=7.1-preview.3')
    expect(await makeAdoWorkItemSource({ http }).loadComments(5)).toEqual([])
    expect(await makeAdoWorkItemSource({ http: { fetch: async () => res({}, 500) }, getDefaultProject: () => 'P' }).loadComments(5)).toEqual([])
  })

  it('saveField sends a json-patch add op and throws on failure', async () => {
    const http = { fetch: vi.fn(async () => res({})) }
    await makeAdoWorkItemSource({ http }).saveField(3, 'System.Title', 'New')
    const [path, opts] = http.fetch.mock.calls[0]
    expect(path).toBe('_apis/wit/workitems/3?api-version=7.0')
    expect(opts.method).toBe('PATCH')
    expect(opts.headers['Content-Type']).toBe('application/json-patch+json')
    expect(JSON.parse(opts.body)).toEqual([{ op: 'add', path: '/fields/System.Title', value: 'New' }])
    await expect(makeAdoWorkItemSource({ http: { fetch: async () => res({}, 400) } }).saveField(3, 'x', 'y')).rejects.toThrow('HTTP 400')
  })

  it('addComment posts the comment and returns the normalised result', async () => {
    const http = { fetch: vi.fn(async () => res({ id: 9, createdBy: { displayName: 'Ada' }, createdDate: 'now' })) }
    const out = await makeAdoWorkItemSource({ http }).addComment(4, 'P', '<b>x</b>')
    expect(out).toEqual({ id: 9, author: 'Ada', text: '<b>x</b>', createdDate: 'now' })
    expect(JSON.parse(http.fetch.mock.calls[0][1].body)).toEqual({ comments: [{ parentCommentId: 0, content: '<b>x</b>', commentType: 1 }], status: 1 })
  })

  it('addComment throws with the server error or the status', async () => {
    const withError = makeAdoWorkItemSource({ http: { fetch: async () => res({ error: 'denied' }, 403) } })
    await expect(withError.addComment(1, 'P', 'x')).rejects.toThrow('denied')
    const bare = makeAdoWorkItemSource({ http: { fetch: async () => ({ ok: false, status: 500, json: async () => { throw new Error('no body') } }) } })
    await expect(bare.addComment(1, 'P', 'x')).rejects.toThrow('HTTP 500')
  })

  it('moveToCategory saves the resolved state through saveField', async () => {
    const http = { fetch: vi.fn(async () => res({})) }
    const meta = { typeStates: { Bug: ['New', 'Closed'] }, stateCategoryByName: { New: 'Proposed', Closed: 'Completed' } }
    const src = makeAdoWorkItemSource({ http, loadProcessMeta: () => meta })
    expect(await src.moveToCategory(8, 'Completed', { type: 'bug' })).toEqual({ state: 'Closed', stateCategory: 'Completed' })
    expect(JSON.parse(http.fetch.mock.calls[0][1].body)[0]).toMatchObject({ path: '/fields/System.State', value: 'Closed' })
  })

  it('webUrl uses the configured org; createWorkItem is only present when supplied', async () => {
    const create = vi.fn(async () => ({ id: 1, warnings: [] }))
    const src = makeAdoWorkItemSource({ http: {}, getOrg: () => 'acme', createWorkItem: create })
    expect(src.webUrl({ id: 2, project: 'web' })).toBe('https://dev.azure.com/acme/Web/_workitems/edit/2')
    await src.createWorkItem({ a: 1 })
    expect(create).toHaveBeenCalledWith({ a: 1 })
    expect(makeAdoWorkItemSource({ http: {} }).createWorkItem).toBeUndefined()
  })
})

describe('adoMoveToCategory', () => {
  const meta = { typeStates: { Bug: ['New', 'Active', 'Closed'] }, stateCategoryByName: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' } }
  it('saves the first state in the category for the item type', async () => {
    const saveState = vi.fn(async () => {})
    expect(await adoMoveToCategory({ item: { type: 'bug' }, category: 'Completed', meta, saveState })).toEqual({ state: 'Closed', stateCategory: 'Completed' })
    expect(saveState).toHaveBeenCalledWith('Closed')
  })
  it('falls back to "Done" for Completed when metadata is missing', async () => {
    const saveState = vi.fn(async () => {})
    expect(await adoMoveToCategory({ item: { type: 'bug' }, category: 'Completed', meta: {}, saveState })).toEqual({ state: 'Done', stateCategory: 'Completed' })
  })
  it('throws when no state fits', async () => {
    await expect(adoMoveToCategory({ item: { type: 'bug' }, category: 'Resolved', meta, saveState: vi.fn() }))
      .rejects.toThrow('No Resolved state for bug in ADO')
  })
})

describe('adoWorkItemUrl', () => {
  it('title-cases the project and encodes it', () => {
    expect(adoWorkItemUrl('org', { id: 1, project: 'my-proj-web' })).toBe('https://dev.azure.com/org/My%20Proj%20Web/_workitems/edit/1')
  })
  it('returns null without org or project', () => {
    expect(adoWorkItemUrl('', { id: 1, project: 'p' })).toBeNull()
    expect(adoWorkItemUrl('org', { id: 1 })).toBeNull()
    expect(adoWorkItemUrl('org', null)).toBeNull()
  })
})

