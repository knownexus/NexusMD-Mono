import { describe, it, expect, vi } from 'vitest'
import { createOfflineQueue, isNetworkError } from './offline-queue.js'

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
