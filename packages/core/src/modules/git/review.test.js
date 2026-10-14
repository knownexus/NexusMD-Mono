import { describe, it, expect } from 'vitest'
import { fileReview, commitTargets, commitReview, COMMIT_NOTE } from './review.js'

const c = (area, path, extra = {}) => ({ path, originalPath: null, xy: area === 'staged' ? 'M.' : '.M', area, sub: 'N...', id: `${area}\0${path}`, ...extra })
const tree = (name, changes, extra = {}) => ({
  repo: 'App', repoRoot: 'C:/repos/App', path: name === 'checkout' ? 'C:/repos/App' : `C:/repos/App/${name}`,
  branch: 'main', rebasingBranch: null, operation: '', error: '', changes, ...extra,
})

describe('fileReview', () => {
  const changes = [c('unstaged', 'a.txt'), c('untracked', 'b.txt'), c('staged', 'moved.txt', { originalPath: 'was.txt', xy: 'R.' }), c('unstaged', 'lib', { sub: 'SC..' })]
  const all = changes.map(x => x.id)

  it('lists the files an action applies to and the ones it skips', () => {
    const r = fileReview('stage', changes, all)
    expect(r.title).toBe('Stage 2 files')
    expect(r.files.map(f => [f.code, f.path])).toEqual([[' M', 'a.txt'], ['??', 'b.txt']])
    expect(r.paths).toEqual(['a.txt', 'b.txt'])
    expect(r.skipped.map(s => [s.path, s.reason])).toEqual([
      ['moved.txt', 'not applicable to stage'], ['lib', 'submodule — manage it inside the submodule'],
    ])
    expect([r.warning, r.needsTyping]).toEqual([null, null])
  })

  it('includes both names of a renamed file in the paths', () => {
    expect(fileReview('unstage', changes, all).paths).toEqual(['moved.txt', 'was.txt'])
    expect(fileReview('unstage', changes, all).title).toBe('Unstage 1 file')
  })

  it('asks for a typed word before destructive actions', () => {
    const discard = fileReview('discard', changes, all)
    expect([discard.title, discard.needsTyping]).toEqual(['Discard changes in 1 file', 'DISCARD'])
    expect(discard.warning).toBe("Unstaged edits in these files will be lost. This can't be undone.")
    const del = fileReview('delete', changes, all)
    expect([del.title, del.needsTyping]).toEqual(['Delete 1 file', 'DELETE'])
    expect(del.warning).toBe("These untracked files will be deleted from disk. This can't be undone.")
  })
})

describe('commit targets and review', () => {
  const worktrees = [
    tree('checkout', [c('staged', 'a.txt'), c('unstaged', 'b.txt')]),
    tree('feature', [c('staged', 'c.txt')], { branch: 'feature' }),
    tree('clean', []),
    tree('merging', [c('staged', 'd.txt')], { operation: 'Merge in progress' }),
    tree('conflicted', [c('staged', 'e.txt'), c('conflict', 'f.txt', { xy: 'UU' })]),
    tree('broken', [c('staged', 'g.txt')], { error: 'boom' }),
  ]

  it('lists worktrees with staged changes, ticking only the selected one and explaining unavailable ones', () => {
    const t = commitTargets(worktrees, 'C:/repos/App')
    expect(t.map(x => [x.title, x.ticked, x.unavailable])).toEqual([
      ['App › checkout → main', true, null],
      ['App › feature → feature', false, null],
      ['App › merging → main', false, 'Merge in progress: continue or abort it first'],
      ['App › conflicted → main', false, 'Resolve conflicts first'],
    ])
    expect(t[0].staged.map(x => x.path)).toEqual(['a.txt'])
    expect(t[0].id).toBe('C:/repos/App')
  })

  it('builds one block per ticked target with the shared or per-target message', () => {
    const targets = commitTargets(worktrees, 'C:/repos/App').map(x => x.title.includes('feature') ? { ...x, ticked: true } : x)
    const shared = commitReview(targets, { message: '  Fix it  ' })
    expect(shared.blocks.map(b => [b.title, b.files, b.message])).toEqual([
      ['App › checkout → main', ['M  a.txt'], 'Fix it'], ['App › feature → feature', ['M  c.txt'], 'Fix it'],
    ])
    expect([shared.note, shared.error]).toEqual([COMMIT_NOTE, null])
    const per = commitReview(targets, { perTarget: { 'C:/repos/App': 'One' } })
    expect(per.blocks.map(b => b.message)).toEqual(['One', ''])
    expect(per.error).toBe('Enter a commit message.')
    expect(commitReview(targets.map(x => ({ ...x, ticked: false })), { message: 'x' }).error).toBe('Choose at least one worktree.')
  })

  it('keeps the exact note text', () => {
    expect(COMMIT_NOTE).toBe('Each worktree commits separately; if one fails the others are not undone.')
  })
})
