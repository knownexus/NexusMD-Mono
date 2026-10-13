import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { EmulatorView } from './emulator-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = emu => ({ type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], test: {}, database: {}, ios: {}, android: { emulator: emu, proxy: 'running' } })
const AVDS = (extra = {}) => ({ type: 'result', kind: 'emulator-avds', avds: ['Pixel_9', 'Tablet'], default: 'Pixel_9', error: null, ...extra })

function setup({ over = {}, emu = null, avds = AVDS() } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    pathForFile: vi.fn(f => (f.name === 'skip' ? '' : `C:\\Users\\me\\${f.name}`)),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS(emu)] }
      if (k === 'emulator avds --json') return { code: 0, stderr: '', results: [avds] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  const picker = { pickFile: vi.fn(async () => 'C:\\Users\\me\\doc.pdf') }
  render(<EmulatorView adapter={adapter} picker={picker} />)
  return { run: globalThis.__run, adapter, picker }
}

describe('EmulatorView', () => {
  it('starts the chosen AVD with or without the proxy', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'start', '--avd', 'Pixel_9'], { exclusive: true, label: 'devenv emulator start --avd Pixel_9' })
    fireEvent.change(screen.getByLabelText('AVD'), { target: { value: 'Tablet' } })
    fireEvent.click(screen.getByLabelText('Use the proxy'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'start', '--avd', 'Tablet', '--no-proxy'], expect.objectContaining({ exclusive: true }))
  })

  it('preselects the running emulator\'s AVD', async () => {
    setup({ emu: { running: true, serial: 'emulator-5580', avd: 'Tablet' } })
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Tablet'))
    expect(screen.getByText('emulator-5580 (Tablet)')).toBeTruthy()
  })

  it('runs stop, proxy, CA and reinstall', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    const cases = [['Stop', ['emulator', 'stop']], ['Proxy on', ['emulator', 'proxy']], ['Proxy off', ['emulator', 'proxy', '--off']],
      ['Push CA', ['emulator', 'push-ca']], ['Reinstall app', ['app', 'install']]]
    for (const [name, argv] of cases) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(run.start).toHaveBeenLastCalledWith(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
    }
  })

  it('asks before recreating the image, and Keep it backs out', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    fireEvent.click(screen.getByRole('button', { name: 'Recreate image…' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByText('This deletes Pixel_9 and creates it again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByText('This deletes Pixel_9 and creates it again.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Recreate image…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recreate Pixel_9' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'create', '--avd', 'Pixel_9'], { exclusive: true, label: 'devenv emulator create --avd Pixel_9' })
  })

  it('pushes dropped and picked files to the destination', async () => {
    const { run } = setup()
    await screen.findByTestId('drop-zone')
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [{ name: 'photo.jpg' }, { name: 'skip' }] } })
    fireEvent.click(screen.getByRole('button', { name: 'Add file…' }))
    await screen.findByText('C:\\Users\\me\\doc.pdf')
    expect(screen.getByText('C:\\Users\\me\\photo.jpg')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '/sdcard/Download' } })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'push', 'C:\\Users\\me\\photo.jpg', 'C:\\Users\\me\\doc.pdf', '--to', '/sdcard/Download'],
      { exclusive: true, label: 'devenv emulator push C:\\Users\\me\\photo.jpg C:\\Users\\me\\doc.pdf --to /sdcard/Download' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove C:\\Users\\me\\photo.jpg' }))
    expect(screen.queryByText('C:\\Users\\me\\photo.jpg')).toBeNull()
  })

  it('refuses a push with no files or a bad destination', async () => {
    const { run } = setup()
    await screen.findByTestId('drop-zone')
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least one file/)
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [{ name: 'a.txt' }] } })
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '/data/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/sdcard/)
  })

  it('shows the SDK error from the AVD list', async () => {
    setup({ avds: AVDS({ avds: [], error: 'Android emulator not found - set ANDROID_HOME' }) })
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /ANDROID_HOME/.test(a.textContent))).toBe(true))
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv emulator start --avd Pixel_9', runId: 5 } })
    await screen.findByTestId('drop-zone')
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Push' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
