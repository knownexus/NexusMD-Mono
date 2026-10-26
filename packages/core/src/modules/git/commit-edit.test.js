import { describe, it, expect } from 'vitest'
import { rewordProblem, squashPreviousProblem, squashSelectedProblem, editPlan, squashMessage } from './commit-edit.js'
import { rebaseMessages, rebaseProblems } from './rebase-plan.js'

// Newest first, linear: d -> c -> b -> a -> root
const commits = [
  { oid: 'd', subject: 'D', parents: ['c'] },
  { oid: 'c', subject: 'C', parents: ['b'] },
  { oid: 'b', subject: 'B', parents: ['a'] },
  { oid: 'a', subject: 'A', parents: ['root'] },
]
const all = new Set(['a', 'b', 'c', 'd'])

describe('rewordProblem', () => {
  it('refuses pushed and merge commits', () => {
    expect(rewordProblem(commits[0], new Set(['c']))).toBe('Already pushed')
    expect(rewordProblem({ oid: 'm', parents: ['x', 'y'] }, new Set(['m']))).toBe("Merge commits can't be reworded here")
    expect(rewordProblem(commits[0], all)).toBeNull()
  })
})

describe('squashPreviousProblem', () => {
  it('allows folding into an own, unpushed previous commit', () => {
    expect(squashPreviousProblem(commits, 0, all, new Set(['a', 'b', 'c', 'd']), 'refs/heads/master')).toBeNull()
  })
  it('refuses when the previous commit is on the source', () => {
    expect(squashPreviousProblem(commits, 3, all, new Set(['b', 'c', 'd']), 'refs/heads/master')).toBe('The previous commit is on master')
  })
  it('refuses a pushed previous commit and merges', () => {
    expect(squashPreviousProblem(commits, 0, new Set(['d']), null, null)).toBe('The previous commit is already pushed')
    const merged = [{ oid: 'm', parents: ['x', 'y'] }, ...commits.slice(1)]
    expect(squashPreviousProblem(merged, 0, all.add('m'), null, null)).toBe("Merge commits can't be squashed here")
  })
})

describe('squashSelectedProblem', () => {
  it('needs adjacent commits', () => {
    expect(squashSelectedProblem(commits, ['d', 'b'], all)).toBe('Pick commits that are next to each other')
    expect(squashSelectedProblem(commits, ['c', 'd'], all)).toBeNull()
  })
  it('refuses merges, pushed commits and a single pick', () => {
    const merged = [{ oid: 'm', parents: ['c', 'y'] }, ...commits.slice(1)]
    expect(squashSelectedProblem(merged, ['m', 'c'], new Set(['m', 'c']))).toBe("Merge commits can't be squashed here")
    expect(squashSelectedProblem(commits, ['d', 'c'], new Set(['d']))).toBe('Already pushed')
    expect(squashSelectedProblem(commits, ['d'], all)).toBeTruthy()
  })
})

describe('editPlan', () => {
  it('rewords one commit, keeping the newer ones as picks', () => {
    const plan = editPlan(commits.slice(0, 3), { kind: 'reword', oid: 'c', message: 'New' })
    expect(plan.base).toBe('b')
    expect(plan.rows.map(r => [r.oid, r.action, r.message])).toEqual([['c', 'reword', 'New'], ['d', 'pick', null]])
  })
  it('squashes adjacent commits with the message on the last row of the group', () => {
    const plan = editPlan(commits, { kind: 'squash', oids: ['c', 'b'], message: 'Both' })
    expect(plan.base).toBe('a')
    expect(plan.rows.map(r => [r.oid, r.action, r.message])).toEqual([['b', 'pick', null], ['c', 'squash', 'Both'], ['d', 'pick', null]])
    expect(rebaseMessages(plan.rows)).toEqual({ c: 'Both' })
    expect(rebaseProblems(plan.rows)).toEqual([])
  })
  it('throws on an unknown oid', () => {
    expect(() => editPlan(commits, { kind: 'reword', oid: 'zz', message: 'x' })).toThrow()
  })
  it('throws for a squash of commits that are not next to each other, repeated, or too few', () => {
    expect(() => editPlan(commits, { kind: 'squash', oids: ['d', 'b'], message: 'x' })).toThrow('next to each other')
    expect(() => editPlan(commits, { kind: 'squash', oids: ['c', 'c'], message: 'x' })).toThrow()
    expect(() => editPlan(commits, { kind: 'squash', oids: ['c'], message: 'x' })).toThrow()
    expect(() => editPlan(commits, { kind: 'squash', oids: ['c', 'zz'], message: 'x' })).toThrow()
    expect(editPlan(commits, { kind: 'squash', oids: ['b', 'd', 'c'], message: 'x' }).base).toBe('a')
  })
})

describe('squashMessage', () => {
  it('trims and joins with a blank line', () => {
    expect(squashMessage(['  one\n', 'two  '])).toBe('one\n\ntwo')
  })
})
