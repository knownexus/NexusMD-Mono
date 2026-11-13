import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TargetPicker } from './target-picker.jsx'
import { WidgetSheet } from './home-widgets.jsx'

afterEach(cleanup)

const TREE = {
  '/': [{ name: 'src', path: '/src', isFolder: true }, { name: 'a.txt', path: '/a.txt', isFolder: false }],
  '/src': [{ name: 'deep', path: '/src/deep', isFolder: true }, { name: 'b.js', path: '/src/b.js', isFolder: false }],
  '/src/deep': [],
}
const gitSource = (over = {}) => ({
  id: 'git', label: 'Repository file or folder', desc: 'A file or folder in a repository', icon: 'git-branch',
  roots: async () => [{ id: 'r1', title: 'alpha', sub: 'P' }],
  list: vi.fn(async (_root, path) => TREE[path] ?? []),
  toTarget: (root, e) => ({
    target: 'git', kind: !e || e.isFolder ? 'folder' : 'file', path: e?.path ?? '/', repo: { provider: 'ado', name: root.title, project: root.sub },
  }),
  ...over,
})
const jsonSource = () => ({
  id: 'json', label: 'JSON document', desc: 'A saved JSON document', icon: 'doc',
  roots: async () => [{ id: 'j1', title: 'cfg', sub: 'JSON' }, { id: 'j2', title: 'users' }],
  toTarget: r => ({ target: 'doc', tool: 'json', docId: r.id, name: r.title }),
})

describe('TargetPicker', () => {
  it('offers each kind of thing to pick, then what is in it', async () => {
    render(<TargetPicker sources={[gitSource(), jsonSource()]} onPick={() => {}} />)
    expect(screen.getByText('Repository file or folder')).toBeTruthy()
    expect(screen.getByText('A saved JSON document')).toBeTruthy()
    fireEvent.click(screen.getByText('Repository file or folder'))
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(screen.getByText('P')).toBeTruthy()
  })

  it('picks a document straight from the list, since there is nothing to browse in it', async () => {
    const onPick = vi.fn()
    render(<TargetPicker sources={[gitSource(), jsonSource()]} onPick={onPick} />)
    fireEvent.click(screen.getByText('JSON document'))
    fireEvent.click(await screen.findByText('users'))
    expect(onPick).toHaveBeenCalledWith({ target: 'doc', tool: 'json', docId: 'j2', name: 'users' })
  })

  it('browses a repository folder by folder and picks a file in it', async () => {
    const onPick = vi.fn()
    render(<TargetPicker sources={[gitSource()]} onPick={onPick} />)
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('b.js')).toBeTruthy()
    fireEvent.click(screen.getByText('b.js'))
    expect(onPick).toHaveBeenCalledWith({ target: 'git', kind: 'file', path: '/src/b.js', repo: { provider: 'ado', name: 'alpha', project: 'P' } })
  })

  it('picks the folder it is in, wherever that is, including the repository itself', async () => {
    const onPick = vi.fn()
    render(<TargetPicker sources={[gitSource()]} onPick={onPick} />)
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose this folder' }))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'folder', path: '/' }))
    fireEvent.click(await screen.findByText('src'))
    await screen.findByText('b.js')
    fireEvent.click(screen.getByRole('button', { name: 'Choose this folder' }))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'folder', path: '/src' }))
  })

  it('goes back a folder, then out of the repository, then to the kinds', async () => {
    render(<TargetPicker sources={[gitSource(), jsonSource()]} onPick={() => {}} />)
    fireEvent.click(screen.getByText('Repository file or folder'))
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('src'))
    fireEvent.click(await screen.findByText('deep'))
    expect(await screen.findByText('This folder is empty.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText('b.js')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText('a.txt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(screen.queryByText('a.txt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByText('JSON document')).toBeTruthy()
  })

  it('goes straight to the choices when there is only one kind, with no way back to a list of one', async () => {
    render(<TargetPicker sources={[gitSource()]} onPick={() => {}} />)
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
  })

  it('says when there is nothing to choose, and why a listing failed', async () => {
    const { unmount } = render(<TargetPicker sources={[gitSource({ roots: async () => [], empty: 'No repositories are connected.' })]} onPick={() => {}} />)
    expect(await screen.findByText('No repositories are connected.')).toBeTruthy()
    unmount()
    render(<TargetPicker sources={[gitSource({ roots: async () => { throw new Error('Offline.') } })]} onPick={() => {}} />)
    expect(await screen.findByText('Offline.')).toBeTruthy()
  })

  it('says why a folder could not be read, and lets the person go back', async () => {
    const source = gitSource({ list: vi.fn(async () => { throw new Error('No access to that folder.') }) })
    render(<TargetPicker sources={[source]} onPick={() => {}} />)
    fireEvent.click(await screen.findByText('alpha'))
    expect(await screen.findByText('No access to that folder.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText('alpha')).toBeTruthy()
  })

  it('has nothing to show when the host supplies no sources', () => {
    render(<TargetPicker sources={[]} onPick={() => {}} />)
    expect(screen.getByText('Nothing to choose from here.')).toBeTruthy()
  })

  it('opens a row from the keyboard', async () => {
    const onPick = vi.fn()
    render(<TargetPicker sources={[jsonSource()]} onPick={onPick} />)
    fireEvent.keyDown(await screen.findByText('cfg'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: /^users/ }), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ docId: 'j2' }))
  })
})

