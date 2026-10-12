import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { CommandsView } from './commands-view.jsx'

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
    onLine: cb => { l.line.push(cb); return () => {} },
    onExit: cb => { l.exit.push(cb); return () => {} },
    line: m => l.line.forEach(cb => cb(m)),
    exit: m => l.exit.forEach(cb => cb(m)),
  }
}

describe('CommandsView', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('lists visible commands by group, hiding hidden ones', async () => {
    render(<CommandsView adapter={fakeAdapter()} picker={{}} />)
    await waitFor(() => screen.getByText('devenv status'))
    screen.getByText('Emulator')
    screen.getByText('devenv emulator push')
    expect(screen.queryByText('devenv setup shell')).toBeNull()
  })

  it('filters by text', async () => {
    render(<CommandsView adapter={fakeAdapter()} picker={{}} />)
    await waitFor(() => screen.getByText('devenv status'))
    fireEvent.change(screen.getByLabelText('Filter commands'), { target: { value: 'disk' } })
    screen.getByText('devenv clean')
    expect(screen.queryByText('devenv status')).toBeNull()
  })

  it('runs a command with its form values and shows output', async () => {
    const a = fakeAdapter()
    render(<CommandsView adapter={a} picker={{ pickFile: vi.fn(async () => 'C:\\pics\\a b.jpg') }} />)
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
    render(<CommandsView adapter={a} picker={{}} />)
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
    const { unmount } = render(<CommandsView adapter={{ ...fakeAdapter(), catalog: vi.fn(async () => { throw new Error('No devenv.ps1 in C:\\x') }) }} picker={{}} />)
    await waitFor(() => screen.getByText('No devenv.ps1 in C:\\x'))
    screen.getByText(/Settings → Desktop/)
    unmount()
    render(<CommandsView adapter={fakeAdapter({ ...CATALOG, protocol: 2 })} picker={{}} />)
    await waitFor(() => screen.getByText(/update devenv/i))
  })
})
