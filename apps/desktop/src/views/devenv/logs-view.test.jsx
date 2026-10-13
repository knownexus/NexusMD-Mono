import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { LogsView } from './logs-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const TARGETS = { type: 'result', kind: 'log-targets', targets: [
  { group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false },
  { group: 'backend', key: 'orders', label: 'Orders', argv: ['backend', 'logs', 'orders'], follow: true },
  { group: 'backend', key: 'storage', label: 'storage', argv: ['backend', 'logs', 'storage'], follow: true },
] }

function fakeAdapter() {
  const listeners = { line: [], exit: [] }
  let id = 20
  const a = {
    query: vi.fn(async () => ({ code: 0, stderr: '', results: [TARGETS] })),
    run: vi.fn(async () => ({ runId: ++id })),
    cancel: vi.fn(async () => ({ ok: true })),
    answer: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { listeners.line.push(cb); return () => { listeners.line = listeners.line.filter(x => x !== cb) } },
    onExit: cb => { listeners.exit.push(cb); return () => { listeners.exit = listeners.exit.filter(x => x !== cb) } },
    emitLine: m => listeners.line.forEach(cb => cb(m)),
    emitExit: m => listeners.exit.forEach(cb => cb(m)),
  }
  return a
}

function setup() {
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = fakeAdapter()
  const view = render(<LogsView adapter={adapter} />)
  return { adapter, view }
}

const pick = id => fireEvent.change(screen.getByLabelText('Log'), { target: { value: id } })

describe('LogsView', () => {
  it('lists devenv targets by group and shows a build log without taking the exclusive slot', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders build log' })
    expect(document.querySelector('optgroup[label="Backend containers"]')).toBeTruthy()
    pick('build:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    expect(adapter.run).toHaveBeenCalledWith(CFG, ['logs', 'show', 'orders'], { exclusive: false, label: 'devenv logs show orders' })
    act(() => adapter.emitLine({ runId: 21, stream: 'stdout', line: 'Build succeeded' }))
    expect(screen.getByText('Build succeeded')).toBeTruthy()
  })

  it('cancels a running follow before showing another target', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    pick('backend:storage')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    expect(adapter.cancel).toHaveBeenCalledWith(21)
    expect(adapter.cancel.mock.invocationCallOrder[0]).toBeLessThan(adapter.run.mock.invocationCallOrder[1])
    expect(adapter.run).toHaveBeenLastCalledWith(CFG, ['backend', 'logs', 'storage'], { exclusive: false, label: 'devenv backend logs storage' })
  })

  it('stops the follow when the tab is left', async () => {
    const { adapter, view } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    view.unmount()
    await waitFor(() => expect(adapter.cancel).toHaveBeenCalledWith(21))
  })

  it('does not cancel anything when left idle', async () => {
    const { adapter, view } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    view.unmount()
    expect(adapter.cancel).not.toHaveBeenCalled()
  })

  it('filters the output', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    act(() => {
      adapter.emitLine({ runId: 21, stream: 'stdout', line: 'GET /orders 200' })
      adapter.emitLine({ runId: 21, stream: 'stdout', line: 'fail: timeout' })
    })
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'timeout' } })
    expect(screen.queryByText('GET /orders 200')).toBeNull()
    expect(screen.getByText('1 of 2 lines')).toBeTruthy()
  })

  it('captures with the chosen range and opens the folder', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '30m' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Capture logs' })) })
    expect(adapter.run).toHaveBeenLastCalledWith(CFG, ['logs', 'capture', '--since', '30m'], { exclusive: false, label: 'devenv logs capture --since 30m' })
    act(() => {
      adapter.emitLine({ runId: 21, stream: 'stdout', line: '@@devenv {"type":"result","kind":"capture","path":"C:\\\\repos\\\\dev-environment\\\\.local\\\\cap"}' })
      adapter.emitExit({ runId: 21, code: 0, cancelled: false })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open capture folder' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\repos\\dev-environment\\.local\\cap' })
  })
})
