import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { createEditorStore } from './editor-store.js'

// CodeMirror is its own thing to test; here the editor is a plain textarea.
vi.mock('@nexusmd/editor-kit/code-editor.jsx', () => ({
  languageForPath: p => (String(p).endsWith('.md') ? 'markdown' : 'plaintext'),
  CodeEditor: ({ value, onChange, ariaLabel, readOnly }) => <textarea aria-label={ariaLabel} value={value} readOnly={readOnly} onChange={e => onChange?.(e.target.value)} />,
}))

import { EditorApp } from './editor-app.jsx'

afterEach(cleanup)

function fakeDisk(files, folders = {}) {
  const disk = new Map(Object.entries(files))
  const stamp = t => `s:${t}`
  return {
    disk,
    stat: vi.fn(async p => (disk.has(p) ? { exists: true, kind: 'file' } : p in folders ? { exists: true, kind: 'dir' } : { exists: false })),
    read: vi.fn(async p => (disk.has(p) ? { path: p, text: disk.get(p), bom: false, stamp: stamp(disk.get(p)) } : { missing: true })),
    write: vi.fn(async (p, text, { expectedStamp, overwrite }) => {
      if (disk.has(p) && !overwrite && stamp(disk.get(p)) !== expectedStamp) return { ok: false, conflict: true }
      disk.set(p, text); return { ok: true, stamp: stamp(text) }
    }),
    list: vi.fn(async p => ({ entries: folders[p] ?? [], truncated: false })),
  }
}

function setup({ files = { '/work/a.txt': 'alpha', '/work/b.md': '# beta' }, folders = {}, picker = {} } = {}) {
  const api = fakeDisk(files, folders)
  const store = createEditorStore({ api })
  const host = { adapters: { picker } }
  render(<EditorApp host={host} store={store} api={api} />)
  return { api, store }
}

const textbox = name => screen.getByRole('textbox', { name: new RegExp(`Editing ${name}`) })

describe('opening', () => {
  it('starts with an invitation, and the recent files when there are some', async () => {
    const api = fakeDisk({ '/work/a.txt': 'alpha' })
    const store = createEditorStore({ api })
    await store.openFile('/work/a.txt'); store.close('/work/a.txt')
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
    expect(screen.getByText(/Open a file or a folder/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'a.txt' })).toBeTruthy()
  })

  it('opens the file the picker returns, asking only for its path', async () => {
    const picker = { pickFile: vi.fn(async () => ({ path: '/work/a.txt', name: 'a.txt' })) }
    setup({ picker })
    fireEvent.click(screen.getByRole('button', { name: 'Open file…' }))
    expect(await screen.findByDisplayValue('alpha')).toBeTruthy()
    expect(picker.pickFile).toHaveBeenCalledWith({ pathOnly: true })
    expect(screen.getByRole('tab', { name: /a\.txt/ })).toBeTruthy()
  })

  it('does nothing when the picker is cancelled', async () => {
    const picker = { pickFile: vi.fn(async () => null), pickDirectory: vi.fn(async () => null) }
    const { store } = setup({ picker })
    fireEvent.click(screen.getByRole('button', { name: 'Open file…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open folder…' }))
    await waitFor(() => expect(picker.pickDirectory).toHaveBeenCalled())
    expect(store.getState().docs).toEqual([])
    expect(store.getState().folder).toBeNull()
  })

  it('opens something from the recent list', async () => {
    const api = fakeDisk({ '/work/a.txt': 'alpha' })
    const store = createEditorStore({ api })
    await store.openFile('/work/a.txt'); store.close('/work/a.txt')
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
    fireEvent.change(screen.getByLabelText('Recent'), { target: { value: '/work/a.txt' } })
    expect(await screen.findByDisplayValue('alpha')).toBeTruthy()
  })

  it('shows why something could not be opened, and lets it be dismissed', async () => {
    const { store } = setup()
    await store.openPath('/nope.txt')
    expect(await screen.findByText(/doesn't exist/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/doesn't exist/)).toBeNull()
  })
})

describe('editing', () => {
  it('marks a changed file, saves it with the button, and clears the mark', async () => {
    const { api, store } = setup()
    await store.openFile('/work/a.txt')
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'alpha!' } })
    expect(screen.getByLabelText('unsaved changes')).toBeTruthy()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.disk.get('/work/a.txt')).toBe('alpha!'))
    await waitFor(() => expect(screen.queryByLabelText('unsaved changes')).toBeNull())
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
  })

  it('saves with Ctrl+S', async () => {
    const { api, store } = setup()
    await store.openFile('/work/a.txt')
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'saved by key' } })
    fireEvent.keyDown(textbox('a.txt'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(api.disk.get('/work/a.txt')).toBe('saved by key'))
  })

  it('offers to load the disk version or overwrite it when the file changed underneath', async () => {
    const { api, store } = setup()
    await store.openFile('/work/a.txt')
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'mine' } })
    api.disk.set('/work/a.txt', 'someone else')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/changed on disk since you opened it/)).toBeTruthy()
    expect(api.disk.get('/work/a.txt')).toBe('someone else')

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite it with mine' }))
    await waitFor(() => expect(api.disk.get('/work/a.txt')).toBe('mine'))
    await waitFor(() => expect(screen.queryByText(/changed on disk/)).toBeNull())
  })

  it('loads the disk version, dropping the edits, on request', async () => {
    const { api, store } = setup()
    await store.openFile('/work/a.txt')
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'mine' } })
    api.disk.set('/work/a.txt', 'someone else')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load the disk version' }))
    expect(await screen.findByDisplayValue('someone else')).toBeTruthy()
  })

  it('shows a file that could not be read, with a way to retry', async () => {
    const { api, store } = setup()
    api.read.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:read': Error: x isn't a text file."))
    await store.openFile('/work/a.txt')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "x isn't a text file.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByDisplayValue('alpha')).toBeTruthy()
  })
})

