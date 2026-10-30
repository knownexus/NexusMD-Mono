import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { useProfileFile, clearProfileDrafts } from './use-profile-file.js'
import { createRunState } from '@nexusmd/core'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./use-devenv-status.js', () => ({ useDevenvStatus: () => globalThis.__status }))
vi.mock('./use-devenv-query.js', () => ({ useDevenvQuery: () => globalThis.__builds }))
vi.mock('./start-view.jsx', () => ({ StartView: () => <div>start-stub</div> }))
vi.mock('./builds-view.jsx', () => ({ BuildsView: () => <div>builds-stub</div> }))
vi.mock('./commands-view.jsx', () => ({ CommandsView: () => <div>commands-stub</div> }))
vi.mock('./profile-view.jsx', () => ({ ProfileView: () => <div>profile-stub</div> }))

import { DevenvView } from './view-devenv.jsx'

const STATUS = {
  at: '2026-10-15T10:00:00Z',
  docker: { ok: true, error: '' },
  backend: [{ key: 'accounts', label: 'Accounts API', port: 5001, state: 'running' }],
  infra: [{ service: 'redis', state: 'stopped' }],
  database: { state: 'running', ui: 'stopped', baseline: 'base-1' },
  test: { tracer: 'stopped', apis: [] },
  android: { emulator: null, proxy: 'stopped' },
  ios: { host: '', error: '' },
}
const BUILDS = {
  apis: [
    { key: 'accounts', label: 'Accounts API', upToDate: false, error: '', source: { branch: 'main', commit: 'abcdef1234', dirty: false }, built: null },
    { key: 'billing', label: 'Billing API', upToDate: true, error: '', source: { branch: 'main', commit: '1234abcdef', dirty: true }, built: null },
  ],
  mobile: null,
}

afterEach(() => { cleanup(); clearProfileDrafts() })
beforeEach(() => {
  localStorage.clear()
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), leftover: { runs: [], error: null, cancelAll: vi.fn() } }
  globalThis.__status = { status: STATUS, error: null, loading: false, refresh: vi.fn() }
  globalThis.__builds = { data: BUILDS, error: null, loading: false, refresh: vi.fn() }
})

const adapters = { devenv: { isAvailable: () => true } }
const tile = name => screen.getByRole('region', { name })

