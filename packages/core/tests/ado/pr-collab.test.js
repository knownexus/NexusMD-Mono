import { describe, it, expect, vi } from 'vitest'
import {
  fetchPRThreads, postPRThread, postPRReply, setPRThreadStatus,
  fetchPRCommits, fetchPRFileChanges, fetchFileContent, updatePRDescription,
} from '../../src/modules/ado/pr-collab.js'

function makeHttp(responses) {
  const calls = []
  return {
    calls,
    fetch: vi.fn(async (path, options) => {
      calls.push({ path, options })
      const match = responses.find(r => path.includes(r.match))
      if (!match) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      return {
        ok: match.ok !== false,
        status: match.status || 200,
        json: async () => match.json ?? {},
        text: async () => match.text ?? '',
      }
    }),
  }
}

describe('fetchPRThreads', () => {
  it('fetches threads and filters out deleted / commentless threads', async () => {
    const http = makeHttp([{
      match: '/threads?api-version',
      json: { value: [
        { id: 1, isDeleted: false, comments: [{ commentType: 1, isDeleted: false }] },
        { id: 2, isDeleted: true, comments: [{ commentType: 1, isDeleted: false }] },
        { id: 3, isDeleted: false, comments: [{ commentType: 2, isDeleted: false }] },
        { id: 4, isDeleted: false, comments: [] },
      ] },
    }])
    const threads = await fetchPRThreads(http, { project: 'Proj', repoId: 'repo1', prId: 42 })
    expect(threads.map(t => t.id)).toEqual([1])
    expect(http.calls[0].path).toBe('Proj/_apis/git/repositories/repo1/pullRequests/42/threads?api-version=7.0')
  })

  it('throws on non-ok response', async () => {
    const http = makeHttp([{ match: '/threads?api-version', ok: false, status: 500 }])
    await expect(fetchPRThreads(http, { project: 'Proj', repoId: 'r', prId: 1 }))
      .rejects.toThrow('HTTP 500')
  })
})

describe('postPRThread', () => {
  it('POSTs a new thread with the given content', async () => {
    const http = makeHttp([{ match: '/threads?api-version', json: { id: 9, status: 'active' } }])
    const thread = await postPRThread(http, { project: 'Proj', repoId: 'r1', prId: 5, content: 'hello' })
    expect(thread).toEqual({ id: 9, status: 'active' })
    const call = http.calls[0]
    expect(call.path).toBe('Proj/_apis/git/repositories/r1/pullRequests/5/threads?api-version=7.0')
    expect(call.options.method).toBe('POST')
    const body = JSON.parse(call.options.body)
    expect(body).toEqual({ comments: [{ parentCommentId: 0, content: 'hello', commentType: 1 }], status: 1 })
  })
})

describe('postPRReply', () => {
  it('POSTs a reply comment under the given thread', async () => {
    const http = makeHttp([{ match: '/threads/7/comments?api-version', json: { id: 20 } }])
    const comment = await postPRReply(http, {
      project: 'Proj', repoId: 'r1', prId: 5, threadId: 7, parentCommentId: 3, content: 'reply text',
    })
    expect(comment).toEqual({ id: 20 })
    const call = http.calls[0]
    expect(call.path).toBe('Proj/_apis/git/repositories/r1/pullRequests/5/threads/7/comments?api-version=7.0')
    expect(JSON.parse(call.options.body)).toEqual({ parentCommentId: 3, content: 'reply text', commentType: 1 })
  })
})

describe('setPRThreadStatus', () => {
  it('PATCHes the thread status', async () => {
    const http = makeHttp([{ match: '/threads/7?api-version', json: { id: 7, status: 'fixed' } }])
    const thread = await setPRThreadStatus(http, { project: 'Proj', repoId: 'r1', prId: 5, threadId: 7, status: 'fixed' })
    expect(thread.status).toBe('fixed')
    const call = http.calls[0]
    expect(call.options.method).toBe('PATCH')
    expect(JSON.parse(call.options.body)).toEqual({ status: 'fixed' })
  })
})

describe('fetchPRCommits', () => {
  it('returns the commits list', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [{ commitId: 'abc123' }] } }])
    const commits = await fetchPRCommits(http, { project: 'Proj', repoId: 'r1', prId: 5 })
    expect(commits).toEqual([{ commitId: 'abc123' }])
  })
})

describe('fetchPRFileChanges', () => {
  it('resolves the latest iteration then fetches its changes', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [
        { id: 1, sourceRefCommit: { commitId: 'old' }, targetRefCommit: { commitId: 'base-old' } },
        { id: 2, sourceRefCommit: { commitId: 'src2' }, targetRefCommit: { commitId: 'base2' } },
      ] } },
      { match: '/iterations/2/changes', json: { changeEntries: [{ item: { path: '/a.js' }, changeType: 'edit' }] } },
    ])
    const result = await fetchPRFileChanges(http, { project: 'Proj', repoId: 'r1', prId: 5 })
    expect(result).toEqual({
      files: [{ item: { path: '/a.js' }, changeType: 'edit' }],
      srcCommit: 'src2',
      baseCommit: 'base2',
    })
  })

  it('throws when there are no iterations', async () => {
    const http = makeHttp([{ match: '/iterations?api-version', json: { value: [] } }])
    await expect(fetchPRFileChanges(http, { project: 'Proj', repoId: 'r1', prId: 5 }))
      .rejects.toThrow('No PR iterations found.')
  })
})

describe('fetchFileContent', () => {
  it('returns empty string when commitId is falsy', async () => {
    const http = makeHttp([])
    const content = await fetchFileContent(http, { project: 'Proj', repoId: 'r1', path: '/a.js', commitId: null })
    expect(content).toBe('')
    expect(http.calls).toHaveLength(0)
  })

  it('fetches raw text content for a given commit', async () => {
    const http = makeHttp([{ match: '/items?path=', text: 'console.log(1)' }])
    const content = await fetchFileContent(http, { project: 'Proj', repoId: 'r1', path: '/a.js', commitId: 'src2' })
    expect(content).toBe('console.log(1)')
  })
})

describe('updatePRDescription', () => {
  it('PATCHes the PR description', async () => {
    const http = makeHttp([{ match: 'pullRequests/5?api-version', json: { id: 5, description: 'new desc' } }])
    const pr = await updatePRDescription(http, { project: 'Proj', repoId: 'r1', prId: 5, description: 'new desc' })
    expect(pr.description).toBe('new desc')
    const call = http.calls[0]
    expect(call.options.method).toBe('PATCH')
    expect(JSON.parse(call.options.body)).toEqual({ description: 'new desc' })
  })
})
