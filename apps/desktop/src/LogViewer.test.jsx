import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LogViewer from './log-viewer.jsx'
import LogsCard from './logs-card.jsx'

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ title, children }) => <section aria-label={title}>{children}</section>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  Icon: () => null,
}))

const e = (o = {}) => ({ sid: 's1', seq: 0, ts: '2026-11-04T12:00:00.000Z', lvl: 'info', mod: 'git', msg: 'hello', ...o })

let logs
let pushBatch
const stopTail = vi.fn()

beforeEach(() => {
  pushBatch = null
  logs = {
    modules: vi.fn(() => Promise.resolve([
      { mod: 'core', days: [{ date: '2026-11-04', size: 2048 }] },
      { mod: 'git', days: [{ date: '2026-11-04', size: 1024 }, { date: '2026-11-03', size: 10 }] },
    ])),
    query: vi.fn(() => Promise.resolve({
      entries: [
        e({ seq: 1, msg: 'fetched origin' }),
        e({ seq: 2, lvl: 'error', msg: 'push failed', err: { name: 'Error', message: 'rejected by remote' }, cid: 'c-abc123', via: ['core'] }),
      ],
      truncated: false, skipped: 0,
    })),
    follow: vi.fn(() => Promise.resolve({
      entries: [
        e({ seq: 1, mod: 'core', msg: 'handler started', cid: 'c-abc123' }),
        e({ seq: 2, mod: 'git', lvl: 'error', msg: 'push failed', cid: 'c-abc123', ts: '2026-11-04T12:00:01.000Z' }),
        e({ seq: 3, mod: 'devenv', lvl: 'warn', msg: 'exited 1', cid: 'c-abc123', ts: '2026-11-04T12:00:02.000Z' }),
      ],
      modules: ['core', 'git', 'devenv'], truncated: false, skipped: 0,
    })),
    tailStart: vi.fn(() => Promise.resolve([])),
    tailStop: vi.fn(() => { stopTail(); return Promise.resolve(true) }),
    onEntries: vi.fn(cb => { pushBatch = cb; return () => { pushBatch = null } }),
    list: vi.fn(() => Promise.resolve([])),
    read: vi.fn(), delete: vi.fn(),
  }
  vi.stubGlobal('electronAPI', { logs })
  window.electronAPI = { logs }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.electronAPI; stopTail.mockClear() })

