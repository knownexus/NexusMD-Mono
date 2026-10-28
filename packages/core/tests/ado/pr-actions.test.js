import { describe, it, expect } from 'vitest'
import {
  ADO_MERGE_STRATEGIES, voteAdoPR, abandonAdoPR, completeAdoPR,
} from '../../src/modules/ado/pr-actions.js'

function makeHttp(responses) {
  const calls = []
  let i = 0
  return {
    calls,
    fetch: async (path, options) => {
      calls.push({ path, options })
      const r = responses[Math.min(i++, responses.length - 1)]
      const body = r.body === undefined ? {} : r.body
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => JSON.parse(text),
        text: async () => text,
      }
    },
  }
}

const pr = { project: 'My Proj', repoId: 'r1', prId: 5 }
const base = 'My%20Proj/_apis/git/repositories/r1/pullRequests/5'

describe('voteAdoPR', () => {
  it('PUTs the vote for the reviewer', async () => {
    const http = makeHttp([{ status: 200 }])
    await voteAdoPR(http, { ...pr, reviewerId: 'u-1' }, 10)
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0].path).toBe(`${base}/reviewers/u-1?api-version=7.0`)
    expect(http.calls[0].options.method).toBe('PUT')
    expect(http.calls[0].options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(http.calls[0].options.body)).toEqual({ vote: 10 })
  })
  it('rejects without a reviewer id and makes no call', async () => {
    const http = makeHttp([{ status: 200 }])
    await expect(voteAdoPR(http, { ...pr, reviewerId: '' }, -5))
      .rejects.toThrow('Your Azure DevOps identity is not known yet — refresh and try again')
    expect(http.calls).toHaveLength(0)
  })
})

describe('abandonAdoPR', () => {
  it('PATCHes status abandoned', async () => {
    const http = makeHttp([{ status: 200 }])
    await abandonAdoPR(http, pr)
    expect(http.calls[0].path).toBe(`${base}?api-version=7.0`)
    expect(http.calls[0].options.method).toBe('PATCH')
    expect(JSON.parse(http.calls[0].options.body)).toEqual({ status: 'abandoned' })
  })
})

describe('completeAdoPR', () => {
  it('GETs the PR then PATCHes completion with the source commit', async () => {
    const http = makeHttp([
      { status: 200, body: { lastMergeSourceCommit: { commitId: 'abc' } } },
      { status: 200 },
    ])
    await completeAdoPR(http, pr, { mergeStrategy: 'squash', deleteSourceBranch: true })
    expect(http.calls).toHaveLength(2)
    expect(http.calls[0].path).toBe(`${base}?api-version=7.0`)
    expect(http.calls[0].options?.method ?? 'GET').toBe('GET')
    expect(http.calls[1].options.method).toBe('PATCH')
    expect(JSON.parse(http.calls[1].options.body)).toEqual({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'abc' },
      completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true },
    })
  })
})

describe('completeAdoPR reply', () => {
  it('returns the parsed PATCH reply', async () => {
    const http = makeHttp([
      { status: 200, body: { lastMergeSourceCommit: { commitId: 'abc' } } },
      { status: 200, body: { status: 'active', mergeStatus: 'queued' } },
    ])
    const r = await completeAdoPR(http, pr, { mergeStrategy: 'squash', deleteSourceBranch: false })
    expect(r).toMatchObject({ status: 'active', mergeStatus: 'queued' })
  })
})

describe('errors', () => {
  it('uses the ADO message', async () => {
    const msg = 'TF401181: The pull request cannot be completed due to policy'
    const http = makeHttp([{ status: 409, body: { message: msg } }])
    await expect(abandonAdoPR(http, pr)).rejects.toThrow(new RegExp(`^${msg}$`))
  })
  it('falls back to HTTP status for non-JSON bodies', async () => {
    const http = makeHttp([{ status: 500, body: 'boom' }])
    await expect(abandonAdoPR(http, pr)).rejects.toThrow(/^HTTP 500$/)
  })
})

describe('ADO_MERGE_STRATEGIES', () => {
  it('lists strategies in order', () => {
    expect(ADO_MERGE_STRATEGIES.map(s => s.id)).toEqual(['noFastForward', 'squash', 'rebase', 'rebaseMerge'])
    expect(ADO_MERGE_STRATEGIES.map(s => s.label)).toEqual(['Merge', 'Squash', 'Rebase and fast-forward', 'Semi-linear'])
  })
})
