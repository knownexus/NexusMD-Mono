import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { ProfileView } from './profile-view.jsx'
import { clearAllDrafts, setDraft } from './profile-drafts.js'
import { EXAMPLE_ENV, DIR, CFG, fakeProfileAdapter } from './profile-test-fixtures.js'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(() => { cleanup(); clearAllDrafts() })

function setup(files, { over = {}, config = CFG } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config }
  const adapter = fakeProfileAdapter(files)
  const utils = render(<ProfileView adapter={adapter} picker={{ pickFile: vi.fn() }} />)
  return { adapter, run: globalThis.__run, ...utils }
}
const fileList = () => within(screen.getByRole('navigation', { name: 'Profile files' }))

describe('ProfileView', () => {
  it('lists Environment and Mac first, then the other files by folder, and opens environment.json', async () => {
    setup({ 'environment.json': EXAMPLE_ENV, 'commands.ps1': '#', 'docker/services.compose.yml': 'a: 1' })
    await screen.findByText(DIR)
    expect(screen.getByText("(devenv's default)")).toBeTruthy()
    const names = fileList().getAllByRole('button').map(b => b.textContent)
    expect(names.slice(0, 4)).toEqual(['Environment', 'Mac (not set up)', 'commands.ps1', 'services.compose.yml'])
    expect(fileList().getByText('docker/')).toBeTruthy()
    expect(await screen.findByText('environment.json')).toBeTruthy()
  })

  it('without a profile offers Create from template, run exclusively', async () => {
    const { run } = setup({})
    fireEvent.click(await screen.findByRole('button', { name: 'Create from template' }))
    expect(run.start).toHaveBeenCalledWith(['setup', 'profile'], { exclusive: true, label: 'devenv setup profile' })
    expect(screen.getByText(`No profile at ${DIR} yet.`)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check' }).disabled).toBe(true)
  })

  it('reloads the list when the template run ends', async () => {
    const { adapter, rerender } = setup({})
    await screen.findByRole('button', { name: 'Create from template' })
    globalThis.__run = { ...globalThis.__run, state: { ...createRunState('devenv setup profile'), status: 'running' } }
    rerender(<ProfileView adapter={adapter} picker={{}} />)
    adapter.changeOnDisk('environment.json', EXAMPLE_ENV)
    globalThis.__run = { ...globalThis.__run, state: { ...createRunState('devenv setup profile'), status: 'done' } }
    rerender(<ProfileView adapter={adapter} picker={{}} />)
    expect(await screen.findByRole('navigation', { name: 'Profile files' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create from template' })).toBeNull())
  })

  it('Check runs devenv doctor alongside other runs; Open folder opens the profile', async () => {
    const { run, adapter } = setup({ 'environment.json': EXAMPLE_ENV })
    await screen.findByText('environment.json')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(run.start).toHaveBeenCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Open folder' })[0])
    expect(adapter.open).toHaveBeenCalledWith({ path: DIR })
  })

  it('marks files with unsaved drafts', async () => {
    setDraft(DIR, 'commands.ps1', { text: 'x', baseStamp: 's0' })
    setup({ 'environment.json': EXAMPLE_ENV, 'commands.ps1': '#' })
    await screen.findByText('environment.json')
    expect(fileList().getByRole('button', { name: /commands\.ps1/ }).textContent).toBe('commands.ps1 •')
  })

  it('New file refuses paths outside the profile before asking main', async () => {
    const { adapter } = setup({ 'environment.json': EXAMPLE_ENV })
    await screen.findByText('environment.json')
    fireEvent.click(screen.getByRole('button', { name: 'New file…' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New file path' }), { target: { value: '../devenv.ps1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByText('Use a path inside the profile, like sql/cleanup.sql.')).toBeTruthy()
    expect(adapter.readProfileFile).not.toHaveBeenCalledWith(CFG, '../devenv.ps1')
  })

  it('New file opens an empty file that Save creates', async () => {
    const { adapter } = setup({ 'environment.json': EXAMPLE_ENV })
    await screen.findByText('environment.json')
    fireEvent.click(screen.getByRole('button', { name: 'New file…' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New file path' }), { target: { value: 'sql\\cleanup.sql' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const box = await screen.findByRole('textbox', { name: 'Text of sql/cleanup.sql' })
    fireEvent.change(box, { target: { value: 'DELETE FROM x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(adapter.disk.get('sql/cleanup.sql')).toBe('DELETE FROM x'))
  })

  it('shows its own runs in the run panel', async () => {
    setup({ 'environment.json': EXAMPLE_ENV }, { over: { command: 'devenv doctor', status: 'running', lines: [] } })
    await screen.findByText('environment.json')
    expect(screen.getByText('devenv doctor')).toBeTruthy()
  })
})