describe('Add widget: File or folder', () => {
  const noop = () => {}
  const open = (props = {}) => render(<WidgetSheet open widget={null} targetSources={[gitSource(), jsonSource()]} onClose={noop} onSave={noop} onRemove={noop} {...props}/>)

  it('picks something, names it if wanted, and adds a shortcut to it', async () => {
    const onSave = vi.fn()
    open({ onSave })
    fireEvent.click(screen.getByText('File or folder'))
    fireEvent.click(screen.getByText('Repository file or folder'))
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('src'))
    fireEvent.click(await screen.findByText('b.js'))
    expect(await screen.findByText('Opens')).toBeTruthy()
    expect(screen.getByText('b.js')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Entry point' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    expect(onSave).toHaveBeenCalledWith({
      id: expect.any(String), type: 'link',
      config: { target: 'git', kind: 'file', path: '/src/b.js', repo: { provider: 'ado', name: 'alpha', project: 'P' }, label: 'Entry point' },
    })
  })

  it('cannot add anything before something is picked', () => {
    open()
    fireEvent.click(screen.getByText('File or folder'))
    expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull()
  })

  it('lets the pick be changed before adding', async () => {
    const onSave = vi.fn()
    open({ onSave })
    fireEvent.click(screen.getByText('File or folder'))
    fireEvent.click(screen.getByText('JSON document'))
    fireEvent.click(await screen.findByText('cfg'))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose something else' }))
    fireEvent.click(await screen.findByText('JSON document'))
    fireEvent.click(await screen.findByText('users'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add widget' }))
    expect(onSave.mock.calls[0][0].config).toMatchObject({ target: 'doc', tool: 'json', docId: 'j2' })
  })

  it('starts the picking again for the next shortcut', async () => {
    const { rerender } = open()
    fireEvent.click(screen.getByText('File or folder'))
    fireEvent.click(screen.getByText('JSON document'))
    fireEvent.click(await screen.findByText('cfg'))
    await screen.findByText('Opens')
    rerender(<WidgetSheet open={false} widget={null} targetSources={[jsonSource()]} onClose={noop} onSave={noop} onRemove={noop}/>)
    rerender(<WidgetSheet open widget={null} targetSources={[jsonSource()]} onClose={noop} onSave={noop} onRemove={noop}/>)
    await waitFor(() => expect(screen.getByText('File or folder')).toBeTruthy())
  })
})

describe('TargetPicker with a pick that finishes later', () => {
  const dialogSource = (result) => ({
    id: 'editor', label: 'Editor file', icon: 'doc',
    roots: async () => [{ id: 'file', title: 'Pick a file…' }],
    toTarget: vi.fn(() => Promise.resolve(result)),
  })

  it('hands over the target once the dialog gives it', async () => {
    const onPick = vi.fn()
    render(<TargetPicker sources={[dialogSource({ target: 'editor', kind: 'file', path: 'C:/a.md', name: 'a.md', platform: 'desktop' })]} onPick={onPick} />)
    fireEvent.click(await screen.findByText('Pick a file…'))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ path: 'C:/a.md' })))
  })

  it('does nothing, and stays on the choices, when the dialog was cancelled', async () => {
    const onPick = vi.fn()
    const source = dialogSource(null)
    render(<TargetPicker sources={[source]} onPick={onPick} />)
    fireEvent.click(await screen.findByText('Pick a file…'))
    await waitFor(() => expect(source.toTarget).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('Pick a file…')).toBeTruthy()
  })
})

describe('TargetPicker when a file dialog fails', () => {
  it('says why instead of failing silently, and clears it when the person goes back', async () => {
    const source = {
      id: 'editor', label: 'Editor file', icon: 'doc',
      roots: async () => [{ id: 'file', title: 'Pick a file…' }],
      toTarget: () => Promise.reject(new Error('The dialog could not open.')),
    }
    const onPick = vi.fn()
    render(<TargetPicker sources={[source, jsonSource()]} onPick={onPick} />)
    fireEvent.click(screen.getByText('Editor file'))
    fireEvent.click(await screen.findByText('Pick a file…'))
    expect(await screen.findByText('The dialog could not open.')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    fireEvent.click(screen.getByText('Editor file'))
    await screen.findByText('Pick a file…')
    expect(screen.queryByText('The dialog could not open.')).toBeNull()
  })
})
