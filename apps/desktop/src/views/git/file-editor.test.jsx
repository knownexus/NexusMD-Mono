import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { FileEditor } from './file-editor.jsx'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const setup = (adapter, props = {}) => {
  const onSaved = vi.fn()
  const onDirtyChange = vi.fn()
  const r = render(<FileEditor adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} path="f.txt" onSaved={onSaved} onDirtyChange={onDirtyChange} {...props} />)
  return { ...r, onSaved, onDirtyChange }
}
const editorView = async container => {
  await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy())
  return EditorView.findFromDOM(container.querySelector('.cm-editor'))
}
const type = (view, text) => act(() => { view.dispatch({ changes: { from: 0, insert: text } }) })

describe('FileEditor', () => {
  it('saves with Save and Ctrl+S, then calls onSaved', async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async () => ({ ok: true, stamp: 's2' })),
    }
    const { container, onSaved, onDirtyChange } = setup(adapter)
    const view = await editorView(container)
    expect(screen.getByText('f.txt')).toBeTruthy()
    expect(screen.queryByText('● Unsaved')).toBeNull()
    type(view, 'x')
    expect(screen.getByText('● Unsaved')).toBeTruthy()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(adapter.writeFile).toHaveBeenCalledWith(repo, repo.path, registered, 'f.txt', 'xa\n', { expectedStamp: 's1', overwrite: false, bom: false })
    expect(screen.queryByText('● Unsaved')).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    type(view, 'y')
    fireEvent.keyDown(container.querySelector('.cm-content'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
    expect(adapter.writeFile).toHaveBeenLastCalledWith(repo, repo.path, registered, 'f.txt', 'yxa\n', { expectedStamp: 's2', overwrite: false, bom: false })
  })

  it('shows the conflict choices', async () => {
    const adapter = {
      readFile: vi.fn(async () => ({ text: 'a\n', bom: false, stamp: 's1' })),
      writeFile: vi.fn(async (_r, _w, _g, _p, _t, o) => (o.overwrite ? { ok: true, stamp: 's3' } : { ok: false, conflict: true, stamp: 's2' })),
    }
    const { container, onSaved } = setup(adapter)
    type(await editorView(container), 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This file changed on disk since you opened it.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload (discard my changes)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(adapter.writeFile.mock.calls[1][5].overwrite).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("shows why a file can't be edited", async () => {
    const adapter = { readFile: vi.fn(async () => { throw new Error("Error invoking remote method 'git:readFile': Error: logo.png isn't a text file.") }) }
    const { container } = setup(adapter, { path: 'logo.png' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("logo.png isn't a text file."))
    expect(container.querySelector('.cm-editor')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
  })
})
