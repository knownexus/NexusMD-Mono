import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { FilesPane, forgetFilesView } from './files-pane.jsx'

// The tab remembers open folders per worktree for the session; each test starts afresh.
afterEach(() => { cleanup(); forgetFilesView() })

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const files = ['README.md', 'docs/guide.md', 'src/app.jsx']
const dropped = name => ({ name })

function setup({ plan = { total: 1, conflicts: [], failed: [] }, result = { added: 1, replaced: 0, skipped: 0, failed: [] }, changes, worktreePath = repo.path } = {}) {
  const adapter = {
    files: vi.fn(async () => ({ files, truncated: false })),
    pathForFile: vi.fn(f => (f.name === 'unknown' ? '' : `D:\\in\\${f.name}`)),
    importFiles: vi.fn(async (_r, _w, _g, _d, _s, options) => (options?.dryRun ? plan : result)),
  }
  const onImported = vi.fn()
  render(<div className="nx-gw-files-body"><FilesPane adapter={adapter} repo={repo} worktreePath={worktreePath} registered={registered} version={1} onImported={onImported} changes={changes} /></div>)
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

  describe('opening a file in another app', () => {
    const adapterWith = extra => ({ files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(), ...extra })
    const hostWith = provided => {
      const calls = []
      return { calls, host: { capabilities: { has: n => provided.includes(n), call: (...a) => { calls.push(a); return Promise.resolve(true) } } } }
    }

    it('uses the Editor app when it is installed', async () => {
      const adapter = adapterWith({ openExternal: vi.fn() })
      const { host, calls } = hostWith(['editor.openPath'])
      render(<FilesPane adapter={adapter} host={host} repo={repo} worktreePath={'C:\\repos\\A'} registered={registered} version={1} />)
      fireEvent.contextMenu(await row('docs'))
      fireEvent.click(await row('docs'))
      fireEvent.contextMenu(await row('guide.md'))
      expect(screen.queryByRole('menuitem', { name: 'Open with default app' })).toBeNull()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Editor' }))
      await waitFor(() => expect(calls).toEqual([['editor.openPath', 'C:\\repos\\A\\docs\\guide.md']]))
      expect(adapter.openExternal).not.toHaveBeenCalled()
    })

    it('falls back to the system default app when there is no Editor', async () => {
      const adapter = adapterWith({ openExternal: vi.fn(async () => {}) })
      render(<FilesPane adapter={adapter} host={hostWith([]).host} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
      fireEvent.contextMenu(await row('README.md'))
      expect(screen.queryByRole('menuitem', { name: 'Open in Editor' })).toBeNull()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open with default app' }))
      await waitFor(() => expect(adapter.openExternal).toHaveBeenCalledWith(repo, repo.path, registered, 'README.md'))
    })

    it('also falls back when there is no host at all', async () => {
      const adapter = adapterWith({ openExternal: vi.fn(async () => {}) })
      render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
      fireEvent.contextMenu(await row('README.md'))
      expect(screen.getByRole('menuitem', { name: 'Open with default app' })).toBeTruthy()
    })

    it('says why the default app was not used, e.g. for a script', async () => {
      const adapter = adapterWith({ openExternal: vi.fn(async () => { throw new Error('run.bat is a kind of file that can run something, so it isn\'t opened from here.') }) })
      render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
      fireEvent.contextMenu(await row('README.md'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open with default app' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/can run something/)
    })

    it('offers neither for a folder', async () => {
      render(<FilesPane adapter={adapterWith({})} host={hostWith(['editor.openPath']).host} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
      fireEvent.contextMenu(await row('docs'))
      expect(screen.queryByRole('menuitem', { name: 'Open in Editor' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Open with default app' })).toBeNull()
    })
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

  it('marks each changed file by where its change is, in the Changes tab colours, and folders holding changes with a dot', async () => {
    setup({ changes: [
      { path: 'README.md', area: 'unstaged', xy: '.M' },
      { path: 'README.md', area: 'staged', xy: 'M.' },
      { path: 'docs/guide.md', area: 'untracked', xy: '??' },
      { path: 'src/app.jsx', area: 'staged', xy: 'A.' },
    ] })
    const readme = await row('README.md')
    const codes = [...readme.querySelectorAll('.nx-gw-tree-code')]
    expect(codes.map(c => [c.firstChild.textContent, c.dataset.tone, c.title])).toEqual([['M', 'ok', 'Staged: modified'], ['M', 'warn', 'Not staged: modified']])
    expect(readme.querySelector('.nx-gw-tree-name').dataset.tone).toBe('warn')
    expect(readme.textContent).toContain('Staged: modified')
    const docs = await row('docs')
    expect(docs.querySelector('.nx-gw-tree-dot').title).toBe('1 changed file inside')
    expect(docs.querySelector('.nx-gw-tree-dot').dataset.tone).toBe('info')
    fireEvent.click(docs)
    const guide = (await row('guide.md')).querySelector('.nx-gw-tree-code')
    expect([guide.firstChild.textContent, guide.dataset.tone, guide.title]).toEqual(['?', 'info', 'Untracked'])
    fireEvent.click(await row('src'))
    const app = (await row('app.jsx')).querySelector('.nx-gw-tree-code')
    expect([app.firstChild.textContent, app.dataset.tone]).toEqual(['A', 'ok'])
  })

  it('explains the colours when there are changes, and not for a clean worktree', async () => {
    setup({ changes: [{ path: 'README.md', area: 'unstaged', xy: '.M' }] })
    const legend = await screen.findByRole('list', { name: 'What the colours mean' })
    expect(legend.textContent).toContain('Staged')
    expect(legend.textContent).toContain('Not staged')
    expect(legend.textContent).toContain('Untracked')
    cleanup()
    setup()
    await row('README.md')
    expect(screen.queryByRole('list', { name: 'What the colours mean' })).toBeNull()
  })

  it('shows no marks for a clean worktree', async () => {
    setup()
    await row('README.md')
    expect(document.querySelector('.nx-gw-tree-code, .nx-gw-tree-dot')).toBeNull()
  })

  describe('coming back to the tab', () => {
    beforeEach(() => forgetFilesView())

    it('keeps the folders that were open, and the scroll position, when the tab is left and opened again', async () => {
      setup()
      fireEvent.click(await row('docs'))
      await row('guide.md')
      const scroller = document.querySelector('.nx-gw-files-body')
      scroller.scrollTop = 120
      fireEvent.scroll(scroller)
      cleanup()
      setup()
      expect(await row('guide.md')).toBeTruthy()
      await waitFor(() => expect(document.querySelector('.nx-gw-files-body').scrollTop).toBe(120))
    })

    it('does not lose the position to a scroll while the files are still loading', async () => {
      setup()
      fireEvent.click(await row('docs'))
      await row('guide.md')
      const first = document.querySelector('.nx-gw-files-body')
      first.scrollTop = 120
      fireEvent.scroll(first)
      cleanup()
      // Opened again: the list is slow, and the box is scrolled (clamped to 0) before it arrives.
      let release
      const adapter = { files: vi.fn(() => new Promise(r => { release = () => r({ files, truncated: false }) })), pathForFile: vi.fn(), importFiles: vi.fn() }
      render(<div className="nx-gw-files-body"><FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} /></div>)
      const box = document.querySelector('.nx-gw-files-body')
      box.scrollTop = 0
      fireEvent.scroll(box)
      release()
      expect(await row('guide.md')).toBeTruthy()
      await waitFor(() => expect(box.scrollTop).toBe(120))
    })


    it('remembers each worktree on its own', async () => {
      setup()
      fireEvent.click(await row('docs'))
      await row('guide.md')
      cleanup()
      setup({ worktreePath: 'C:/repos/A-feature' })
      await row('docs')
      expect((await screen.findAllByRole('treeitem')).some(r => r.textContent.includes('guide.md'))).toBe(false)
    })
  })
})
