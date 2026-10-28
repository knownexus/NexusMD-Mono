import { describe, it, expect, vi } from 'vitest'
import { makeGithubWorkItemSource } from '../../src/modules/github/work-item-source.js'

function setup(body = {}) {
  const calls = []
  const http = { fetch: vi.fn(async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined })
    const text = JSON.stringify(body)
    return { ok: true, status: 200, headers: new Map(), text: async () => text }
  }) }
  return { src: makeGithubWorkItemSource({ http, getLogin: () => 'me' }), calls }
}

describe('github work item source', () => {
  it('moveToCategory closes or reopens', async () => {
    const { src, calls } = setup()
    await src.moveToCategory('gh:a/b#1', 'Completed')
    await src.moveToCategory('gh:a/b#1', 'InProgress')
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: 'repos/a/b/issues/1', body: { state: 'closed', state_reason: 'completed' } })
    expect(calls[1].body).toEqual({ state: 'open' })
  })
  it('saveField patches', async () => {
    const { src, calls } = setup()
    await src.saveField('gh:a/b#1', 'System.Title', 'N')
    expect(calls[0].body).toEqual({ title: 'N' })
  })
  it('addComment posts', async () => {
    const { src, calls } = setup({ id: 1, user: { login: 'me' }, body: 'x' })
    await src.addComment('gh:a/b#1', 'p', 'x')
    expect(calls[0]).toMatchObject({ method: 'POST', path: 'repos/a/b/issues/1/comments', body: { body: 'x' } })
  })
  it('loadRawFields returns the issue json', async () => {
    const { src } = setup({ number: 1 })
    expect(await src.loadRawFields('gh:a/b#1')).toEqual({ number: 1 })
  })
  it('states and webUrl', async () => {
    const { src } = setup()
    expect(await src.availableTargetStates('gh:a/b#1')).toEqual(['Open', 'Closed'])
    expect(src.webUrl({ id: 'gh:acme/web#12' })).toBe('https://github.com/acme/web/issues/12')
  })
  it('createIssue posts to the repo', async () => {
    const { src, calls } = setup({ number: 3, html_url: 'u' })
    const r = await src.createIssue({ repo: 'acme/web', title: 't' })
    expect(calls[0].path).toBe('repos/acme/web/issues')
    expect(r.id).toBe('gh:acme/web#3')
  })
})
