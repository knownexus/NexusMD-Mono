import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { StartView } from './start-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))

afterEach(cleanup)

const summary = { type: 'result', kind: 'summary', title: 'Session up', rows: [{ key: 'Backend', value: '' }, { key: 'Orders API', value: 'http://127.0.0.1:5101' }, { key: 'iOS', value: 'FAILED - ssh exit 255' }], notes: ['devenv status     devenv stop'] }

function setup(over = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn() }
  return globalThis.__run
}

describe('StartView', () => {
  it('starts devenv start, with --remote-db when ticked', () => {
    const run = setup()
    render(<StartView />)
    fireEvent.click(screen.getByRole('button', { name: 'Start session…' }))
    expect(run.start).toHaveBeenCalledWith(['start'], { exclusive: true, label: 'devenv start' })
    fireEvent.click(screen.getByLabelText('Use the remote DEV database'))
    fireEvent.click(screen.getByRole('button', { name: 'Start session…' }))
    expect(run.start).toHaveBeenLastCalledWith(['start', '--remote-db'], { exclusive: true, label: 'devenv start' })
  })

  it('is disabled while a run is active', () => {
    setup({ status: 'running', command: 'devenv stop' })
    render(<StartView />)
    expect(screen.getByRole('button', { name: 'Start session…' }).disabled).toBe(true)
  })

  it('shows the session summary from the start run', () => {
    setup({ status: 'done', command: 'devenv start', exitCode: 0, results: [summary] })
    render(<StartView />)
    expect(screen.getByText('Session up')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:5101')).toBeTruthy()
    expect(screen.getByText('FAILED - ssh exit 255')).toBeTruthy()
  })

  it('ignores a summary left by a different command', () => {
    setup({ status: 'done', command: 'devenv stop', exitCode: 0, results: [summary] })
    render(<StartView />)
    expect(screen.queryByText('Session up')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})
