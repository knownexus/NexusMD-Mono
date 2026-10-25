import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { CommandsView } from './commands-view.jsx'
import { DevenvRunProvider } from './devenv-run-context.jsx'

const CATALOG = {
  type: 'result', kind: 'catalog', protocol: 1, profileError: null,
  groups: [{ id: '', title: 'Everyday' }, { id: 'emulator', title: 'Emulator' }, { id: 'setup', title: 'Setup' }],
  commands: [
    { group: '', verb: 'status', args: '', summary: 'At a glance', switches: [], values: [], mut: false },
    { group: '', verb: 'clean', args: '', summary: 'Free disk space', switches: [], values: [], mut: true },
    { group: 'emulator', verb: 'push', args: '<file> [<file>...]', summary: 'Copy files', switches: [], values: ['to'], mut: true, pathArgs: 'file' },
    { group: 'setup', verb: 'shell', args: '', summary: 'Profile function', switches: [], values: [], hidden: true },
  ],
}

function fakeAdapter(catalog = CATALOG) {
  const l = { line: [], exit: [] }
  return {
    l,
    isAvailable: () => true,
    catalog: vi.fn(async () => catalog),
    run: vi.fn(async () => ({ runId: 1 })),
    answer: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { l.line.push(cb); return () => { l.line = l.line.filter(x => x !== cb) } },
    onExit: cb => { l.exit.push(cb); return () => { l.exit = l.exit.filter(x => x !== cb) } },
    active: vi.fn(async () => []),
    line: m => l.line.forEach(cb => cb(m)),
    exit: m => l.exit.forEach(cb => cb(m)),
  }
}

function tree(a, picker, show = true) {
  return <DevenvRunProvider adapter={a}>{show && <CommandsView adapter={a} picker={picker} />}</DevenvRunProvider>
}
const renderView = (a, picker) => render(tree(a, picker))

async function runClean(a) {
  await waitFor(() => screen.getByText('devenv clean'))
  fireEvent.click(screen.getByText('devenv clean'))
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await waitFor(() => expect(a.run).toHaveBeenCalled())
}

describe('CommandsView', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('lists visible commands by group, hiding hidden ones', async () => {
    renderView(fakeAdapter(), {})
    await waitFor(() => screen.getByText('devenv status'))
    screen.getByText('Emulator')
    screen.getByText('devenv emulator push')
    expect(screen.queryByText('devenv setup shell')).toBeNull()
  })

  it('filters by text', async () => {
    renderView(fakeAdapter(), {})
    await waitFor(() => screen.getByText('devenv status'))
    fireEvent.change(screen.getByLabelText('Filter commands'), { target: { value: 'disk' } })
    screen.getByText('devenv clean')
    expect(screen.queryByText('devenv status')).toBeNull()
  })

  it('runs a command with its form values and shows output', async () => {
    const a = fakeAdapter()
    renderView(a, { pickFile: vi.fn(async () => 'C:\\pics\\a b.jpg') })
    await waitFor(() => screen.getByText('devenv emulator push'))
    fireEvent.click(screen.getByText('devenv emulator push'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => expect(screen.getByLabelText('Argument 1').value).toBe('C:\\pics\\a b.jpg'))
    fireEvent.change(screen.getByLabelText('--to'), { target: { value: '/sdcard/Pictures' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(a.run).toHaveBeenCalled())
    expect(a.run.mock.calls[0][1]).toEqual(['emulator', 'push', 'C:\\pics\\a b.jpg', '--to', '/sdcard/Pictures'])
    expect(a.run.mock.calls[0][2]).toEqual({ exclusive: true, label: 'devenv emulator push' })
    act(() => a.line({ runId: 1, stream: 'stdout', line: 'Pushed a b.jpg' }))
    screen.getByText('Pushed a b.jpg')
  })

  it('shows a prompt dialog and answers it', async () => {
    const a = fakeAdapter()
    renderView(a, {})
    await waitFor(() => screen.getByText('devenv clean'))
    fireEvent.click(screen.getByText('devenv clean'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(a.run).toHaveBeenCalled())
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv {"type":"prompt","id":"p1","kind":"choice","title":"Clean - reclaim disk","default":"1","options":[{"value":"1","label":"Remove old commits"},{"value":"Q","label":"Cancel"}]}' }))
    screen.getByText('Clean - reclaim disk')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(a.answer).toHaveBeenCalledWith(1, { id: 'p1', value: '1' }))
  })

  it('explains a missing or outdated devenv', async () => {
    const { unmount } = renderView({ ...fakeAdapter(), catalog: vi.fn(async () => { throw new Error('No devenv.ps1 in C:\\x') }) }, {})
    await waitFor(() => screen.getByText('No devenv.ps1 in C:\\x'))
    screen.getByText(/Settings → Desktop/)
    unmount()
    renderView(fakeAdapter({ ...CATALOG, protocol: 2 }), {})
    await waitFor(() => screen.getByText(/update devenv/i))
  })

  it('disables Run for every command while a run is active, with a hint', async () => {
    const a = fakeAdapter()
    renderView(a, {})
    await runClean(a)
    fireEvent.click(screen.getByText('devenv status'))
    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(true)
    screen.getByText('Wait for the running command to finish or cancel it.')
    act(() => a.exit({ runId: 1, code: 0, cancelled: false }))
    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(false)
    expect(screen.queryByText('Wait for the running command to finish or cancel it.')).toBeNull()
  })

  it('keeps a run, its output and its prompts across leaving and returning to the screen', async () => {
    const a = fakeAdapter()
    const { rerender } = renderView(a, {})
    await runClean(a)
    act(() => a.line({ runId: 1, stream: 'stdout', line: 'Scanning…' }))
    rerender(tree(a, {}, false))
    expect(screen.queryByText('Scanning…')).toBeNull()
    act(() => a.line({ runId: 1, stream: 'stdout', line: 'Found 3 old commits' }))
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv {"type":"prompt","id":"p1","kind":"text","title":"Keep how many?"}' }))
    screen.getByText('Keep how many?')
    rerender(tree(a, {}, true))
    await waitFor(() => screen.getByText('devenv status'))
    screen.getByText('Scanning…')
    screen.getByText('Found 3 old commits')
    fireEvent.change(screen.getByLabelText('Keep how many?'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(a.answer).toHaveBeenCalledWith(1, { id: 'p1', value: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(a.cancel).toHaveBeenCalledWith(1))
    act(() => a.exit({ runId: 1, code: 1, cancelled: true }))
    screen.getByText('Cancelled')
  })
})
