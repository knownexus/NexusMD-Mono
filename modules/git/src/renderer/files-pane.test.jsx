import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
// CodeMirror is tested on its own; the preview here is a plain read-only textarea.
vi.mock('@nexusmd/editor-kit/code-editor.jsx', () => ({
  languageForPath: () => 'plaintext',
  CodeEditor: ({ value, ariaLabel, lineClasses }) => <textarea aria-label={ariaLabel} value={value} readOnly data-lines={JSON.stringify((lineClasses ?? []).map(l => l[0]))} />,
}))

import { FilesPane, forgetFilesView } from './files-pane.jsx'
import { forgetRecentFiles } from './use-recent-files.js'

// The tab remembers open folders per worktree for the session; each test starts afresh.
afterEach(() => { cleanup(); forgetFilesView(); forgetRecentFiles() })

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const files = ['README.md', 'docs/guide.md', 'src/app.jsx']
const dropped = name => ({ name })
const DIFF = ['diff --git a/src/app.jsx b/src/app.jsx', '--- a/src/app.jsx', '+++ b/src/app.jsx', '@@ -1,2 +1,3 @@', ' one', '+two', '+three', ''].join('\n')

function setup({ extra = {}, plan = { total: 1, conflicts: [], failed: [] }, result = { added: 1, replaced: 0, skipped: 0, failed: [] }, changes, worktreePath = repo.path } = {}) {
  const adapter = {
    files: vi.fn(async () => ({ files, truncated: false })),
    pathForFile: vi.fn(f => (f.name === 'unknown' ? '' : `D:\\in\\${f.name}`)),
    importFiles: vi.fn(async (_r, _w, _g, _d, _s, options) => (options?.dryRun ? plan : result)),
    readFile: vi.fn(async () => ({ text: 'one\ntwo\nthree\n' })),
    log: vi.fn(async () => ({ text: `* \x1e${'a'.repeat(40)}\x1f\x1fAna\x1fa@b\x1f1700000000\x1f\x1fFix the thing\n`, tip: 'x' })),
    diff: vi.fn(async () => ({ text: DIFF, stamp: 's1', truncated: false, binary: false, size: DIFF.length })),
  }
  const onImported = vi.fn()
  render(<div className="nx-gw-files-body"><FilesPane adapter={adapter} repo={repo} worktreePath={worktreePath} registered={registered} version={1} onImported={onImported} changes={changes} {...extra} /></div>)
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

  it('opens a file on double-click, and on Enter once it is picked, but not a folder', async () => {
    const onOpenFile = vi.fn()
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(async () => {}) }
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} onOpenFile={onOpenFile} />)
    fireEvent.doubleClick(await row('README.md'))
    expect(onOpenFile).toHaveBeenLastCalledWith('README.md')
    fireEvent.click(await row('docs'))
    fireEvent.doubleClick(await row('docs'))
    expect(onOpenFile).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(await row('guide.md'), { key: 'Enter' })
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

    it('keeps the folders that were open, the picked file and the scroll position, when the tab is left and opened again', async () => {
      setup()
      fireEvent.click(await row('docs'))
      await row('guide.md')
      const scroller = document.querySelector('.nx-gw-fx-scroll')
      scroller.scrollTop = 120
      fireEvent.scroll(scroller)
      fireEvent.click(await row('guide.md'))
      cleanup()
      setup()
      expect((await row('guide.md')).getAttribute('aria-selected')).toBe('true')
      await waitFor(() => expect(document.querySelector('.nx-gw-fx-scroll').scrollTop).toBe(120))
    })

    it('does not lose the position to a scroll while the files are still loading', async () => {
      setup()
      fireEvent.click(await row('docs'))
      await row('guide.md')
      const first = document.querySelector('.nx-gw-fx-scroll')
      first.scrollTop = 120
      fireEvent.scroll(first)
      cleanup()
      // Opened again: the list is slow, and the box is scrolled (clamped to 0) before it arrives.
      let release
      const adapter = { files: vi.fn(() => new Promise(r => { release = () => r({ files, truncated: false }) })), pathForFile: vi.fn(), importFiles: vi.fn() }
      render(<div className="nx-gw-files-body"><FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} /></div>)
      const box = document.querySelector('.nx-gw-fx-scroll')
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

  describe('the preview', () => {
    const adapterWith = extra => ({
      files: vi.fn(async () => ({ files: [...files, 'logo.png'], truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(),
      readFile: vi.fn(async (_r, _w, _g, rel) => ({ text: 'text of ' + rel, bom: false, stamp: 's' })),
      readImage: vi.fn(async () => ({ url: 'data:image/png;base64,AA', size: 10, mime: 'image/png' })),
      openWindow: vi.fn(async () => ({})), ...extra,
    })

    it('shows the picked file read-only, with Edit here, Open in Editor and New window in the panel', async () => {
      const onOpenFile = vi.fn()
      const adapter = adapterWith()
      const calls = []
      const host = { capabilities: { has: n => n === 'editor.openPath', call: (...a) => { calls.push(a); return Promise.resolve(true) } } }
      render(<FilesPane adapter={adapter} host={host} repo={repo} worktreePath={'C:\\repos\\A'} registered={registered} version={1} onOpenFile={onOpenFile} />)
      expect(await screen.findByText('Pick a file to see it here.')).toBeTruthy()
      fireEvent.click(await row('README.md'))
      expect((await screen.findByRole('textbox', { name: 'Preview of README.md' })).value).toBe('text of README.md')
      expect(adapter.readFile).toHaveBeenCalledWith(repo, 'C:\\repos\\A', registered, 'README.md')
      fireEvent.click(screen.getByRole('button', { name: /^Edit here/ }))
      expect(onOpenFile).toHaveBeenLastCalledWith('README.md')
      fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }))
      await waitFor(() => expect(calls).toEqual([['editor.openPath', 'C:\\repos\\A\\README.md']]))
      fireEvent.click(screen.getByRole('button', { name: 'New window' }))
      await waitFor(() => expect(adapter.openWindow).toHaveBeenCalled())
    })

    it('shows an image as an image, and why a file could not be read', async () => {
      const adapter = adapterWith({ readFile: vi.fn(async () => { throw new Error("Error invoking remote method 'git:readFile': Error: big.bin isn't a text file.") }) })
      render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
      fireEvent.click(await row('logo.png'))
      expect((await screen.findByRole('img', { name: 'logo.png' })).getAttribute('src')).toBe('data:image/png;base64,AA')
      fireEvent.click(await row('README.md'))
      expect((await screen.findByRole('alert')).textContent).toBe("big.bin isn't a text file.")
    })
  })
})

