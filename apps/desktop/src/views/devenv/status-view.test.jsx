import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { StatusView } from './status-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))

afterEach(cleanup)

const full = {
  type: 'result', kind: 'status', at: '2026-10-12T10:00:00Z', docker: { ok: true, error: null },
  backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }],
  infra: [{ service: 'storage', state: 'running' }],
  database: { state: 'running', ui: 'missing', baseline: 'b1' },
  test: { tracer: 'stopped', apis: [{ key: 'orders', label: 'Orders API', port: 5201, state: 'stopped' }] },
  android: { emulator: { running: true, serial: 'emulator-5554', avd: 'devenv' }, proxy: 'running' },
  ios: { host: null, error: 'no mac.json' },
}

function setup({ result = full, runStatus = 'idle' } = {}) {
  const run = { state: { ...createRunState(), status: runStatus }, start: vi.fn(), cancel: vi.fn(), config: { root: 'C:\\r', pwsh: 'pwsh', profile: '' } }
  globalThis.__run = run
  const adapter = { query: vi.fn(async () => ({ code: 0, results: [result], stderr: '' })) }
  const onStart = vi.fn()
  return { run, adapter, onStart }
}

describe('StatusView', () => {
  it('renders the cards from the status', async () => {
    const { adapter, onStart } = setup()
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    expect(screen.getByText('Orders API :5101')).toBeTruthy()
    expect(screen.getByText('Baseline b1')).toBeTruthy()
    expect(screen.getByText('Emulator emulator-5554 (devenv)')).toBeTruthy()
    expect(screen.getByText('no mac.json')).toBeTruthy()
  })

  it('shows a banner when Docker is down', async () => {
    const { adapter, onStart } = setup({ result: { ...full, docker: { ok: false, error: 'Docker Desktop is not running' } } })
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    expect(screen.getByText("Docker isn't running — Docker Desktop is not running")).toBeTruthy()
  })

  it('runs actions through the provider run', async () => {
    const { run, adapter, onStart } = setup()
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(run.start).toHaveBeenCalledWith(['stop'], { exclusive: true, label: 'devenv stop' })
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))
    expect(run.start).toHaveBeenCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Start…' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('disables actions while a run is active', async () => {
    const { adapter, onStart } = setup({ runStatus: 'running' })
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    for (const name of ['Start…', 'Stop', 'Backend up', 'Backend down', 'Doctor']) {
      expect(screen.getByRole('button', { name }).disabled).toBe(true)
    }
  })
})
