import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ProfileFileEditor } from './profile-file-editor.jsx'

vi.mock('./code-editor.jsx', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />,
}))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
function fakeAdapter(files = {}) {
  const disk = { ...files }
  return {
    disk,
    profileRead: vi.fn(async (_c, p) => (p in disk ? { ...disk[p] } : { missing: true })),
    profileWrite: vi.fn(async (_c, p, text, opts) => {
      const cur = disk[p]
      if (!opts.overwrite && cur && (opts.create || cur.mtimeMs !== opts.expectedMtimeMs)) return { ok: false, conflict: true, mtimeMs: cur.mtimeMs }
      if (!opts.overwrite && !cur && !opts.create) return { ok: false, missing: true }
      disk[p] = { text, bom: !!opts.bom, mtimeMs: (cur?.mtimeMs ?? 0) + 1 }
      return { ok: true, mtimeMs: disk[p].mtimeMs }
    }),
  }
}
const edit = (label, text) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } })

describe('ProfileFileEditor', () => {
  it('loads a file, saves edits with the mtime it read, and keeps CRLF and the BOM', async () => {
    const a = fakeAdapter({ 'commands.ps1': { text: 'a\r\nb\r\n', bom: true, mtimeMs: 10 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="commands.ps1" />)
    await waitFor(() => expect(screen.getByLabelText('Edit commands.ps1').value).toBe('a\nb\n'))
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    edit('Edit commands.ps1', 'a\nc\n')
    expect(screen.getByText('Unsaved')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(a.profileWrite).toHaveBeenCalledWith(CFG, 'commands.ps1', 'a\r\nc\r\n', { expectedMtimeMs: 10, overwrite: false, bom: true, create: false })
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  it('blocks saving invalid JSON and shows the line', async () => {
    const a = fakeAdapter({ 'docker/x.json': { text: '{}\n', bom: false, mtimeMs: 1 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="docker/x.json" />)
    await waitFor(() => expect(screen.getByLabelText('Edit docker/x.json').value).toBe('{}\n'))
    edit('Edit docker/x.json', '{\n  "a": 1,\n}')
    expect(screen.getByRole('alert').textContent).toMatch(/Line 3/)
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
  })

  it('shows a conflict when the file changed on disk, and can overwrite or reload', async () => {
    const a = fakeAdapter({ 'environment.json': { text: '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}', bom: false, mtimeMs: 1 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="environment.json" />)
    await waitFor(() => expect(screen.getByLabelText('Edit environment.json')).toBeTruthy())
    a.disk['environment.json'] = { text: '{"repositories":{"b":{"source":"s","ref":"r","project":"p","kind":"api"}}}', bom: false, mtimeMs: 5 }
    edit('Edit environment.json', '{"repositories":{"c":{"source":"s","ref":"r","project":"p","kind":"api"}}}')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(screen.getByText('This file changed on disk since you opened it.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overwrite' })) })
    expect(a.profileWrite).toHaveBeenLastCalledWith(CFG, 'environment.json', expect.stringContaining('"c"'), expect.objectContaining({ overwrite: true }))
    a.disk['environment.json'].mtimeMs = 99
    edit('Edit environment.json', '{"repositories":{"d":{"source":"s","ref":"r","project":"p","kind":"api"}}}')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload (discard my changes)' })) })
    await waitFor(() => expect(screen.getByLabelText('Edit environment.json').value).toContain('"c"'))
  })

  it('creates a missing file on save', async () => {
    const a = fakeAdapter()
    render(<ProfileFileEditor adapter={a} config={CFG} path="mac.json" />)
    await screen.findByText("mac.json doesn't exist yet - fill it in and Save to create it.")
    edit('Edit mac.json', '{"host":"mac.local","user":"me"}\n')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(a.profileWrite).toHaveBeenCalledWith(CFG, 'mac.json', '{"host":"mac.local","user":"me"}\n', expect.objectContaining({ create: true }))
  })

  it('keeps unsaved edits when the editor is remounted, until reverted', async () => {
    const a = fakeAdapter({ 'sql/a.sql': { text: 'select 1\n', bom: false, mtimeMs: 1 } })
    const first = render(<ProfileFileEditor adapter={a} config={CFG} path="sql/a.sql" />)
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 1\n'))
    edit('Edit sql/a.sql', 'select 2\n')
    first.unmount()
    render(<ProfileFileEditor adapter={a} config={CFG} path="sql/a.sql" />)
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 2\n'))
    expect(screen.getByText('Unsaved changes from earlier were restored.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revert' })) })
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 1\n'))
  })

  it('reports read errors', async () => {
    const a = { profileRead: vi.fn(async () => { throw new Error('big.txt is too large to edit here (2048 KB).') }), profileWrite: vi.fn() }
    render(<ProfileFileEditor adapter={a} config={CFG} path="big.txt" />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too large/))
  })
})
