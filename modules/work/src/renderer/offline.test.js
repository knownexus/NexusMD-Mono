import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.hoisted(() => vi.fn())
vi.mock('@nexusmd/ui', async (orig) => ({ ...(await orig()), toast }))

import { QUEUED_TOAST } from '@nexusmd/ui'
import { makeOfflineSender, withQueuedVotes, withQueuedStateChanges } from './offline.js'

beforeEach(() => toast.mockReset())

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const adoPr = { id: 7, source: 'ado', project: 'Proj', repoId: 'r1', title: 'big', reviewerDetails: [] }
const ghPr = { id: 'gh:o/r#3', source: 'github', repo: 'o/r', number: 3, title: 'big' }

describe('makeOfflineSender', () => {
  it('sends each queued kind with the Work app clients', async () => {
    const adoFetch = vi.fn(async () => ok({ id: 11 }))
    const ghFetch = vi.fn(async () => ok({ id: 5, body: 'x', user: { login: 'me' } }))
    const source = { saveField: vi.fn(async () => {}), moveToCategory: vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' })) }
    const send = makeOfflineSender({ adoHttp: { fetch: adoFetch }, githubHttp: () => ({ fetch: ghFetch }), workItemSource: () => source })

    await send('ado-vote', { pr: { id: 7, project: 'Proj', repoId: 'r1' }, vote: 10, adoId: 'me-1' })
    expect(adoFetch.mock.calls[0][0]).toContain('pullRequests/7/reviewers/me-1')
    expect(adoFetch.mock.calls[0][1].method).toBe('PUT')

    expect(await send('ado-comment', { pr: { id: 7, project: 'Proj', repoId: 'r1' }, text: 'hi' })).toEqual({ id: 11 })
    expect(adoFetch.mock.calls[1][0]).toContain('pullRequests/7/threads')

    await send('github-vote', { pr: { repo: 'o/r', number: 3 }, event: 'APPROVE' })
    expect(ghFetch.mock.calls[0][0]).toBe('repos/o/r/pulls/3/reviews')

    await send('github-comment', { pr: { repo: 'o/r', number: 3 }, text: 'hi' })
    expect(ghFetch.mock.calls[1][0]).toBe('repos/o/r/issues/3/comments')

    await send('work-state', { id: 4, state: 'Active' })
    expect(source.saveField).toHaveBeenCalledWith(4, 'System.State', 'Active')
    await send('work-state', { id: 4, category: 'Completed', item: { id: 4, type: 'Bug', state: 'Active' } })
    expect(source.moveToCategory).toHaveBeenCalledWith(4, 'Completed', { id: 4, type: 'Bug', state: 'Active' })
  })

  it('rejects an unknown kind', async () => {
    const send = makeOfflineSender({ adoHttp: { fetch: vi.fn() }, githubHttp: () => null, workItemSource: () => ({}) })
    await expect(send('nope', {})).rejects.toThrow('Unknown')
  })
})

describe('withQueuedVotes', () => {
  const actions = { approve: vi.fn(), waitForAuthor: vi.fn(), reject: vi.fn(async () => 'rejected'), merge: vi.fn(), mergeOptions: vi.fn() }

  it('sends an ADO vote through the queue with only what the call needs', async () => {
    const queue = { run: vi.fn(async () => ({ done: true })) }
    const q = withQueuedVotes(actions, queue, { adoMeId: 'me-1' })
    expect(await q.approve(adoPr)).toEqual({ patch: { myVote: 10 }, warnings: [] })
    expect(queue.run).toHaveBeenCalledWith('ado-vote', { pr: { id: 7, project: 'Proj', repoId: 'r1' }, vote: 10, adoId: 'me-1' }, 'Vote on #7')
    expect(actions.approve).not.toHaveBeenCalled()
  })

  it('sends a GitHub review through the queue and says when it was queued', async () => {
    const queue = { run: vi.fn(async () => ({ queued: true })) }
    const q = withQueuedVotes(actions, queue, { adoMeId: '' })
    expect(await q.waitForAuthor(ghPr)).toEqual({ patch: { myVote: -5 }, warnings: [], queued: true })
    expect(queue.run).toHaveBeenCalledWith('github-vote', { pr: { repo: 'o/r', number: 3 }, event: 'REQUEST_CHANGES' }, 'Vote on o/r#3')
  })

  it('refuses an ADO vote with no identity before queueing it, as before', async () => {
    const queue = { run: vi.fn() }
    await expect(withQueuedVotes(actions, queue, { adoMeId: '' }).approve(adoPr)).rejects.toThrow('identity')
    expect(queue.run).not.toHaveBeenCalled()
  })

  it('leaves reject and merge direct (never queued)', async () => {
    const q = withQueuedVotes(actions, { run: vi.fn() }, { adoMeId: 'me-1' })
    expect(await q.reject(adoPr)).toBe('rejected')
    expect(q.merge).toBe(actions.merge)
  })
})

describe('withQueuedStateChanges', () => {
  const source = () => ({
    saveField: vi.fn(async () => 'saved'),
    moveToCategory: vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' })),
    loadDetail: vi.fn(async () => 'detail'),
    webUrl: () => 'u',
  })

  it('queues a state change and shows the queued toast', async () => {
    const s = source()
    const queue = { run: vi.fn(async () => ({ queued: true })) }
    const q = withQueuedStateChanges(s, queue)
    await q.saveField(4, 'System.State', 'Active')
    expect(queue.run).toHaveBeenCalledWith('work-state', { id: 4, state: 'Active' }, 'Move 4 to Active')
    expect(toast).toHaveBeenCalledWith(QUEUED_TOAST, 'success')
    expect(s.saveField).not.toHaveBeenCalled()
  })

  it('other fields are saved directly', async () => {
    const s = source()
    const queue = { run: vi.fn() }
    expect(await withQueuedStateChanges(s, queue).saveField(4, 'System.Title', 'x')).toBe('saved')
    expect(queue.run).not.toHaveBeenCalled()
  })

  it('moves to a category through the queue: the result when sent, the target category when queued', async () => {
    const s = source()
    const item = { id: 4, type: 'Bug', state: 'Active', title: 'long', description: 'd', project: 'P' }
    const sent = withQueuedStateChanges(s, { run: vi.fn(async () => ({ done: true, result: { state: 'Done', stateCategory: 'Completed' } })) })
    expect(await sent.moveToCategory(4, 'Completed', item)).toEqual({ state: 'Done', stateCategory: 'Completed' })
    expect(toast).not.toHaveBeenCalled()

    const run = vi.fn(async () => ({ queued: true }))
    const queued = withQueuedStateChanges(s, { run })
    expect(await queued.moveToCategory(4, 'Completed', item)).toEqual({ state: 'Active', stateCategory: 'Completed', queued: true })
    expect(run).toHaveBeenCalledWith('work-state', { id: 4, category: 'Completed', item: { id: 4, type: 'Bug', state: 'Active', project: 'P' } }, 'Move 4 to Completed')
    expect(toast).toHaveBeenCalledWith(QUEUED_TOAST, 'success')
  })

  it('a provider rejection is thrown, as before', async () => {
    const q = withQueuedStateChanges(source(), { run: vi.fn(async () => { throw new Error('HTTP 409') }) })
    await expect(q.saveField(4, 'System.State', 'Done')).rejects.toThrow('HTTP 409')
    await expect(q.moveToCategory(4, 'Completed', { id: 4 })).rejects.toThrow('HTTP 409')
  })

  it('keeps the other methods', async () => {
    const q = withQueuedStateChanges(source(), { run: vi.fn() })
    expect(await q.loadDetail(1)).toBe('detail')
    expect(q.webUrl()).toBe('u')
  })
})
