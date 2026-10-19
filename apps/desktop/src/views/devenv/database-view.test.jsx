import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { DatabaseView } from './database-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const ID = '20261013T120000Z-aaaaaaaa'
const STATUS = ui => ({ type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], test: {}, android: {}, ios: {}, database: { state: 'running', ui, baseline: ID } })
const BASELINES = { type: 'result', kind: 'db-baselines', latest: ID, baselines: [
  { id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 5 * 1024 * 1024, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true },
  { id: '20261001T080000Z-bbbbbbbb', createdUtc: null, size: 0, isLatest: false, databases: [], sourceContainer: null, valid: false },
] }
const SCRIPTS = { type: 'result', kind: 'db-scripts', database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script for devenv db sql' }] }

function setup({ over = {}, ui = 'running' } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    open: vi.fn(async () => ({ ok: true })),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS(ui)] }
      if (k === 'db baselines --json') return { code: 0, stderr: '', results: [BASELINES] }
      if (k === 'db scripts --json') return { code: 0, stderr: '', results: [SCRIPTS] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  render(<DatabaseView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('DatabaseView', () => {
  it('runs the database actions with the right exclusivity', async () => {
    const { run } = setup()
    await screen.findByText(`Latest baseline: ${ID}`)
    const cases = [['Start', ['db', 'start'], true], ['Stop', ['db', 'stop'], true], ['Back up now', ['db', 'backup'], true],
      ['Verify', ['db', 'verify'], false], ['Editor on', ['db', 'ui'], true], ['Editor off', ['db', 'ui', '--off'], true]]
    for (const [name, argv, exclusive] of cases) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(run.start).toHaveBeenLastCalledWith(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
    }
  })

  it('opens the editor only while it runs', async () => {
    const { adapter } = setup()
    await screen.findByText(`Latest baseline: ${ID}`)
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(adapter.open).toHaveBeenCalledWith({ url: 'http://127.0.0.1:14331' })
    cleanup()
    setup({ ui: 'stopped' })
    await screen.findByText(`Latest baseline: ${ID}`)
    expect(screen.getByRole('button', { name: 'Open editor' }).disabled).toBe(true)
  })

  it('lists baselines and restores the chosen one', async () => {
    const { run } = setup()
    await screen.findByText(ID)
    expect(screen.getByText('5.0 MB')).toBeTruthy()
    expect(screen.getByText('Latest')).toBeTruthy()
    expect(screen.getByText('Not readable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Restore ${ID}` }))
    expect(run.start).toHaveBeenLastCalledWith(['db', 'restore', '--baseline', ID], { exclusive: true, label: `devenv db restore --baseline ${ID}` })
  })

  it('runs a SQL script on the profile database, or another one', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('Database').value).toBe('Orders_Local'))
    fireEvent.click(screen.getByRole('button', { name: 'Run example' }))
    expect(run.start).toHaveBeenLastCalledWith(['db', 'sql', 'example', '--database', 'Orders_Local'], { exclusive: true, label: 'devenv db sql example --database Orders_Local' })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'x;drop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run example' }))
    expect(run.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/Not a database name/)
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv db backup', runId: 2 } })
    await screen.findByText(ID)
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: `Restore ${ID}` }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
