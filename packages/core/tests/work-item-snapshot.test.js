import { describe, it, expect, vi } from 'vitest'
import {
  JIRA_CACHE_KEY, ADO_CACHE_KEY, WORK_ITEM_STATUS_KEY,
  buildSnapshot, refreshProviders, defaultCreateProvider, nextHiddenIds,
} from '../src/index.js'

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