describe('FilesPane pinned groups', () => {
  const change = (area, path, xy) => ({ id: `${area}\0${path}`, path, originalPath: null, area, xy, sub: 'N...' })
  const changes = [change('unstaged', 'src/app.jsx', '.M'), change('staged', 'README.md', 'M.')]

  it('lists the changed files above the tree with their letter, name and folder, and picks one on click', async () => {
    setup({ changes })
    const group = await screen.findByRole('group', { name: 'Changed 2' })
    expect(group.textContent).toContain('app.jsx')
    expect(group.textContent).toContain('src')
    fireEvent.click(within(group).getByText('app.jsx'))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'File path' }).textContent).toBe('A›src›app.jsx'))
  })

  it('tints a staged file in the staged colour', async () => {
    setup({ changes })
    const group = await screen.findByRole('group', { name: 'Changed 2' })
    expect(within(group).getByText('README.md').closest('button').getAttribute('data-tone')).toBe('ok')
    expect(within(group).getByText('app.jsx').closest('button').getAttribute('data-tone')).toBe('warn')
  })

  it('has no Changed group for a clean worktree', async () => {
    setup({ changes: [] })
    await row('docs')
    expect(screen.queryByRole('group', { name: /^Changed/ })).toBeNull()
  })

  it('lists the files opened this session under Recent, newest first', async () => {
    setup()
    expect(screen.queryByRole('group', { name: 'Recent' })).toBeNull()
    fireEvent.click(await row('README.md'))
    fireEvent.click(await row('src'))
    fireEvent.click(await row('app.jsx'))
    const recent = screen.getByRole('group', { name: 'Recent' })
    expect([...recent.querySelectorAll('button')].map(b => b.title)).toEqual(['src/app.jsx', 'README.md'])
  })
})

