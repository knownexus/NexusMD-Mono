import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), listGithubContents: vi.fn(), getGithubFile: vi.fn() }))
import { listGithubContents, getGithubFile } from '@nexusmd/core'
import { GithubFiles } from './github-files.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })
const client = {}
const ROOT = [{ name: 'src', path: 'src', type: 'dir', size: 0 }, { name: 'a.js', path: 'a.js', type: 'file', size: 5 }, { name: 'big.bin', path: 'big.bin', type: 'file', size: 9e6 }]

describe('GithubFiles', () => {
  it('lists the root, navigates into a dir and shows the breadcrumb', async () => {
    listGithubContents.mockImplementation(async (c, r, { path }) => (path ? [{ name: 'b.js', path: 'src/b.js', type: 'file', size: 1 }] : ROOT))
    render(<GithubFiles repo="acme/web" client={client} branch="main" />)
    await screen.findByText('src')
    expect(listGithubContents).toHaveBeenCalledWith(client, 'acme/web', { path: '', ref: 'main' })
    fireEvent.click(screen.getByText('src'))
    expect(await screen.findByText('b.js')).toBeTruthy()
    expect(listGithubContents).toHaveBeenCalledWith(client, 'acme/web', { path: 'src', ref: 'main' })
    expect(screen.getByRole('navigation').textContent).toContain('src')
  })

  it('shows a file\'s text read-only', async () => {
    listGithubContents.mockResolvedValue(ROOT)
    getGithubFile.mockResolvedValue({ text: 'hello world', reason: null, url: 'https://github.com/x' })
    render(<GithubFiles repo="acme/web" client={client} branch="main" />)
    fireEvent.click(await screen.findByText('a.js'))
    const pre = await screen.findByText('hello world')
    expect(pre.tagName).toBe('PRE')
  })

  it('links too-large files to GitHub', async () => {
    listGithubContents.mockResolvedValue(ROOT)
    getGithubFile.mockResolvedValue({ text: '', reason: 'too-large', url: 'https://github.com/acme/web/blob/main/big.bin' })
    render(<GithubFiles repo="acme/web" client={client} branch="main" />)
    fireEvent.click(await screen.findByText('big.bin'))
    const a = await screen.findByText('Open on GitHub')
    expect(a.closest('a').getAttribute('href')).toBe('https://github.com/acme/web/blob/main/big.bin')
  })

  it('shows the error message', async () => {
    listGithubContents.mockRejectedValue(new Error('Rate limited'))
    render(<GithubFiles repo="acme/web" client={client} branch="main" />)
    expect(await screen.findByText('Rate limited')).toBeTruthy()
  })
})