describe('DevenvView', () => {
  it('shows each area as a tile with its live state', () => {
    render(<DevenvView adapters={adapters} />)
    for (const name of ['Services', 'Builds', 'Tests', 'Database', 'Android', 'iOS on Mac', 'Logs', 'Profile', 'More actions']) expect(tile(name)).toBeTruthy()
    expect(within(tile('Services')).getByText('1 of 2 up')).toBeTruthy()
    expect(within(tile('Builds')).getByText('1 need a build')).toBeTruthy()
    expect(within(tile('Builds')).getByText('main · 1234abcd + uncommitted')).toBeTruthy()
    expect(screen.getByText('Running · 1 of 2 services')).toBeTruthy()
  })

  it('offers Start environment while stopped and opens the Start view in a modal', () => {
    globalThis.__status.status = { ...STATUS, backend: [{ ...STATUS.backend[0], state: 'stopped' }] }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('Stopped')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start environment' }))
    expect(screen.getByRole('dialog').textContent).toContain('start-stub')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('start-stub')).toBeNull()
  })

  it('runs devenv with the same labels as before, so other screens still recognise the run', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Health check' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop environment' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['stop'], { exclusive: true, label: 'devenv stop' })
    fireEvent.click(screen.getByRole('button', { name: 'Start backend' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['backend', 'up'], { exclusive: true, label: 'devenv backend up' })
  })

  it('builds one API or all of them, cleaning first when asked', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Build Accounts API' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['build', 'accounts'], { exclusive: true, label: 'devenv build accounts' })
    fireEvent.click(screen.getByLabelText('Clean first'))
    fireEvent.click(screen.getByRole('button', { name: 'Build all' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['build', 'apis', '--clean'], { exclusive: true, label: 'devenv build apis --clean' })
  })

  it('changes a source branch from its tile without starting the environment', () => {
    globalThis.__builds.data = { ...BUILDS, mobile: { key: 'mobile', label: 'Mobile app', source: { branch: 'feature/x', commit: 'feedface00', dirty: false }, built: null, mode: null, ios: null } }
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change branch for Accounts API' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['source', 'branch', 'accounts'], { exclusive: true, label: 'devenv source branch accounts' })
    for (const name of ['Android', 'iOS on Mac']) expect(within(tile(name)).getByText('feature/x · feedface')).toBeTruthy()
    fireEvent.click(within(tile('Android')).getByRole('button', { name: 'Change branch for Mobile app' }))
    expect(globalThis.__run.start).toHaveBeenLastCalledWith(['source', 'branch', 'mobile'], { exclusive: true, label: 'devenv source branch mobile' })
  })

  it('titles a branch change in the drawer', () => {
    globalThis.__run.state = { ...createRunState(), status: 'running', runId: 4, command: 'devenv source branch mobile' }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('dialog', { name: 'Change branch' })).toBeTruthy()
  })

  it('opens the full Builds view for the options the tiles leave out', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Build options…' }))
    expect(screen.getByRole('dialog').textContent).toContain('builds-stub')
  })

  it('disables actions while a run is going', () => {
    globalThis.__run.state = { ...createRunState(), status: 'running', runId: 1, command: 'devenv doctor' }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('button', { name: 'Health check' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Build Accounts API' }).disabled).toBe(true)
  })

  it('shows a run in the drawer until it is closed, then again for the next run', () => {
    globalThis.__run.state = { ...createRunState(), status: 'done', runId: 1, command: 'devenv doctor', lines: [{ text: 'all good' }] }
    const { rerender } = render(<DevenvView adapters={adapters} />)
    const drawer = screen.getByRole('dialog', { name: 'Health check' })
    expect(within(drawer).getByText('all good')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Health check' })).toBeNull()
    globalThis.__run.state = { ...createRunState(), status: 'running', runId: 2, command: 'devenv build accounts', lines: [] }
    rerender(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('dialog', { name: 'Build' })).toBeTruthy()
  })

  it('shows the drawer while a run is still starting', () => {
    globalThis.__run.state = { ...createRunState(), status: 'starting', runId: null, command: 'devenv stop' }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('dialog', { name: 'Stop environment' })).toBeTruthy()
  })

  it('cancels a running run from the drawer', () => {
    globalThis.__run.state = { ...createRunState(), status: 'running', runId: 3, command: 'devenv stop' }
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Stop environment' })).getByRole('button', { name: 'Cancel' }))
    expect(globalThis.__run.cancel).toHaveBeenCalled()
  })

  it('filters More actions and falls back to the full list', () => {
    render(<DevenvView adapters={adapters} />)
    const more = tile('More actions')
    fireEvent.change(within(more).getByLabelText('Search actions'), { target: { value: 'android' } })
    expect(within(more).getByRole('button', { name: /Build Android app/ })).toBeTruthy()
    expect(within(more).queryByRole('button', { name: /Health check/ })).toBeNull()
    fireEvent.change(within(more).getByLabelText('Search actions'), { target: { value: 'zzz' } })
    fireEvent.click(within(more).getByRole('button', { name: /Search all actions/ }))
    expect(screen.getByRole('dialog').textContent).toContain('commands-stub')
  })

  it('says when Docker is not running', () => {
    globalThis.__status.status = { ...STATUS, docker: { ok: false, error: '' } }
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('alert').textContent).toMatch(/Docker isn't running/)
  })

  it('marks the Profile tile while any profile draft is unsaved', async () => {
    // Real draft store: a tiny component creates a draft through useProfileFile.
    const adapter = { profileRead: async () => ({ text: '{}', bom: false, stamp: 's' }) }
    const cfg = { root: 'r', profile: '' }
    globalThis.__run.config = cfg
    let api
    function Probe() { api = useProfileFile({ adapter, config: cfg, path: 'environment.json' }); return null }
    render(<DevenvView adapters={adapters} />)
    expect(within(tile('Profile')).queryByText('Unsaved changes')).toBeNull()
    render(<Probe />)
    await waitFor(() => expect(api.status).toBe('ready'))
    act(() => api.setText('{"x":1}'))
    expect(within(tile('Profile')).getByText('Unsaved changes')).toBeTruthy()
    act(() => clearProfileDrafts())
    expect(within(tile('Profile')).queryByText('Unsaved changes')).toBeNull()
  })

  it('does not mark the Profile tile for a draft under another config', async () => {
    const adapter = { profileRead: async () => ({ text: '{}', bom: false, stamp: 's' }) }
    globalThis.__run.config = { root: 'r', profile: '' }
    const otherCfg = { root: 'other', profile: '' }
    let api
    function Probe() { api = useProfileFile({ adapter, config: otherCfg, path: 'environment.json' }); return null }
    render(<DevenvView adapters={adapters} />)
    render(<Probe />)
    await waitFor(() => expect(api.status).toBe('ready'))
    act(() => api.setText('{"x":1}'))
    expect(within(tile('Profile')).queryByText('Unsaved changes')).toBeNull()
  })

  it('explains when there is no desktop bridge', () => {
    render(<DevenvView adapters={{}} />)
    expect(screen.getByText('Dev Environment needs the desktop app.')).toBeTruthy()
  })
})
