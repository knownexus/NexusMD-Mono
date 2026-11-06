import { describe, it, expect, vi } from 'vitest'
import { makePRActions, deleteBranchWarning, deleteBranchByDefault } from '../../src/modules/workitems/pr-actions.js'

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
    const adoHttp = { fetch: vi.fn(async (p, o) => ok({ status: 'completed', lastMergeSourceCommit: { commitId: 'c1' } })) }
    const r = await makePRActions({ adoHttp }).merge(adoPr, { method: 'squash', deleteBranch: true })
    expect(r).toEqual({ patch: { status: 'merged' }, warnings: [] })
    const body = JSON.parse(adoHttp.fetch.mock.calls[1][1].body)
    expect(body.completionOptions).toMatchObject({ mergeStrategy: 'squash', deleteSourceBranch: true })
  })
  it.each([['queued', 'queued'], [undefined, 'pending']])('does not mark an ADO PR merged while completion is queued (%s)', async (mergeStatus, shown) => {
    const adoHttp = { fetch: vi.fn(async (p, o) => ok(o?.method === 'PATCH' ? { status: 'active', mergeStatus } : { lastMergeSourceCommit: { commitId: 'c1' } })) }
    const r = await makePRActions({ adoHttp }).merge(adoPr, { method: 'squash', deleteBranch: false })
    expect(r).toEqual({ patch: {}, warnings: [`Completion queued — Azure DevOps reports ${shown}`] })
  })
  it('mergeOptions for GitHub', async () => {
    const githubClient = { get: async (p) => (p.includes('/pulls?') ? [] : { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }) }
    expect(await makePRActions({ githubClient }).mergeOptions(ghPr)).toEqual({
      methods: [{ id: 'merge', label: 'Merge' }],
      rejectConfirm: 'Reject and close this pull request?',
      dependents: [],
    })
  })
  it('mergeOptions for ADO', async () => {
    const o = await makePRActions({}).mergeOptions(adoPr)
    expect(o.methods.map(m => m.id)).toEqual(['noFastForward', 'squash', 'rebase', 'rebaseMerge'])
    expect(o.rejectConfirm).toBe('Reject and abandon this pull request?')
  })
  describe('pull requests that depend on the branch about to be deleted', () => {
    const repoInfo = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }
    const ghClient = (pulls) => ({ get: vi.fn(async (p) => (p.includes('/pulls?') ? (typeof pulls === 'function' ? pulls(p) : pulls) : repoInfo)) })

    it('GitHub: lists the open PRs whose base is the source branch of this PR, by number', async () => {
      const githubClient = ghClient([{ number: 8, title: 'Next in the stack' }, { number: 9, title: 'Another' }])
      const o = await makePRActions({ githubClient }).mergeOptions(ghPr)
      expect(o.dependents).toEqual([{ id: 8, label: '#8', title: 'Next in the stack' }, { id: 9, label: '#9', title: 'Another' }])
      const asked = githubClient.get.mock.calls.map(c => c[0]).find(p => p.includes('/pulls?'))
      expect(asked).toBe('repos/acme/web/pulls?state=open&base=f&per_page=30')
    })

    it('GitHub: encodes a branch name with a slash or a space', async () => {
      const githubClient = ghClient([])
      await makePRActions({ githubClient }).mergeOptions({ ...ghPr, branch: 'feat/a b' })
      expect(githubClient.get.mock.calls.map(c => c[0]).find(p => p.includes('/pulls?'))).toContain('base=feat%2Fa%20b')
    })

    it('GitHub: a PR from a fork does not delete a branch here, so nothing depends on it and nothing is asked', async () => {
      const githubClient = ghClient([{ number: 8, title: 'x' }])
      const o = await makePRActions({ githubClient }).mergeOptions({ ...ghPr, headRepo: 'someone/web' })
      expect(o.dependents).toEqual([])
      expect(githubClient.get.mock.calls.some(c => c[0].includes('/pulls?'))).toBe(false)
    })

    it('GitHub: no branch known, nothing to ask', async () => {
      const githubClient = ghClient([{ number: 8, title: 'x' }])
      const o = await makePRActions({ githubClient }).mergeOptions({ ...ghPr, branch: '' })
      expect(o.dependents).toEqual([])
    })

    it('GitHub: a reply that is not a list counts as none', async () => {
      const o = await makePRActions({ githubClient: ghClient({ message: 'odd' }) }).mergeOptions(ghPr)
      expect(o.dependents).toEqual([])
    })

    it('when the lookup fails the merge options still come, and say the check could not be made', async () => {
      const githubClient = ghClient(() => { throw new Error('rate limited') })
      const o = await makePRActions({ githubClient }).mergeOptions(ghPr)
      expect(o.methods.length).toBe(3)
      expect(o.dependents).toEqual([])
      expect(o.dependentsError).toBe(true)
    })

    it('ADO: lists the active PRs in the repository that target the source branch, not the PR itself', async () => {
      const adoHttp = { fetch: vi.fn(async () => ok({ value: [{ pullRequestId: 9, title: 'Child' }, { pullRequestId: 5, title: 'self' }] })) }
      const o = await makePRActions({ adoHttp }).mergeOptions({ ...adoPr, sourceBranch: 'refs/heads/feat/one' })
      expect(o.dependents).toEqual([{ id: 9, label: '#9', title: 'Child' }])
      const [path] = adoHttp.fetch.mock.calls[0]
      expect(path).toBe('P/_apis/git/repositories/r1/pullrequests?searchCriteria.status=active&searchCriteria.targetRefName=refs%2Fheads%2Ffeat%2Fone&api-version=7.0')
    })

    it('ADO: no source branch known, nothing to ask', async () => {
      const adoHttp = { fetch: vi.fn(async () => ok({ value: [{ pullRequestId: 9, title: 'x' }] })) }
      const o = await makePRActions({ adoHttp }).mergeOptions(adoPr)
      expect(o.dependents).toEqual([])
      expect(adoHttp.fetch).not.toHaveBeenCalled()
    })

    it('ADO: a refused lookup says the check could not be made', async () => {
      const adoHttp = { fetch: vi.fn(async () => ({ ok: false, status: 403, text: async () => '' })) }
      const o = await makePRActions({ adoHttp }).mergeOptions({ ...adoPr, sourceBranch: 'refs/heads/feat' })
      expect(o.dependentsError).toBe(true)
      expect(o.dependents).toEqual([])
    })
  })
  it('GitHub PR without a client fails', async () => {
    await expect(makePRActions({ githubClient: null }).approve(ghPr)).rejects.toThrow('GitHub is not configured')
  })
})

describe('deleteBranchWarning / deleteBranchByDefault', () => {
  it('say nothing, and delete the branch, when nothing depends on it', () => {
    expect(deleteBranchWarning({ dependents: [] }, ghPr)).toBe('')
    expect(deleteBranchWarning({}, ghPr)).toBe('')
    expect(deleteBranchByDefault({ dependents: [] })).toBe(true)
    expect(deleteBranchByDefault({})).toBe(true)
  })
  it('keep the branch and name the PRs when some depend on it', () => {
    const o = { dependents: [{ id: 8, label: '#8', title: 'Next' }] }
    expect(deleteBranchByDefault(o)).toBe(false)
    expect(deleteBranchWarning(o, ghPr)).toBe('1 open pull request targets this branch: #8 Next. Deleting the branch would close them. Merge or retarget them first, or keep the branch.')
    expect(deleteBranchWarning(o, adoPr)).toContain('no target branch')
  })
  it('keep the branch and say so when the check failed', () => {
    const o = { dependents: [], dependentsError: true }
    expect(deleteBranchByDefault(o)).toBe(false)
    expect(deleteBranchWarning(o, ghPr)).toContain('could not check')
  })
})