describe('FilesPane preview', () => {
  const change = (area, path, xy) => ({ id: `${area}\0${path}`, path, originalPath: null, area, xy, sub: 'N...' })
  const changes = [change('unstaged', 'src/app.jsx', '.M')]
  const pick = async name => { fireEvent.click(await row('src')); fireEvent.click(await row(name)) }

  it('shows the path as crumbs from the repository down to the file', async () => {
    setup()
    await pick('app.jsx')
    expect((await screen.findByRole('navigation', { name: 'File path' })).textContent).toBe('A›src›app.jsx')
  })

  it('shows language, lines, size, line ending and encoding in a status footer', async () => {
    setup()
    await pick('app.jsx')
    const footer = await screen.findByRole('status', { name: 'File details' })
    expect(footer.textContent).toContain('JavaScript')
    expect(footer.textContent).toContain('3 lines')
    expect(footer.textContent).toContain('14 B')
    expect(footer.textContent).toContain('LF')
    expect(footer.textContent).toContain('UTF-8')
  })

  it('has no File | Diff switch for a file that is not changed', async () => {
    setup({ changes })
    await pick('README.md')
    await screen.findByRole('navigation', { name: 'File path' })
    expect(screen.queryByRole('tab', { name: 'Diff' })).toBeNull()
  })

  it('marks the changed lines in the file, and switches to the same diff as Changes', async () => {
    setup({ changes })
    await pick('app.jsx')
    expect(await screen.findByRole('tab', { name: 'Diff' })).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Preview of src/app.jsx').getAttribute('data-lines')).toBe('[2,3]'))
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }))
    expect(await screen.findByRole('region', { name: 'Diff' })).toBeTruthy()
    expect(screen.getAllByTestId('diff-line').length).toBe(3)
    fireEvent.click(screen.getByRole('tab', { name: 'File' }))
    expect(await screen.findByLabelText('Preview of src/app.jsx')).toBeTruthy()
  })

  it('remembers File or Diff for the worktree when the tab is left and come back to', async () => {
    setup({ changes })
    await pick('app.jsx')
    fireEvent.click(await screen.findByRole('tab', { name: 'Diff' }))
    cleanup()
    setup({ changes })
    expect(await screen.findByRole('region', { name: 'Diff' })).toBeTruthy()
  })
})

describe('FilesPane right-hand panel', () => {
  const change = (area, path, xy) => ({ id: `${area}\0${path}`, path, originalPath: null, area, xy, sub: 'N...' })
  const changes = [change('unstaged', 'src/app.jsx', '.M')]
  const pick = async name => { fireEvent.click(await row('src')); fireEvent.click(await row(name)) }

  it('shows the picked file\'s details with its recent commits, and no preview actions in the path bar', async () => {
    setup({ changes })
    await pick('app.jsx')
    const rail = await screen.findByRole('complementary', { name: 'File details' })
    expect(rail.textContent).toContain('Modified · not staged')
    expect(await screen.findByText('Fix the thing')).toBeTruthy()
    expect(document.querySelector('.nx-gw-pathbar-end button[title]')).toBeNull()
  })

  it('hides to a strip that shows it again, remembered for the tab kind', async () => {
    setup({ changes })
    await pick('app.jsx')
    fireEvent.click(await screen.findByRole('button', { name: 'Hide panel' }))
    expect(screen.getByRole('button', { name: 'Show File details' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.includes('git.config')))).view.railOpen.files).toBe(false)
  })

  it('stages and discards the picked change through the page, and opens a commit in History', async () => {
    const onWrite = vi.fn()
    const onAction = vi.fn()
    const onOpenCommit = vi.fn()
    setup({ changes, extra: { onWrite, onAction, onOpenCommit } })
    await pick('app.jsx')
    fireEvent.click(await screen.findByRole('button', { name: 'Stage' }))
    expect(onWrite).toHaveBeenCalledWith('stage', [changes[0].id])
    fireEvent.click(screen.getByRole('button', { name: 'Discard…' }))
    expect(onAction).toHaveBeenCalledWith('discard', [changes[0].id])
    fireEvent.click(await screen.findByText('Fix the thing'))
    expect(onOpenCommit).toHaveBeenCalledWith('a'.repeat(40))
  })

  it('View diff in the panel switches the preview to the diff', async () => {
    setup({ changes })
    await pick('app.jsx')
    fireEvent.click(await screen.findByRole('button', { name: 'View diff' }))
    expect(await screen.findByRole('region', { name: 'Diff' })).toBeTruthy()
  })
})

