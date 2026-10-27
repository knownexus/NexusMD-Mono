import { describe, it, expect, vi } from 'vitest'
import {
  loadGithubDetail, loadGithubComments, addGithubComment, updateGithubIssue,
  githubPatchFromAdoField, fetchGithubCreateMeta, createGithubIssue,
} from '../../src/modules/github/issues.js'

describe('githubPatchFromAdoField', () => {
  it('maps state, title, body, tags and assignee', () => {
    expect(githubPatchFromAdoField('System.State', 'Closed')).toEqual({ state: 'closed', state_reason: 'completed' })
    expect(githubPatchFromAdoField('System.State', 'Removed')).toEqual({ state: 'closed', state_reason: 'not_planned' })
    expect(githubPatchFromAdoField('System.State', 'Open')).toEqual({ state: 'open' })
    expect(githubPatchFromAdoField('System.Title', 'T')).toEqual({ title: 'T' })
    expect(githubPatchFromAdoField('System.Description', 'B')).toEqual({ body: 'B' })
    expect(githubPatchFromAdoField('System.Tags', 'bug; p1')).toEqual({ labels: ['bug', 'p1'] })
    expect(githubPatchFromAdoField('System.AssignedTo', '')).toEqual({ assignees: [] })
    expect(githubPatchFromAdoField('System.AssignedTo', 'octo')).toEqual({ assignees: ['octo'] })
  })
  it('throws on unknown fields', () => {
    expect(() => githubPatchFromAdoField('Foo', 1)).toThrow('Editing Foo is not supported for GitHub issues')
  })
})

describe('issue operations', () => {
  it('updateGithubIssue PATCHes exactly the patch', async () => {
    const client = { patch: vi.fn().mockResolvedValue({}) }
    await updateGithubIssue(client, 'gh:acme/web#12', { title: 'x' })
    expect(client.patch).toHaveBeenCalledWith('repos/acme/web/issues/12', { title: 'x' })
  })
  it('addGithubComment POSTs body and maps result', async () => {
    const client = { post: vi.fn().mockResolvedValue({ id: 5, user: { login: 'me' }, body: 'hi', created_at: '2026-01-01T00:00:00Z' }) }
    const c = await addGithubComment(client, 'gh:acme/web#12', 'hi')
    expect(client.post).toHaveBeenCalledWith('repos/acme/web/issues/12/comments', { body: 'hi' })
    expect(c).toMatchObject({ id: 5, author: 'me', createdDate: '2026-01-01T00:00:00Z' })
    expect(c.text).toContain('hi')
  })
  it('loadGithubComments returns [] on failure', async () => {
    expect(await loadGithubComments({ getPaged: vi.fn().mockRejectedValue(new Error('x')) }, 'gh:a/b#1')).toEqual([])
  })
  it('loadGithubComments maps comments with escaped text', async () => {
    const client = { getPaged: vi.fn().mockResolvedValue([{ id: 1, user: { login: 'u' }, body: '<b>&', created_at: 'd' }]) }
    const [c] = await loadGithubComments(client, 'gh:a/b#1')
    expect(client.getPaged).toHaveBeenCalledWith('repos/a/b/issues/1/comments')
    expect(c.text).toContain('&lt;b&gt;&amp;')
  })
  it('loadGithubDetail escapes the body', async () => {
    const d = await loadGithubDetail({ get: async () => ({ body: 'a <i>\nb' }) }, 'gh:a/b#1')
    expect(d.description).toContain('a &lt;i&gt;')
    expect(d.description).toContain('<br')
    expect((await loadGithubDetail({ get: async () => ({ body: null }) }, 'gh:a/b#1')).description).toBeNull()
  })
  it('createGithubIssue POSTs and returns the gh id', async () => {
    const client = { post: vi.fn().mockResolvedValue({ number: 9, html_url: 'u' }) }
    const r = await createGithubIssue(client, { repo: 'acme/web', title: 't', body: 'b', labels: ['x'], assignees: ['me'], milestone: 2 })
    expect(client.post).toHaveBeenCalledWith('repos/acme/web/issues', { title: 't', body: 'b', labels: ['x'], assignees: ['me'], milestone: 2 })
    expect(r).toEqual({ id: 'gh:acme/web#9', url: 'u', warnings: [] })
  })
  it('fetchGithubCreateMeta lists labels, assignees, milestones', async () => {
    const client = { getPaged: vi.fn(async (p) => p.includes('labels') ? [{ name: 'bug' }] : p.includes('assignees') ? [{ login: 'me' }] : [{ number: 1, title: 'v1' }]) }
    expect(await fetchGithubCreateMeta(client, 'a/b')).toEqual({ labels: ['bug'], assignees: ['me'], milestones: [{ number: 1, title: 'v1' }] })
  })
})
