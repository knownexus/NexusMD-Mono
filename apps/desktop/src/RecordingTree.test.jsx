import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { RecordingTree } from './recording-tree.jsx'

afterEach(cleanup)

const T0 = 1_700_000_000_000
const enter = (id, p, fn, dt, a = [], over = {}) => ({ k: 'enter', id, p, fn, a, t: T0 + dt, proc: 'renderer', win: 1, ...over })
const ret = (id, v, dt, ms = 1) => ({ k: 'ret', id, v, t: T0 + dt, ms, proc: 'renderer' })
const err = (id, e, dt) => ({ k: 'err', id, e, t: T0 + dt, ms: 1, proc: 'renderer' })
const header = { nxrec: 1, id: 'rec-20261105-101500-ab12', label: 'merge test', startedAt: T0 }

// Merge click -> onMerge -> mergePr (a request that came back 405, and a thrown error), then an unrelated Refresh click.
const events = () => [
  { k: 'click', id: 'r1-1', p: null, d: { name: 'Merge', page: 'Pull Requests', tag: 'button' }, t: T0, proc: 'renderer', win: 1 },
  enter('r1-2', 'r1-1', 'apps/pr.jsx:10:2:onMerge', 5, [{ pr: 4411 }]),
  enter('r1-3', 'r1-2', 'core/pr-actions.js:15:7:mergePr', 12, [4411, 'squash']),
  { k: 'net', id: 'r1-4', p: 'r1-3', d: { method: 'PUT', url: 'https://api.example.com/pulls/4411/merge', headers: { accept: 'json' }, body: '{"m":1}', status: 405, responseHeaders: {}, responseBody: 'not allowed', ms: 120 }, t: T0 + 20, proc: 'renderer' },
  err('r1-3', { name: 'Error', message: 'HTTP 405', stack: 'Error: HTTP 405\n    at mergePr (pr-actions.js:20:9)' }, 140),
  ret('r1-2', null, 150, 145),
  { k: 'click', id: 'r1-9', p: null, d: { name: 'Refresh', page: 'Pull Requests', tag: 'button' }, t: T0 + 500, proc: 'renderer', win: 1 },
  enter('m1-1', 'r1-9', 'ipc:git:status', 502, ['C:/repo'], { proc: 'main', win: undefined }),
  ret('m1-1', { files: 3 }, 530, 28),
]
const quiet = () => events().filter(e => !['r1-3', 'r1-4'].includes(e.id) && !(e.k === 'err'))
const show = (evs, extra = {}) => render(<RecordingTree recording={{ header, events: evs, ...extra }} />)
const row = (name) => screen.getByRole('treeitem', { name: new RegExp(name) })
const rows = () => screen.queryAllByRole('treeitem')

