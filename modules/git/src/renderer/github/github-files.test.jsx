import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
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
const clientWith = (tree = TREE) => ({ get: vi.fn(async path => (/git\/trees/.test(path) ? tree : [])) })
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

describe('GithubFiles path bar and panel', () => {
  const BRANCHES = [{ name: 'main' }, { name: 'old' }]
  beforeEachMock()
  function beforeEachMock() { /* getGithubFile is cleared by afterEach */ }

  it('puts a branch picker first in the path bar, even before a file is picked, and picks another branch', async () => {
    const onBranch = vi.fn()
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" branches={BRANCHES} onBranch={onBranch} />)
    await screen.findByRole('tree', { name: 'web folders' })
    fireEvent.click(screen.getByRole('button', { name: /^⑂ main/ }))
    expect(screen.getByRole('menuitemradio', { name: 'main' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'old' }))
    expect(onBranch).toHaveBeenCalledWith('old')
  })

  it('shows the path as crumbs once a file is picked', async () => {
    getGithubFile.mockResolvedValue({ text: 'hi', reason: null, url: '' })
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" branches={BRANCHES} onBranch={() => {}} />)
    fireEvent.click(await row('src'))
    fireEvent.click(await row('b.js'))
    expect((await screen.findByRole('navigation', { name: 'File path' })).textContent).toBe('web›src›b.js')
  })

  it('marks the matched word starts in the tree and says how many files match', async () => {
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" />)
    await screen.findByRole('tree', { name: 'web folders' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter files' }), { target: { value: 'a.j' } })
    expect([...document.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['a.j'])
    expect(screen.getByText('1 of 3 files match')).toBeTruthy()
  })

  it('offers Source | Preview for a Markdown file and renders it in Preview', async () => {
    getGithubFile.mockResolvedValue({ text: '# Title\n\nhello', reason: null, url: '' })
    const tree = { tree: [{ path: 'README.md', type: 'blob' }, { path: 'a.js', type: 'blob' }], truncated: false }
    render(<GithubFiles repo="acme/web" client={clientWith(tree)} branch="main" sha="abc" />)
    fireEvent.click(await row('a.js'))
    await screen.findByRole('textbox', { name: 'Preview of a.js' })
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull()
    fireEvent.click(await row('README.md'))
    expect((await screen.findByRole('textbox', { name: 'Preview of README.md' })).value).toContain('# Title')
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect((await screen.findByRole('heading', { name: 'Title' })).tagName).toBe('H1')
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(await screen.findByRole('textbox', { name: 'Preview of README.md' })).toBeTruthy()
  })

  it('shows the panel for the picked file: open pull request, history, and the open actions', async () => {
    getGithubFile.mockResolvedValue({ text: 'hi', reason: null, url: '' })
    const files = { get: vi.fn(async path => {
      if (/git\/trees/.test(path)) return TREE
      if (/pulls\/7\/files/.test(path)) return [{ filename: 'a.js', additions: 2, deletions: 0 }]
      if (/commits\?path=/.test(path)) return [{ sha: 'c'.repeat(40), commit: { message: 'Touch a', author: { date: new Date().toISOString() } } }]
      return []
    }) }
    const onViewPrs = vi.fn()
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    render(<GithubFiles repo="acme/web" client={files} branch="main" sha="abc" openPRs={[{ number: 7, title: 'Add search', lastActivity: '2024-01-01' }]} onViewPrs={onViewPrs}
      fileActions={() => [{ label: 'Open in Editor', primary: true, onSelect: () => {} }, { label: 'Open on GitHub', onSelect: () => {} }]} />)
    fireEvent.click(await row('a.js'))
    const rail = await screen.findByRole('complementary', { name: 'File details' })
    expect(await screen.findByText('#7 Add search')).toBeTruthy()
    expect(await screen.findByText('Touch a')).toBeTruthy()
    expect(rail.textContent).toContain('History on main')
    fireEvent.click(screen.getByRole('button', { name: 'View in Pull requests' }))
    expect(onViewPrs).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy permalink' }))
    expect(write).toHaveBeenCalledWith('https://github.com/acme/web/blob/abc/a.js')
  })

  it('hides the panel to a strip', async () => {
    getGithubFile.mockResolvedValue({ text: 'hi', reason: null, url: '' })
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" />)
    fireEvent.click(await row('a.js'))
    fireEvent.click(await screen.findByRole('button', { name: 'Hide panel' }))
    expect(screen.getByRole('button', { name: 'Show File details' })).toBeTruthy()
  })
})

describe('GithubFiles Markdown from a repository', () => {
  it('renders it strictly: a form in a README cannot be submitted from the app', async () => {
    getGithubFile.mockResolvedValue({ text: '# Title\n\n<form action="https://evil.example"><button>Go</button></form>', reason: null, url: '' })
    const tree = { tree: [{ path: 'README.md', type: 'blob' }], truncated: false }
    render(<GithubFiles repo="acme/web" client={clientWith(tree)} branch="main" sha="abc" />)
    fireEvent.click(await row('README.md'))
    await screen.findByRole('textbox', { name: 'Preview of README.md' })
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    await screen.findByRole('heading', { name: 'Title' })
    expect(document.querySelector('.nx-gw-fx-md form, .nx-gw-fx-md button, .nx-gw-fx-md [action]')).toBeNull()
  })
})

describe('GithubFiles: Pin to Dashboard', () => {
  const pinned = []
  const onPin = e => pinned.push(e.detail)
  beforeEach(() => { pinned.length = 0; window.addEventListener('nexusmd:pin-shortcut', onPin) })
  afterEach(() => window.removeEventListener('nexusmd:pin-shortcut', onPin))

  it('pins a file on the branch being looked at', async () => {
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="feature/x" sha="abc" />)
    fireEvent.contextMenu(await row('a.js'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to Dashboard' }))
    expect(pinned).toEqual([{ target: 'git', kind: 'file', path: '/a.js', branch: 'feature/x', repo: { provider: 'github', name: 'web', fullName: 'acme/web' } }])
  })

  it('pins a folder too, which had no menu before', async () => {
    render(<GithubFiles repo="acme/web" client={clientWith()} branch="main" sha="abc" />)
    fireEvent.contextMenu(await row('src'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to Dashboard' }))
    expect(pinned[0]).toMatchObject({ kind: 'folder', path: '/src', branch: 'main' })
  })
})
