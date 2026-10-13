import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { BuildsView } from './builds-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const builds = (items) => ({ code: 0, stderr: '', results: [{ type: 'result', kind: 'builds', at: '2026-10-13T09:00:00Z', items }] })
const ORDERS = { key: 'orders', label: 'Orders', kind: 'api', source: { branch: 'main', commit: 'abcdef123456', dirty: false }, built: { commit: 'abcdef123456', dirty: false, at: '2026-10-13T08:00:00Z' }, upToDate: true, error: null, log: null, mode: null, ios: null }
const GONE = { key: 'gone', label: 'Gone', kind: 'api', source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x', log: null, mode: null, ios: null }
const MOBILE = { key: 'mobile', label: 'Mobile', kind: 'mobile', source: { branch: 'dev', commit: '99887766aa', dirty: true }, built: null, upToDate: false, error: null, log: null, mode: { deploy: 'full', abi: 'android-arm64' }, ios: null }

function setup(items, over = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = { query: vi.fn(async () => builds(items)) }
  render(<BuildsView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('BuildsView', () => {
  it('shows each API with its source, last build and state', async () => {
    setup([ORDERS, GONE])
    await screen.findByText('Orders')
    expect(screen.getByText('main abcdef12')).toBeTruthy()
    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.getByText('Source worktree missing: C:\\x')).toBeTruthy()
    expect(screen.getByText('never built')).toBeTruthy()
  })

  it('builds, clean-rebuilds and builds all through the provider run', async () => {
    const { run } = setup([ORDERS])
    await screen.findByText('Orders')
    fireEvent.click(screen.getByRole('button', { name: 'Build Orders' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'orders'], { exclusive: true, label: 'devenv build orders' })
    fireEvent.click(screen.getByRole('button', { name: 'Clean rebuild Orders' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'orders', '--clean'], { exclusive: true, label: 'devenv build orders --clean' })
    fireEvent.click(screen.getByLabelText('Clean first'))
    fireEvent.click(screen.getByRole('button', { name: 'Build all APIs' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'apis', '--clean'], { exclusive: true, label: 'devenv build apis --clean' })
  })

  it('has no Mobile or iOS section without a mobile repo', async () => {
    setup([ORDERS])
    await screen.findByText('Orders')
    expect(screen.queryByRole('button', { name: 'Build mobile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Build for iOS' })).toBeNull()
  })

  it('builds mobile with the chosen ABI, deploy and install, and iOS with a device', async () => {
    const { run } = setup([ORDERS, MOBILE])
    await screen.findByRole('button', { name: 'Build mobile' })
    expect(screen.getByText('Last build: full deploy, android-arm64')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ABI'), { target: { value: 'arm64' } })
    fireEvent.change(screen.getByLabelText('Deploy'), { target: { value: 'full' } })
    fireEvent.click(screen.getByLabelText('Install on the emulator'))
    fireEvent.click(screen.getByRole('button', { name: 'Build mobile' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'mobile', '--abi', 'arm64', '--deploy', 'full', '--install'], { exclusive: true, label: 'devenv build mobile --abi arm64 --deploy full --install' })
    fireEvent.click(screen.getByRole('button', { name: 'Install last build' }))
    expect(run.start).toHaveBeenLastCalledWith(['app', 'install'], { exclusive: true, label: 'devenv app install' })
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'iPhone 16' } })
    fireEvent.click(screen.getByLabelText("Build only (don't run)"))
    fireEvent.click(screen.getByRole('button', { name: 'Build for iOS' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'ios', '--device', 'iPhone 16', '--no-run'], { exclusive: true, label: 'devenv build ios --device iPhone 16 --no-run' })
  })

  it('shows an invalid device as an error instead of starting', async () => {
    const { run } = setup([ORDERS, MOBILE])
    await screen.findByRole('button', { name: 'Build for iOS' })
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: '-x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build for iOS' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/Not a device name/)
  })

  it('disables every action while a run is active and shows its own run', async () => {
    setup([ORDERS], { status: 'running', command: 'devenv build orders', runId: 3 })
    await screen.findByText('Orders')
    expect(screen.getByRole('button', { name: 'Build Orders' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Build all APIs' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it("does not show another tab's run", async () => {
    setup([ORDERS], { status: 'running', command: 'devenv start', runId: 3 })
    await screen.findByText('Orders')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows a query error', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<BuildsView adapter={{ query: vi.fn(async () => { throw new Error('pwsh missing') }) }} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('pwsh missing'))
  })
})
