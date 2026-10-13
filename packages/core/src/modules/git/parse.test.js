import { describe, it, expect } from 'vitest'
import { parseStatus, parseWorktrees, parseBranches, statusCode, worktreeId, worktreeName, activeBranchRef, branchLabel } from './parse.js'

const REPO = { name: 'Test', path: 'C:/repos/Test' }

describe('parseStatus', () => {
  it('reads branch info and keeps staged and unstaged sides as separate changes', () => {
    const out = '# branch.oid abc\0# branch.head actual-branch\0# branch.upstream origin/main\0# branch.ab +2 -3\0' +
      '1 MM N... 100644 100644 100644 abc abc space [a].txt\0' +
      '2 R. N... 100644 100644 100644 abc abc R100 new name.txt\0old name.txt\0' +
      '? unknown ü.txt\0'
    const s = parseStatus(out)
    expect([s.branch, s.head, s.upstream, s.ahead, s.behind]).toEqual(['actual-branch', 'abc', 'origin/main', 2, 3])
    expect(s.changes.map(c => [c.area, c.path])).toEqual([
      ['staged', 'space [a].txt'], ['unstaged', 'space [a].txt'], ['staged', 'new name.txt'], ['untracked', 'unknown ü.txt'],
    ])
    expect(s.changes[2].originalPath).toBe('old name.txt')
    expect(new Set(s.changes.map(c => c.id)).size).toBe(4)
  })

  it('reports conflicts, a detached unborn HEAD, no upstream and leading-dash paths', () => {
    const s = parseStatus('# branch.oid (initial)\0# branch.head (detached)\0u UU N... 100644 100644 100644 100644 a b c -dash.txt\0')
    expect([s.branch, s.upstream, s.ahead, s.behind]).toEqual(['(detached)', null, 0, 0])
    expect(s.changes).toHaveLength(1)
    expect(s.changes[0]).toMatchObject({ area: 'conflict', path: '-dash.txt', xy: 'UU' })
  })

  it('treats a submodule with modified content as an unstaged change', () => {
    const s = parseStatus('1 .. S.M. 160000 160000 160000 a a vendor/lib\0')
    expect(s.changes.map(c => c.area)).toEqual(['unstaged'])
  })

  it('returns an empty result for empty output', () => {
    expect(parseStatus('')).toEqual({ branch: '(detached)', head: '', upstream: null, ahead: 0, behind: 0, changes: [] })
  })
})

describe('statusCode', () => {
  it('shows the staged side on the left and the unstaged side on the right', () => {
    expect(statusCode({ area: 'untracked', xy: '??' })).toBe('??')
    expect(statusCode({ area: 'conflict', xy: 'UU' })).toBe('UU')
    expect(statusCode({ area: 'staged', xy: 'R.' })).toBe('R ')
    expect(statusCode({ area: 'unstaged', xy: '.D' })).toBe(' D')
    expect(statusCode({ area: 'unstaged', xy: '..' })).toBe(' M')
  })
})

describe('parseWorktrees', () => {
  const out = 'worktree C:/repos/Test/.git-main\0bare\0\0' +
    'worktree C:/other/location\0HEAD abc\0detached\0locked keep me\0\0' +
    'worktree C:/repos/Test/topic dir\0HEAD def\0branch refs/heads/topic/x\0prunable gitdir file points to non-existent location\0\0'

  it('skips the bare entry and keeps detached, locked and prunable worktrees', () => {
    const trees = parseWorktrees(out, REPO, 'C:/repos/Test/.git-main')
    expect(trees).toHaveLength(2)
    expect(trees[0]).toMatchObject({ repo: 'Test', repoRoot: 'C:/repos/Test', commonDir: 'C:/repos/Test/.git-main', branch: '(detached)', head: 'abc', locked: 'keep me' })
    expect(trees[1]).toMatchObject({ branch: 'topic/x', head: 'def' })
    expect(trees[1].prunable).toMatch(/^gitdir file/)
    expect(trees[1].changes).toEqual([])
  })

  it('names worktrees relative to the repo folder', () => {
    const [external, topic] = parseWorktrees(out, REPO, 'x')
    expect(worktreeName(external)).toBe('C:/other/location')
    expect(worktreeName(topic)).toBe('topic dir')
    expect(worktreeName({ path: 'C:\\repos\\Test\\', repoRoot: 'C:/repos/test' })).toBe('checkout')
    expect(worktreeId({ path: 'C:\\repos\\Test\\a\\' })).toBe('C:/repos/Test/a')
  })

  it('works out the active branch ref, preferring the branch being rebased', () => {
    const [external, topic] = parseWorktrees(out, REPO, 'x')
    expect(activeBranchRef(topic)).toBe('refs/heads/topic/x')
    expect(activeBranchRef(external)).toBeNull()
    expect(activeBranchRef({ ...external, rebasingBranch: 'refs/heads/feature' })).toBe('refs/heads/feature')
    expect(branchLabel({ ...external, rebasingBranch: 'refs/heads/feature' })).toBe('feature (rebasing)')
    expect(branchLabel(topic)).toBe('topic/x')
  })
})

describe('parseBranches', () => {
  it('reads NUL-separated for-each-ref lines', () => {
    const b = parseBranches('refs/heads/main\0abc\0Initial\0origin/main\nrefs/heads/topic\0def\0Fix [x]\0\n', REPO, 'C:/c')
    expect(b).toEqual([
      { repo: 'Test', commonDir: 'C:/c', ref: 'refs/heads/main', head: 'abc', subject: 'Initial', upstream: 'origin/main', name: 'main', id: 'b:Test:refs/heads/main' },
      { repo: 'Test', commonDir: 'C:/c', ref: 'refs/heads/topic', head: 'def', subject: 'Fix [x]', upstream: null, name: 'topic', id: 'b:Test:refs/heads/topic' },
    ])
  })
})
