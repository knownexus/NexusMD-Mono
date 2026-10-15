import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { ProfileView } from './profile-view.jsx'
import { clearProfileDrafts } from './use-profile-file.js'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./code-editor.jsx', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />,
}))
afterEach(() => { cleanup(); clearProfileDrafts() })

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const DIR = 'C:\\repos\\dev-environment\\profile'
const ENV = '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}\n'

function setup({ exists = true, over = {}, truncated = false } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const disk = { 'environment.json': { text: ENV, bom: false, stamp: 'aaa' }, 'sql/a.sql': { text: 'select 1\n', bom: false, stamp: 'aaa' } }
  const state = { exists }
  const adapter = {
    profileInfo: vi.fn(async () => ({ dir: DIR, isDefault: true, exists: state.exists, example: true })),
    profileList: vi.fn(async () => ({ dir: DIR, truncated, files: Object.keys(disk).map(p => ({ path: p, size: 1, mtimeMs: 1 })) })),
    profileRead: vi.fn(async (_c, p) => (p in disk ? { ...disk[p] } : { missing: true })),
    profileWrite: vi.fn(async () => ({ ok: true, stamp: 'bbb' })),
    profileCreate: vi.fn(async () => { state.exists = true; return { ok: true, dir: DIR } }),
  }
  render(<ProfileView adapter={adapter} />)
  return { run: globalThis.__run, adapter, disk }
}

describe('ProfileView', () => {
  it('notes when the file list was cut off, and not otherwise', async () => {
    setup({ truncated: true })
    await screen.findByText('Only the first 2000 files are listed.')
    cleanup()
    setup()
    await screen.findByRole('button', { name: 'sql/a.sql' })
    expect(screen.queryByText('Only the first 2000 files are listed.')).toBeNull()
  })

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

  it('switches files without asking and keeps the unsaved draft, marked in the list', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit environment.json')
    fireEvent.change(screen.getByLabelText('Edit environment.json'), { target: { value: '{"edited":true}' } })
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    await screen.findByLabelText('Edit sql/a.sql')
    const marked = screen.getByRole('button', { name: 'environment.json, unsaved changes' })
    expect(marked.textContent).toContain('•')
    fireEvent.click(marked)
    await screen.findByText('Unsaved changes from earlier were restored.')
  })

  it('drops the marker when the draft is reverted', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    await screen.findByLabelText('Edit environment.json')
    fireEvent.change(screen.getByLabelText('Edit environment.json'), { target: { value: '{"edited":true}' } })
    await screen.findByRole('button', { name: 'environment.json, unsaved changes' })
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await screen.findByRole('button', { name: 'environment.json' })
  })

  it('refreshes the file list after a save creates a file', async () => {
    const { adapter, disk } = setup()
    await screen.findByLabelText('a name')
    adapter.profileWrite.mockImplementation(async (_c, p, text) => { disk[p] = { text, bom: false, stamp: 'bbb' }; return { ok: true, stamp: 'bbb' } })
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
