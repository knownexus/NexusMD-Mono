import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'

// CodeMirror is tested on its own; the preview here is a plain read-only textarea.
vi.mock('@nexusmd/editor-kit/code-editor.jsx', () => ({
  languageForPath: () => 'plaintext',
  CodeEditor: ({ value, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} readOnly />,
}))
vi.mock('@nexusmd/ui', async orig => ({ ...(await orig()), toast: vi.fn() }))

import { toast } from '@nexusmd/ui'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from './git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'
import { forgetFilesView } from './files-pane.jsx'
import { requestOpen, takeOpenRequest, forgetRepoRemotes } from './shortcut-open.js'

afterEach(() => { cleanup(); forgetFilesView() })
beforeEach(() => { localStorage.clear(); clearGitSnapshotCache(); forgetRepoRemotes(); takeOpenRequest(); vi.mocked(toast).mockClear() })

const porcelain = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0'
const files = ['README.md', 'docs/guide.md', 'docs/deep/note.md', 'src/app.jsx']
function adapter() {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    files: vi.fn(async () => ({ files, truncated: false })),
    readFile: vi.fn(async () => ({ text: 'content' })),
    log: vi.fn(async () => ({ text: '', tip: 'x' })),
    remotes: vi.fn(async () => ''),
  }
}
const configure = () => setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }] })
const treeItem = async name => (await screen.findAllByRole('treeitem')).find(r => r.textContent.includes(name))

describe('ViewGit opened from a Home shortcut', () => {
  it('shows a file in the Files tab of its repository, folders opened and the file picked', async () => {
    configure()
    requestOpen({ repoPath: 'C:/repos/A', path: '/docs/deep/note.md', kind: 'file' })
    render(<ViewGit adapters={{ git: adapter() }} />)
    await waitFor(() => expect(getGitConfig().view).toMatchObject({ selected: 'C:/repos/A', panel: 'files' }))
    const note = await treeItem('note.md')
    expect(note.getAttribute('aria-selected')).toBe('true')
    expect(await treeItem('deep')).toBeTruthy()
    expect(takeOpenRequest()).toBeNull() // taken
  })

  it('opens a folder with nothing picked', async () => {
    configure()
    requestOpen({ repoPath: 'C:/repos/A', path: '/docs', kind: 'folder' })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect(await treeItem('guide.md')).toBeTruthy()
    for (const r of screen.getAllByRole('treeitem')) expect(r.getAttribute('aria-selected')).not.toBe('true')
  })

  it('takes a request made while the page is already showing, and moves to that repository', async () => {
    configure()
    setGitConfig({ view: { ...getGitConfig().view, selected: 'C:/repos/B', panel: 'changes' } })
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    act(() => requestOpen({ repoPath: 'C:/repos/A', path: '/src/app.jsx', kind: 'file' }))
    await waitFor(() => expect(getGitConfig().view).toMatchObject({ selected: 'C:/repos/A', panel: 'files' }))
    expect((await treeItem('app.jsx')).getAttribute('aria-selected')).toBe('true')
  })

  it('shows the place again in an explorer that was already drawn for that worktree', async () => {
    configure()
    requestOpen({ repoPath: 'C:/repos/A', path: '/README.md', kind: 'file' })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect((await treeItem('README.md')).getAttribute('aria-selected')).toBe('true')
    act(() => requestOpen({ repoPath: 'C:/repos/A', path: '/src/app.jsx', kind: 'file' }))
    await waitFor(async () => expect((await treeItem('app.jsx')).getAttribute('aria-selected')).toBe('true'))
    expect((await treeItem('README.md')).getAttribute('aria-selected')).not.toBe('true')
  })

  it('says so, and changes nothing, when the repository is not registered', async () => {
    configure()
    const before = getGitConfig().view
    requestOpen({ repoPath: 'C:/repos/Nope', path: '/a', kind: 'file' })
    render(<ViewGit adapters={{ git: adapter() }} />)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That repository is not available here.', 'error'))
    expect(getGitConfig().view.selected).toBe(before.selected)
    expect(getGitConfig().view.panel).toBe(before.panel)
  })

  it('leaves the page alone when nothing was asked', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    expect(toast).not.toHaveBeenCalled()
    expect(getGitConfig().view.panel).toBe('changes')
  })
})
