import { describe, it, expect, vi } from 'vitest'
import {
  fetchGithubPRFiles, fetchGithubPRCommits, fetchGithubPRThreads, postGithubPRComment,
} from '../../src/modules/github/pr-collab.js'

const PR = { repo: 'acme/web', number: 7 }

describe('GitHub PR collaboration', () => {
  it('lists changed files with their change type, counts and patch', async () => {
    const client = { getPaged: vi.fn(async () => [
      { filename: 'a.js', status: 'added', additions: 3, deletions: 0, patch: '@@ +1 @@' },
      { filename: 'b.js', status: 'removed', additions: 0, deletions: 2 },
      { filename: 'c.js', status: 'renamed', additions: 1, deletions: 1, previous_filename: 'old-c.js' },
      { filename: 'd.js', status: 'modified', additions: 4, deletions: 5 },
    ]) }
    const files = await fetchGithubPRFiles(client, PR)
    expect(client.getPaged).toHaveBeenCalledWith('repos/acme/web/pulls/7/files')
    expect(files).toEqual([
      { path: 'a.js', changeType: 'add', additions: 3, deletions: 0, patch: '@@ +1 @@' },
      { path: 'b.js', changeType: 'delete', additions: 0, deletions: 2, patch: '' },
      { path: 'c.js', changeType: 'rename', additions: 1, deletions: 1, patch: '' },
      { path: 'd.js', changeType: 'edit', additions: 4, deletions: 5, patch: '' },
    ])
  })

  it('lists commits with their first-line message, author login and date', async () => {
    const client = { getPaged: vi.fn(async () => [
      { sha: 'abc1234def', author: { login: 'octo' }, commit: { message: 'Fix it\n\nbody', author: { name: 'Octo Cat', date: '2026-01-02T00:00:00Z' } } },
      { sha: 'fff', author: null, commit: { message: 'x', author: { name: 'Ghost', date: 'd' } } },
    ]) }
    expect(await fetchGithubPRCommits(client, PR)).toEqual([
      { id: 'abc1234def', message: 'Fix it', author: 'octo', date: '2026-01-02T00:00:00Z' },
      { id: 'fff', message: 'x', author: 'Ghost', date: 'd' },
    ])
    expect(client.getPaged).toHaveBeenCalledWith('repos/acme/web/pulls/7/commits')
  })

  it('groups review comments into threads by in_reply_to_id, after the conversation comments', async () => {
    const client = { getPaged: vi.fn(async (path) => path.endsWith('/pulls/7/comments')
      ? [
          { id: 1, path: 'a.js', line: 4, user: { login: 'r1' }, body: 'why?', created_at: 't1' },
          { id: 2, in_reply_to_id: 1, path: 'a.js', line: 4, user: { login: 'octo' }, body: 'because', created_at: 't2' },
          { id: 3, path: 'b.js', line: null, original_line: 9, user: { login: 'r2' }, body: 'nit', created_at: 't3' },
        ]
      : [{ id: 50, user: { login: 'pm' }, body: 'ship it', created_at: 't0' }]) }
    const threads = await fetchGithubPRThreads(client, PR)
    expect(client.getPaged).toHaveBeenCalledWith('repos/acme/web/issues/7/comments')
    expect(threads).toEqual([
      { id: 'conversation', path: null, line: null, comments: [{ id: 50, author: 'pm', text: 'ship it', createdDate: 't0' }] },
      { id: 1, path: 'a.js', line: 4, comments: [
        { id: 1, author: 'r1', text: 'why?', createdDate: 't1' },
        { id: 2, author: 'octo', text: 'because', createdDate: 't2' },
      ] },
      { id: 3, path: 'b.js', line: 9, comments: [{ id: 3, author: 'r2', text: 'nit', createdDate: 't3' }] },
    ])
  })

  it('leaves out the conversation thread when there are no conversation comments', async () => {
    const client = { getPaged: vi.fn(async () => []) }
    expect(await fetchGithubPRThreads(client, PR)).toEqual([])
  })

  it('posts a PR comment as an issue comment and maps the result', async () => {
    const client = { post: vi.fn(async () => ({ id: 9, user: { login: 'me' }, body: 'hi', created_at: 't' })) }
    expect(await postGithubPRComment(client, PR, 'hi')).toEqual({ id: 9, author: 'me', text: 'hi', createdDate: 't' })
    expect(client.post).toHaveBeenCalledWith('repos/acme/web/issues/7/comments', { body: 'hi' })
  })
})
