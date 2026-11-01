import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeDesktopQueue, QUEUE_KINDS, SEND_CAPABILITY, appQueue, flushQueue } from './offline-queue-app.js'
import { capabilities } from './shell/capabilities.js'
import { getProfileKey } from './profile-keys.js'

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function make({ online = true, send = vi.fn(async () => 'ok') } = {}) {
  const state = { online }
  const emit = vi.fn()
  const queue = makeDesktopQueue({ storage: memoryStorage(), key: () => 'q', send, isOnline: () => state.online, emit })
  return { queue, send, state, emit }
}

const conflict = () => Object.assign(new Error('TF401019: the pull request was updated (409)'), { status: 409 })

describe('desktop offline queue', () => {
  it('has the five desktop handlers', () => {
    expect(QUEUE_KINDS).toEqual(['ado-vote', 'ado-comment', 'github-vote', 'github-comment', 'work-state'])
  })

  it('run queues when offline and returns { queued: true }', async () => {
    const { queue, send, emit } = make({ online: false })
    const r = await queue.run('ado-vote', { pr: { id: 7 }, vote: 10, adoId: 'me' }, 'Vote on #7')
    expect(r.queued).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(queue.count()).toBe(1)
    expect(emit).toHaveBeenLastCalledWith(1)
  })

  it('run sends now when online and returns { done, result }', async () => {
    const { queue, send } = make({ send: vi.fn(async () => ({ id: 3 })) })
    const r = await queue.run('ado-comment', { pr: { id: 7 }, text: 'hi' })
    expect(r).toEqual({ done: true, result: { id: 3 } })
    expect(send).toHaveBeenCalledWith('ado-comment', { pr: { id: 7 }, text: 'hi' })
    expect(queue.count()).toBe(0)
  })

  it('a network failure mid-request queues', async () => {
    const { queue } = make({ send: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    expect((await queue.run('github-comment', { pr: { id: 1 }, text: 'x' })).queued).toBe(true)
    expect(queue.count()).toBe(1)
  })

  it('a 409 from the provider is thrown, not queued', async () => {
    const { queue } = make({ send: vi.fn(async () => { throw conflict() }) })
    await expect(queue.run('work-state', { id: 1, state: 'Done' })).rejects.toThrow('409')
    expect(queue.count()).toBe(0)
  })

  it('flush sends oldest first and stops at the first network error', async () => {
    const { queue, send, state } = make({ online: false })
    await queue.run('work-state', { id: 1, state: 'Active' })
    await queue.run('ado-vote', { pr: { id: 2 }, vote: 10 })
    await queue.run('github-comment', { pr: { id: 3 }, text: 'c' })
    state.online = true
    send.mockImplementationOnce(async () => 'ok').mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    const r = await queue.flush()
    expect(r).toEqual({ sent: 1, failed: [] })
    expect(send.mock.calls.map(c => c[0])).toEqual(['work-state', 'ado-vote'])
    expect(queue.list().map(o => o.kind)).toEqual(['ado-vote', 'github-comment'])
  })

  it('a rejected operation is dropped and reported in failed', async () => {
    const { queue, send, state } = make({ online: false })
    await queue.run('github-vote', { pr: { id: 2 }, event: 'APPROVE' }, 'Vote on #2')
    await queue.run('ado-comment', { pr: { id: 3 }, text: 'c' })
    state.online = true
    const err = conflict()
    send.mockImplementationOnce(async () => { throw err }).mockImplementationOnce(async () => 'ok')
    const r = await queue.flush()
    expect(r.sent).toBe(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].op).toMatchObject({ kind: 'github-vote', label: 'Vote on #2' })
    expect(r.failed[0].error).toBe(err)
    expect(queue.count()).toBe(0)
  })
})

describe('the app queue', () => {
  beforeEach(() => { localStorage.clear() })

  it('is stored under the profile key and announces its count as nexusmd:queue', async () => {
    const seen = []
    const on = e => seen.push(e.detail.count)
    window.addEventListener('nexusmd:queue', on)
    appQueue.enqueue('work-state', { id: 1, state: 'Done' }, 'x')
    window.removeEventListener('nexusmd:queue', on)
    expect(seen).toEqual([1])
    expect(JSON.parse(localStorage.getItem(getProfileKey('nexusmd.offlineQueue')))).toHaveLength(1)
  })

  it('keeps what is waiting while the Work app is not there to send it', async () => {
    appQueue.enqueue('work-state', { id: 1, state: 'Done' }, 'x')
    expect(capabilities.has(SEND_CAPABILITY)).toBe(false)
    expect(await flushQueue()).toEqual({ sent: 0, failed: [] })
    expect(appQueue.count()).toBe(1)
  })

  it('sends through the Work app and reports the flush as nexusmd:queue-flushed', async () => {
    appQueue.enqueue('ado-vote', { pr: { id: 2 }, vote: 10, adoId: 'me' }, 'Vote')
    const send = vi.fn(async () => {})
    const off = capabilities.provide(SEND_CAPABILITY, send)
    const flushed = vi.fn()
    window.addEventListener('nexusmd:queue-flushed', flushed)
    try {
      expect(await flushQueue()).toEqual({ sent: 1, failed: [] })
    } finally { off(); window.removeEventListener('nexusmd:queue-flushed', flushed) }
    expect(send).toHaveBeenCalledWith('ado-vote', { pr: { id: 2 }, vote: 10, adoId: 'me' })
    expect(flushed.mock.calls[0][0].detail).toEqual({ sent: 1, failed: [] })
  })
})
