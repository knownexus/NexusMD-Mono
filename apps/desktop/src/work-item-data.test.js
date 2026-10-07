import { describe, it, expect, vi } from 'vitest'
import { JIRA_CACHE_KEY, ADO_CACHE_KEY, WORK_ITEM_STATUS_KEY } from '@nexusmd/core'
import { buildSnapshot, refreshProviders, adoMoveToCategory, defaultCreateProvider, adoWorkItemUrl, useRoutedWorkItemSource, nextHiddenIds } from './work-item-data.js'

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

  it('hides people: drops them from the rosters and unassigns their items', () => {
    const st = storage({
      [ADO_CACHE_KEY]: { ORG: 'o', WORK_ITEMS: [{ id: 1, assignee: 'alex-doe' }, { id: 2, assignee: 'sam-roe' }], TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }, { id: 'sam-roe', name: 'Sam Roe' }] },
    })
    const args = { adoConfig: { org: 'o' }, adoConfigured: true, jiraConfig: {}, jiraActive: false, storage: st, empty: EMPTY }
    const snap = buildSnapshot({ ...args, hiddenIds: ['alex-doe'] })
    expect(snap.TEAM.map(m => m.id)).toEqual(['sam-roe'])
    expect(snap.TEAM_ALL.map(m => m.id)).toEqual(['alex-doe', 'sam-roe'])
    expect(snap.WORK_ITEMS.map(w => w.assignee)).toEqual([null, 'sam-roe'])
    const all = buildSnapshot(args)
    expect(all.TEAM.map(m => m.id)).toEqual(['alex-doe', 'sam-roe'])
    expect(all.TEAM_ALL).toBeUndefined()
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
    expect(st._s[WORK_ITEM_STATUS_KEY]).toMatchObject({ ado: { status: 'ok' }, jira: { status: 'error', error: 'auth failed — check settings (nope)' } })
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

describe('useRoutedWorkItemSource', () => {
  it('keeps the same routed source across re-renders (e.g. snapshot refreshes) and rebuilds only when a source changes', async () => {
    const { renderHook } = await import('@testing-library/react')
    const ado = { loadDetail: vi.fn() }
    const jira = { loadDetail: vi.fn() }
    const { result, rerender } = renderHook(({ snapshot, j }) => {
      void snapshot
      return useRoutedWorkItemSource(ado, j)
    }, { initialProps: { snapshot: { WORK_ITEMS: [] }, j: null } })
    const first = result.current
    rerender({ snapshot: { WORK_ITEMS: [{ id: 1 }] }, j: null })
    expect(result.current).toBe(first)
    rerender({ snapshot: { WORK_ITEMS: [{ id: 2 }] }, j: jira })
    expect(result.current).not.toBe(first)
    expect(result.current.jira).toBe(jira)
    const second = result.current
    rerender({ snapshot: { WORK_ITEMS: [{ id: 3 }] }, j: jira })
    expect(result.current).toBe(second)
  })
})

describe('nextHiddenIds', () => {
  const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('keeps hidden ids that are not in the current roster', () => {
    expect(nextHiddenIds(['ghost'], roster, roster)).toEqual(['ghost'])
  })
  it('adds roster members missing from the new team', () => {
    expect(nextHiddenIds(['ghost'], roster, [{ id: 'a' }, { id: 'c' }])).toEqual(['ghost', 'b'])
  })
  it('restores roster members that are back in the new team', () => {
    expect(nextHiddenIds(['a', 'ghost'], roster, roster)).toEqual(['ghost'])
  })
  it('changes nothing when the roster is empty', () => {
    expect(nextHiddenIds(['a', 'ghost'], [], [])).toEqual(['a', 'ghost'])
  })
  it('does not duplicate an already-hidden id', () => {
    expect(nextHiddenIds(['b'], roster, [{ id: 'a' }, { id: 'c' }])).toEqual(['b'])
  })
})
