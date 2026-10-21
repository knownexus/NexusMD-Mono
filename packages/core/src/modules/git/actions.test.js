import { describe, it, expect } from 'vitest'
import { ACTION_KINDS, BATCH_NOTE, actionTargets, previewModel, worktreeDefaultPath, checkBranchName } from './actions.js'
import { rebasePlan, moveRow, setRowAction, setRowMessage, rebaseTodo, rebaseMessages, rebaseProblems, messageRows } from './rebase-plan.js'
import { ACTIVITY_MAX, addActivity, failedTargets } from './activity.js'

const tree = over => ({
  repo: 'A', repoRoot: 'C:/repos/A', path: 'C:/repos/A/main', branch: 'main', rebasingBranch: null, head: 'a',
  upstream: 'origin/main', upstreamGone: false, operation: '', error: '', changes: [], ...over,
})

describe('actionTargets', () => {
  const trees = [
    tree(),
    tree({ path: 'C:/repos/A/feature', branch: 'feature', upstream: null }),
    tree({ repo: 'B', repoRoot: 'C:/repos/B', path: 'C:/repos/B', upstreamGone: true }),
    tree({ repo: 'C', repoRoot: 'C:/repos/C', path: 'C:/repos/C', operation: 'Rebase in progress' }),
    tree({ repo: 'D', repoRoot: 'C:/repos/D', path: 'C:/repos/D', error: 'Missing worktree' }),
  ]
  it('pulls across the group, ticking only what can fast-forward', () => {
    const t = actionTargets('pull', trees, null)
    expect(t.map(x => [x.repo, x.ticked, x.unavailable])).toEqual([
      ['A', true, null], ['A', false, 'no upstream'], ['B', false, 'upstream gone'], ['C', false, 'rebase in progress'], ['D', false, 'missing'],
    ])
    expect(t[0].title).toBe('A › main → main')
  })
  it('fetches once per repository', () => {
    expect(actionTargets('fetch', trees, null).map(t => t.repo)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('runs other actions on the selected worktree only', () => {
    const id = 'C:/repos/A/feature'
    const t = actionTargets('push', trees, id)
    expect(t).toHaveLength(1)
    expect(t[0].worktreePath).toBe(id)
    expect(t[0].unavailable).toBeNull()
  })
  it('knows every kind and refuses others', () => {
    expect(ACTION_KINDS).toHaveLength(17)
    expect(ACTION_KINDS).toContain('skip')
    expect(ACTION_KINDS).toContain('rebase')
    expect(() => actionTargets('reset', trees, null)).toThrow('Unknown action')
  })
})

describe('previewModel', () => {
  const target = (id, unavailable = null) => ({ id, title: id, unavailable })
  it('carries eligibility, reasons, programs and the batch note', () => {
    const m = previewModel('pull', [
      { target: target('a'), preview: { eligible: true, details: { behind: 2 }, programs: ['post-merge hook'], stamp: 's' } },
      { target: target('b'), preview: { eligible: false, reason: 'diverged' } },
      { target: target('c', 'no upstream') },
      { target: target('d'), error: 'boom' },
    ])
    expect(m.title).toBe('Pull')
    expect(m.note).toBe(BATCH_NOTE)
    expect(m.rows.map(r => [r.id, r.eligible, r.reason])).toEqual([['a', true, null], ['b', false, 'diverged'], ['c', false, 'no upstream'], ['d', false, 'boom']])
    expect(m.rows[0].programs).toEqual(['post-merge hook'])
    expect(previewModel('push', []).note).toBeNull()
  })
})

describe('worktreeDefaultPath', () => {
  it('follows devenv: the short name, path-illegal characters as dashes', () => {
    expect(worktreeDefaultPath('C:/repos/A', 'feature/x')).toBe('C:/repos/A/feature-x')
    expect(worktreeDefaultPath('C:/repos/A/', 'a:b*c')).toBe('C:/repos/A/a-b-c')
    expect(worktreeDefaultPath('C:\\repos\\A', 'origin/feature/x', { remote: true })).toBe('C:\\repos\\A/feature-x')
  })
})

describe('checkBranchName', () => {
  it.each(['feature/x', 'release-1.2', 'ünïcode', 'x@y'])('accepts %j', n => { expect(checkBranchName(n)).toBeNull() })
  it.each(['', 'a b', '-x', '/x', 'x/', 'x.', 'x.lock', 'a..b', 'a@{b', 'a//b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', '@', 'a/.b', '.a', 'a.lock/b', 'HEAD', 'a\tb'])('refuses %j', n => {
    expect(checkBranchName(n)).toEqual(expect.any(String))
  })
})

describe('rebase plan', () => {
  const commits = ['1', '2', '3', '4'].map(n => ({ oid: n.repeat(40), subject: `c${n}` }))
  const o = n => n.repeat(40)
  it('starts as picks and builds a todo', () => {
    const rows = rebasePlan(commits)
    expect(rebaseTodo(rows)).toBe(commits.map(c => `pick ${c.oid}\n`).join(''))
  })
  it('moves, changes and words rows', () => {
    let rows = moveRow(rebasePlan(commits), o('3'), -2)
    expect(rows.map(r => r.subject)).toEqual(['c3', 'c1', 'c2', 'c4'])
    expect(moveRow(rows, o('3'), -1)).toBe(rows)
    rows = setRowAction(rows, o('4'), 'drop')
    expect(rebaseTodo(rows).split('\n')[3]).toBe(`drop ${o('4')}`)
    expect(() => setRowAction(rows, o('1'), 'edit')).toThrow('Unknown rebase action')
  })
  it('keys a reword by its commit and a squash group by its last commit', () => {
    let rows = rebasePlan(commits)
    rows = setRowAction(rows, o('2'), 'squash')
    rows = setRowAction(rows, o('3'), 'fixup')
    rows = setRowMessage(rows, o('3'), 'one, two and three')
    rows = setRowAction(rows, o('4'), 'reword')
    rows = setRowMessage(rows, o('4'), 'four, renamed')
    expect(rebaseMessages(rows)).toEqual({ [o('3')]: 'one, two and three', [o('4')]: 'four, renamed' })
    expect([...messageRows(rows)]).toEqual([o('3'), o('4')])
  })
  it('a squash group with no message keeps git\'s', () => {
    const rows = setRowAction(rebasePlan(commits), o('2'), 'squash')
    expect(rebaseMessages(rows)).toEqual({})
  })
  it('names what blocks a run', () => {
    expect(rebaseProblems(rebasePlan(commits))).toEqual([])
    expect(rebaseProblems(setRowAction(rebasePlan(commits), o('1'), 'squash'))).toEqual(["The first commit can't be squashed or fixed up."])
    expect(rebaseProblems(commits.reduce((rows, c) => setRowAction(rows, c.oid, 'drop'), rebasePlan(commits)))).toEqual(['Keep at least one commit.'])
    expect(rebaseProblems(setRowAction(rebasePlan(commits), o('2'), 'reword'))).toEqual(['Give 2222222 a message.'])
  })
})

describe('activity', () => {
  it('keeps the newest first, capped, and lists a run\'s failures', () => {
    let log = []
    for (let i = 0; i < ACTIVITY_MAX + 5; i++) log = addActivity(log, { runId: i < 3 ? 'r1' : 'r2', targetId: `t${i % 3}`, ok: i !== 1, at: i })
    expect(log).toHaveLength(ACTIVITY_MAX)
    expect(log[0].at).toBe(ACTIVITY_MAX + 4)
    expect(failedTargets(log, 'r2')).toEqual([])
    expect(failedTargets(addActivity([], { runId: 'x', targetId: 'a', ok: false }), 'x')).toEqual(['a'])
  })
})