describe('RecordingTree', () => {
  it('opens on the first failure: its callers are open and it is the one selected, with its error shown', () => {
    show(events())
    expect(rows().map(r => r.getAttribute('aria-level'))).toEqual(['1', '2', '3', '4', '1'])
    const failed = row('mergePr')
    expect(failed.getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByRole('region', { name: 'Details' })).getByText(/HTTP 405/)).toBeTruthy()
  })

  it('with nothing wrong, shows the actions closed; opening one shows its calls in order with how long after the start each ran', () => {
    show(quiet())
    expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('Clicked Merge'), expect.stringContaining('Clicked Refresh')])
    fireEvent.click(screen.getByRole('button', { name: 'Expand Clicked Merge' }))
    const [, onMerge] = rows()
    expect(onMerge.textContent).toContain('onMerge')
    expect(onMerge.textContent).toContain('+5 ms')
    expect(onMerge.textContent).toContain('145 ms')
  })

  it('selecting a call shows what it was given and what it returned', () => {
    show(quiet())
    fireEvent.click(screen.getByRole('button', { name: 'Expand Clicked Merge' }))
    fireEvent.click(row('onMerge'))
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByText(/"pr": 4411/)).toBeTruthy()
    expect(within(details).getByText('Returned')).toBeTruthy()
    expect(within(details).getByText('apps/pr.jsx:10')).toBeTruthy()
  })

  it('a call that threw shows what it threw, with its stack', () => {
    show(events())
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByText('Threw')).toBeTruthy()
    expect(within(details).getByText(/at mergePr \(pr-actions.js:20:9\)/)).toBeTruthy()
  })

  it('a request shows what was sent and what came back', () => {
    show(events())
    fireEvent.click(row('PUT api.example.com'))
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByText('Request')).toBeTruthy()
    expect(within(details).getByText(/"m":1/)).toBeTruthy()
    expect(within(details).getByText('Response')).toBeTruthy()
    expect(within(details).getByText(/not allowed/)).toBeTruthy()
  })

  it('an IPC call is shown by its channel and says it ran in the main process', () => {
    show(quiet())
    fireEvent.click(screen.getByRole('button', { name: 'Expand Clicked Refresh' }))
    fireEvent.click(row('git:status'))
    const details = screen.getByRole('region', { name: 'Details' })
    expect(within(details).getByText(/main process/i)).toBeTruthy()
    expect(within(details).getByText(/"files": 3/)).toBeTruthy()
  })

  it('"Errors only" keeps the path to each failure and hides the rest', () => {
    show(events())
    const toggle = screen.getByRole('button', { name: 'Errors only' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(rows().map(r => r.textContent.replace(/\s+/g, ' ')).join('|')).not.toContain('Refresh')
    expect(rows()).toHaveLength(4)
  })

  it('searching shows the matches and the calls above them', () => {
    show(quiet())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search recording' }), { target: { value: 'git:status' } })
    expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('Clicked Refresh'), expect.stringContaining('git:status')])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search recording' }), { target: { value: 'zzzz' } })
    expect(rows()).toHaveLength(0)
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })

  it('says where a recording stopped when it hit its size limit, and when it never finished', () => {
    show(events(), { })
    cleanup()
    show([...events(), { k: 'cap', t: T0 + 900, proc: 'main', reason: 'bytes' }])
    expect(screen.getByRole('status').textContent).toMatch(/size limit/i)
    cleanup()
    show([enter('m1-1', null, 'x.js:1:0:slow', 1)])
    expect(screen.getByRole('status').textContent).toMatch(/did not finish/i)
  })

  it('says that secrets matching a rule are hidden and anything else is shown', () => {
    show(quiet())
    expect(screen.getByText(/hidden.*everything else is shown/i)).toBeTruthy()
  })

  it('the arrow keys move through the calls, and left and right close and open them', () => {
    show(quiet())
    const tree = screen.getByRole('tree', { name: 'Recorded calls' })
    expect(row('Clicked Merge').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(rows()).toHaveLength(3)
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(row('onMerge').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })           // on a closed node: up to its parent
    expect(row('Clicked Merge').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })           // on an open one: close it
    expect(rows()).toHaveLength(2)
  })

  it('copies the file and line of a call', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    show(events())
    fireEvent.click(screen.getByRole('button', { name: 'Copy location' }))
    expect(writeText).toHaveBeenCalledWith('core/pr-actions.js:15')
  })

  it('a very long list of calls shows the first few hundred and offers the rest', () => {
    const many = [{ k: 'click', id: 'r1-1', p: null, d: { name: 'Big' }, t: T0, proc: 'renderer' }]
    for (let i = 0; i < 700; i++) many.push(enter(`r1-${i + 2}`, 'r1-1', `a.js:${i}:0:f${i}`, i + 1), ret(`r1-${i + 2}`, i, i + 2))
    show(many)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Clicked Big' }))
    expect(rows()).toHaveLength(1 + 300)
    fireEvent.click(screen.getByRole('button', { name: /Show 400 more/ }))
    expect(rows()).toHaveLength(1 + 700)
  })

  it('an empty recording says so', () => {
    show([])
    expect(screen.getByText(/nothing was recorded/i)).toBeTruthy()
  })
})

describe('background activity', () => {
  const withTimers = () => [
    ...quiet(),
    enter('r1-50', null, 'apps/poll.js:3:0:tick', 200), ret('r1-50', null, 201),
    enter('r1-51', null, 'apps/poll.js:3:0:tick', 700), ret('r1-51', null, 701),
  ]

  it('is left out of the top level when the person clicked something, and says how much is hidden', () => {
    show(withTimers())
    expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('Clicked Merge'), expect.stringContaining('Clicked Refresh')])
    expect(screen.getByText('2 background actions hidden')).toBeTruthy()
  })

  it('does not describe something that is hidden: the first thing the person did is the one selected', () => {
    show([enter('r1-40', null, 'apps/poll.js:3:0:early', -50), ret('r1-40', null, -49), ...quiet()])
    expect(row('Clicked Merge').getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { level: 3 }).textContent).toBe('Clicked Merge')
  })

  it('shows it again on request', () => {
    show(withTimers())
    const toggle = screen.getByRole('button', { name: 'Background activity' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(rows()).toHaveLength(4)
    expect(screen.queryByText(/background actions? hidden/)).toBeNull()
  })

  it('is shown anyway when it failed', () => {
    show([...quiet(), enter('r1-60', null, 'apps/poll.js:9:0:sync', 300), err('r1-60', { name: 'Error', message: 'offline' }, 301)])
    expect(rows().map(r => r.textContent).some(t => t.includes('sync'))).toBe(true)
  })

  it('is shown when a search finds it', () => {
    show(withTimers())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search recording' }), { target: { value: 'tick' } })
    expect(rows()).toHaveLength(2)
  })

  it('is all there is when nothing was clicked, so nothing is hidden', () => {
    show([enter('m1-1', null, 'x.js:1:0:startup', 1), ret('m1-1', null, 2)])
    expect(rows()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Background activity' })).toBeNull()
  })
})