describe('FilesPane Changed pin with many changes', () => {
  const many = n => Array.from({ length: n }, (_, i) => ({ id: `unstaged\0f${i}.txt`, path: `f${i}.txt`, originalPath: null, area: 'unstaged', xy: '.M', sub: 'N...' }))

  it('shows a few rows and offers the rest, so the tree keeps its room', async () => {
    setup({ changes: many(40) })
    const group = await screen.findByRole('group', { name: 'Changed 40' })
    expect(group.querySelectorAll('.nx-gw-pin-row')).toHaveLength(8)
    fireEvent.click(within(group).getByRole('button', { name: 'Show 32 more' }))
    expect(group.querySelectorAll('.nx-gw-pin-row')).toHaveLength(40)
    fireEvent.click(within(group).getByRole('button', { name: 'Show fewer' }))
    expect(group.querySelectorAll('.nx-gw-pin-row')).toHaveLength(8)
  })

  it('never draws thousands of buttons: expanded, it stops at 300 and says how many are left', async () => {
    setup({ changes: many(1000) })
    const group = await screen.findByRole('group', { name: 'Changed 1000' })
    fireEvent.click(within(group).getByRole('button', { name: 'Show 992 more' }))
    expect(group.querySelectorAll('.nx-gw-pin-row')).toHaveLength(300)
    expect(within(group).getByText('700 more in the Changes tab')).toBeTruthy()
  })

  it('has no toggle for a handful', async () => {
    setup({ changes: many(5) })
    const group = await screen.findByRole('group', { name: 'Changed 5' })
    expect(within(group).queryByRole('button', { name: /Show/ })).toBeNull()
  })
})

describe('FilesPane: Pin to Dashboard', () => {
  const adapterWith = remotes => ({ files: vi.fn(async () => ({ files, truncated: false })), pathForFile: vi.fn(), importFiles: vi.fn(), reveal: vi.fn(), remotes: vi.fn(async () => remotes) })
  const pinned = []
  const onPin = e => pinned.push(e.detail)
  beforeEach(() => { pinned.length = 0; window.addEventListener('nexusmd:pin-shortcut', onPin) })
  afterEach(() => window.removeEventListener('nexusmd:pin-shortcut', onPin))

  it('pins a file of a GitHub clone by the repository’s owner and name', async () => {
    const adapter = adapterWith('origin\tgit@github.com:acme/web.git (fetch)\norigin\tgit@github.com:acme/web.git (push)\n')
    render(<FilesPane adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
    fireEvent.contextMenu(await row('README.md'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to Dashboard' }))
    await waitFor(() => expect(pinned).toHaveLength(1))
    expect(pinned[0]).toEqual({
      target: 'git', kind: 'file', path: '/README.md',
      repo: { provider: 'github', name: 'web', fullName: 'acme/web', remote: 'github.com/acme/web' },
    })
    expect(adapter.remotes).toHaveBeenCalledWith(repo, repo.path, registered)
  })

  it('pins a folder, from its own row', async () => {
    render(<FilesPane adapter={adapterWith('')} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
    fireEvent.contextMenu(await row('docs'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to Dashboard' }))
    await waitFor(() => expect(pinned).toHaveLength(1))
    expect(pinned[0]).toMatchObject({ kind: 'folder', path: '/docs', repo: { provider: 'local', name: 'A' } })
  })

  it('pins a file inside a folder with its whole path', async () => {
    render(<FilesPane adapter={adapterWith('')} repo={repo} worktreePath={repo.path} registered={registered} version={1} />)
    fireEvent.click(await row('docs'))
    fireEvent.contextMenu(await row('guide.md'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to Dashboard' }))
    await waitFor(() => expect(pinned).toHaveLength(1))
    expect(pinned[0]).toMatchObject({ kind: 'file', path: '/docs/guide.md' })
  })
})
