import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { DevenvRunProvider, useDevenvRunContext } from './devenv-run-context.jsx'
import { DevenvView } from './view-devenv.jsx'

const CATALOG = {
  type: 'result', kind: 'catalog', protocol: 1, profileError: null,
  groups: [{ id: '', title: 'Everyday' }],
  commands: [{ group: '', verb: 'status', args: '', summary: 'At a glance', switches: [], values: [], mut: false }],
}

function fakeAdapter() {
  const l = { line: [], exit: [] }
  return {
    isAvailable: () => true,
    catalog: vi.fn(async () => CATALOG),
    run: vi.fn(async () => ({ runId: 1 })),
    answer: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    active: vi.fn(async () => []),
    onLine: cb => { l.line.push(cb); return () => { l.line = l.line.filter(x => x !== cb) } },
    onExit: cb => { l.exit.push(cb); return () => { l.exit = l.exit.filter(x => x !== cb) } },
    line: m => l.line.forEach(cb => cb(m)),
    exit: m => l.exit.forEach(cb => cb(m)),
  }
}

let ctx
function Grab() { ctx = useDevenvRunContext(); return null }

describe('DevenvRunProvider', () => {
  beforeEach(() => { localStorage.clear(); ctx = null })
  afterEach(cleanup)

  it('shows a prompt dialog even when no devenv screen is mounted, and answers it', async () => {
    const a = fakeAdapter()
    render(<DevenvRunProvider adapter={a}><Grab /><div>Dashboard</div></DevenvRunProvider>)
    await act(() => ctx.start(['clean'], { exclusive: true, label: 'devenv clean' }))
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv {"type":"prompt","id":"p1","kind":"choice","title":"Clean - reclaim disk","default":"1","options":[{"value":"1","label":"Remove old commits"}]}' }))
    screen.getByText('Clean - reclaim disk')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(a.answer).toHaveBeenCalledWith(1, { id: 'p1', value: '1' }))
    expect(screen.queryByText('Clean - reclaim disk')).toBeNull()
  })

  it('renders a plan prompt as the plan dialog and answers it with devplan\'s result', async () => {
    const a = fakeAdapter()
    render(<DevenvRunProvider adapter={a}><Grab /></DevenvRunProvider>)
    await act(() => ctx.start(['start'], { exclusive: true, label: 'devenv start' }))
    const plan = { locked: true, lockError: null, database: 'asis', services: [], backups: [], testApis: [], testServices: [] }
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv ' + JSON.stringify({ type: 'prompt', id: 'p1', kind: 'plan', title: 'Review', plan }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(a.answer).toHaveBeenCalledWith(1, { id: 'p1', value: expect.objectContaining({ action: 'start' }) }))
  })

  it('notifies about a prompt that arrives while the window is unfocused', async () => {
    const a = fakeAdapter()
    const notify = vi.fn()
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    render(<DevenvRunProvider adapter={a} notify={notify}><Grab /></DevenvRunProvider>)
    await act(() => ctx.start(['clean'], { exclusive: true, label: 'devenv clean' }))
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv {"type":"prompt","id":"p1","kind":"text","title":"Branch"}' }))
    expect(notify).toHaveBeenCalledWith('devenv needs an answer', 'Branch')
    focus.mockRestore()
  })

  it('renders only its children when devenv is unavailable', () => {
    render(<DevenvRunProvider adapter={{ isAvailable: () => false }}><Grab /><div>Dashboard</div></DevenvRunProvider>)
    screen.getByText('Dashboard')
    expect(ctx).toBeNull()
  })

  it('offers to cancel runs left over from before a reload', async () => {
    const a = fakeAdapter()
    a.active = vi.fn()
      .mockResolvedValueOnce([{ runId: 4, label: 'devenv start', exclusive: true }])
      .mockResolvedValue([])
    render(<DevenvRunProvider adapter={a}><DevenvView adapters={{ devenv: a }} /></DevenvRunProvider>)
    await waitFor(() => screen.getByText('devenv is still running devenv start from before the window reloaded'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(a.cancel).toHaveBeenCalledWith(4))
    await waitFor(() => expect(screen.queryByText(/from before the window reloaded/)).toBeNull())
    expect(a.active).toHaveBeenCalledTimes(2)
  })

  it('drops a leftover run from the banner when it exits on its own', async () => {
    const a = fakeAdapter()
    a.active = vi.fn(async () => [{ runId: 4, label: 'devenv start', exclusive: true }])
    render(<DevenvRunProvider adapter={a}><DevenvView adapters={{ devenv: a }} /></DevenvRunProvider>)
    await waitFor(() => screen.getByText(/devenv start from before the window reloaded/))
    act(() => a.exit({ runId: 4, code: 0, cancelled: false }))
    expect(screen.queryByText(/from before the window reloaded/)).toBeNull()
  })

  it('shows an error when cancelling a leftover run fails', async () => {
    const a = fakeAdapter()
    a.active = vi.fn(async () => [{ runId: 4, label: 'devenv start', exclusive: true }])
    a.cancel = vi.fn(async () => { throw new Error('taskkill failed') })
    render(<DevenvRunProvider adapter={a}><DevenvView adapters={{ devenv: a }} /></DevenvRunProvider>)
    await waitFor(() => screen.getByText(/from before the window reloaded/))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => screen.getByText('taskkill failed'))
  })
})
