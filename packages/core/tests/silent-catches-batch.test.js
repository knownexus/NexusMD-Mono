import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAdoConfig } from '../src/modules/ado/config.js'
import { startAutoSync } from '../src/modules/sync/auto.js'
import { loadCollection } from '../src/modules/api-client/collection-store.js'
import { createOfflineQueue } from '../src/modules/offline-queue/index.js'

// These code paths used to swallow an error without a trace (an empty catch). They behave as before: the
// code carries on. What changed is that each now says what it ignored and why, under its own module.

let warn, debug
const seen = (spy) => spy.mock.calls.map((c) => c[0])
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('a saved list that is not valid JSON', () => {
  it('gives no projects, as before, and says so', () => {
    const values = { 'nexusmd.ado.projects': '{ torn', 'nexusmd.ado.org': 'acme' }
    const cfg = makeAdoConfig({ storage: { get: (k) => values[k] }, key: (n) => `nexusmd.ado.${n}` })
    expect(cfg.getAdoConfig().projects).toEqual([])
    expect(cfg.getAdoConfig().org).toBe('acme')   // the rest of the config still reads
    expect(seen(warn)).toContain('[ado:config] ignored: the saved project list is not valid JSON, so none is used')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('torn')   // never the saved text
  })
})

describe('a background sync that fails', () => {
  it('does not throw into the trigger, and is logged (it was dropped without a trace)', async () => {
    let trigger
    const syncNow = vi.fn(async () => { throw new Error('network down') })
    const stop = startAutoSync({ syncNow, intervalMs: 1e9, subscribeForeground: (cb) => { trigger = cb; return () => {} } })
    trigger()
    await new Promise((r) => setTimeout(r, 0))
    stop()
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(seen(warn)).toContain('[sync:auto] ignored: a background sync failed; the next trigger tries again')
  })
})

describe('loadCollection', () => {
  it('leaves out a request or environment it cannot read, and names it', async () => {
    const files = {
      'c/collection.json': JSON.stringify({ name: 'C', tree: [] }),
      'c/requests/good.json': JSON.stringify({ url: 'a' }),
      'c/requests/bad.json': '{ torn',
      'c/environments/dev.json': 'not json',
    }
    const file = {
      read: async (p) => files[p],
      list: async (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1)),
    }
    const c = await loadCollection(file, 'c')
    expect(Object.keys(c.requests)).toEqual(['good'])
    expect(c.environments).toEqual({})
    const hits = warn.mock.calls.filter((x) => String(x[0]).includes('could not be read and was left out'))
    expect(hits.map((x) => x[2])).toEqual([{ request: 'bad' }, { environment: 'dev' }])
  })
})

describe('the offline queue', () => {
  it('says when it could not be saved, and carries on (the caller is still told it was queued)', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    const counts = []
    const q = createOfflineQueue({ storage, key: () => 'q', handlers: {}, emit: (n) => counts.push(n) })
    const op = q.enqueue('vote', { pr: 1 }, 'Vote')
    expect(op.kind).toBe('vote')
    expect(seen(warn)).toContain('[sync:offline-queue] ignored: the offline queue could not be saved (storage full or blocked)')
    expect(counts).toHaveLength(1)
  })
})
