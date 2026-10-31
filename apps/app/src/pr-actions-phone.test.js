import { describe, it, expect, vi } from 'vitest'
import { canVote, canComment, myVoteOf, votesFor, adoVote, adoComment, adoVoteLabel, minimalPR, ADO_VOTES } from './pr-actions-phone.js'

const ado = { id: 7, status: 'active', draft: false, project: 'My Proj', repoId: 'r1', reviewerDetails: [{ id: 'me-id', name: 'Me', vote: 5 }, { id: 'x', name: 'Other', vote: -10 }] }

describe('PR actions on a phone', () => {
  it('lets you vote only on an open PR you can identify yourself on', () => {
    expect(canVote(ado, { adoId: 'me-id' })).toBe(true)
    expect(canVote(ado, {})).toBe(false)
    expect(canVote({ ...ado, draft: true }, { adoId: 'me-id' })).toBe(false)
    expect(canVote({ ...ado, status: 'merged' }, { adoId: 'me-id' })).toBe(false)
    expect(canVote({ source: 'github', status: 'active' }, {})).toBe(true)
  })
  it('offers each provider its own votes', () => {
    expect(votesFor(ado)).toBe(ADO_VOTES)
    expect(votesFor({ source: 'github' }).map(v => v.v)).toEqual(['APPROVE', 'REQUEST_CHANGES'])
  })
  it('finds your own vote', () => {
    expect(myVoteOf(ado, { adoId: 'me-id' })).toBe(5)
    expect(myVoteOf(ado, { name: 'Other' })).toBe(-10)
    expect(myVoteOf(ado, { adoId: 'nobody' })).toBe(0)
    expect(myVoteOf({ source: 'github', reviewerDetails: [{ name: 'Octo', vote: 10 }] }, {}, 'octo')).toBe(10)
    expect(adoVoteLabel(-5)).toBe('Waiting for author')
  })
  it('votes and comments on the right ADO endpoints', async () => {
    const put = vi.fn(async () => ({}))
    const post = vi.fn(async () => ({}))
    await adoVote({ put }, ado, 'me-id', 10)
    expect(put).toHaveBeenCalledWith('My%20Proj/_apis/git/repositories/r1/pullRequests/7/reviewers/me-id?api-version=7.0', { vote: 10 })
    await adoComment({ post }, ado, 'Looks good')
    expect(post.mock.calls[0][0]).toBe('My%20Proj/_apis/git/repositories/r1/pullRequests/7/threads?api-version=7.0')
    expect(post.mock.calls[0][1].comments[0]).toEqual({ parentCommentId: 0, content: 'Looks good', commentType: 1 })
  })
  it('keeps only what a queued call needs, and checks comment rights', () => {
    const slim = minimalPR({ ...ado, title: 'big', description: 'x'.repeat(1000) })
    expect(slim).toEqual({ id: 7, source: 'ado', project: 'My Proj', repoId: 'r1', repo: undefined, number: undefined })
    expect(canComment(ado)).toBe(true)
    expect(canComment({ id: 1 })).toBe(false)
    expect(canComment({ source: 'github' })).toBe(true)
  })
})

import { resolveAdoId, resetAdoIdentity } from './pr-actions-phone.js'

describe('your ADO identity', () => {
  it('is asked for once and remembered', async () => {
    resetAdoIdentity()
    const adoGet = vi.fn(async () => ({ authenticatedUser: { id: 'abc' } }))
    expect(await resolveAdoId(adoGet)).toBe('abc')
    expect(await resolveAdoId(adoGet)).toBe('abc')
    expect(adoGet).toHaveBeenCalledTimes(1)
  })
  it('asks again after a failure', async () => {
    resetAdoIdentity()
    const adoGet = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ authenticatedUser: { id: 'z' } })
    expect(await resolveAdoId(adoGet)).toBe('')
    expect(await resolveAdoId(adoGet)).toBe('z')
  })
})
