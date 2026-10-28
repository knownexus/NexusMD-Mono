import { describe, it, expect, vi } from 'vitest'
import { makePRActions } from '../../src/modules/workitems/pr-actions.js'

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => '' })
const adoPr = { source: 'ado', id: 5, project: 'P', repoId: 'r1' }
const ghPr = { source: 'github', repo: 'acme/web', number: 7, branch: 'f', headRepo: 'acme/web' }

describe('makePRActions', () => {
  it('approves an ADO PR with vote 10', async () => {
    const adoHttp = { fetch: vi.fn(async () => ok()) }
    const r = await makePRActions({ adoHttp, adoMeId: 'me-1' }).approve(adoPr)
    expect(r).toEqual({ patch: { myVote: 10 }, warnings: [] })
    const [path, opts] = adoHttp.fetch.mock.calls[0]
    expect(path).toContain('reviewers/me-1')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ vote: 10 })
  })
  it('rejects an ADO PR by abandoning', async () => {
    const adoHttp = { fetch: vi.fn(async () => ok()) }
    const r = await makePRActions({ adoHttp, adoMeId: 'me-1' }).reject(adoPr)
    expect(r).toEqual({ patch: { status: 'abandoned' }, warnings: [] })
    expect(adoHttp.fetch.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(adoHttp.fetch.mock.calls[0][1].body)).toEqual({ status: 'abandoned' })
  })
  it('treats a PR without source as ADO', async () => {
    const adoHttp = { fetch: vi.fn(async () => ok()) }
    const { source, ...bare } = adoPr
    await makePRActions({ adoHttp, adoMeId: 'me-1' }).waitForAuthor(bare)
    expect(JSON.parse(adoHttp.fetch.mock.calls[0][1].body)).toEqual({ vote: -5 })
  })
  it('waitForAuthor on GitHub requests changes', async () => {
    const githubClient = { post: vi.fn(async () => null) }
    const r = await makePRActions({ githubClient }).waitForAuthor(ghPr)
    expect(r).toEqual({ patch: { myVote: -5 }, warnings: [] })
    expect(githubClient.post.mock.calls[0][1].event).toBe('REQUEST_CHANGES')
  })
  it('merges a GitHub PR without deleting the branch', async () => {
    const githubClient = { put: vi.fn(async () => null), del: vi.fn() }
    const r = await makePRActions({ githubClient }).merge(ghPr, { method: 'merge', deleteBranch: false })
    expect(r).toEqual({ patch: { status: 'merged' }, warnings: [] })
    expect(githubClient.put).toHaveBeenCalledWith('repos/acme/web/pulls/7/merge', { merge_method: 'merge' })
    expect(githubClient.del).not.toHaveBeenCalled()
  })
  it('merges an ADO PR using the chosen strategy', async () => {
    const adoHttp = { fetch: vi.fn(async (p, o) => ok({ lastMergeSourceCommit: { commitId: 'c1' } })) }
    const r = await makePRActions({ adoHttp }).merge(adoPr, { method: 'squash', deleteBranch: true })
    expect(r).toEqual({ patch: { status: 'merged' }, warnings: [] })
    const body = JSON.parse(adoHttp.fetch.mock.calls[1][1].body)
    expect(body.completionOptions).toMatchObject({ mergeStrategy: 'squash', deleteSourceBranch: true })
  })
  it('mergeOptions for GitHub', async () => {
    const githubClient = { get: async () => ({ allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }) }
    expect(await makePRActions({ githubClient }).mergeOptions(ghPr)).toEqual({
      methods: [{ id: 'merge', label: 'Merge' }],
      rejectConfirm: 'Reject and close this pull request?',
    })
  })
  it('mergeOptions for ADO', async () => {
    const o = await makePRActions({}).mergeOptions(adoPr)
    expect(o.methods.map(m => m.id)).toEqual(['noFastForward', 'squash', 'rebase', 'rebaseMerge'])
    expect(o.rejectConfirm).toBe('Reject and abandon this pull request?')
  })
  it('GitHub PR without a client fails', async () => {
    await expect(makePRActions({ githubClient: null }).approve(ghPr)).rejects.toThrow('GitHub is not configured')
  })
})