describe('LogViewer', () => {
  it('says so outside the desktop app', () => {
    delete window.electronAPI
    render(<LogViewer />)
    expect(screen.getByText(/only available in the desktop app/i)).toBeTruthy()
  })

  it('invites the first entry when nothing has been logged', async () => {
    logs.modules.mockResolvedValue([])
    render(<LogViewer />)
    await waitFor(() => expect(screen.getByText(/No logs yet/)).toBeTruthy())
  })

  it('shows the modules and the newest day, with the default levels', async () => {
    render(<LogViewer />)
    await waitFor(() => expect(screen.getByText('fetched origin')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'git' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'core' })).toBeTruthy()
    expect(logs.query).toHaveBeenLastCalledWith({ date: '2026-11-04', mods: [], levels: ['error', 'warn', 'info'], text: '' })
    expect(screen.getByRole('button', { name: 'Follow this call: core, then git' })).toBeTruthy()   // the entry's route: one click to follow it
  })

  it('switches module and level by asking for just those', async () => {
    render(<LogViewer />)
    await waitFor(() => screen.getByText('fetched origin'))
    fireEvent.click(screen.getByRole('button', { name: 'git' }))
    await waitFor(() => expect(logs.query).toHaveBeenLastCalledWith(expect.objectContaining({ mods: ['git'] })))
    fireEvent.click(screen.getByRole('button', { name: /debug/ }))
    await waitFor(() => expect(logs.query).toHaveBeenLastCalledWith(expect.objectContaining({ levels: ['error', 'warn', 'info', 'debug'] })))
    fireEvent.click(screen.getByRole('button', { name: 'All modules' }))
    await waitFor(() => expect(logs.query).toHaveBeenLastCalledWith(expect.objectContaining({ mods: [] })))
  })

  it('searches after a short pause', async () => {
    render(<LogViewer />)
    await waitFor(() => screen.getByText('fetched origin'))
    fireEvent.change(screen.getByRole('searchbox', { name: /search logs/i }), { target: { value: 'rejected' } })
    await waitFor(() => expect(logs.query).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'rejected' })))
  })

  it('shows an entry\'s error and offers to follow its call', async () => {
    render(<LogViewer />)
    const row = await screen.findByText('push failed')
    fireEvent.click(row)
    expect(screen.getByText(/Error: rejected by remote/)).toBeTruthy()
    expect(screen.getByText(/reached through core/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Follow this call' }))
    await waitFor(() => expect(logs.follow).toHaveBeenCalledWith('c-abc123'))
    const route = await screen.findByRole('list', { name: /modules this call passed through/i })
    expect(route.textContent).toContain('core')
    expect(route.textContent).toContain('devenv')
    expect(route.textContent).toContain('1 failed')
    expect(screen.getByText(/Following one call: 3 modules, 3 entries, 2\.0 s/)).toBeTruthy()
    expect(screen.getByText('exited 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /back to the day/i }))
    await waitFor(() => expect(screen.getByText('fetched origin')).toBeTruthy())
  })

  it('follows a call straight from its row, without opening the entry first', async () => {
    render(<LogViewer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Follow this call: core, then git' }))
    await waitFor(() => expect(logs.follow).toHaveBeenCalledWith('c-abc123'))
    expect(await screen.findByRole('list', { name: /modules this call passed through/i })).toBeTruthy()
  })

  it('shows each entry of a followed call as how long after the start it happened', async () => {
    render(<LogViewer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Follow this call: core, then git' }))
    await screen.findByRole('list', { name: /modules this call passed through/i })
    const list = screen.getByRole('list', { name: 'Log entries' })
    expect(list.textContent).toContain('+0 ms')
    expect(list.textContent).toContain('+1.0 s')
    expect(list.textContent).toContain('+2.0 s')
  })

  it('lets the reader focus on one module of a followed call, and back to all', async () => {
    render(<LogViewer />)
    fireEvent.click(await screen.findByRole('button', { name: 'Follow this call: core, then git' }))
    await screen.findByRole('list', { name: /modules this call passed through/i })
    const rowOf = (text) => screen.getByText(text).closest('li')
    expect(rowOf('exited 1').dataset.dim).toBeUndefined()
    const hop = screen.getByRole('button', { name: /^devenv/ })
    expect(hop.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(hop)
    expect(hop.getAttribute('aria-pressed')).toBe('true')
    expect(rowOf('exited 1').dataset.dim).toBeUndefined()      // devenv's own row stays
    expect(rowOf('push failed').dataset.dim).toBe('true')      // the others step back
    expect(rowOf('handler started').dataset.dim).toBe('true')
    fireEvent.click(hop)
    expect(rowOf('push failed').dataset.dim).toBeUndefined()
  })

  it('goes back to the same place in the day, and marks the entry it came from', async () => {
    render(<LogViewer />)
    const route = await screen.findByRole('button', { name: 'Follow this call: core, then git' })
    const list = screen.getByRole('list', { name: 'Log entries' })
    list.scrollTop = 120; fireEvent.scroll(list)
    fireEvent.click(route)
    await screen.findByRole('list', { name: /modules this call passed through/i })
    fireEvent.click(screen.getByRole('button', { name: /back to the day/i }))
    await waitFor(() => expect(screen.getByText('fetched origin')).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Log entries' }).scrollTop).toBe(120)
    expect(screen.getByText('push failed').closest('li').dataset.from).toBe('true')
  })

  it('shows only the first line of a long message, says how many more there are, and gives all of it when opened', async () => {
    logs.query.mockResolvedValue({ entries: [e({ seq: 1, msg: 'Policy warning\n  line two\n\nline three' })], truncated: false, skipped: 0 })
    render(<LogViewer />)
    expect(await screen.findByText('Policy warning')).toBeTruthy()
    expect(screen.getByText('+2 lines')).toBeTruthy()
    expect(screen.queryByText(/line two/)).toBeNull()
    fireEvent.click(screen.getByText('Policy warning'))
    expect(document.querySelector('pre').textContent).toContain('line two')
  })

  it('says the level of each entry in words for screen readers, not only by colour', async () => {
    render(<LogViewer />)
    const row = (await screen.findByText('push failed')).closest('li')
    expect(row.textContent).toMatch(/error/)
  })

  it('shows an error once when its stack already starts with it', async () => {
    logs.query.mockResolvedValue({
      entries: [e({ seq: 1, lvl: 'error', msg: 'boom', err: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at Board (work.jsx:1:1)' } })],
      truncated: false, skipped: 0,
    })
    render(<LogViewer />)
    fireEvent.click(await screen.findByText(/boom/))
    expect(screen.getAllByText(/TypeError: x is undefined/)).toHaveLength(1) // the open row drops its one-line summary
    expect(document.querySelector('pre').textContent.match(/TypeError: x is undefined/g)).toHaveLength(1)
  })

  it('goes live: appends new entries that match, and stops when switched off', async () => {
    render(<LogViewer />)
    await waitFor(() => screen.getByText('fetched origin'))
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }))
    await waitFor(() => expect(logs.tailStart).toHaveBeenCalled())
    await waitFor(() => expect(pushBatch).toBeTruthy())
    act(() => { pushBatch([e({ seq: 9, msg: 'just now' }), e({ seq: 10, lvl: 'debug', msg: 'too chatty' })]) })
    expect(screen.getByText('just now')).toBeTruthy()
    expect(screen.queryByText('too chatty')).toBeNull()   // debug is off
    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    await waitFor(() => expect(stopTail).toHaveBeenCalled())
  })

  it('tells the reader when a query fails', async () => {
    logs.query.mockRejectedValue(new Error('disk gone'))
    render(<LogViewer />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/)
  })

  it('says when filters hide everything, and how many were cut off', async () => {
    logs.query.mockResolvedValue({ entries: [], truncated: true, skipped: 2 })
    render(<LogViewer />)
    expect(await screen.findByText(/Nothing matches/)).toBeTruthy()
    expect(screen.getByText(/2 damaged lines were skipped/)).toBeTruthy()
  })
})

describe('LogsCard', () => {
  it('shows the viewer, and the earlier daily files only when there are some', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByText('fetched origin'))
    expect(screen.queryByRole('region', { name: 'Earlier logs' })).toBeNull()
    cleanup()
    logs.list.mockResolvedValue([{ date: '2026-07-01', size: 10 }])
    logs.read.mockResolvedValue('')
    render(<LogsCard />)
    expect(await screen.findByRole('region', { name: 'Earlier logs' })).toBeTruthy()
  })
})