describe('tabs', () => {
  it('switches between open files, keeping each one\'s edits', async () => {
    const { store } = setup()
    await store.openFile('/work/a.txt'); await store.openFile('/work/b.md')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByDisplayValue('# beta')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^a\.txt/ }))
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'alpha edited' } })
    fireEvent.click(screen.getByRole('button', { name: /^b\.md/ }))
    expect(await screen.findByDisplayValue('# beta')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^a\.txt/ }))
    expect(await screen.findByDisplayValue('alpha edited')).toBeTruthy()
  })

  it('closes a clean tab straight away', async () => {
    const { store } = setup()
    await store.openFile('/work/a.txt')
    await screen.findByDisplayValue('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Close a.txt' }))
    expect(store.getState().docs).toEqual([])
  })

  it('asks before closing a tab with unsaved edits', async () => {
    const { store } = setup()
    await store.openFile('/work/a.txt')
    fireEvent.change(await screen.findByDisplayValue('alpha'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close a.txt' }))
    expect(screen.getByText('Discard your changes to a.txt?')).toBeTruthy()
    expect(store.getState().docs).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(store.getState().docs).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close a.txt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(store.getState().docs).toEqual([])
  })
})

describe('folder tree', () => {
  const folders = {
    '/proj': [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }],
    '/proj/src': [{ name: 'main.js', kind: 'file' }],
  }
  const files = { '/proj/README.md': '# readme', '/proj/src/main.js': 'run()' }
  const sep = '/'

  it('lists the folder, opens sub-folders when clicked, and opens a file in a tab', async () => {
    const { store } = setup({ files, folders })
    store.openFolder('/proj')
    const tree = await screen.findByRole('tree', { name: 'Folder' })
    expect(within(tree).getByText('README.md')).toBeTruthy()
    expect(within(tree).queryByText('main.js')).toBeNull()

    fireEvent.click(within(tree).getByText('src'))
    fireEvent.click(await within(tree).findByText('main.js'))
    expect(await screen.findByDisplayValue('run()')).toBeTruthy()
    expect(store.getState().active).toBe('/proj' + sep + 'src' + sep + 'main.js')
  })

  it('shows a folder it cannot read, without breaking the rest', async () => {
    const { api, store } = setup({ files, folders })
    api.list.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:list': Error: EACCES"))
    store.openFolder('/proj')
    expect(await screen.findByText('EACCES')).toBeTruthy()
  })

  it('closes the folder', async () => {
    const { store } = setup({ files, folders })
    store.openFolder('/proj')
    await screen.findByRole('tree')
    fireEvent.click(screen.getByRole('button', { name: 'Close folder' }))
    expect(screen.queryByRole('tree')).toBeNull()
  })
})

describe('read-only text', () => {
  it('shows where the text came from, says it is read-only, and offers no Save', () => {
    const { store } = setup()
    store.openText({ id: 'github:acme/web@main:src/a.js', name: 'a.js', text: 'alpha', origin: 'acme/web on GitHub, main: src/a.js' })
    return waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Reading a.js' }).readOnly).toBe(true)
      expect(screen.getByText('acme/web on GitHub, main: src/a.js')).toBeTruthy()
      expect(screen.getByText('Read-only')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    })
  })
})

describe('markdown', () => {
  const preview = name => screen.findByLabelText(`Preview of ${name}`)

  it('opens a markdown file rendered, and Edit shows its source to change', async () => {
    const { store } = setup({ files: { '/work/b.md': '# beta\n\nSome **bold** text' } })
    await store.openFile('/work/b.md')
    const shown = await preview('b.md')
    expect(within(shown).getByRole('heading', { name: 'beta' })).toBeTruthy()
    expect(shown.querySelector('strong').textContent).toBe('bold')
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(textbox('b.md'), { target: { value: '# gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(within(await preview('b.md')).getByRole('heading', { name: 'gamma' })).toBeTruthy()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('keeps each tab showing the way it was left', async () => {
    const { store } = setup()
    await store.openFile('/work/b.md')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await store.openFile('/work/a.txt')
    fireEvent.click(screen.getByRole('button', { name: /^b\.md/ }))
    expect(await screen.findByDisplayValue('# beta')).toBeTruthy()
  })

  it('shows the source when asked for a line in it', async () => {
    const { store } = setup()
    await store.openFile('/work/b.md', { line: 1 })
    expect(await screen.findByDisplayValue('# beta')).toBeTruthy()
  })

  it('offers no choice for files that are not markdown', async () => {
    const { store } = setup()
    await store.openFile('/work/a.txt')
    await screen.findByDisplayValue('alpha')
    expect(screen.queryByRole('group', { name: 'Show as' })).toBeNull()
  })

  it('renders read-only markdown too, with its source a click away but never editable', async () => {
    const { store } = setup()
    store.openText({ id: 'github:acme/web@main:README.md', name: 'README.md', text: '# readme', origin: 'acme/web on GitHub, main: README.md' })
    expect(within(await preview('README.md')).getByRole('heading', { name: 'readme' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.getByRole('textbox', { name: 'Reading README.md' }).readOnly).toBe(true)
  })
})
