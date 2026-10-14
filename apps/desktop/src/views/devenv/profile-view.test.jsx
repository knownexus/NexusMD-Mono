import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { ProfileView } from './profile-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./code-editor.jsx', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />,
}))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const DIR = 'C:\\repos\\dev-environment\\profile'
const ENV = '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}\n'

function setup({ exists = true, over = {} } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const disk = { 'environment.json': { text: ENV, bom: false, mtimeMs: 1 }, 'sql/a.sql': { text: 'select 1\n', bom: false, mtimeMs: 1 } }
  const state = { exists }
  const adapter = {
    profileInfo: vi.fn(async () => ({ dir: DIR, isDefault: true, exists: state.exists, example: true })),
    profileList: vi.fn(async () => ({ dir: DIR, truncated: false, files: Object.keys(disk).map(p => ({ path: p, size: 1, mtimeMs: 1 })) })),
    profileRead: vi.fn(async (_c, p) => (p in disk ? { ...disk[p] } : { missing: true })),
    profileWrite: vi.fn(async () => ({ ok: true, mtimeMs: 2 })),
    profileCreate: vi.fn(async () => { state.exists = true; return { ok: true, dir: DIR } }),
  }
  render(<ProfileView adapter={adapter} />)
  return { run: globalThis.__run, adapter, disk }
}

describe('ProfileView', () => {
  it('offers to create a missing profile from the template', async () => {
    const { adapter } = setup({ exists: false })
    await screen.findByText(`No profile at ${DIR} yet.`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create from template' })) })
    expect(adapter.profileCreate).toHaveBeenCalledWith(CFG)
    await screen.findByRole('button', { name: 'sql/a.sql' })
  })

  it('lists the files, opens environment.json first, and always offers mac.json', async () => {
    setup()
    await screen.findByLabelText('a name')
    expect(screen.queryByLabelText('Edit environment.json')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit environment.json')
    expect(screen.getByRole('button', { name: 'sql/a.sql' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'mac.json (not created yet)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    await screen.findByLabelText('Edit sql/a.sql')
  })

  it('asks before leaving a file with unsaved changes', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit environment.json')
    fireEvent.change(screen.getByLabelText('Edit environment.json'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    expect(await screen.findByText('environment.json has unsaved changes.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Edit environment.json').value).toBe('{}')
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await screen.findByLabelText('Edit sql/a.sql')
  })

  it('really discards the draft, so re-selecting the file shows the on-disk text', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit environment.json')
    fireEvent.change(screen.getByLabelText('Edit environment.json'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await screen.findByLabelText('Edit sql/a.sql')
    fireEvent.click(screen.getByRole('button', { name: 'environment.json' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await waitFor(() => expect(screen.getByLabelText('Edit environment.json').value).toBe(ENV))
    expect(screen.queryByText('Unsaved changes from earlier were restored.')).toBeNull()
  })

  it('refreshes the file list after a save creates a file', async () => {
    const { adapter, disk } = setup()
    await screen.findByLabelText('a name')
    adapter.profileWrite.mockImplementation(async (_c, p, text) => { disk[p] = { text, bom: false, mtimeMs: 2 }; return { ok: true, mtimeMs: 2 } })
    fireEvent.click(screen.getByRole('button', { name: 'mac.json (not created yet)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit mac.json')
    fireEvent.change(screen.getByLabelText('Edit mac.json'), { target: { value: '{"host":"h","user":"u"}\n' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await screen.findByRole('button', { name: 'mac.json' })
    expect(screen.queryByRole('button', { name: 'mac.json (not created yet)' })).toBeNull()
  })

  it('runs devenv doctor as Check, alongside other runs', async () => {
    const { run } = setup()
    await screen.findByLabelText('a name')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(run.start).toHaveBeenCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
  })

  it('shows profile errors', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<ProfileView adapter={{ profileInfo: vi.fn(async () => { throw new Error('Set the devenv folder in Settings') }) }} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Set the devenv folder/))
  })
})
