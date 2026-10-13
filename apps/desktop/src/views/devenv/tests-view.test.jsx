import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { TestsView } from './tests-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = { type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], database: {}, android: {}, ios: {},
  test: { tracer: 'running', apis: [{ key: 'orders', label: 'Orders', port: 5201, state: 'running' }, { key: 'billing', label: 'Billing', port: 5202, state: 'stopped' }] } }
const RUNS = { type: 'result', kind: 'test-runs', runs: [
  { id: '20261013-120000-api-tests', label: 'api-tests', at: '2026-10-13T12:00:00+01:00', paths: [], services: ['orders'], exit: 1, passed: false, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: 'C:\\r\\bruno.html' },
], reports: [{ name: 'trace-20261013-090000.html', at: '2026-10-13T09:00:00', path: 'C:\\r\\trace-1.html' }] }
const COLLECTION = (root, extra = {}) => ({ type: 'result', kind: 'test-collection', root, isDefault: !extra.custom, error: extra.error ?? null,
  items: extra.error ? [] : [{ path: 'smoke', kind: 'folder', depth: 0 }, { path: 'smoke/orders.bru', kind: 'request', depth: 1 }, { path: 'top.bru', kind: 'request', depth: 0 }] })

function setup({ over = {}, collection } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    open: vi.fn(async () => ({ ok: true })),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS] }
      if (k === 'test runs --json') return { code: 0, stderr: '', results: [RUNS] }
      if (k.startsWith('test collection --json')) return { code: 0, stderr: '', results: [collection ? collection(argv) : COLLECTION('C:\\profile\\api-tests')] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  const picker = { pickDirectory: vi.fn(async () => 'C:\\other\\collection') }
  render(<TestsView adapter={adapter} picker={picker} />)
  return { run: globalThis.__run, adapter, picker }
}

describe('TestsView', () => {
  it('starts the stack with the running APIs pre-ticked, plus any ticked', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('Orders :5201').checked).toBe(true))
    expect(screen.getByLabelText('Billing :5202').checked).toBe(false)
    fireEvent.click(screen.getByLabelText('Billing :5202'))
    fireEvent.click(screen.getByLabelText('Skip builds'))
    fireEvent.click(screen.getByRole('button', { name: 'Start stack' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'up', 'orders', 'billing', '--no-build'], { exclusive: true, label: 'devenv test up orders billing --no-build' })
  })

  it('stops, clears and opens the live view', async () => {
    const { run } = setup()
    await screen.findByLabelText('Orders :5201')
    fireEvent.click(screen.getByRole('button', { name: 'Stop stack' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'down'], { exclusive: true, label: 'devenv test down' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear trace' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'clear'], { exclusive: true, label: 'devenv test clear' })
    fireEvent.click(screen.getByRole('button', { name: 'Open live view' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'web'], { exclusive: false, label: 'devenv test web' })
  })

  it('runs the whole collection, or the top-level ticked paths with options', async () => {
    const { run } = setup()
    await screen.findByLabelText('smoke/')
    fireEvent.click(screen.getByRole('button', { name: 'Run all' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run'], { exclusive: true, label: 'devenv test run' })
    fireEvent.click(screen.getByLabelText('smoke/'))
    expect(screen.getByLabelText('orders.bru').disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('top.bru'))
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'docker' } })
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'nightly' } })
    fireEvent.click(screen.getByLabelText("Include requests for APIs that aren't running"))
    fireEvent.click(screen.getByRole('button', { name: 'Run selected' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run', 'smoke', 'top.bru', '--env', 'docker', '--all-apis', '--name', 'nightly'],
      { exclusive: true, label: 'devenv test run smoke top.bru --env docker --all-apis --name nightly' })
  })

  it('switches to another collection and runs it with --collection', async () => {
    const { run, adapter } = setup({ collection: argv => COLLECTION(argv[4] || 'C:\\profile\\api-tests', { custom: !!argv[4] }) })
    await screen.findByLabelText('smoke/')
    fireEvent.click(screen.getByRole('button', { name: 'Choose collection…' }))
    await waitFor(() => expect(adapter.query).toHaveBeenCalledWith(CFG, ['test', 'collection', '--json', '--collection', 'C:\\other\\collection']))
    await screen.findByRole('button', { name: "Use the profile's" })
    fireEvent.click(screen.getByRole('button', { name: 'Run all' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run', '--collection', 'C:\\other\\collection'], expect.objectContaining({ exclusive: true }))
  })

  it('drops the old tree and disables Run when the new collection fails to load', async () => {
    const { adapter, run } = setup()
    await screen.findByLabelText('smoke/')
    const original = adapter.query.getMockImplementation()
    adapter.query.mockImplementation(async (c, argv) => (argv.includes('--collection')
      ? { code: 1, stderr: 'Cannot read collection', results: [] }
      : original(c, argv)))
    fireEvent.click(screen.getByRole('button', { name: 'Choose collection…' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /Cannot read collection/.test(a.textContent))).toBe(true))
    expect(screen.queryByLabelText('smoke/')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
    expect(run.start).not.toHaveBeenCalled()
  })

  it('hides the old tree and disables Run while another collection loads', async () => {
    const { adapter } = setup()
    await screen.findByLabelText('smoke/')
    const original = adapter.query.getMockImplementation()
    let release
    const held = new Promise(r => { release = r })
    adapter.query.mockImplementation(async (c, argv) => (argv.includes('--collection')
      ? held
      : original(c, argv)))
    fireEvent.click(screen.getByRole('button', { name: 'Choose collection…' }))
    await waitFor(() => expect(adapter.query).toHaveBeenCalledWith(CFG, ['test', 'collection', '--json', '--collection', 'C:\\other\\collection']))
    expect(screen.queryByLabelText('smoke/')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
    release({ code: 0, stderr: '', results: [COLLECTION('C:\\other\\collection', { custom: true })] })
    await screen.findByLabelText('smoke/')
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(false)
  })

  it('shows a collection error and offers no run', async () => {
    setup({ collection: () => COLLECTION('C:\\x', { error: 'Not a Bruno collection (no bruno.json): C:\\x' }) })
    await screen.findByText('Not a Bruno collection (no bruno.json): C:\\x')
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
  })

  it('lists past runs and opens their reports in-app', async () => {
    const { adapter, run } = setup()
    await screen.findByText('api-tests')
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('1/2 requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Call chain' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\trace.html' })
    fireEvent.click(screen.getByRole('button', { name: 'Bruno report' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\bruno.html' })
    fireEvent.click(screen.getByRole('button', { name: 'Open trace-20261013-090000.html' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\trace-1.html' })
    fireEvent.change(screen.getByLabelText('Report window'), { target: { value: '1h' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make report' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'report', '--since', '1h'], { exclusive: false, label: 'devenv test report --since 1h' })
  })

  it('shows query errors (e.g. a profile without test APIs)', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    const adapter = { open: vi.fn(), query: vi.fn(async (_c, argv) => (argv[0] === 'status'
      ? { code: 0, stderr: '', results: [STATUS] }
      : { code: 1, stderr: 'The profile has no repositories with a "test" block', results: [] })) }
    render(<TestsView adapter={adapter} picker={{ pickDirectory: vi.fn() }} />)
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /no repositories with a "test" block/.test(a.textContent))).toBe(true))
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv test up', runId: 4 } })
    await screen.findByLabelText('Orders :5201')
    expect(screen.getByRole('button', { name: 'Start stack' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
