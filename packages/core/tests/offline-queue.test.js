import { describe, it, expect, vi } from 'vitest'
import { createOfflineQueue, isNetworkError } from '../src/modules/offline-queue/index.js'

const memory = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v } } }
const make = (handlers, online = { v: true }, emit = vi.fn()) => ({
  q: createOfflineQueue({ storage: memory(), key: () => 'k', handlers, isOnline: () => online.v, emit }), online, emit,
})

describe('offline queue', () => {
  it('runs straight away when online', async () => {
    const h = { a: vi.fn(async x => x + 1) }
    const { q } = make(h)
    expect(await q.run('a', 1)).toEqual({ done: true, result: 2 })
    expect(q.count()).toBe(0)
  })

  it('keeps the action when offline and sends it once back, oldest first', async () => {
    const calls = []
    const { q, online, emit } = make({ a: async p => { calls.push(p) } }, { v: false })
    expect((await q.run('a', 'one', 'first')).queued).toBe(true)
    await q.run('a', 'two')
    expect(q.count()).toBe(2)
    expect(emit).toHaveBeenLastCalledWith(2)
    expect(await q.flush()).toEqual({ sent: 0, failed: [] }) // still offline
    online.v = true
    expect(await q.flush()).toEqual({ sent: 2, failed: [] })
    expect(calls).toEqual(['one', 'two'])
    expect(q.count()).toBe(0)
  })

  it('queues when the network drops during the request', async () => {
    const { q } = make({ a: async () => { throw new TypeError('Failed to fetch') } })
    expect((await q.run('a', 1)).queued).toBe(true)
    expect(q.count()).toBe(1)
  })

  it('throws when the provider refuses, without queueing', async () => {
    const { q } = make({ a: async () => { throw new Error('403 forbidden') } })
    await expect(q.run('a', 1)).rejects.toThrow('403')
    expect(q.count()).toBe(0)
  })

  it('drops a rejected action on flush and carries on with the rest', async () => {
    const seen = []
    const { q, online } = make({ ok: async p => { seen.push(p) }, bad: async () => { throw new Error('nope') } }, { v: false })
    await q.run('bad', 1)
    await q.run('ok', 2)
    online.v = true
    const r = await q.flush()
    expect(r.sent).toBe(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].error.message).toBe('nope')
    expect(seen).toEqual([2])
    expect(q.count()).toBe(0)
  })

  it('stops at a network failure and keeps the rest', async () => {
    const { q, online } = make({ a: async () => { throw new TypeError('Failed to fetch') } }, { v: false })
    await q.run('a', 1)
    await q.run('a', 2)
    online.v = true
    expect((await q.flush()).sent).toBe(0)
    expect(q.count()).toBe(2)
  })

  it('knows a network error from a provider error', () => {
    expect(isNetworkError(new TypeError('x'))).toBe(true)
    expect(isNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true)
    expect(isNetworkError(new Error('ADO 401: path'))).toBe(false)
  })
})

describe('a damaged saved queue is kept aside before anything replaces it', () => {
  const full = () => {
    const m = {}
    return {
      m, get length() { return Object.keys(m).length }, key: i => Object.keys(m)[i] ?? null,
      getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] },
    }
  }
  const DAMAGED = '[{"id":"1_a","kind":"a","payload":{"vote":10},"at":1},{"id":"2_b","kin'
  const kept = (s) => Object.keys(s.m).filter(k => k.startsWith('nexusmd.p.x.sync.quarantine.offline-queue.data.'))
  const setup = (over = {}) => {
    const storage = full(); storage.m['nexusmd.p.x.offlineQueue'] = DAMAGED
    const q = createOfflineQueue({
      storage, key: () => 'nexusmd.p.x.offlineQueue', handlers: { a: async () => {} }, isOnline: () => false,
      getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.x.'), namespace: 'nexusmd', ...over,
    })
    return { storage, q }
  }

  it('a queue that cannot be read counts as empty, as before, and the damaged text is copied aside when the next action replaces it', async () => {
    const { storage, q } = setup()
    expect(q.count()).toBe(0)
    await q.run('a', 'new')
    expect(q.count()).toBe(1)
    const copies = kept(storage)
    expect(copies).toHaveLength(1)
    expect(storage.m[copies[0]]).toBe(DAMAGED)
  })

  it('reading the same damaged queue again does not pile up copies or repeat the log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage, q } = setup()
    q.count(); q.list(); q.count()
    expect(kept(storage)).toHaveLength(1)
    const msgs = warn.mock.calls.map(c => c[0]).filter(m => String(m).includes('offline queue could not be read'))
    expect(msgs).toEqual(['[sync:offline-queue] ignored: the offline queue could not be read, so it counts as empty; the damaged text is kept aside'])
    warn.mockRestore()
  })

  it('says so when no copy could be kept, and still counts as empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { q } = setup({ getProfileKey: undefined })
    expect(q.count()).toBe(0)
    expect(warn.mock.calls.map(c => c[0])).toContain('[sync:offline-queue] ignored: the offline queue could not be read, so it counts as empty; no copy of the damaged text could be kept')
    warn.mockRestore()
  })

  it('a queue that reads fine is not copied anywhere', async () => {
    const storage = full()
    const q = createOfflineQueue({ storage, key: () => 'nexusmd.p.x.offlineQueue', handlers: { a: async () => {} }, isOnline: () => false,
      getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.x.'), namespace: 'nexusmd' })
    await q.run('a', 1)
    expect(q.count()).toBe(1)
    expect(kept(storage)).toHaveLength(0)
  })
})
