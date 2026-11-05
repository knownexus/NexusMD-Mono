import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadAdoData } from '../../src/modules/ado/loader.js'

// The loader lets most requests fail on their own (the page shows what it has). That must not be silent:
// each skipped piece is logged under the ado module, with the project (never any content).
vi.mock('../../src/modules/ado/mappers.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    mapWorkItem: (wi, ...rest) => { if (wi?.id === 2) throw new Error('cannot map this work item'); return real.mapWorkItem(wi, ...rest) },
    mapPR: (pr, ...rest) => { if (pr?.id === 9) throw new Error('cannot map this pull request'); return real.mapPR(pr, ...rest) },
  }
})

const CONFIG = { org: 'o', projects: ['P1'] }
const ok = data => ({ ok: true, status: 200, json: async () => data })
const fail = () => ({ ok: false, status: 500, json: async () => ({}) })

// routes: [substring, response | () => response], first match wins; anything else is an empty list
function http(routes = []) {
  return {
    fetch: vi.fn(async (path) => {
      for (const [part, res] of routes) if (path.includes(part)) return typeof res === 'function' ? res() : res
      return ok({ value: [] })
    }),
  }
}
const storage = () => { const s = {}; return { get: k => s[k] ?? null, set: (k, v) => { s[k] = v }, remove: k => { delete s[k] }, keys: () => Object.keys(s) } }

let warn, debug
const logged = (spy, text) => spy.mock.calls.filter(c => String(c[0]).includes(text))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('loadAdoData logs what it leaves out', () => {
  it('a project whose team list fails, naming the project', async () => {
    const data = await loadAdoData(CONFIG, { http: http([['/teams?', fail]]), storage: storage() })
    expect(data).toBeTruthy()
    const hit = logged(warn, 'could not list a project\'s teams')
    expect(hit).toHaveLength(1)
    expect(hit[0][0]).toBe('[ado:loader] ignored: could not list a project\'s teams')
    expect(hit[0][2]).toEqual({ project: 'P1' })
  })

  it('a team whose members cannot be listed (debug: it is common and only thins the people list)', async () => {
    await loadAdoData(CONFIG, { http: http([['/teams?', ok({ value: [{ id: 't1' }] })], ['/members', fail]]), storage: storage() })
    const hit = logged(debug, 'could not list a team\'s members')
    expect(hit).toHaveLength(1)
    expect(hit[0][2]).toEqual({ project: 'P1', team: 't1' })
    expect(logged(warn, 'members')).toHaveLength(0)
  })

  it('a batch of work items that fails to load, with how many were asked for', async () => {
    await loadAdoData(CONFIG, { http: http([['/wiql', ok({ workItems: [{ id: 1 }, { id: 2 }] })], ['workitems?ids=', fail]]), storage: storage() })
    const hit = logged(warn, 'could not load a batch of work items')
    expect(hit.length).toBeGreaterThan(0)
    expect(hit[0][2]).toEqual({ project: 'P1', count: 2 })
  })

  it('a project whose work-item query fails', async () => {
    await loadAdoData(CONFIG, { http: http([['/wiql', fail]]), storage: storage() })
    expect(logged(warn, 'could not load a project\'s work items')[0][2]).toEqual({ project: 'P1' })
    expect(logged(warn, 'recently closed work items')[0][2]).toEqual({ project: 'P1' })
  })

  it('a project whose builds fail to load', async () => {
    await loadAdoData(CONFIG, { http: http([['_apis/build/builds?$top=15', fail]]), storage: storage() })
    expect(logged(warn, 'could not load a project\'s builds')[0][2]).toEqual({ project: 'P1' })
  })

  it('a work item that cannot be mapped is left out and named by id, and the rest still load', async () => {
    const wi = id => ({ id, fields: { 'System.Title': `T${id}`, 'System.WorkItemType': 'Task', 'System.State': 'Active' } })
    const data = await loadAdoData(CONFIG, { http: http([['/wiql', ok({ workItems: [{ id: 1 }, { id: 2 }] })], ['workitems?ids=', ok({ value: [wi(1), wi(2)] })]]), storage: storage() })
    expect(data.WORK_ITEMS).toHaveLength(1)
    const hit = logged(warn, 'a work item could not be read and was left out')
    expect(hit).toHaveLength(1)
    expect(hit[0][2]).toEqual({ id: 2 })
  })

  it('a pull request that cannot be mapped is left out and named by id', async () => {
    const pr = id => ({ pullRequestId: id, id, title: `PR${id}`, status: 'active', createdBy: { displayName: 'A' }, creationDate: '2026-01-01T00:00:00Z' })
    await loadAdoData(CONFIG, {
      http: http([['/git/repositories?', ok({ value: [{ id: 'r1', name: 'repo' }] })], ['/pullrequests?', ok({ value: [pr(8), pr(9)] })]]),
      storage: storage(),
    })
    const hit = logged(warn, 'a pull request could not be read and was left out')
    expect(hit).toHaveLength(1)
    expect(hit[0][2]).toEqual({ id: 9 })
  })

  it('an offline cache that cannot be saved (debug: only the next start is slower)', async () => {
    const s = storage()
    s.set = () => { throw new Error('quota') }
    const data = await loadAdoData(CONFIG, { http: http(), storage: s })
    expect(data).toBeTruthy()
    expect(logged(debug, 'could not save the offline cache')).toHaveLength(1)
  })
})
