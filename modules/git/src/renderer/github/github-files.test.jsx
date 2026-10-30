import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), getGithubFile: vi.fn() }))
vi.mock('@nexusmd/editor-kit/code-editor.jsx', () => ({
  languageForPath: () => 'plaintext',
  CodeEditor: ({ value, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} readOnly />,
}))
import { getGithubFile } from '@nexusmd/core'
import { GithubFiles } from './github-files.jsx'
import { forgetExplorerViews } from '../file-explorer.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks(); forgetExplorerViews() })
const TREE = { tree: [{ path: 'src', type: 'tree' }, { path: 'src/b.js', type: 'blob' }, { path: 'a.js', type: 'blob' }, { path: 'big.bin', type: 'blob' }, { path: 'vendor/lib', type: 'commit' }], truncated: false }
const clientWith = (tree = TREE) => ({ get: vi.fn(async () => tree) })
const row = async name => (await screen.findAllByRole('treeitem')).find(r => r.textContent.includes(name))

describe('GithubFiles', () => {
  it('lists every file at the commit in one call, as the same tree as a local worktree', async () => {
    const client = clientWith()
    render(<GithubFiles repo="acme/web" client={client} branch="feature/x" sha="abc123" />)
    expect(await screen.findByRole('tree', { name: 'web folders' })).toBeTruthy()
    expect(client.get).toHaveBeenCalledWith('repos/acme/web/git/trees/abc123?recursive=1')
    expect(screen.getByText('3 files')).toBeTruthy()
    fireEvent.click(await row('src'))
    expect(await row('b.js')).toBeTruthy()
  })

  it('previews a file read-only, with the actions it is given', async () => {
    getGithubFile.mockResolvedValue({ text: 'hello world', reason: null, url: 'https://github.com/x' })
    const open = vi.fn()
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" fileActions={path => [{ label: 'Open in Editor', primary: true, onSelect: () => open(path) }]} />)
    fireEvent.click(await row('a.js'))
    expect((await screen.findByRole('textbox', { name: 'Preview of a.js' })).value).toBe('hello world')
    expect(getGithubFile).toHaveBeenCalledWith(expect.anything(), 'acme/web', { path: 'a.js', ref: 'main' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }))
    expect(open).toHaveBeenCalledWith('a.js')
    fireEvent.contextMenu(await row('a.js'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Editor' }))
    expect(open).toHaveBeenCalledTimes(2)
  })

  it("says why a file isn't shown and links it to GitHub", async () => {
    getGithubFile.mockResolvedValue({ text: null, reason: 'too-large', url: 'https://github.com/acme/web/blob/main/big.bin' })
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" />)
    fireEvent.click(await row('big.bin'))
    expect(await screen.findByText(/too large to show here/)).toBeTruthy()
    expect(screen.getAllByText('Open on GitHub').find(e => e.tagName === 'A').getAttribute('href')).toBe('https://github.com/acme/web/blob/main/big.bin')
  })

  it('shows why an action failed', async () => {
    getGithubFile.mockResolvedValue({ text: 'x', reason: null, url: '' })
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" fileActions={() => [{ label: 'Open in Editor', onSelect: async () => { throw new Error('Rate limited') } }]} />)
    fireEvent.click(await row('a.js'))
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Editor' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Rate limited')
  })

  it('shows why the files could not be listed, and says when GitHub cut the list short', async () => {
    render(<GithubFiles repo="acme/web" client={{ get: vi.fn(async () => { throw new Error('Rate limited') }) }} branch="main" sha="abc" />)
    expect(await screen.findByText('Rate limited')).toBeTruthy()
    cleanup()
    render(<GithubFiles repo="acme/web" client={clientWith({ ...TREE, truncated: true })} branch="main" sha="abc" />)
    expect(await screen.findByText('Showing the first 3 files.')).toBeTruthy()
  })
})
