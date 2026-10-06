import { describe, it, expect, vi } from 'vitest'
import { JIRA_CACHE_KEY, ADO_CACHE_KEY, WORK_ITEM_STATUS_KEY } from '@nexusmd/core'
import { buildSnapshot, refreshProviders, adoMoveToCategory, defaultCreateProvider, adoWorkItemUrl } from './work-item-data.js'

function storage(seed = {}) {
  const s = { ...seed }
  return { get: k => s[k] ?? null, set: (k, v) => { s[k] = v }, _s: s }
}
const EMPTY = { WORK_ITEMS: [], TEAM: [], PRS: [] }

describe('buildSnapshot', () => {
  it('merges the ADO and Jira caches over the empty shape, keeping ADO-only fields', () => {
    const st = storage({
      [ADO_CACHE_KEY]: { ORG: 'o', WORK_ITEMS: [{ id: 1, state: 'Active' }], PRS: [{ id: 9 }], TEAM: [] },
      [JIRA_CACHE_KEY]: { SITE: 'https://a.atlassian.net', WORK_ITEMS: [{ id: 'jira:A-1', source: 'jira' }], PEOPLE: [] },
    })
    const snap = buildSnapshot({
      adoConfig: { org: 'o' }, adoConfigured: true,
      jiraConfig: { site: 'https://a.atlassian.net' }, jiraActive: true,
      storage: st, empty: EMPTY,
    })
    expect(snap.WORK_ITEMS.map(w => w.id)).toEqual([1, 'jira:A-1'])
    expect(snap.PRS).toEqual([{ id: 9 }])
    expect(snap.WORK_ITEM_PROVIDERS.map(p => p.id)).toEqual(['ado', 'jira'])
  })

  it('ignores the Jira cache when Jira is not active', () => {
    const st = storage({ [JIRA_CACHE_KEY]: { SITE: 's', WORK_ITEMS: [{ id: 'jira:A-1' }] } })
    const snap = buildSnapshot({ adoConfig: {}, adoConfigured: false, jiraConfig: { site: 's' }, jiraActive: false, storage: st, empty: EMPTY })
    expect(snap.WORK_ITEMS).toEqual([])
  })
})

describe('refreshProviders', () => {
  it('runs configured providers, records each outcome and never throws', async () => {
    const st = storage()
    const ado = vi.fn(async () => {})
    const jira = vi.fn(async () => { throw Object.assign(new Error('nope'), { status: 401 }) })
    const skipped = vi.fn()
    await refreshProviders({ storage: st, providers: {
      ado: { configured: true, run: ado },
      jira: { configured: true, run: jira },
      other: { configured: false, run: skipped },
    } })
    expect(ado).toHaveBeenCalled()
    expect(jira).toHaveBeenCalled()
    expect(skipped).not.toHaveBeenCalled()
    expect(st._s[WORK_ITEM_STATUS_KEY]).toMatchObject({ ado: { status: 'ok' }, jira: { status: 'error', error: 'auth failed — check settings' } })
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

describe('defaultCreateProvider', () => {
  const reader = (values) => (k, d) => (k in values ? values[k] : d)
  it('uses the active tab in separate mode', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.displayMode': 'separate', 'nexusmd.wi.sourceTab': 'jira' }), adoAvailable: true, jiraAvailable: true })).toBe('jira')
  })
  it('uses the last provider used otherwise', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'jira' }), adoAvailable: true, jiraAvailable: true })).toBe('jira')
  })
  it('falls back to whichever provider is available', () => {
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'ado' }), adoAvailable: false, jiraAvailable: true })).toBe('jira')
    expect(defaultCreateProvider({ readJson: reader({ 'nexusmd.wi.createProvider': 'jira' }), adoAvailable: true, jiraAvailable: false })).toBe('ado')
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
