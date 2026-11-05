import { describe, it, expect } from 'vitest'
import { buildTree, searchTree, firstError, parseFn } from './recording-model.js'

const enter = (id, p, fn, t, a = [], over = {}) => ({ k: 'enter', id, p, fn, a, t, proc: 'renderer', win: 1, ...over })
const ret = (id, v, t, ms = 1) => ({ k: 'ret', id, v, t, ms, proc: 'renderer' })
const err = (id, e, t, ms = 1) => ({ k: 'err', id, e, t, ms, proc: 'renderer' })

describe('parseFn', () => {
  it('splits a report id into file, line, column and name', () => {
    expect(parseFn('packages/core/src/modules/github/pr-actions.js:15:7:reviewGithubPR')).toEqual({ file: 'packages/core/src/modules/github/pr-actions.js', line: 15, col: 7, name: 'reviewGithubPR' })
    expect(parseFn('x.js:1:0:anonymous')).toMatchObject({ name: 'anonymous', line: 1 })
  })
  it('keeps a name that holds colons, and copes with something that is not a report id', () => {
    expect(parseFn('a/b.cjs:3:2:Foo:bar')).toMatchObject({ file: 'a/b.cjs', name: 'Foo:bar' })
    expect(parseFn('ipc:git:push')).toEqual({ name: 'ipc:git:push' })
    expect(parseFn(undefined)).toEqual({ name: '' })
  })
})

describe('buildTree', () => {
  it('nests calls by parent, in order, and attaches the return value and duration', () => {
    const tree = buildTree([
      { k: 'click', id: 'r1-1', p: null, d: { name: 'Merge', page: 'Pull Requests', tag: 'button' }, t: 1000, proc: 'renderer', win: 1 },
      enter('r1-2', 'r1-1', 'a.js:1:0:onMerge', 1001, [{ pr: 4411 }]),
      enter('r1-3', 'r1-2', 'b.js:9:2:mergePr', 1002, [4411]),
      ret('r1-3', { merged: true }, 1010, 8),
      ret('r1-2', undefined, 1012, 11),
    ])
    expect(tree.roots).toHaveLength(1)
    const click = tree.roots[0]
    expect(click).toMatchObject({ kind: 'click', title: 'Clicked Merge', start: 1000 })
    expect(click.children.map(c => c.title)).toEqual(['onMerge'])
    const merge = click.children[0].children[0]
    expect(merge).toMatchObject({ kind: 'call', title: 'mergePr', file: 'b.js', line: 9, args: [4411], value: { merged: true }, ms: 8 })
    expect(tree.byId.get('r1-3')).toBe(merge)
  })

  it('an error ends a call with the error, and marks it failed', () => {
    const tree = buildTree([enter('m1-1', null, 'x.js:1:0:f', 1), err('m1-1', { name: 'RangeError', message: 'no', stack: 'RangeError: no\n at f' }, 2)])
    expect(tree.roots[0]).toMatchObject({ failed: true, error: { name: 'RangeError', message: 'no' } })
  })

  it('a call with no return is listed as unfinished', () => {
    const tree = buildTree([enter('m1-1', null, 'x.js:1:0:slow', 1), enter('m1-2', 'm1-1', 'x.js:2:0:inner', 2), ret('m1-2', 1, 3)])
    expect(tree.unfinished.map(n => n.title)).toEqual(['slow'])
  })

  it("an IPC call whose parent is a window's call appears under it, across processes", () => {
    const tree = buildTree([
      enter('r1-5', null, 'c.js:1:0:onClick', 10),
      enter('m1-9', 'r1-5', 'ipc:git:push', 12, ['C:/repo'], { proc: 'main', win: undefined }),
      enter('m1-10', 'm1-9', 'modules/git/src/main/git-actions.cjs:40:2:push', 13, [], { proc: 'main' }),
      ret('m1-10', 'ok', 20), ret('m1-9', 'pushed', 21), ret('r1-5', null, 22),
    ])
    const ipc = tree.byId.get('r1-5').children[0]
    expect(ipc).toMatchObject({ kind: 'ipc', title: 'git:push', proc: 'main', value: 'pushed' })
    expect(ipc.children[0].title).toBe('push')
  })

  it('a call whose parent is not in the recording becomes a root of its own, as an action', () => {
    const tree = buildTree([enter('m1-1', 'x9-9', 'timers.js:1:0:tick', 5), enter('m1-2', null, 'timers.js:2:0:poll', 6)])
    expect(tree.roots.map(r => [r.kind, r.title])).toEqual([['action', 'tick'], ['action', 'poll']])
  })

  it('network requests and log lines are nodes with what they hold', () => {
    const tree = buildTree([
      enter('r1-1', null, 'a.js:1:0:merge', 1),
      { k: 'net', id: 'r1-2', p: 'r1-1', d: { method: 'PUT', url: 'https://api.example.com/pulls/4411/merge', status: 405, body: '{}', responseBody: 'not allowed', ms: 120 }, t: 2, proc: 'renderer' },
      { k: 'log', id: 'r1-3', p: 'r1-1', d: { lvl: 'error', mod: 'work', scope: 'pr', msg: 'merge failed', err: { name: 'Error', message: 'HTTP 405' } }, t: 3, proc: 'renderer' },
      ret('r1-1', null, 4),
    ])
    const [net, log] = tree.byId.get('r1-1').children
    expect(net).toMatchObject({ kind: 'net', title: 'PUT api.example.com/pulls/4411/merge 405', ms: 120 })
    expect(net.data.responseBody).toBe('not allowed')
    expect(log).toMatchObject({ kind: 'log', title: 'error: merge failed', failed: true })
  })

  it('says when the recording was cut short', () => {
    expect(buildTree([enter('m1-1', null, 'x.js:1:0:f', 1), { k: 'cap', t: 2, proc: 'main', reason: 'bytes' }])).toMatchObject({ capped: true, capReason: 'bytes' })
    expect(buildTree([]).capped).toBe(false)
  })

  it('orders the roots and each node\'s children by when they started, whatever order they arrived in', () => {
    const tree = buildTree([enter('m1-3', null, 'x.js:3:0:third', 30), enter('m1-1', null, 'x.js:1:0:first', 10), enter('m1-2', null, 'x.js:2:0:second', 20)])
    expect(tree.roots.map(r => r.title)).toEqual(['first', 'second', 'third'])
  })

  it('handles 50 000 events in about a second', () => {
    const events = []
    for (let i = 0; i < 25000; i++) { events.push(enter(`r1-${i}`, i === 0 ? null : `r1-${Math.floor(i / 5)}`, `x.js:${i}:0:f${i % 50}`, i, [i])); events.push(ret(`r1-${i}`, i, i + 1)) }
    const t0 = Date.now()
    const tree = buildTree(events)
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(tree.count).toBe(25000)
  })

  it('copes with events it does not know and with a return for a call it never saw', () => {
    expect(() => buildTree([{ k: 'mystery', id: 'x-1', t: 1 }, ret('nope-1', 1, 2), null, 7])).not.toThrow()
  })
})

