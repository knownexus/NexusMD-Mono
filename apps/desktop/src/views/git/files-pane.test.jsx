import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { FilesPane } from './files-pane.jsx'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const files = ['README.md', 'docs/guide.md', 'src/app.jsx']
const dropped = name => ({ name })

function setup({ plan = { total: 1, conflicts: [], failed: [] }, result = { added: 1, replaced: 0, skipped: 0, failed: [] } } = {}) {
  const adapter = {
    files: vi.fn(async () => ({ files, truncated: false })),
    pathForFile: vi.fn(f => (f.name === 'unknown' ? '' : `D:\\in\\${f.name}`)),
    importFiles: vi.fn(async (_r, _w, _g, _d, _s, options) => (options?.dryRun ? plan : result)),
  }
  const onImported = vi.fn()
  render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} onImported={onImported} />)
  return { adapter, onImported }
}
const dropOn = (el, names) => fireEvent.drop(el, { dataTransfer: { types: ['Files'], files: names.map(dropped) } })
const row = async name => (await screen.findAllByRole('treeitem')).find(r => r.textContent.includes(name))

describe('FilesPane', () => {
  it('lists folders first and opens one on click', async () => {
    setup()
    await row('docs')
    expect(screen.queryByText('guide.md')).toBeNull()
    fireEvent.click(await row('docs'))
    expect(screen.getByText('guide.md')).toBeTruthy()
  })

  it('copies files dropped on a folder into it, then refreshes', async () => {
    const { adapter, onImported } = setup()
    dropOn(await row('docs'), ['logo.png'])
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(adapter.importFiles).toHaveBeenLastCalledWith(repo, repo.path, registered, 'docs', ['D:\\in\\logo.png'], { replace: [] })
    expect(screen.getByRole('status').textContent).toBe('Added 1 file.')
    expect(adapter.files).toHaveBeenCalledTimes(2)
  })

  it('drops on a file row into its folder and on empty space into the root', async () => {
    const { adapter } = setup()
    fireEvent.click(await row('docs'))
    dropOn(screen.getByText('guide.md'), ['a.txt'])
    await waitFor(() => expect(adapter.importFiles).toHaveBeenCalledTimes(2))
    expect(adapter.importFiles.mock.calls[1][3]).toBe('docs')
    dropOn(screen.getByRole('tree'), ['b.txt'])
    await waitFor(() => expect(adapter.importFiles).toHaveBeenCalledTimes(4))
    expect(adapter.importFiles.mock.calls[3][3]).toBe('')
  })

  it('asks before replacing, and Skip leaves the file alone', async () => {
    const { adapter } = setup({ plan: { total: 2, conflicts: ['docs/a.txt', 'docs/b.txt'], failed: [] }, result: { added: 0, replaced: 1, skipped: 1, failed: [] } })
    dropOn(await row('docs'), ['a.txt', 'b.txt'])
    expect(await screen.findByText('docs/a.txt')).toBeTruthy()
    expect(adapter.importFiles).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByText('docs/b.txt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(adapter.importFiles).toHaveBeenCalledTimes(2))
    expect(adapter.importFiles.mock.calls[1][5]).toEqual({ replace: ['docs/b.txt'] })
    expect((await screen.findByRole('status')).textContent).toBe('Replaced 1 file, skipped 1.')
  })

  it('applies one answer to all remaining names', async () => {
    const { adapter } = setup({ plan: { total: 3, conflicts: ['a', 'b', 'c'], failed: [] } })
    dropOn(await row('src'), ['a', 'b', 'c'])
    await screen.findByText('a')
    fireEvent.click(screen.getByLabelText(/Apply to all remaining \(3\)/))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(adapter.importFiles).toHaveBeenCalledTimes(2))
    expect(adapter.importFiles.mock.calls[1][5]).toEqual({ replace: ['a', 'b', 'c'] })
  })

  it('copies nothing when the question is cancelled', async () => {
    const { adapter, onImported } = setup({ plan: { total: 1, conflicts: ['docs/a.txt'], failed: [] } })
    dropOn(await row('docs'), ['a.txt'])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    expect(adapter.importFiles).toHaveBeenCalledTimes(1)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('says so when a dropped item has no file path', async () => {
    const { adapter } = setup()
    dropOn(await row('docs'), ['unknown'])
    expect((await screen.findByRole('alert')).textContent).toMatch(/where the dropped items came from/)
    expect(adapter.importFiles).not.toHaveBeenCalled()
  })

  it('shows a refusal from the host', async () => {
    const { adapter } = setup()
    adapter.importFiles.mockRejectedValueOnce(new Error("Error invoking remote method 'git:importFiles': Error: Not a worktree folder: docs"))
    dropOn(await row('docs'), ['a.txt'])
    expect((await screen.findByRole('alert')).textContent).toBe('Not a worktree folder: docs')
  })

  it('opens a file on double-click and Enter, but not a folder', async () => {
    const onOpenFile = vi.fn()
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(async () => {}) }
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} onOpenFile={onOpenFile} />)
    fireEvent.doubleClick(await row('README.md'))
    expect(onOpenFile).toHaveBeenLastCalledWith('README.md')
    fireEvent.click(await row('docs'))
    fireEvent.doubleClick(await row('docs'))
    expect(onOpenFile).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(await row('guide.md'), { key: 'Enter' })
    expect(onOpenFile).toHaveBeenLastCalledWith('docs/guide.md')
  })

  it('shows a file or folder in the file manager from the right-click menu', async () => {
    const onOpenFile = vi.fn()
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(async () => {}) }
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} onOpenFile={onOpenFile} />)
    fireEvent.contextMenu(await row('README.md'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show in Explorer' }))
    await waitFor(() => expect(adapter.reveal).toHaveBeenLastCalledWith(repo, repo.path, registered, 'README.md'))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(await row('docs'))
    expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show in Explorer' }))
    await waitFor(() => expect(adapter.reveal).toHaveBeenLastCalledWith(repo, repo.path, registered, 'docs'))
    fireEvent.contextMenu(await row('README.md'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(onOpenFile).toHaveBeenLastCalledWith('README.md')
  })

  it('shows why the file manager could not be opened', async () => {
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(async () => { throw new Error('docs/x no longer exists.') }) }
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
    fireEvent.contextMenu(await row('docs'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show in Explorer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('docs/x no longer exists.')
  })

  it('opens a file in a window of its own from the menu, and a folder has no such item', async () => {
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(), openWindow: vi.fn(async () => ({ reused: false })) }
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
    fireEvent.contextMenu(await row('docs'))
    expect(screen.queryByRole('menuitem', { name: 'Open in new window' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(await row('README.md'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new window' }))
    await waitFor(() => expect(adapter.openWindow).toHaveBeenCalledWith({
      kind: 'editor', repo: { name: 'A', path: 'C:/repos/A' }, worktree: repo.path, path: 'README.md', registered,
    }))
  })

  it('ignores drags that are not files', async () => {
    const { adapter } = setup()
    fireEvent.drop(await row('docs'), { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(adapter.importFiles).not.toHaveBeenCalled()
  })
})
