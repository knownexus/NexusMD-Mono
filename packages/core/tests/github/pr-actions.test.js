import { describe, it, expect, vi } from 'vitest'
import {
  GithubError, reviewGithubPR, closeGithubPR, githubMergeMethods, mergeGithubPR,
} from '../../src/modules/github/index.js'

const pr = { repo: 'acme/web', number: 7 }

describe('reviewGithubPR', () => {
  it('approves', async () => {
    const c = { post: vi.fn(async () => null) }
    await reviewGithubPR(c, pr, 'APPROVE')
    expect(c.post).toHaveBeenCalledWith('repos/acme/web/pulls/7/reviews', { event: 'APPROVE' })
  })
  it('requests changes with the fixed body', async () => {
    const c = { post: vi.fn(async () => null) }
    await reviewGithubPR(c, pr, 'REQUEST_CHANGES')
    expect(c.post).toHaveBeenCalledWith('repos/acme/web/pulls/7/reviews',
      { event: 'REQUEST_CHANGES', body: 'Waiting for author — sent from NexusMD' })
  })
  it('turns a 422 into a self-review message', async () => {
    const c = { post: vi.fn(async () => { throw new GithubError('x', { status: 422 }) }) }
    await expect(reviewGithubPR(c, pr, 'APPROVE')).rejects.toThrow("You can't review your own pull request")
  })
  it('rethrows other errors unchanged', async () => {
    const c = { post: vi.fn(async () => { throw new GithubError('nope', { status: 403 }) }) }
    await expect(reviewGithubPR(c, pr, 'APPROVE')).rejects.toThrow('nope')
  })
})

describe('closeGithubPR', () => {
  it('patches state closed', async () => {
    const c = { patch: vi.fn(async () => null) }
    await closeGithubPR(c, pr)
    expect(c.patch).toHaveBeenCalledWith('repos/acme/web/pulls/7', { state: 'closed' })
  })
})

describe('githubMergeMethods', () => {
  it('lists only allowed methods in order', async () => {
    const c = { get: vi.fn(async () => ({ allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true })) }
    expect(await githubMergeMethods(c, 'acme/web')).toEqual([
      { id: 'squash', label: 'Squash' }, { id: 'rebase', label: 'Rebase' },
    ])
    expect(c.get).toHaveBeenCalledWith('repos/acme/web')
  })
  it('returns all three when allowed', async () => {
    const c = { get: async () => ({ allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }) }
    expect((await githubMergeMethods(c, 'a/b')).map(m => m.id)).toEqual(['merge', 'squash', 'rebase'])
  })
  it('returns [] when none allowed', async () => {
    const c = { get: async () => ({ allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: false }) }
    expect(await githubMergeMethods(c, 'a/b')).toEqual([])
  })
})

describe('mergeGithubPR', () => {
  const target = { repo: 'acme/web', number: 7, branch: 'f', headRepo: 'acme/web' }
  const opts = { method: 'squash', deleteBranch: true }
  it('merges then deletes the branch', async () => {
    const c = { put: vi.fn(async () => null), del: vi.fn(async () => null) }
    expect(await mergeGithubPR(c, target, opts)).toEqual({ warnings: [] })
    expect(c.put).toHaveBeenCalledWith('repos/acme/web/pulls/7/merge', { merge_method: 'squash' })
    expect(c.del).toHaveBeenCalledWith('repos/acme/web/git/refs/heads/f')
  })
  it('keeps slashes in branch names as path segments', async () => {
    const c = { put: async () => null, del: vi.fn(async () => null) }
    await mergeGithubPR(c, { ...target, branch: 'feature/x y' }, opts)
    expect(c.del).toHaveBeenCalledWith('repos/acme/web/git/refs/heads/feature/x%20y')
  })
  it('does not delete a fork branch', async () => {
    const c = { put: vi.fn(async () => null), del: vi.fn() }
    await mergeGithubPR(c, { ...target, headRepo: 'fork/web' }, opts)
    expect(c.del).not.toHaveBeenCalled()
  })
  it('warns and does not delete when the head repo is another repository', async () => {
    const c = { put: async () => null, del: vi.fn() }
    expect(await mergeGithubPR(c, { ...target, headRepo: 'fork/web' }, opts)).toEqual({
      warnings: ['Merged, but the branch is in another repository and was not deleted'],
    })
    expect(c.del).not.toHaveBeenCalled()
  })
  it('never deletes when the head repo is unknown (deleted fork)', async () => {
    const c = { put: async () => null, del: vi.fn() }
    const r = await mergeGithubPR(c, { ...target, branch: 'main', headRepo: null }, opts)
    expect(c.del).not.toHaveBeenCalled()
    expect(r.warnings).toEqual(['Merged, but the branch is in another repository and was not deleted'])
  })
  it('compares repo names case-insensitively', async () => {
    const c = { put: async () => null, del: vi.fn(async () => null) }
    await mergeGithubPR(c, { ...target, headRepo: 'Acme/Web' }, opts)
    expect(c.del).toHaveBeenCalledWith('repos/acme/web/git/refs/heads/f')
  })
  it('does not delete when deleteBranch is false', async () => {
    const c = { put: vi.fn(async () => null), del: vi.fn() }
    expect(await mergeGithubPR(c, target, { method: 'merge', deleteBranch: false })).toEqual({ warnings: [] })
    expect(c.del).not.toHaveBeenCalled()
  })
  it('warns when the branch delete fails', async () => {
    const c = { put: async () => null, del: async () => { throw new Error('Reference does not exist') } }
    expect(await mergeGithubPR(c, target, opts)).toEqual({
      warnings: ['Merged, but the branch could not be deleted: Reference does not exist'],
    })
  })
  it('rejects when the merge fails, without deleting', async () => {
    const c = { put: async () => { throw new Error('Pull Request is not mergeable') }, del: vi.fn() }
    await expect(mergeGithubPR(c, target, opts)).rejects.toThrow('Pull Request is not mergeable')
    expect(c.del).not.toHaveBeenCalled()
  })
})