describe('searchTree and firstError', () => {
  const tree = () => buildTree([
    { k: 'click', id: 'r1-1', p: null, d: { name: 'Merge', page: 'PRs' }, t: 1, proc: 'renderer' },
    enter('r1-2', 'r1-1', 'a.js:1:0:onMerge', 2, [{ title: 'Fix refund rounding' }]),
    enter('r1-3', 'r1-2', 'b.js:1:0:mergePr', 3, [4411]),
    err('r1-3', { name: 'Error', message: 'HTTP 405 not allowed' }, 4),
    ret('r1-2', null, 5),
    { k: 'click', id: 'r1-9', p: null, d: { name: 'Refresh' }, t: 6, proc: 'renderer' },
  ])

  it('returns the nodes that match, and the nodes above them', () => {
    expect([...searchTree(tree(), 'refund')].sort()).toEqual(['r1-1', 'r1-2'])
    expect([...searchTree(tree(), '405')].sort()).toEqual(['r1-1', 'r1-2', 'r1-3'])
    expect([...searchTree(tree(), 'zzz')]).toEqual([])
  })

  it('an empty search matches nothing special: it returns null (show everything)', () => {
    expect(searchTree(tree(), '')).toBeNull()
    expect(searchTree(tree(), '   ')).toBeNull()
  })

  it('firstError is the earliest failed node, whether a call threw or a line was logged as an error', () => {
    expect(firstError(tree()).id).toBe('r1-3')
    expect(firstError(buildTree([enter('m1-1', null, 'x.js:1:0:f', 1), ret('m1-1', 1, 2)]))).toBeNull()
    const logged = buildTree([{ k: 'log', id: 'r1-1', p: null, d: { lvl: 'error', msg: 'x' }, t: 5, proc: 'renderer' }, enter('r1-2', null, 'x.js:1:0:f', 9), err('r1-2', { name: 'E', message: 'm' }, 10)])
    expect(firstError(logged).id).toBe('r1-1')
  })
})
