import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { MacView } from './mac-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = over => ({ type: 'result', kind: 'mac-status', configured: true, host: 'mac.local', user: 'me', sshKey: null, keyExists: false, connection: 'auth', detail: 'me@mac.local: Permission denied (publickey).', error: null, ...over })

function setup({ status = STATUS(), over = {} } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = { query: vi.fn(async () => ({ code: 0, stderr: '', results: [status] })) }
  render(<MacView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('MacView', () => {
  it('shows the host, the missing key and why it cannot log in, with the wizard open', async () => {
    const { run } = setup()
    await screen.findByText('me@mac.local')
    expect(screen.getByText('No devenv key yet')).toBeTruthy()
    expect(screen.getByText("The Mac doesn't accept this PC's key yet - set up the SSH key.")).toBeTruthy()
    expect(screen.getByText('me@mac.local: Permission denied (publickey).')).toBeTruthy()
    expect(screen.getByText('Asks for your Mac password once.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up SSH key' }))
    expect(run.start).toHaveBeenCalledWith(['mac', 'key-setup'], { exclusive: true, label: 'devenv mac key-setup' })
  })

  it('folds the wizard away once the key works', async () => {
    setup({ status: STATUS({ connection: 'ok', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, detail: null }) })
    await screen.findByText('C:\\Users\\me\\.ssh\\devenv_mac_ed25519')
    expect(screen.queryByText('Asks for your Mac password once.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set up the key again' })).toBeTruthy()
  })

  it('runs Doctor alongside other runs and Fix exclusively', async () => {
    const { run } = setup({ status: STATUS({ connection: 'ok' }) })
    await screen.findByText('me@mac.local')
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))
    expect(run.start).toHaveBeenLastCalledWith(['mac', 'doctor'], { exclusive: false, label: 'devenv mac doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(run.start).toHaveBeenLastCalledWith(['mac', 'fix'], { exclusive: true, label: 'devenv mac fix' })
  })

  it('sets up and removes arm64 simulator builds', async () => {
    const { run } = setup()
    await screen.findByText('me@mac.local')
    fireEvent.click(screen.getByRole('button', { name: 'Make simulator builds arm64' }))
    expect(run.start).toHaveBeenLastCalledWith(['setup', 'ios-sim'], { exclusive: true, label: 'devenv setup ios-sim' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(run.start).toHaveBeenLastCalledWith(['setup', 'ios-sim', '--remove'], { exclusive: true, label: 'devenv setup ios-sim --remove' })
  })

  it('without mac.json shows what to do and disables Doctor, Fix and the wizard', async () => {
    setup({ status: STATUS({ configured: false, host: null, user: null, connection: 'unconfigured', detail: null, error: 'No mac.json in C:\\p - create it with {"host":"<mac ip or name>","user":"<mac login>"}.' }) })
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /No mac\.json/.test(a.textContent))).toBe(true))
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Doctor' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Fix' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Set up SSH key' })).toBeNull()
  })

  it('shows a missing key file', async () => {
    setup({ status: STATUS({ sshKey: 'C:\\k', keyExists: false }) })
    await screen.findByText('C:\\k (file missing)')
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv mac key-setup', runId: 6 } })
    await screen.findByText('me@mac.local')
    expect(screen.getByRole('button', { name: 'Set up SSH key' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Doctor' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows a query error', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<MacView adapter={{ query: vi.fn(async () => { throw new Error('pwsh missing') }) }} />)
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent === 'pwsh missing')).toBe(true))
  })
})
